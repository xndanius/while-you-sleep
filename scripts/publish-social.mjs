import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, sha256, stableJSON, validId } from '../lib/storage.mjs';
import { checkApproval, verifyPublishedPost } from '../lib/validation.mjs';
import { localParts } from '../lib/config.mjs';
import { listPublishingChannels, prepareDigest, publishedPostHash, publishSocial, verifiedDigestHash } from '../integrations/social.mjs';

const DEFAULT_BASE = 'https://xndanius.github.io/while-you-sleep';
const HELD = new Set(['submitted', 'published', 'publication_unknown']);
const PLATFORMS = ['x', 'instagram', 'linkedin'];
const PUBLIC_SOURCE_FIELDS = ['id', 'title', 'url', 'publisher', 'fetchedAt', 'verifiedAt'];
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const at = (root, directory, id) => {
  if (!validId(id)) throw Error('Invalid record identity.');
  return path.join(root, 'data', directory, `${id}.json`);
};
async function writeImmutable(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}
async function all(root, directory) {
  const folder = path.join(root, 'data', directory);
  let files;
  try { files = await fs.readdir(folder); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return Promise.all(files.filter(file => file.endsWith('.json')).map(file => read(path.join(folder, file))));
}

/** Revalidate the committed independent-check chain; a passed flag alone is insufficient. */
export async function verifyCommittedPost(post, root = ROOT) {
  if (!verifyPublishedPost(post) || publishedPostHash(post) !== post.contentSha256 || !validId(post.runId)) {
    throw Error('A committed post failed its content-integrity check.');
  }
  const [draft, context, manifest] = await Promise.all(['drafts', 'check-context', 'checks'].map(directory => read(at(root, directory, post.runId))));
  if (sha256(stableJSON(draft)) !== context.draftSha256 || sha256(stableJSON(context.sources)) !== context.sourceSnapshotSha256 ||
    post.checker.draftSha256 !== context.draftSha256 || post.checker.sourceSnapshotSha256 !== context.sourceSnapshotSha256 ||
    post.checker.checkerRunId !== (manifest.checkerRunId || `${post.runId}-independent-check`)) {
    throw Error('A committed post no longer matches its independent checker or source snapshot.');
  }
  const decision = checkApproval(draft, context, manifest).find(item => item.postId === post.id);
  const original = draft.posts.find(item => item.id === post.id);
  if (!decision?.pass || !original || stableJSON(post.checker.claimChecks) !== stableJSON(decision.check.claimChecks)) {
    throw Error('A committed post lacks matching independent claim checks.');
  }
  const sourceIds = original.sourceIds;
  const expectedContent = Object.fromEntries(Object.entries(original).filter(([key]) => key !== 'sourceIds'));
  const actualContent = Object.fromEntries(Object.keys(expectedContent).map(key => [key, post[key]]));
  const expectedSources = context.sources.filter(source => sourceIds.includes(source.id))
    .map(source => Object.fromEntries(PUBLIC_SOURCE_FIELDS.map(key => [key, source[key]])));
  if (stableJSON(expectedContent) !== stableJSON(actualContent) || stableJSON(expectedSources) !== stableJSON(post.sources)) {
    throw Error('Published text or attached sources differ from the checked draft.');
  }
  return { passed: true, postHash: post.contentSha256, checkerRunId: post.checker.checkerRunId };
}

function previousReceipts(postId, publications, attempts) {
  const rows = publications.filter(record => record.postId === postId).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const receipts = {};
  for (const platform of PLATFORMS) {
    const held = rows.find(row => HELD.has(row.social?.[platform]?.status));
    const latest = rows.find(row => row.social?.[platform]);
    if (held || latest) receipts[platform] = (held || latest).social[platform];
    const uncompleted = attempts.find(attempt => attempt.postId === postId && attempt.platforms?.includes(platform) &&
      !publications.some(record => record.attemptId === attempt.id));
    if (uncompleted && !HELD.has(receipts[platform]?.status)) receipts[platform] = {
      status: 'publication_unknown', provider: 'postiz', attemptId: uncompleted.id,
      reason: 'A committed reservation has no final receipt. Reconcile Postiz before another send.', estimatedCostUsd: 0,
    };
  }
  return receipts;
}

function metadata(env, now, runId, postId, social, extra = {}) {
  const submitted = Object.values(social).map(result => result.submittedAt).filter(Boolean).sort().at(-1);
  const published = Object.values(social).map(result => result.publishedAt).filter(Boolean).sort().at(-1);
  return { id: `${postId}-${runId}`, postId, createdAt: now.toISOString(), submittedAt: submitted || now.toISOString(),
    ...(published ? { publishedAt: published } : {}), social,
    githubRunUrl: env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY ? `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null,
    ...extra };
}

function absolutePost(post, env) {
  const base = (env.PUBLIC_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
  return { ...post, imageUrl: `${base}/cards/${encodeURIComponent(post.id)}.jpg`, publicUrl: `${base}/#post-${post.id}` };
}

/** Creates immutable reservations only. The workflow commits them before --send. */
export async function reserveSocial({ root = ROOT, env = process.env, runId, now = new Date(), fetch } = {}) {
  if (!validId(runId)) throw Error('A valid social run ID is required.');
  const [posts, publications, attempts] = await Promise.all(['posts', 'publications', 'social-attempts'].map(directory => all(root, directory)));
  const verified = new Map();
  for (const post of posts) verified.set(post.id, await verifyCommittedPost(post, root));
  const connection = env.POSTIZ_API_KEY ? await listPublishingChannels(env, { fetch }) : { status: 'pending_setup', channels: [] };
  const report = { phase: 'reserve', checkedPosts: posts.length, reservations: 0, pendingSetup: 0, needsAttention: false };
  const plans = posts.map(post => ({ post: absolutePost(post, env), postId: post.id, verification: verified.get(post.id), platforms: ['x', 'instagram'] }));
  const local = localParts(now);
  if (local.weekday === 'Mon' && local.hour >= 8 && posts.length) {
    const weekKey = `digest-${local.day}`;
    const existing = await all(root, 'digests');
    let digest = existing.find(item => item.weekKey === weekKey);
    if (!digest) {
      const weekPosts = posts.filter(post => Date.parse(post.publishedAt) >= now.getTime() - 7 * 86_400_000);
      if (weekPosts.length) {
        digest = { ...prepareDigest(weekPosts.map(post => absolutePost(post, env)), { now: () => now }), weekKey };
        await writeImmutable(at(root, 'digests', weekKey), digest);
      }
    }
    if (digest) {
      const included = digest.postIds.map(id => posts.find(post => post.id === id));
      if (included.some((post, index) => !post || post.contentSha256 !== digest.postHashes[index] || !verified.has(post.id))) {
        throw Error('Weekly digest inputs no longer match their independently checked posts.');
      }
      const expected = prepareDigest(included.map(post => absolutePost(post, env)), { now: () => now });
      if (verifiedDigestHash(expected) !== verifiedDigestHash(digest)) throw Error('The deterministic weekly digest text was changed.');
      const checkId = `${digest.id}-${runId}`;
      const digestVerification = { passed: true, digestHash: verifiedDigestHash(digest), checkerRunId: checkId };
      await writeImmutable(at(root, 'digest-checks', checkId), { ...digestVerification, checkedAt: now.toISOString(),
        method: 'deterministic-composition-from-independently-checked-posts', postChecks: included.map(post => ({
          postId: post.id, postHash: post.contentSha256, checkerRunId: post.checker.checkerRunId,
          sourceSnapshotSha256: post.checker.sourceSnapshotSha256,
        })) });
      plans.push({ postId: digest.id, digest, digestVerification, platforms: ['linkedin'], weekKey });
    }
  }
  for (const plan of plans) {
    const receipts = previousReceipts(plan.postId, publications, attempts);
    const preview = connection.status === 'connected' ? await publishSocial(plan.post || null, env, {
      platforms: plan.platforms, verification: plan.verification, digest: plan.digest, digestVerification: plan.digestVerification,
      channels: connection.channels, receipts, dryRun: true, now: () => now, fetch,
    }) : Object.fromEntries(plan.platforms.map(platform => [platform, receipts[platform] || {
      status: connection.status === 'pending_setup' ? 'pending_setup' : 'failed', provider: 'postiz',
      reason: connection.status === 'pending_setup' ? 'Danielius needs to add POSTIZ_API_KEY and connect the account.' : 'Postiz channel listing failed.', estimatedCostUsd: 0,
    }]));
    const ready = plan.platforms.filter(platform => preview[platform]?.status === 'dry_run');
    const safelyPublic = Object.fromEntries(Object.entries(preview).filter(([, result]) => result.status !== 'dry_run'));
    if (Object.values(safelyPublic).some(result => ['failed', 'blocked_unchecked', 'ambiguous_channel', 'publication_unknown'].includes(result.status))) report.needsAttention = true;
    report.pendingSetup += Object.values(safelyPublic).filter(result => result.status === 'pending_setup').length;
    if (Object.keys(safelyPublic).length) {
      const last = publications.filter(row => row.postId === plan.postId).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
      if (stableJSON(last?.social) !== stableJSON(safelyPublic)) {
        const receipt = metadata(env, now, `${runId}-setup`, plan.postId, safelyPublic, { ...(plan.weekKey ? { weekKey: plan.weekKey } : {}) });
        await writeImmutable(at(root, 'publications', receipt.id), receipt);
      }
    }
    if (!ready.length) continue;
    const attemptId = `${plan.postId}-${runId}`;
    const record = { id: attemptId, runId, postId: plan.postId, createdAt: now.toISOString(), status: 'reserved', platforms: ready,
      postHash: plan.post?.contentSha256 || null, digestHash: plan.digestVerification?.digestHash || null,
      digestVerification: plan.digestVerification || null, weekKey: plan.weekKey || null,
      channels: connection.channels.filter(channel => ready.some(platform => preview[platform].channelId === channel.id)),
      previousReceipts: receipts };
    await writeImmutable(at(root, 'social-attempts', attemptId), record);
    report.reservations++;
  }
  return report;
}

/** Send only the current run's already committed reservations. No model is imported. */
export async function sendReservedSocial({ root = ROOT, env = process.env, runId, now = new Date(), fetch, dryRun = false } = {}) {
  if (!validId(runId)) throw Error('A valid social run ID is required.');
  if (!dryRun && env.SOCIAL_RESERVATION_COMMITTED !== 'true') throw Error('Commit social reservations before sending.');
  const [attempts, publications, digests] = await Promise.all(['social-attempts', 'publications', 'digests'].map(directory => all(root, directory)));
  const report = { phase: 'send', sent: 0, submitted: 0, pendingSetup: 0, needsAttention: false };
  for (const attempt of attempts.filter(item => item.runId === runId)) {
    if (publications.some(receipt => receipt.attemptId === attempt.id)) continue;
    let post = null, verification, digest;
    if (attempt.postHash) {
      post = await read(at(root, 'posts', attempt.postId));
      verification = await verifyCommittedPost(post, root);
      if (post.contentSha256 !== attempt.postHash) throw Error('Reserved post was changed before sending.');
      post = absolutePost(post, env);
    } else {
      digest = digests.find(item => item.id === attempt.postId && item.weekKey === attempt.weekKey);
      if (!digest || verifiedDigestHash(digest) !== attempt.digestHash) throw Error('Reserved digest was changed before sending.');
      const committedCheck = await read(at(root, 'digest-checks', attempt.digestVerification.checkerRunId));
      if (stableJSON({ passed: committedCheck.passed, digestHash: committedCheck.digestHash, checkerRunId: committedCheck.checkerRunId }) !== stableJSON(attempt.digestVerification)) {
        throw Error('Reserved digest lacks its committed validation record.');
      }
      const included = await Promise.all(digest.postIds.map(id => read(at(root, 'posts', id))));
      for (let i = 0; i < included.length; i++) {
        await verifyCommittedPost(included[i], root);
        if (included[i].contentSha256 !== digest.postHashes[i]) throw Error('Digest source post was changed before sending.');
      }
      const expected = prepareDigest(included.map(item => absolutePost(item, env)), { now: () => now });
      if (verifiedDigestHash(expected) !== attempt.digestHash) throw Error('Digest text differs from checked input composition.');
    }
    const social = await publishSocial(post, env, { platforms: attempt.platforms, verification, digest,
      digestVerification: attempt.digestVerification, channels: attempt.channels, receipts: attempt.previousReceipts,
      dryRun, now: () => now, fetch });
    if (!dryRun) {
      const receipt = metadata(env, now, runId, attempt.postId, social, { attemptId: attempt.id, postHash: attempt.postHash,
        ...(attempt.weekKey ? { weekKey: attempt.weekKey } : {}) });
      await writeImmutable(at(root, 'publications', receipt.id), receipt);
    }
    report.sent++;
    report.submitted += Object.values(social).filter(result => result.status === 'submitted' || result.status === 'published').length;
    report.pendingSetup += Object.values(social).filter(result => result.status === 'pending_setup').length;
    if (Object.values(social).some(result => ['failed', 'blocked_unchecked', 'ambiguous_channel', 'publication_unknown'].includes(result.status))) report.needsAttention = true;
  }
  return report;
}

async function cli() {
  const runId = `social-${process.env.SOCIAL_RUN_ID || `${Date.now()}-local`}`;
  const options = { runId };
  const report = process.argv.includes('--reserve') ? await reserveSocial(options)
    : await sendReservedSocial({ ...options, dryRun: process.argv.includes('--dry-run') });
  console.log(JSON.stringify(report));
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `needs_attention=${report.needsAttention}\n`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch(() => { console.error('Social publishing stopped: committed validation or reservation could not be verified. No automatic retry was made.'); process.exitCode = 1; });
}
