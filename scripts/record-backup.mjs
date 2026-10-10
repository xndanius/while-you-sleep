import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const PLAYWRIGHT_VERSION = '1.64.0';
const FRAME_RATE = 30;
const FRAME_COUNT = 900;
const SITE = 'https://xndanius.github.io/while-you-sleep';
const REPOSITORY = 'xndanius/while-you-sleep';
const LOOP_RUNS_URL = `https://api.github.com/repos/${REPOSITORY}/actions/workflows/loop.yml/runs?event=schedule&per_page=100`;
const EXCLUDED_FIELDS = new Set(['checker', 'contentSha256', 'metrics', 'publicUrl', 'imageUrl']);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const stableJSON = value => Array.isArray(value) ? `[${value.map(stableJSON).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${stableJSON(value[key])}`).join(',')}}`
  : JSON.stringify(value);
const contentHash = post => sha256(stableJSON(Object.fromEntries(Object.entries(post).filter(([key]) => !EXCLUDED_FIELDS.has(key)))));
const isHostedRun = value => typeof value === 'string' && /^https:\/\/github\.com\/xndanius\/while-you-sleep\/actions\/runs\/[1-9]\d*(?:\/attempts\/[1-9]\d*)?\/?$/.test(value);
const vilniusDate = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));

export function scheduledDateAllowed(eventName, now = new Date()) {
  if (eventName === 'workflow_dispatch') return true;
  if (eventName !== 'schedule') return false;
  return vilniusDate(now) === '2026-10-12';
}

export function verifyScheduledLoopEvidence(metadata, w1At, now = new Date()) {
  const failures = [], w1Time = Date.parse(w1At);
  const conclusions = new Set(['success', 'failure', 'timed_out', 'neutral', 'skipped', 'action_required', 'stale']);
  const runs = (Array.isArray(metadata?.workflow_runs) ? metadata.workflow_runs : []).filter(run => {
    const created = Date.parse(run?.created_at), started = Date.parse(run?.run_started_at), completed = Date.parse(run?.updated_at);
    return Number.isSafeInteger(run?.id) && run.id > 0 && run.event === 'schedule' && run.status === 'completed'
      && conclusions.has(run.conclusion) && run.run_attempt === 1 && run.head_branch === 'main'
      && ['.github/workflows/loop.yml', '.github/workflows/loop.yml@main'].includes(run.path)
      && run.repository?.full_name === REPOSITORY && run.html_url === `https://github.com/${REPOSITORY}/actions/runs/${run.id}`
      && Number.isFinite(w1Time) && Number.isFinite(created) && created >= w1Time
      && Number.isFinite(started) && started >= created && Number.isFinite(completed) && completed >= started && completed <= now.getTime();
  });
  const uniqueRuns = [...new Map(runs.map(run => [run.id, run])).values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const dates = [...new Set(uniqueRuns.map(run => vilniusDate(run.created_at)))].sort();
  const firstScheduledAt = uniqueRuns[0]?.created_at || null;
  const latestCompletedAt = uniqueRuns.length ? new Date(Math.max(...uniqueRuns.map(run => Date.parse(run.updated_at)))).toISOString() : null;
  if (uniqueRuns.length < 6) failures.push('Fewer than six completed scheduled loop runs are verified after W1.');
  if (dates.length < 2) failures.push('Verified scheduled loop runs do not cover at least two Europe/Vilnius dates.');
  if (!firstScheduledAt || Date.parse(firstScheduledAt) > w1Time + 6 * 3_600_000) failures.push('No completed scheduled loop was created within six hours after W1.');
  if (!latestCompletedAt || Date.parse(latestCompletedAt) < w1Time + 48 * 3_600_000) failures.push('No verified scheduled loop completed at least 48 hours after W1.');
  return { passed: failures.length === 0, failures, count: uniqueRuns.length, vilniusDates: dates, firstScheduledAt, latestCompletedAt,
    runs: uniqueRuns.map(run => ({ id: run.id, url: run.html_url, event: run.event, status: run.status, conclusion: run.conclusion,
      runAttempt: run.run_attempt, scheduledAt: run.created_at, startedAt: run.run_started_at, completedAt: run.updated_at,
      vilniusDate: vilniusDate(run.created_at) })) };
}

export function verifyBackupEvidence(feed, machine, commits, scheduledRuns, now = new Date()) {
  const failures = [];
  const posts = Array.isArray(feed?.posts) ? feed.posts : [];
  const validPosts = posts.filter(post => post && typeof post.id === 'string' && post.id.trim()
    && typeof post.title === 'string' && post.title.trim()
    && post.checker?.passed === true && typeof post.checker?.checkerRunId === 'string' && post.checker.checkerRunId
    && /^[a-f0-9]{64}$/.test(post.contentSha256 || '') && contentHash(post) === post.contentSha256
    && post.origin === 'github-actions-codex-loop' && isHostedRun(post.githubRunUrl)
    && Number.isFinite(Date.parse(post.publishedAt)) && Date.parse(post.publishedAt) <= now.getTime());
  if (validPosts.length !== posts.length) failures.push('A public post lacks valid checker approval, content integrity, cloud provenance, or publication time.');
  if (new Set(validPosts.map(post => post.id)).size !== validPosts.length) failures.push('The public feed contains duplicate post IDs.');
  if (validPosts.length < 3) failures.push('W1 is incomplete: fewer than three actual checked cloud posts are public.');
  const machinePosts = Array.isArray(machine?.posts) ? machine.posts : [];
  const signature = items => stableJSON(items.map(post => ({ id: post.id, contentSha256: post.contentSha256 })).sort((a, b) => a.id.localeCompare(b.id)));
  if (signature(machinePosts) !== signature(posts)) failures.push('The machine and feed disagree about the public posts.');
  if (machine?.stats?.published !== posts.length || feed?.stats?.published !== posts.length) failures.push('Public publication counters disagree with actual post records.');
  if (machine?.schedule?.hosted !== true || !isHostedRun(machine?.status?.lastHostedRunUrl)) failures.push('The public machine has no verified hosted run.');
  const firstThree = validPosts.slice().sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt)).slice(0, 3);
  const w1At = firstThree.length === 3 ? firstThree[2].publishedAt : null;
  const elapsedHours = w1At ? (now.getTime() - Date.parse(w1At)) / 3_600_000 : null;
  if (elapsedHours === null || elapsedHours < 48) failures.push('Two full days have not elapsed since the third initial cloud post.');
  const scheduledLoops = verifyScheduledLoopEvidence(scheduledRuns, w1At, now);
  failures.push(...scheduledLoops.failures);
  const adoptedRules = (Array.isArray(machine?.versions) ? machine.versions : []).filter(version => version?.status === 'adopted'
    && version.adopted === true && isHostedRun(version.githubRunUrl)
    && /^[a-f0-9]{64}$/.test(version.parentRulesSha256 || '') && /^[a-f0-9]{64}$/.test(version.newRulesSha256 || '')
    && version.parentRulesSha256 !== version.newRulesSha256
    && typeof version.change === 'string' && version.change.trim() && typeof version.reason === 'string' && version.reason.trim()
    && Array.isArray(version.evaluations) && version.evaluations.length >= 3
    && Number.isFinite(version.baselineScore) && Number.isFinite(version.challengerScore) && version.challengerScore > version.baselineScore
    && Number.isFinite(Date.parse(version.createdAt)) && Date.parse(version.createdAt) <= now.getTime());
  if (!adoptedRules.length) failures.push('No actual hosted improver rule change has passed its held-out evaluation.');
  const publicCommits = (Array.isArray(commits) ? commits : []).filter(commit => /^[a-f0-9]{40}$/.test(commit?.sha || '')
    && commit.html_url === `https://github.com/${REPOSITORY}/commit/${commit.sha}`);
  if (!publicCommits.length) failures.push('The public GitHub commit history could not be verified.');
  return {
    passed: failures.length === 0, failures, verifiedAt: now.toISOString(), publicPostCount: validPosts.length,
    firstThreePostIds: firstThree.map(post => post.id), w1At, elapsedSinceW1Hours: elapsedHours, scheduledLoops,
    adoptedRuleChanges: adoptedRules.map(version => ({ id: version.id, createdAt: version.createdAt, change: version.change, reason: version.reason,
      parentRulesSha256: version.parentRulesSha256, newRulesSha256: version.newRulesSha256, githubRunUrl: version.githubRunUrl,
      baselineScore: version.baselineScore, challengerScore: version.challengerScore, heldOutCases: version.evaluations.length })),
    publicRuns: (Array.isArray(machine?.runs) ? machine.runs : []).filter(run => isHostedRun(run.githubRunUrl)).map(run => ({
      id: run.id, type: run.type, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, githubRunUrl: run.githubRunUrl })),
    publicCommits: publicCommits.map(commit => ({ sha: commit.sha, url: commit.html_url, committedAt: commit.commit?.committer?.date || null,
      subject: String(commit.commit?.message || '').split('\n')[0] })),
  };
}

export function backupRequestHeaders(url, token) {
  const target = new URL(url);
  const github = target.origin === 'https://api.github.com' && target.pathname.startsWith(`/repos/${REPOSITORY}/`);
  const headers = { Accept: github ? 'application/vnd.github+json' : 'application/json', 'User-Agent': 'While-You-Sleep-W3-Backup' };
  if (github) {
    headers['X-GitHub-Api-Version'] = '2026-03-10';
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function publicJSON(url) {
  const headers = backupRequestHeaders(url, process.env.GITHUB_TOKEN);
  const response = await fetch(url, { headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Public evidence request failed: ${new URL(url).pathname} (HTTP ${response.status}).`);
  const text = await response.text();
  if (Buffer.byteLength(text) > 12_000_000) throw new Error('Public evidence response exceeded the backup size limit.');
  return { value: JSON.parse(text), sha256: sha256(text) };
}

async function preflight() {
  const [feed, machine, commits, scheduledRuns] = await Promise.all([
    publicJSON(`${SITE}/api/feed.json`), publicJSON(`${SITE}/api/machine.json`),
    publicJSON(`https://api.github.com/repos/${REPOSITORY}/commits?sha=main&per_page=30`),
    publicJSON(LOOP_RUNS_URL),
  ]);
  const evidence = verifyBackupEvidence(feed.value, machine.value, commits.value, scheduledRuns.value);
  evidence.sources = { feed: `${SITE}/api/feed.json`, machine: `${SITE}/api/machine.json`, history: `https://github.com/${REPOSITORY}/commits/main`, scheduledLoops: LOOP_RUNS_URL };
  evidence.sourceHashes = { feedSha256: feed.sha256, machineSha256: machine.sha256, historyResponseSha256: commits.sha256, scheduledRunsResponseSha256: scheduledRuns.sha256 };
  if (!evidence.passed) throw new Error(evidence.failures.join(' '));
  return evidence;
}

async function probe(file) {
  const { stdout } = await runFile('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height,avg_frame_rate,nb_read_frames,duration:format=duration', '-of', 'json', file], { timeout: 120_000, maxBuffer: 100_000 });
  const data = JSON.parse(stdout), stream = data.streams?.[0];
  return { durationSeconds: Number(stream?.duration || data.format?.duration), width: stream?.width, height: stream?.height,
    frames: Number(stream?.nb_read_frames), frameRate: stream?.avg_frame_rate };
}

export function verifyVideoProbe(video, frames = FRAME_COUNT) {
  assert.ok(Math.abs(video.durationSeconds - frames / FRAME_RATE) < 0.001, 'Recording duration differs from the exact frame duration.');
  assert.equal(video.frames, frames, 'Recording has the wrong number of actual encoded frames.');
  assert.equal(video.frameRate, '30/1', 'Recording has the wrong frame rate.');
  assert.equal(video.width, 1920, 'Recording has the wrong width.');
  assert.equal(video.height, 1080, 'Recording has the wrong height.');
}

async function capturePage(browser, rawDir, kind, evidence) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
    locale: 'en-GB', timezoneId: 'Europe/Vilnius', recordVideo: { dir: rawDir, size: { width: 1920, height: 1080 }, fps: FRAME_RATE } });
  const page = await context.newPage();
  const video = page.video();
  let result;
  try {
    const url = kind === 'machine' ? `${SITE}/machine/` : evidence.sources.history;
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (!response?.ok()) throw new Error(`${kind} page did not load successfully.`);
    if (kind === 'machine') {
      await page.locator('#runs[aria-busy="false"] .run').first().waitFor({ state: 'visible', timeout: 30_000 });
      const publishedText = await page.locator('#machine-stats strong').first().innerText();
      if (Number(publishedText.replace(/,/g, '')) !== evidence.publicPostCount) throw new Error('Rendered publication count disagrees with verified public records.');
      if (!(await page.locator('#hosting-note').innerText()).includes('Hosted in GitHub Actions')) throw new Error('Rendered machine has no verified cloud execution.');
      await page.waitForTimeout(6_000);
      await page.locator('#runs-heading').scrollIntoViewIfNeeded();
      await page.waitForTimeout(6_000);
      const adopted = page.locator('#versions .version').filter({ has: page.locator('.version-number').filter({ hasText: evidence.adoptedRuleChanges[0].id }) }).first();
      await adopted.scrollIntoViewIfNeeded();
      await page.waitForTimeout(8_000);
    } else {
      await page.locator(`main a[href*="/commit/${evidence.publicCommits[0].sha}"]`).first().waitFor({ state: 'visible', timeout: 30_000 });
      await page.waitForTimeout(5_000);
      await page.mouse.wheel(0, 480);
      await page.waitForTimeout(5_000);
      await page.mouse.wheel(0, 420);
      await page.waitForTimeout(4_000);
    }
    result = { kind, url: page.url(), title: await page.title(), capturedAt: new Date().toISOString() };
  } finally {
    // Playwright flushes the real viewport recording when this context closes.
    await context.close();
  }
  result.rawPath = await video.path();
  result.rawVideo = await probe(result.rawPath);
  return result;
}

async function trimSegment(raw, seconds, output) {
  if (!Number.isFinite(raw.rawVideo.durationSeconds) || raw.rawVideo.durationSeconds < seconds + 0.5) throw new Error('Loaded page footage is too short to trim safely.');
  const start = raw.rawVideo.durationSeconds - seconds;
  await runFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', start.toFixed(6), '-i', raw.rawPath,
    '-an', '-vf', 'fps=30,format=yuv420p', '-frames:v', String(seconds * FRAME_RATE), '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
    '-movflags', '+faststart', output], { timeout: 180_000, maxBuffer: 100_000 });
  verifyVideoProbe(await probe(output), seconds * FRAME_RATE);
  return { kind: raw.kind, url: raw.url, title: raw.title, capturedAt: raw.capturedAt, durationSeconds: seconds,
    rawDurationSeconds: raw.rawVideo.durationSeconds, trimStartSeconds: start, rawSha256: sha256(await fs.readFile(raw.rawPath)) };
}

async function record(evidence) {
  const runtimeDir = path.resolve(process.env.BACKUP_RUNTIME_DIR || '');
  if (!process.env.BACKUP_RUNTIME_DIR) throw new Error('BACKUP_RUNTIME_DIR must point to the workflow-only Playwright installation.');
  const requireRuntime = createRequire(path.join(runtimeDir, 'package.json'));
  if (requireRuntime('playwright/package.json').version !== PLAYWRIGHT_VERSION) throw new Error(`Backup requires the pinned Playwright ${PLAYWRIGHT_VERSION}.`);
  const { chromium } = requireRuntime('playwright');
  const outputDir = path.resolve(process.env.BACKUP_OUTPUT_DIR || 'artifacts/backup');
  await fs.mkdir(path.join(outputDir, 'raw'), { recursive: true });
  // The temporary GitHub read token is for API evidence only, not the browser.
  const browser = await chromium.launch({ headless: true, env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'GITHUB_TOKEN')) });
  let machine, history;
  try {
    machine = await capturePage(browser, path.join(outputDir, 'raw'), 'machine', evidence);
    history = await capturePage(browser, path.join(outputDir, 'raw'), 'history', evidence);
  } finally { await browser.close(); }
  const machinePath = path.join(outputDir, 'machine-18s.mp4'), historyPath = path.join(outputDir, 'history-12s.mp4');
  const segments = [await trimSegment(machine, 18, machinePath), await trimSegment(history, 12, historyPath)];
  const finalPath = path.join(outputDir, 'while-you-sleep-backup-30s.mp4');
  await runFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', machinePath, '-i', historyPath,
    '-filter_complex', '[0:v:0][1:v:0]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-an', '-r', String(FRAME_RATE), '-frames:v', String(FRAME_COUNT),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', finalPath], { timeout: 180_000, maxBuffer: 100_000 });
  const finalProbe = await probe(finalPath);
  verifyVideoProbe(finalProbe);
  const manifest = { ...evidence, recordedAt: new Date().toISOString(), playwrightVersion: PLAYWRIGHT_VERSION,
    capture: 'Real public browser viewports; loaded-page segments trimmed and joined. No substituted page data.', segments,
    recording: { filename: path.basename(finalPath), sha256: sha256(await fs.readFile(finalPath)), ...finalProbe },
    workflowRunUrl: process.env.GITHUB_RUN_ID ? `https://github.com/${REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
    workflowCommit: process.env.GITHUB_SHA || null };
  await fs.writeFile(path.join(outputDir, 'backup-evidence.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, output: finalPath, publicPostCount: evidence.publicPostCount, durationSeconds: finalProbe.durationSeconds,
    adoptedRuleChanges: evidence.adoptedRuleChanges.length, verifiedScheduledLoops: evidence.scheduledLoops.count }));
}

async function selfTest() {
  const now = new Date('2026-10-12T16:30:00Z'), hostedRun = `https://github.com/${REPOSITORY}/actions/runs/12345`;
  const posts = [0, 1, 2].map(index => {
    const post = { id: `offline-test-${index}`, title: `Offline gate fixture ${index}`, origin: 'github-actions-codex-loop',
      githubRunUrl: hostedRun, publishedAt: `2026-10-10T0${index + 5}:00:00Z`, checker: { passed: true, checkerRunId: 'offline-check' } };
    return { ...post, contentSha256: contentHash(post) };
  });
  const feed = { posts, stats: { published: 3 } }, machine = { ...feed, schedule: { hosted: true }, status: { lastHostedRunUrl: hostedRun },
    versions: [{ id: 'offline-improve', status: 'adopted', adopted: true, githubRunUrl: hostedRun, parentRulesSha256: 'a'.repeat(64), newRulesSha256: 'b'.repeat(64),
      change: 'Offline gate fixture', reason: 'Separate held-out improvement gate fixture', evaluations: [{}, {}, {}], baselineScore: 12, challengerScore: 14, createdAt: '2026-10-11T19:00:00Z' }] };
  const commits = [{ sha: 'c'.repeat(40), html_url: `https://github.com/${REPOSITORY}/commit/${'c'.repeat(40)}` }];
  const dates = ['2026-10-10T10:00:00Z', '2026-10-10T16:00:00Z', '2026-10-11T05:00:00Z', '2026-10-11T10:00:00Z', '2026-10-11T16:00:00Z', '2026-10-12T05:00:00Z', '2026-10-12T10:00:00Z'];
  const scheduledRuns = { workflow_runs: dates.map((created, index) => ({ id: 100 + index, html_url: `https://github.com/${REPOSITORY}/actions/runs/${100 + index}`,
    event: 'schedule', status: 'completed', conclusion: index === 1 ? 'failure' : 'success', run_attempt: 1, head_branch: 'main', path: '.github/workflows/loop.yml',
    repository: { full_name: REPOSITORY }, created_at: created, run_started_at: created, updated_at: new Date(Date.parse(created) + 20 * 60_000).toISOString() })) };
  assert.equal(verifyBackupEvidence(feed, machine, commits, scheduledRuns, now).passed, true);
  assert.equal(verifyBackupEvidence({ ...feed, posts: posts.slice(0, 2) }, machine, commits, scheduledRuns, now).passed, false);
  assert.equal(verifyBackupEvidence({ ...feed, posts: [posts[0], posts[0], posts[2]] }, machine, commits, scheduledRuns, now).passed, false);
  const changed = structuredClone(feed); changed.posts[0].title = 'Changed after approval';
  assert.equal(verifyBackupEvidence(changed, machine, commits, scheduledRuns, now).passed, false);
  const local = structuredClone(feed); local.posts[0].origin = 'local-checked-publication'; local.posts[0].contentSha256 = contentHash(local.posts[0]);
  assert.equal(verifyBackupEvidence(local, { ...machine, posts: local.posts }, commits, scheduledRuns, now).passed, false);
  assert.equal(verifyBackupEvidence(feed, machine, commits, scheduledRuns, new Date('2026-10-11T16:30:00Z')).passed, false);
  assert.equal(verifyBackupEvidence(feed, { ...machine, versions: [{ status: 'adopted', id: 'v1' }] }, commits, scheduledRuns, now).passed, false);
  assert.equal(verifyBackupEvidence(feed, machine, [], scheduledRuns, now).passed, false);
  const w1At = posts[2].publishedAt;
  assert.equal(verifyScheduledLoopEvidence(undefined, w1At, now).passed, false);
  assert.equal(verifyScheduledLoopEvidence({ workflow_runs: scheduledRuns.workflow_runs.slice(0, 5) }, w1At, now).passed, false);
  assert.equal(verifyScheduledLoopEvidence({ workflow_runs: scheduledRuns.workflow_runs.map(run => ({ ...run, event: 'workflow_dispatch' })) }, w1At, now).passed, false);
  assert.equal(verifyScheduledLoopEvidence({ workflow_runs: scheduledRuns.workflow_runs.map(run => ({ ...run, conclusion: 'cancelled' })) }, w1At, now).passed, false);
  assert.equal(verifyScheduledLoopEvidence({ workflow_runs: Array(7).fill(scheduledRuns.workflow_runs[0]) }, w1At, now).passed, false);
  assert.equal(verifyScheduledLoopEvidence({ workflow_runs: scheduledRuns.workflow_runs.slice(1) }, w1At, now).passed, false);
  assert.equal(verifyScheduledLoopEvidence({ workflow_runs: scheduledRuns.workflow_runs.slice(0, 6) }, w1At, now).passed, false);
  assert.equal(verifyScheduledLoopEvidence({ workflow_runs: scheduledRuns.workflow_runs.map(run => ({ ...run, run_attempt: 2 })) }, w1At, now).passed, false);
  assert.equal(verifyScheduledLoopEvidence({ workflow_runs: scheduledRuns.workflow_runs.map(run => ({ ...run, repository: { full_name: 'other/repository' } })) }, w1At, now).passed, false);
  assert.equal(verifyScheduledLoopEvidence({ workflow_runs: scheduledRuns.workflow_runs.map(run => ({ ...run, status: 'in_progress' })) }, w1At, now).passed, false);
  assert.equal(backupRequestHeaders(LOOP_RUNS_URL, 'offline-token-fixture').Authorization, 'Bearer offline-token-fixture');
  assert.equal(backupRequestHeaders(`${SITE}/api/feed.json`, 'offline-token-fixture').Authorization, undefined);
  assert.equal(backupRequestHeaders('https://api.github.com/repos/other/repository/actions/runs', 'offline-token-fixture').Authorization, undefined);
  assert.equal(backupRequestHeaders('https://api.github.com.example.org/repos/xndanius/while-you-sleep/actions/runs', 'offline-token-fixture').Authorization, undefined);
  assert.equal(scheduledDateAllowed('schedule', now), true);
  assert.equal(scheduledDateAllowed('schedule', new Date('2027-10-12T16:30:00Z')), false);
  assert.equal(scheduledDateAllowed('workflow_dispatch', now), true);
  const video = { durationSeconds: 30, frames: 900, frameRate: '30/1', width: 1920, height: 1080 };
  verifyVideoProbe(video);
  assert.throws(() => verifyVideoProbe({ ...video, frames: 899 }));
  assert.throws(() => verifyVideoProbe({ ...video, durationSeconds: 29.99 }));
  console.log('Backup evidence, unattended scheduled-run coverage, credential destination and exact-duration gates: 28 offline checks passed. No browser was opened or recording made.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--self-test') await selfTest();
    else if (process.argv[2] === '--calendar') {
      const due = scheduledDateAllowed(process.env.GITHUB_EVENT_NAME);
      if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `due=${due}\n`);
      console.log(due ? 'W3 backup is due.' : 'One-time scheduled backup is not due today.');
    } else if (process.argv[2] === '--preflight') {
      const evidence = await preflight();
      console.log(JSON.stringify({ passed: true, publicPostCount: evidence.publicPostCount, w1At: evidence.w1At,
        elapsedSinceW1Hours: evidence.elapsedSinceW1Hours, adoptedRuleChanges: evidence.adoptedRuleChanges.length,
        verifiedScheduledLoops: evidence.scheduledLoops.count, scheduledVilniusDates: evidence.scheduledLoops.vilniusDates,
        firstScheduledAt: evidence.scheduledLoops.firstScheduledAt, latestCompletedAt: evidence.scheduledLoops.latestCompletedAt }));
    } else if (process.argv[2] === '--record') await record(await preflight());
    else throw new Error('Usage: node scripts/record-backup.mjs --calendar | --self-test | --preflight | --record');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
