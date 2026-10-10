import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { makeProposerInput, gradeOrUnavailable } from '../lib/improvement-runtime.mjs';
import { evaluateImprovement } from '../lib/improvement.mjs';
import { sha256, stableJSON } from '../lib/storage.mjs';

const rules = '# Rules\n\n## Pick\nEvidence and no duplicates.\n\n## Write\nPlain words and truthful claims.\n\n## Safety\nNo unsafe topics or secrets.\n';
const execute = promisify(execFile);
const repository = fileURLToPath(new URL('..', import.meta.url));

function fixtures() {
  const runId = 'test-improvement-runtime';
  const addition = 'Name the first input the student should collect.';
  const sources = [{ id: 'heldout-source-id', text: 'Heldout product supports extraction and review.' }];
  const candidates = [1, 2, 3].map(i => ({ candidateId: 'heldout-candidate-' + i, productUrl: 'https://heldout.example/' + i, sourceIds: [sources[0].id] }));
  const input = {
    runId, createdAt: '2026-10-10T10:00:00.000Z', baselineRules: rules,
    rulesSha256: sha256(rules), sources, sourceSnapshotSha256: sha256(stableJSON(sources)), candidates,
    metrics: { site: { status: 'not_connected', views: null, saves: null }, posts: [], social: { status: 'not_connected', posts: [], channels: [] } },
  };
  const proposal = {
    runId, rulesSha256: input.rulesSha256, section: 'Write', change: 'Make the first input concrete.',
    reason: 'Test a clarity hypothesis; traffic is unavailable.', addition,
    newRules: rules.replace('Plain words and truthful claims.\n\n', 'Plain words and truthful claims.\n\n' + addition + '\n\n'),
  };
  const cases = candidates.map(c => ({ ...c, sources, A: { post: { title: 'Baseline' }, deterministicReasons: [] }, B: { post: { title: 'Proposal' }, deterministicReasons: [] } }));
  const blind = { runId, sourceSnapshotSha256: input.sourceSnapshotSha256, cases, trialsSha256: sha256(stableJSON(cases)) };
  const labels = { proposalSha256: sha256(stableJSON(proposal)), cases: candidates.map(c => ({ candidateId: c.candidateId, baseline: 'A', proposal: 'B' })) };
  const grade = {
    runId, trialsSha256: blind.trialsSha256, sourceSnapshotSha256: input.sourceSnapshotSha256,
    cases: candidates.map(c => ({ candidateId: c.candidateId, A: { factuality: 4, clarity: 3, feasibility: 3, safety: 5, supported: true, safe: true }, B: { factuality: 4, clarity: 4, feasibility: 4, safety: 5, supported: true, safe: true } })),
  };
  return { input, proposal, blind, labels, grade };
}

test('proposer allowlist excludes held-out identities, evidence, hashes, and extra fields', () => {
  const { input } = fixtures();
  const marker = 'sk-proj-heldoutmarker012345678901234567890123456789';
  input.sources[0].text = marker;
  input.candidates[0].candidateId = marker + '-candidate';
  input.candidates[0].productUrl = 'https://heldout.example/' + marker;
  input.sources[0].id = marker + '-source';
  input.sourceSnapshotSha256 = marker + '-snapshot';
  input.selectionHealth = [{ name: marker }];
  input.githubRunUrl = 'https://example.com/' + marker;
  input.unknown = marker;
  input.metrics.unknown = marker;
  input.metrics.site.reason = marker;
  input.metrics.site.measuredAt = marker;
  input.metrics.social.raw = { body: marker };
  input.metrics.social.posts.push({ postId: marker, x: { status: 'measured', providerPostId: marker, url: 'https://example.com/' + marker, metrics: { views: 0, raw: marker }, history: [marker] } });
  input.metrics.social.channels.push({ channelId: marker, status: 'unavailable', reason: marker });
  const result = makeProposerInput(input, { publishedPosts: 3, draftedPosts: 8, rejectedCandidates: 2, researchRuns: 7, candidates: input.candidates, sourceSnapshotSha256: marker });
  assert.deepEqual(Object.keys(result), ['runId', 'createdAt', 'baselineRules', 'rulesSha256', 'metrics', 'observations']);
  assert.deepEqual(result.observations, { publishedPosts: 3, draftedPosts: 8, rejectedCandidates: 2, researchRuns: 7 });
  const serialized = JSON.stringify(result);
  for (const forbidden of [marker, 'candidateId', 'productUrl', 'sourceIds', 'sourceSnapshotSha256', 'selectionHealth', 'githubRunUrl', 'postId', 'providerPostId', 'channelId', 'heldout-source-id', 'heldout-candidate-', 'heldout.example']) assert.ok(!serialized.includes(forbidden), forbidden);
  assert.equal(result.baselineRules, rules);
  assert.equal(result.rulesSha256, sha256(rules));
  assert.equal(result.metrics.site.status, 'not_connected');
  assert.equal(result.metrics.site.views, null);
  assert.equal(result.metrics.site.measuredAt, null);
  assert.equal(result.metrics.social.measuredPosts, 1);
  assert.equal(result.metrics.social.unavailableChannels, 1);
  assert.equal(result.metrics.social.platforms.x.metrics.views, 0);
  result.metrics.site.views = 12;
  assert.equal(input.metrics.site.views, null, 'proposer metrics must be an independent copy');
});

test('public metrics preserve actual aggregate counts and null unavailable counters', () => {
  const { input } = fixtures();
  input.metrics = {
    site: { status: 'measured', views: 0, saves: 2, measuredAt: '2026-10-10T10:00:00.000Z' },
    social: {
      status: 'partial', measuredAt: '2026-10-10T10:00:00.000Z',
      posts: [
        { postId: 'public-1', x: { status: 'measured', metrics: { views: 0, likes: 3, arbitrary: 200 } }, instagram: { status: 'unavailable' } },
        { postId: 'public-2', x: { status: 'measured', metrics: { views: 4, likes: 1 } } },
        { postId: 'public-3', x: { status: 'unavailable', metrics: { views: 999 } } },
      ],
      channels: [{ channelId: 'public-channel-1', status: 'measured' }, { channelId: 'public-channel-2', status: 'unavailable' }],
    },
  };
  const { metrics } = makeProposerInput(input);
  assert.deepEqual(metrics.site, { status: 'measured', views: 0, saves: 2, measuredAt: '2026-10-10T10:00:00.000Z' });
  assert.equal(metrics.social.status, 'partial');
  assert.equal(metrics.social.measuredPosts, 2);
  assert.equal(metrics.social.unavailablePosts, 1);
  assert.equal(metrics.social.measuredChannels, 1);
  assert.equal(metrics.social.unavailableChannels, 1);
  assert.equal(metrics.social.platforms.x.measuredPosts, 2);
  assert.equal(metrics.social.platforms.x.unavailablePosts, 1);
  assert.equal(metrics.social.platforms.x.metrics.views, 4);
  assert.equal(metrics.social.platforms.x.metrics.likes, 4);
  assert.equal(metrics.social.platforms.x.metrics.saves, null);
  assert.equal(metrics.social.platforms.instagram.metrics.views, null);
  assert.equal(metrics.social.platforms.linkedin.measuredPosts, 0);
  assert.ok(!JSON.stringify(metrics).includes('public-'));
  assert.ok(!JSON.stringify(metrics).includes('arbitrary'));
  const unavailable = makeProposerInput({ ...input, metrics: undefined }).metrics;
  assert.equal(unavailable.site.views, null);
  assert.equal(unavailable.social.measuredPosts, null);
  assert.equal(unavailable.social.platforms.x.metrics.views, null);
});

test('aggregate observations preserve measured zeros and omit invalid counts', () => {
  const { input } = fixtures();
  assert.deepEqual(makeProposerInput(input, { publishedPosts: 0, draftedPosts: -1, rejectedCandidates: 1.5, researchRuns: '3', sourceFailures: 9 }).observations, { publishedPosts: 0 });
  for (const value of [NaN, Infinity, null, undefined]) assert.deepEqual(makeProposerInput(input, { publishedPosts: value }).observations, {});
});

test('missing or malformed grader output produces an unavailable rejection without invented scores', () => {
  const { input, proposal, labels, blind } = fixtures();
  for (const value of [undefined, null, 'invalid JSON', [], {}, { runId: 'another-run', cases: [] }, { runId: input.runId, cases: {} }]) {
    const grade = gradeOrUnavailable(value, blind);
    assert.deepEqual(grade, { runId: input.runId, trialsSha256: blind.trialsSha256, sourceSnapshotSha256: input.sourceSnapshotSha256, cases: [], status: 'unavailable', reason: 'Independent grader did not produce a complete JSON result.' });
    const decision = evaluateImprovement(input, proposal, labels, blind, grade);
    assert.equal(decision.adopted, false);
    assert.equal(decision.baselineScore, null);
    assert.equal(decision.challengerScore, null);
    assert.deepEqual(decision.evaluations, []);
    assert.ok(decision.reasons.some(reason => reason.includes('complete held-out cases')));
  }
});

test('valid grader JSON is preserved for the existing adoption gate', () => {
  const { input, proposal, labels, blind, grade } = fixtures();
  assert.equal(gradeOrUnavailable(grade, blind), grade);
  assert.equal(evaluateImprovement(input, proposal, labels, blind, grade).adopted, true);
});

test('failed or cancelled model stages reject even a complete higher-scoring grade', () => {
  const { input, proposal, labels, blind, grade } = fixtures();
  const succeeded = { propose: { result: 'success' }, trials: { result: 'success' }, grade: { result: 'success' } };
  assert.equal(gradeOrUnavailable(grade, blind, succeeded), grade);
  for (const stage of ['propose', 'trials', 'grade']) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      const stages = { ...succeeded, [stage]: { result } };
      const unavailable = gradeOrUnavailable(grade, blind, stages);
      assert.equal(unavailable.status, 'unavailable');
      assert.deepEqual(unavailable.cases, []);
      assert.ok(unavailable.reason.includes(stage));
      const decision = evaluateImprovement(input, proposal, labels, blind, unavailable);
      assert.equal(decision.adopted, false);
      assert.equal(decision.baselineScore, null);
      assert.equal(decision.challengerScore, null);
      assert.deepEqual(decision.evaluations, []);
    }
  }
  assert.equal(gradeOrUnavailable(grade, blind, {}).status, 'unavailable', 'missing results fail closed when stage results are supplied');
});

test('trusted runtime records a missing grader as an immutable rejection with unchanged rules', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'wys-improvement-runtime-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { input, proposal, blind, labels } = fixtures();
  const runId = input.runId;
  await mkdir(path.join(directory, 'scripts'), { recursive: true });
  await mkdir(path.join(directory, 'data', 'improvements'), { recursive: true });
  await Promise.all([
    cp(path.join(repository, 'lib'), path.join(directory, 'lib'), { recursive: true }),
    cp(path.join(repository, 'scripts', 'prepare-improvement.mjs'), path.join(directory, 'scripts', 'prepare-improvement.mjs')),
    cp(path.join(repository, 'scripts', 'apply-improvement.mjs'), path.join(directory, 'scripts', 'apply-improvement.mjs')),
    symlink(path.join(repository, 'node_modules'), path.join(directory, 'node_modules'), 'dir'),
    writeFile(path.join(directory, 'RULES.md'), rules),
    ...[[runId + '-input', input], [runId, proposal], [runId + '-blind', blind], [runId + '-labels', { runId, ...labels }]].map(([name, value]) => writeFile(path.join(directory, 'data', 'improvements', name + '.json'), JSON.stringify(value) + '\n')),
  ]);
  const command = (script, ...args) => execute(process.execPath, [path.join(directory, 'scripts', script), ...args], { cwd: directory, env: {}, timeout: 10000, maxBuffer: 100000 });
  const gradePath = path.join(directory, 'data', 'improvements', runId + '-grade.json');
  await assert.rejects(readFile(gradePath), error => error.code === 'ENOENT');
  await command('prepare-improvement.mjs', 'ensure-grade', runId);
  const grade = JSON.parse(await readFile(gradePath, 'utf8'));
  assert.deepEqual(grade, {
    runId, trialsSha256: blind.trialsSha256, sourceSnapshotSha256: input.sourceSnapshotSha256,
    cases: [], status: 'unavailable', reason: 'Independent grader did not produce a complete JSON result.',
  });
  await command('apply-improvement.mjs', runId);
  const versionPath = path.join(directory, 'data', 'versions', runId + '.json');
  const originalVersion = await readFile(versionPath, 'utf8');
  const decision = JSON.parse(originalVersion);
  assert.equal(decision.status, 'rejected');
  assert.equal(decision.adopted, false);
  assert.equal(decision.baselineScore, null);
  assert.equal(decision.challengerScore, null);
  assert.deepEqual(decision.evaluations, []);
  assert.equal(decision.parentRulesSha256, input.rulesSha256);
  assert.equal(decision.newRulesSha256, input.rulesSha256);
  assert.equal(await readFile(path.join(directory, 'RULES.md'), 'utf8'), rules);
  assert.match(await readFile(path.join(directory, '.run', 'improvement-commit-message.txt'), 'utf8'), /Held-out test: evaluation unavailable; 0 cases\./);
  await assert.rejects(command('apply-improvement.mjs', runId), error => error.code !== 0 && /EEXIST/.test(error.stderr));
  assert.equal(await readFile(versionPath, 'utf8'), originalVersion, 'a repeated apply must not overwrite its immutable decision');
  assert.equal(await readFile(path.join(directory, 'RULES.md'), 'utf8'), rules);
});

test('model jobs receive only their assigned isolated artifacts and skip Git checkout', async () => {
  const workflow = await readFile(new URL('../.github/workflows/improve.yml', import.meta.url), 'utf8');
  const job = name => {
    const text = workflow.match(new RegExp('^  ' + name + ':\\n([\\s\\S]*?)(?=^  [A-Za-z][A-Za-z_-]*:|$(?![\\s\\S]))', 'm'))?.[1];
    assert.ok(text, name + ' job must exist');
    return text;
  };
  for (const [name, artifact] of [['propose', /name:\s*improvement-proposer(?:\s|$)/], ['trials', /name:\s*improvement-assigned-\$\{\{\s*matrix\.variant\s*\}\}/], ['grade', /name:\s*improvement-blind(?:\s|$)/]]) {
    const text = job(name);
    assert.doesNotMatch(text, /uses:\s*actions\/checkout@/, name + ' must have no repository checkout');
    assert.doesNotMatch(text, /name:\s*improvement-input(?:\s|$)/, name + ' must not download full held-out inputs');
    assert.match(text, artifact, name + ' must download its assigned workspace');
    assert.match(text, /uses:\s*actions\/download-artifact@/);
    // This pinned action adds --skip-git-repo-check itself; repeating it fails parsing.
    assert.match(text, /openai\/codex-action@bdf19a4a223ec2549a3e2274a0cf61556bc07675/);
    assert.doesNotMatch(text, /codex-args:.*--skip-git-repo-check/);
  }
  const trusted = job('prepare-trials');
  assert.match(trusted, /uses:\s*actions\/checkout@/);
  assert.match(trusted, /name:\s*improvement-input(?:\s|$)/);
  assert.match(trusted, /node scripts\/prepare-improvement\.mjs trial/);
  assert.doesNotMatch(trusted, /uses:\s*openai\/codex-action@/, 'full inputs remain in a trusted preparation job without model access');
});
