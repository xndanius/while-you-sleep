import { sha256, stableJSON } from './storage.mjs';
import { validateRuleProposal } from './improvement.mjs';
import { parseScoringPolicy } from './scoring.mjs';

const observationKeys = ['publishedPosts', 'draftedPosts', 'rejectedCandidates', 'researchRuns'];
const platforms = ['x', 'instagram', 'linkedin'];
const metricKeys = ['views', 'impressions', 'likes', 'reactions', 'comments', 'replies', 'shares', 'reposts', 'followers', 'follows', 'clicks', 'reach', 'engagement', 'saves', 'post_clicks', 'post_impressions', 'profile_visits', 'new_followers'];
const metricStates = new Set(['measured', 'partial', 'unavailable', 'not_connected', 'pending_setup', 'failed']);
const state = value => metricStates.has(value) ? value : 'unavailable';
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const metric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const object = value => value && typeof value === 'object' && !Array.isArray(value);

function statusCounts(values) {
  if (!values) return { measured: null, unavailable: null };
  return { measured: values.filter(value => value.status === 'measured').length, unavailable: values.filter(value => value.status !== 'measured').length };
}

function publicMetrics(input) {
  const posts = Array.isArray(input?.social?.posts) ? input.social.posts.filter(object) : null;
  const channels = Array.isArray(input?.social?.channels) ? input.social.channels.filter(object) : null;
  const aggregate = {};
  for (const platform of platforms) {
    const values = posts?.map(post => post[platform]).filter(object) ?? null;
    const counts = statusCounts(values);
    const totals = {};
    for (const key of metricKeys) {
      const measured = values?.filter(value => value.status === 'measured').map(value => metric(value.metrics?.[key])).filter(value => value !== null) ?? [];
      const total = measured.reduce((sum, value) => sum + value, 0);
      totals[key] = measured.length && Number.isFinite(total) ? total : null;
    }
    aggregate[platform] = { measuredPosts: counts.measured, unavailablePosts: counts.unavailable, metrics: totals };
  }
  const postStates = posts?.map(post => {
    const results = platforms.map(platform => post[platform]).filter(object);
    return { status: results.some(result => result.status === 'measured') ? 'measured' : 'unavailable' };
  }) ?? null;
  const postCounts = statusCounts(postStates), channelCounts = statusCounts(channels);
  return {
    site: { status: state(input?.site?.status), views: count(input?.site?.views), saves: count(input?.site?.saves), measuredAt: timestamp(input?.site?.measuredAt) },
    social: {
      status: state(input?.social?.status), measuredAt: timestamp(input?.social?.measuredAt),
      measuredPosts: postCounts.measured, unavailablePosts: postCounts.unavailable,
      measuredChannels: channelCounts.measured, unavailableChannels: channelCounts.unavailable,
      platforms: aggregate,
    },
  };
}

// The proposer receives public measurements and aggregate history, never the
// held-out candidates or evidence used by the later independent writing trials.
export function makeProposerInput(input, observations = {}) {
  const aggregate = {};
  for (const key of observationKeys) {
    const value = observations[key];
    if (Number.isInteger(value) && value >= 0) aggregate[key] = value;
  }
  let scoringPolicy;
  try{scoringPolicy=parseScoringPolicy(input.baselineRules);}catch{/* Older frozen rules have no policy block. */}
  return {
    runId: input.runId,
    createdAt: input.createdAt,
    baselineRules: input.baselineRules,
    rulesSha256: input.rulesSha256,
    ...(scoringPolicy?{scoringPolicy}:{}),
    metrics: publicMetrics(input.metrics),
    observations: aggregate,
  };
}

// This trusted check runs before either writing trial. Invalid model proposals
// are expected decisions; a damaged frozen baseline is an operational failure.
export function proposalTrialReadiness(input, proposal, { expectedInputSha256 } = {}) {
  if (!object(input) || typeof input.baselineRules !== 'string' || !Array.isArray(input.sources)
    || !Array.isArray(input.candidates) || input.rulesSha256 !== sha256(input.baselineRules)
    || input.sourceSnapshotSha256 !== sha256(stableJSON(input.sources))) {
    throw new Error('Frozen improvement input or evidence hash is invalid.');
  }
  const inputSha256 = sha256(stableJSON(input));
  if (expectedInputSha256 && expectedInputSha256 !== inputSha256) {
    throw new Error('Improvement input differs from the trusted frozen seed.');
  }
  const reasons = validateRuleProposal(input.baselineRules, proposal);
  if (proposal?.runId !== input.runId) reasons.push('Rule proposal does not belong to this frozen improvement run.');
  return {
    runId: input.runId,
    status: reasons.length ? 'rejected' : 'ready',
    reasons: [...new Set(reasons)],
    inputSha256,
    proposalSha256: sha256(stableJSON(proposal)),
    rulesSha256: input.rulesSha256,
    sourceSnapshotSha256: input.sourceSnapshotSha256,
  };
}

// A terminal validation rejection completes the daily slot only when the
// checkout-free proposer and this trusted validation job both succeeded.
export function isCompletedProposalRejection(input, proposal, validation, stages) {
  if (stages?.seed?.result !== 'success' || stages?.propose?.result !== 'success'
    || stages?.['validate-proposal']?.result !== 'success') return false;
  const expected = proposalTrialReadiness(input, proposal);
  return expected.status === 'rejected' && validation?.status === 'rejected'
    && stableJSON(validation) === stableJSON(expected);
}

// Missing, malformed, or unrelated grader output must remain unavailable. An
// empty case set is rejected by the existing deterministic adoption gate.
export function gradeOrUnavailable(value, context, stages) {
  const unavailableStages = stages === undefined ? [] : ['propose', 'trials', 'grade'].filter(stage => stages?.[stage]?.result !== 'success');
  if (!unavailableStages.length && value && typeof value === 'object' && !Array.isArray(value)
    && value.runId === context.runId && Array.isArray(value.cases)) return value;
  return {
    runId: context.runId,
    trialsSha256: context.trialsSha256,
    sourceSnapshotSha256: context.sourceSnapshotSha256,
    cases: [],
    status: 'unavailable',
    reason: unavailableStages.length
      ? `Independent evaluation is unavailable because model stages did not complete successfully: ${unavailableStages.join(', ')}.`
      : 'Independent grader did not produce a complete JSON result.',
  };
}
