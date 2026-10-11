import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ROOT } from './storage.mjs';
import { githubApiGet } from './usage.mjs';

export const CLOCK_SOURCE = 'github-environment-clock';
const repository = 'xndanius/while-you-sleep';
const numeric = value => /^[1-9]\d{0,15}$/.test(String(value || '')) && Number.isSafeInteger(Number(value));
const attemptNumber = value => /^[1-9]\d{0,3}$/.test(String(value || ''));
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const url = id => `https://github.com/${repository}/actions/runs/${id}`;
const supported = kind => ['loop', 'research', 'measure', 'improve'].includes(kind);
const clockActor = 'github-actions[bot]';
const runStatuses = ['queued', 'requested', 'pending', 'waiting', 'in_progress', 'completed'];

export function validClockProvenance(clock, { kind, runId } = {}) {
  if(!clock||typeof clock!=='object'||Array.isArray(clock)||typeof clock.workflow!=='string')return false;
  const workflowKind=clock.workflow.replace(/\.yml$/, '');
  // Old committed proofs predate child identity fields. Their enclosing record
  // still has to bind attempt 1; a partial or contradictory new identity fails.
  const hasChildIdentity=['runAttempt','actor','triggeringActor'].some(field=>Object.hasOwn(clock,field));
  return clock.source === CLOCK_SOURCE && clock.verified === true
    && supported(kind || workflowKind)
    && clock.workflow === `${kind || workflowKind}.yml`
    && numeric(clock.clockRunId) && attemptNumber(clock.parentAttempt) && numeric(clock.runId)
    && (!runId || String(clock.runId) === String(runId))
    && clock.tickId === `clock-${clock.clockRunId}-${clock.parentAttempt}`
    && clock.dispatchId === `${clock.tickId}-${clock.workflow.replace(/\.yml$/, '')}`
    && clock.clockRunUrl === url(clock.clockRunId)
    && (!hasChildIdentity || (clock.runAttempt === 1 && clock.actor === clockActor && clock.triggeringActor === clockActor))
    && timestamp(clock.tickedAt) && timestamp(clock.requestedAt) && timestamp(clock.verifiedAt);
}

export function trustedClockTick(receipt) {
  return !!receipt && receipt.kind==='clock-tick' && numeric(receipt.githubRunId) && attemptNumber(receipt.githubRunAttempt)
    && receipt.id===`clock-${receipt.githubRunId}-${receipt.githubRunAttempt}`
    && receipt.githubRunUrl===url(receipt.githubRunId) && receipt.environment==='clock' && receipt.waitMinutes===15
    && timestamp(receipt.claimedAt) && timestamp(receipt.tickedAt)
    && Date.parse(receipt.tickedAt)-Date.parse(receipt.claimedAt)>=15*60000 && Array.isArray(receipt.dispatches);
}

export function clockReceiptMatches(clock, receipt) {
  if(!validClockProvenance(clock)||!trustedClockTick(receipt)||clock.tickId!==receipt.id||clock.tickedAt!==receipt.tickedAt)return false;
  const matches=receipt.dispatches.filter(dispatch=>dispatch?.dispatchId===clock.dispatchId);
  return matches.length===1 && matches[0].workflow===clock.workflow && String(matches[0].runId)===String(clock.runId)
    && matches[0].githubRunUrl===url(clock.runId) && matches[0].requestedAt===clock.requestedAt;
}

// Inputs are a lookup, never proof. The committed trusted clock receipt must
// identify this exact child run, and GitHub must identify both runs. A human
// rerun retains the run ID and inputs, so its attempt and actors also matter.
export async function verifyClockDispatch({ kind, root = ROOT, env = process.env, apiGet = githubApiGet, now = new Date() } = {}) {
  const parentId = env.CLOCK_TICK_RUN_ID, dispatchId = env.CLOCK_DISPATCH_ID, parentAttempt = env.CLOCK_PARENT_ATTEMPT;
  if (![parentId, dispatchId, parentAttempt].some(Boolean)) return null;
  if (!supported(kind) || env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || env.GITHUB_REPOSITORY !== repository || !numeric(env.GITHUB_RUN_ID) || !numeric(parentId) || !attemptNumber(parentAttempt)
    || env.GITHUB_RUN_ATTEMPT !== '1' || env.GITHUB_ACTOR !== clockActor || env.GITHUB_TRIGGERING_ACTOR !== clockActor
    || (env.GITHUB_REF && env.GITHUB_REF !== 'refs/heads/main')) throw new Error('Untrusted clock dispatch context.');
  const tickId = `clock-${parentId}-${parentAttempt}`;
  if (dispatchId !== `${tickId}-${kind}`) throw new Error('Clock dispatch identifier does not bind this workflow.');
  const file = path.join(root, 'data', 'clock', 'ticks', `${tickId}.json`);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262144) throw new Error('Clock receipt is not a bounded trusted record.');
  const receipt = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!trustedClockTick(receipt) || receipt.id !== tickId || String(receipt.githubRunId) !== String(parentId)
    || Number(receipt.githubRunAttempt) !== Number(parentAttempt) || receipt.githubRunUrl !== url(parentId)
    || receipt.environment !== 'clock' || receipt.waitMinutes !== 15 || !timestamp(receipt.tickedAt)
    || !timestamp(receipt.claimedAt) || Date.parse(receipt.claimedAt) > Date.parse(receipt.tickedAt)
    || !Array.isArray(receipt.dispatches)) throw new Error('Clock receipt does not bind its parent tick.');
  const matches = receipt.dispatches.filter(dispatch => dispatch.dispatchId === dispatchId);
  const dispatch = matches[0];
  if (matches.length !== 1 || dispatch.workflow !== `${kind}.yml` || String(dispatch.runId) !== String(env.GITHUB_RUN_ID)
    || dispatch.githubRunUrl !== url(env.GITHUB_RUN_ID) || !timestamp(dispatch.requestedAt)
    || Date.parse(dispatch.requestedAt) < Date.parse(receipt.tickedAt)) throw new Error('Clock receipt does not identify this exact dispatched run.');
  const body = await apiGet(`repos/${repository}/actions/runs/${parentId}`, { maxBytes: 2 * 1024 * 1024, env });
  const parent = typeof body === 'string' ? JSON.parse(body) : body;
  if (String(parent?.id) !== String(parentId) || parent.repository?.full_name !== repository
    || parent.head_repository?.full_name !== repository
    || parent.head_branch !== 'main' || parent.path !== '.github/workflows/clock.yml' || parent.event !== 'workflow_dispatch'
    // The committed tick proves that this parent's clock wait already elapsed.
    // A later Pages job can put the same run back into an environment wait.
    || Number(parent.run_attempt) !== Number(parentAttempt) || !runStatuses.includes(parent.status)) {
    throw new Error('GitHub did not verify the recorded parent clock run.');
  }
  const childBody = await apiGet(`repos/${repository}/actions/runs/${env.GITHUB_RUN_ID}`, { maxBytes: 2 * 1024 * 1024, env });
  const child = typeof childBody === 'string' ? JSON.parse(childBody) : childBody;
  if (String(child?.id) !== String(env.GITHUB_RUN_ID) || child.repository?.full_name !== repository
    || child.head_repository?.full_name !== repository || child.head_branch !== 'main'
    || child.path !== `.github/workflows/${kind}.yml` || child.event !== env.GITHUB_EVENT_NAME
    || child.run_attempt !== 1 || String(child.run_attempt) !== env.GITHUB_RUN_ATTEMPT
    || child.actor?.login !== env.GITHUB_ACTOR || child.triggering_actor?.login !== env.GITHUB_TRIGGERING_ACTOR
    || !runStatuses.includes(child.status)) throw new Error('GitHub did not verify the exact first-attempt clock child run.');
  return {
    source: CLOCK_SOURCE, verified: true, tickId, clockRunId: String(parentId), parentAttempt: Number(parentAttempt),
    clockRunUrl: url(parentId), dispatchId, runId: String(env.GITHUB_RUN_ID), workflow: `${kind}.yml`,
    runAttempt: child.run_attempt, actor: child.actor.login, triggeringActor: child.triggering_actor.login,
    tickedAt: receipt.tickedAt, requestedAt: dispatch.requestedAt, verifiedAt: new Date(now).toISOString(),
    parentHeadSha: /^[a-f0-9]{40}$/.test(parent.head_sha || '') ? parent.head_sha : null,
  };
}
