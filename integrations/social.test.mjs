import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256, stableJSON } from '../lib/storage.mjs';
import { reserveSocial, sendReservedSocial, verifyCommittedPost } from '../scripts/publish-social.mjs';
import { createOAuth1Header, formatXPost, listPublishingChannels, measureSocial,
  prepareDigest, publishedPostHash, publishSocial, refreshInstagramToken, researchX,
  verifiedDigestHash } from './social.mjs';

const NOW = '2026-10-10T08:00:00.000Z';
const env = { POSTIZ_API_KEY: 'test-only-api-key', PUBLIC_BASE_URL: 'https://example.github.io/while-you-sleep/' };
const channels = [
  { id: 'x-channel', identifier: 'x', name: 'While You Sleep' },
  { id: 'ig-channel', identifier: 'instagram-standalone', name: 'While You Sleep' },
  { id: 'li-page', identifier: 'linkedin-page', name: 'While You Sleep' },
];
const noNetwork = async () => assert.fail('This operation must not make a network request');
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
function approvedPost(overrides = {}) {
  const post = { id: 'idea-1', title: 'A tiny research loop', promise: 'Collect evidence for one useful idea.',
    whatItIs: 'An example students can build.', whoPays: 'A team with a recurring research task.',
    loop: ['Read public sources', 'Check claims', 'Publish a summary'], evidence: 'The source documents an existing workflow.',
    first24Hours: ['Pick one question and one public source.'],
    sources: [{ title: 'Original documentation', url: 'https://example.org/docs', publisher: 'Example', fetchedAt: NOW }],
    publishedAt: NOW, imageUrl: 'cards/idea-1.jpg', publicUrl: `${env.PUBLIC_BASE_URL}#post-idea-1`, version: 1,
    ...overrides, checker: { passed: true, checkerRunId: 'check-1', checkedAt: NOW } };
  post.contentSha256 = publishedPostHash(post);
  return post;
}
const verification = post => ({ passed: true, postHash: post.contentSha256, checkerRunId: post.checker.checkerRunId });
const opts = post => ({ channels, verification: verification(post), now: () => NOW });

test('unchecked and subsequently changed content fails before any read or write', async () => {
  const post = approvedPost();
  for (const [candidate, envelope] of [
    [post, undefined], [post, { ...verification(post), checkerRunId: 'different-run' }],
    [{ ...post, evidence: 'Changed after checking.' }, verification(post)],
    [{ ...post, sources: [{ ...post.sources[0], url: 'https://example.org/other' }] }, verification(post)],
  ]) {
    const result = await publishSocial(candidate, env, { verification: envelope, fetch: noNetwork });
    assert.equal(result.x.status, 'blocked_unchecked');
    assert.equal(result.instagram.status, 'blocked_unchecked');
    assert.equal(result.linkedin.status, 'blocked_unchecked');
  }
});

test('no credential reports setup pending without making a request', async () => {
  const result = await publishSocial(approvedPost(), {}, { fetch: noNetwork });
  assert.equal(result.x.status, 'pending_setup');
  assert.deepEqual(result.x.missing, ['POSTIZ_API_KEY']);
});

test('approved X post uses raw service authorization and records acceptance only', async () => {
  const post = approvedPost({ promise: 'Learn at https://example.org or example.org and contact @someone.' });
  let calls = 0;
  const result = await publishSocial(post, env, { ...opts(post), platforms: ['x'], fetch: async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.postiz.com/public/v1/posts');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, env.POSTIZ_API_KEY);
    const payload = JSON.parse(init.body);
    assert.equal(payload.type, 'now');
    assert.equal(payload.shortLink, false);
    assert.equal(payload.posts[0].integration.id, 'x-channel');
    assert.equal(payload.posts[0].settings.made_with_ai, true);
    assert.doesNotMatch(payload.posts[0].value[0].content, /https?:|example\.org|@someone/);
    return json([{ postId: 'service-post-1', integration: 'x-channel' }]);
  } });
  assert.equal(calls, 1);
  assert.equal(result.x.status, 'submitted');
  assert.equal(result.x.providerPostId, 'service-post-1');
  assert.equal(result.x.url, undefined);
});

test('Instagram uploads its public JPEG before submitting to its own channel', async () => {
  const post = approvedPost();
  const calls = [];
  const result = await publishSocial(post, env, { ...opts(post), platforms: ['instagram'], fetch: async (url, init) => {
    calls.push(url);
    const payload = JSON.parse(init.body);
    if (url.endsWith('/upload-from-url')) {
      assert.deepEqual(payload, { url: 'https://example.github.io/while-you-sleep/cards/idea-1.jpg' });
      return json({ id: 'uploaded-image', path: 'https://uploads.postiz.com/image.jpg' });
    }
    assert.deepEqual(payload.posts[0].value[0].image, [{ id: 'uploaded-image', path: 'https://uploads.postiz.com/image.jpg' }]);
    assert.equal(payload.posts[0].settings.__type, 'instagram-standalone');
    return json([{ postId: 'ig-service-post', integration: 'ig-channel' }]);
  } });
  assert.equal(result.instagram.status, 'submitted');
  assert.deepEqual(calls.map(url => new URL(url).pathname), ['/public/v1/upload-from-url', '/public/v1/posts']);
});

test('private media URLs and ambiguous channels cannot publish', async () => {
  const post = approvedPost({ imageUrl: 'https://127.0.0.1/card.jpg' });
  const result = await publishSocial(post, env, { ...opts(post), platforms: ['instagram'], fetch: noNetwork });
  assert.equal(result.instagram.errorCode, 'public_jpeg_url_required');
  const valid = approvedPost();
  const ambiguous = await publishSocial(valid, env, { ...opts(valid), platforms: ['x'], fetch: noNetwork,
    channels: [...channels, { id: 'other-x', identifier: 'x' }] });
  assert.equal(ambiguous.x.status, 'ambiguous_channel');
});

test('dry run cannot upload or publish, even with valid credentials', async () => {
  const post = approvedPost();
  const result = await publishSocial(post, env, { ...opts(post), dryRun: true, fetch: noNetwork });
  assert.equal(result.x.status, 'dry_run');
  assert.equal(result.instagram.status, 'dry_run');
  assert.equal(result.linkedin.status, 'weekly_digest_pending');
  const direct = await publishSocial(post, env, { ...opts(post), provider: 'direct', dryRun: true, fetch: noNetwork });
  assert.equal(direct.x.status, 'dry_run');
});

test('accepted, published and uncertain receipts prevent duplicate POSTs', async () => {
  const post = approvedPost();
  for (const status of ['submitted', 'published', 'publication_unknown']) {
    const prior = { status, provider: 'postiz', providerPostId: 'previous-post', channelId: 'x-channel' };
    const result = await publishSocial(post, env, { ...opts(post), platforms: ['x'], fetch: noNetwork, receipts: { x: prior } });
    assert.deepEqual(result.x, prior);
  }
});

test('LinkedIn only sends a checked weekly digest to a Page channel', async () => {
  const post = approvedPost();
  const digest = prepareDigest([post], { now: () => NOW });
  const options = { digest, digestVerification: { passed: true, digestHash: verifiedDigestHash(digest), checkerRunId: 'digest-check' },
    platforms: ['linkedin'], channels, now: () => NOW };
  const blocked = await publishSocial(null, env, { ...options, digest: { ...digest, text: `${digest.text}\nChanged` }, fetch: noNetwork });
  assert.equal(blocked.linkedin.status, 'blocked_unchecked');
  const personal = await publishSocial(null, env, { ...options, channels: [{ id: 'personal', identifier: 'linkedin' }], fetch: noNetwork });
  assert.equal(personal.linkedin.status, 'pending_setup');
  const result = await publishSocial(null, env, { ...options, fetch: async (_, init) => {
    const payload = JSON.parse(init.body);
    assert.equal(payload.posts[0].integration.id, 'li-page');
    assert.equal(payload.posts[0].settings.__type, 'linkedin-page');
    assert.equal(payload.posts[0].value[0].content, digest.text);
    return json([{ postId: 'weekly-digest-post', integration: 'li-page' }]);
  } });
  assert.equal(result.linkedin.status, 'submitted');
});

test('digest retains the exact included post hashes and never pretends to be checked', () => {
  const a = approvedPost();
  const b = approvedPost({ id: 'idea-2', publishedAt: '2026-10-09T08:00:00Z' });
  const digest = prepareDigest([a, a, b], { now: () => NOW });
  assert.deepEqual(digest.postIds, ['idea-1', 'idea-2']);
  assert.deepEqual(digest.postHashes, [a.contentSha256, b.contentSha256]);
  assert.equal(digest.status, 'awaiting_check');
  assert.ok(digest.text.length < 3000);
});

test('lost publish response remains uncertain and provider error bodies remain private', async () => {
  const post = approvedPost();
  const lost = await publishSocial(post, env, { ...opts(post), platforms: ['x'], fetch: async () => { throw Error(env.POSTIZ_API_KEY); } });
  assert.equal(lost.x.status, 'publication_unknown');
  const rejected = await publishSocial(post, env, { ...opts(post), platforms: ['x'], fetch: async () =>
    json({ error: { code: env.POSTIZ_API_KEY, message: env.POSTIZ_API_KEY } }, 401) });
  assert.equal(rejected.x.status, 'failed');
  assert.equal(rejected.x.errorCode, 'http_401');
  assert.doesNotMatch(JSON.stringify([lost, rejected]), /test-only-api-key/);
});

test('channel listing strips provider OAuth tokens and unknown fields', async () => {
  const result = await listPublishingChannels(env, { fetch: async () => json([
    { id: 'x-channel', identifier: 'x', name: 'Loop', accessToken: 'private-token', refreshToken: 'another-secret' },
  ]) });
  assert.equal(result.channels[0].id, 'x-channel');
  assert.doesNotMatch(JSON.stringify(result), /private-token|another-secret|accessToken|refreshToken/);
});

test('measurement preserves unavailable data and reconciles confirmed publication', async () => {
  const records = [{ postId: 'idea-1', social: { x: { status: 'submitted', provider: 'postiz', providerPostId: 'service-post-1', channelId: 'x-channel' } } }];
  const result = await measureSocial(records, env, { now: new Date(NOW), fetch: async url => {
    const path = new URL(url).pathname;
    if (path.endsWith('/posts')) return json({ posts: [{ id: 'service-post-1', state: 'PUBLISHED', releaseURL: 'https://x.com/i/web/status/123' }] });
    if (path.endsWith('/integrations')) return json([channels[0]]);
    if (path.endsWith('/analytics/post/service-post-1')) return json([]);
    if (path.endsWith('/analytics/x-channel')) return json([
      { label: 'Views', data: [{ date: '2026-10-09', total: '13' }, { date: '2026-10-10', total: '18' }] },
      { label: 'Likes', data: [{ date: '2026-10-10', total: '0' }] },
      { label: 'Missing', data: [{ date: '2026-10-10', total: '' }] },
    ]);
    return assert.fail(`Unexpected request: ${path}`);
  } });
  assert.equal(result.posts[0].x.status, 'unavailable');
  assert.deepEqual(result.posts[0].x.metrics, {});
  assert.equal(result.posts[0].x.publication.status, 'published');
  assert.equal(result.posts[0].x.publication.url, 'https://x.com/i/web/status/123');
  assert.deepEqual(result.channels[0].metrics, { views: 18, likes: 0 });
  assert.equal(result.channels[0].history[0].data.length, 2);
});

test('OAuth signature matches the official X documentation vector', () => {
  // These are explicitly invalid sample credentials published in X's signature guide.
  const sample = { X_API_KEY: 'xvz1evFS4wEEPTGEFPHBog', X_API_SECRET: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
    X_ACCESS_TOKEN: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb', X_ACCESS_TOKEN_SECRET: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE' };
  const header = createOAuth1Header('POST', 'https://api.x.com/1.1/statuses/update.json?include_entities=true&status=Hello%20Ladies%20%2B%20Gentlemen%2C%20a%20signed%20OAuth%20request%21', sample,
    { nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', timestamp: 1318622958 });
  assert.match(header, /oauth_signature="Ls93hJiZbQ3akF3HF3x1Bz8%2FzU4%3D"/);
});

test('optional paid X research refuses insufficient budgets before API access', async () => {
  const result = await researchX('automation', { X_OAUTH2_ACCESS_TOKEN: 'test-only', X_RESEARCH_ENABLED: 'true' },
    { maxCostUsd: 0.049, fetch: noNetwork });
  assert.equal(result.status, 'budget_limit');
  const disabled = await researchX('automation', {}, { fetch: noNetwork });
  assert.equal(disabled.status, 'disabled');
});

test('direct Instagram resumes the previous processing container without creating another', async () => {
  const post = approvedPost();
  const requests = [];
  const result = await publishSocial(post, { IG_USER_ID: '456', IG_ACCESS_TOKEN: 'test-only', PUBLIC_BASE_URL: env.PUBLIC_BASE_URL }, {
    ...opts(post), provider: 'direct', platforms: ['instagram'], receipts: { instagram: { status: 'pending_processing', containerId: '111' } },
    fetch: async (url, init) => {
      requests.push(url);
      if (url.includes('/111?')) return json({ status_code: 'FINISHED' });
      assert.ok(url.endsWith('/456/media_publish'));
      assert.equal(JSON.parse(init.body).creation_id, '111');
      return json({ id: '222' });
    },
  });
  assert.equal(result.instagram.status, 'published');
  assert.equal(requests.length, 2);
  assert.ok(requests.every(url => !url.endsWith('/media')));
});

test('personal LinkedIn fallback requires owner approval bound to the exact digest', async () => {
  const digest = prepareDigest([approvedPost()], { provider: 'direct', now: () => NOW });
  const result = await publishSocial(null, {}, { provider: 'direct', platforms: ['linkedin'], digest, fetch: noNetwork });
  assert.equal(result.linkedin.status, 'awaiting_owner_approval');
  const changed = await publishSocial(null, {}, { provider: 'direct', platforms: ['linkedin'], digest: { ...digest, text: `${digest.text}!` },
    linkedinApproval: digest.id, fetch: noNetwork });
  assert.equal(changed.linkedin.status, 'awaiting_owner_approval');
});

test('invalid and young Instagram token dates cannot trigger a refresh', async () => {
  for (const issuedAt of ['invalid-date', NOW]) {
    const result = await refreshInstagramToken({ IG_ACCESS_TOKEN: 'test-only' }, { issuedAt, now: () => NOW, fetch: noNetwork });
    assert.equal(result.status, 'not_due');
  }
});

test('X shortening accommodates emoji and non-Latin text within the standard post limit', () => {
  const text = formatXPost({ title: '界'.repeat(200), promise: '😀'.repeat(100), first24Hours: ['Try a source.'] });
  assert.ok([...text].reduce((total, char) => total + (char.codePointAt(0) > 0x10ff ? 2 : 1), 0) <= 280);
});

async function committedFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'while-you-sleep-social-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const post = approvedPost();
  const original = Object.fromEntries(['id', 'title', 'promise', 'whatItIs', 'whoPays', 'loop', 'evidence', 'first24Hours'].map(key => [key, post[key]]));
  original.sourceIds = ['source-1'];
  const source = { id: 'source-1', title: 'Official evidence', url: 'https://example.org/docs', publisher: 'Example', fetchedAt: NOW,
    text: 'The documented workflow reads public sources. The documented workflow checks its claims. The documented workflow publishes a summary.' };
  const claimChecks = ['reads public sources', 'checks its claims', 'publishes a summary'].map((claim, index) => ({ claim,
    sourceId: source.id, supported: true, evidenceQuote: source.text.split('. ').map(x => x.replace(/\.$/, ''))[index] }));
  const draft = { runId: 'source-run', posts: [original] };
  const context = { runId: draft.runId, sources: [source], draftSha256: sha256(stableJSON(draft)),
    sourceSnapshotSha256: sha256(stableJSON([source])), deterministicResults: [{ postId: post.id, reasons: [] }] };
  const manifest = { runId: draft.runId, checkerRunId: 'independent-check', draftSha256: context.draftSha256,
    sourceSnapshotSha256: context.sourceSnapshotSha256, checks: [{ postId: post.id, pass: true, claimChecks }] };
  post.runId = draft.runId;
  post.sources = [{ id: source.id, title: source.title, url: source.url, publisher: source.publisher, fetchedAt: source.fetchedAt }];
  post.checker = { passed: true, checkerRunId: manifest.checkerRunId, draftSha256: context.draftSha256,
    sourceSnapshotSha256: context.sourceSnapshotSha256, claimChecks };
  post.contentSha256 = publishedPostHash(post);
  for (const [directory, id, value] of [['drafts', draft.runId, draft], ['check-context', draft.runId, context],
    ['checks', draft.runId, manifest], ['posts', post.id, post]]) {
    await fs.mkdir(path.join(root, 'data', directory), { recursive: true });
    await fs.writeFile(path.join(root, 'data', directory, `${id}.json`), JSON.stringify(value));
  }
  return { root, post, draft, context, manifest };
}

test('publish job verifies the original checked draft and evidence, beyond the public post hash', async t => {
  const fixture = await committedFixture(t);
  assert.equal((await verifyCommittedPost(fixture.post, fixture.root)).passed, true);
  const changed = { ...fixture.post, promise: 'Changed but given a fresh self-reported public hash.' };
  changed.contentSha256 = publishedPostHash(changed);
  await assert.rejects(verifyCommittedPost(changed, fixture.root), /differ from the checked draft/);
  const contextFile = path.join(fixture.root, 'data', 'check-context', 'source-run.json');
  await fs.writeFile(contextFile, JSON.stringify({ ...fixture.context, sources: [{ ...fixture.context.sources[0], text: 'Changed source text.' }] }));
  await assert.rejects(verifyCommittedPost(fixture.post, fixture.root), /source snapshot/);
});

test('runner crash after a committed reservation holds future sends for reconciliation', async t => {
  const { root } = await committedFixture(t);
  const listOnly = async url => {
    assert.ok(url.endsWith('/integrations'));
    return json([channels[0]]);
  };
  const first = await reserveSocial({ root, env, runId: 'first-run', now: new Date(NOW), fetch: listOnly });
  assert.equal(first.reservations, 1);
  // No send/receipt: the first runner disappeared after reserving its X send.
  const second = await reserveSocial({ root, env, runId: 'second-run', now: new Date(NOW), fetch: listOnly });
  assert.equal(second.reservations, 0);
  assert.equal(second.needsAttention, true);
  await assert.rejects(sendReservedSocial({ root, env, runId: 'first-run', fetch: noNetwork }), /Commit social reservations/);
});

test('settled reservations send once and preserve immutable safe receipts', async t => {
  const { root, post } = await committedFixture(t);
  await reserveSocial({ root, env, runId: 'send-run', now: new Date(NOW), fetch: async () => json([channels[0]]) });
  let writes = 0;
  const committedEnv = { ...env, SOCIAL_RESERVATION_COMMITTED: 'true' };
  const first = await sendReservedSocial({ root, env: committedEnv, runId: 'send-run', now: new Date(NOW), fetch: async (url, init) => {
    assert.ok(url.endsWith('/posts'));
    assert.equal(JSON.parse(init.body).posts[0].integration.id, 'x-channel');
    writes++;
    return json([{ postId: 'accepted-post', integration: 'x-channel' }]);
  } });
  assert.equal(first.submitted, 1);
  const second = await sendReservedSocial({ root, env: committedEnv, runId: 'send-run', now: new Date(NOW), fetch: noNetwork });
  assert.equal(second.sent, 0);
  assert.equal(writes, 1);
  const receipt = JSON.parse(await fs.readFile(path.join(root, 'data', 'publications', `${post.id}-send-run.json`), 'utf8'));
  assert.equal(receipt.social.x.status, 'submitted');
  assert.equal(receipt.attemptId, `${post.id}-send-run`);
  assert.doesNotMatch(JSON.stringify(receipt), /test-only-api-key/);
});

test('Monday Page digest binds checked source posts and remains one digest per week', async t => {
  const { root } = await committedFixture(t);
  const monday = new Date('2026-10-12T05:00:00.000Z');
  const result = await reserveSocial({ root, env, runId: 'monday-run', now: monday, fetch: async () => json([channels[2]]) });
  assert.equal(result.reservations, 1);
  const preview = await sendReservedSocial({ root, env, runId: 'monday-run', now: monday, dryRun: true, fetch: noNetwork });
  assert.equal(preview.sent, 1);
  const again = await reserveSocial({ root, env, runId: 'later-monday-run', now: new Date('2026-10-12T06:00:00.000Z'), fetch: async () => json([channels[2]]) });
  assert.equal(again.reservations, 0);
  assert.equal((await fs.readdir(path.join(root, 'data', 'digests'))).length, 1);
});
