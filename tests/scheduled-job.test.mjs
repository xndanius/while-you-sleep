import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { latestScheduledSlot, scheduledDecision, trustedScheduledMetadata, prepareScheduledJob } from '../scripts/prepare-scheduled-job.mjs';

const complete = slot => ({ ...slot, eventName: 'schedule', scheduleStatus: 'completed' });

test('latest elapsed slots include their exact minute and never select a future daily slot', () => {
  assert.deepEqual(latestScheduledSlot('research', '2026-10-10T09:23:00Z'), { jobKey: 'research-2026-10-10-12-23', scheduledAt: '2026-10-10T09:23:00.000Z', timezone: 'Europe/Vilnius' });
  assert.equal(latestScheduledSlot('research', '2026-10-10T09:22:59Z').scheduledAt, '2026-10-10T06:23:00.000Z');
  assert.equal(latestScheduledSlot('measure', '2026-10-10T18:36:59Z').scheduledAt, '2026-10-09T18:37:00.000Z');
  assert.equal(latestScheduledSlot('measure', '2026-10-10T18:37:00Z').scheduledAt, '2026-10-10T18:37:00.000Z');
  assert.equal(latestScheduledSlot('improve', '2026-10-10T19:12:59Z').scheduledAt, '2026-10-09T19:13:00.000Z');
  assert.equal(latestScheduledSlot('improve', '2026-10-10T19:13:00Z').jobKey, 'improve-2026-10-10-22-13');
});

test('queued jobs crossing local midnight catch the preceding elapsed slot', () => {
  const now = '2026-10-10T21:05:00Z'; // 00:05 on the following Vilnius date.
  assert.equal(latestScheduledSlot('research', now).jobKey, 'research-2026-10-10-21-23');
  assert.equal(latestScheduledSlot('measure', now).jobKey, 'measure-2026-10-10-21-37');
  assert.equal(latestScheduledSlot('improve', now).jobKey, 'improve-2026-10-10-22-13');
  for (const kind of ['research', 'measure', 'improve']) assert.equal(scheduledDecision({ kind, eventName: 'schedule', now }).due, true);
});

test('exact successful scheduled or manual auxiliary slots suppress automatic work; explicit diagnostics remain available', () => {
  const now = '2026-10-10T19:30:00Z';
  for (const kind of ['research', 'measure', 'improve']) {
    const slot = latestScheduledSlot(kind, now);
    for (const completedBy of ['schedule', 'workflow_dispatch']) {
      const completion = { ...complete(slot), eventName: completedBy };
      const automatic = scheduledDecision({ kind, eventName: 'schedule', now, completions: [completion] });
      assert.equal(automatic.due, false);
      assert.equal(automatic.eventName, 'schedule');
      assert.equal(automatic.reason, 'scheduled_slot_completed');
      assert.equal(completion.eventName, completedBy, 'stored provenance never changes');
    }
    for (const completion of [
      { ...complete(slot), eventName: 'unknown' },
      { ...complete(slot), eventName: 'push' },
      { ...complete(slot), eventName: 'workflow_dispatch', scheduleStatus: 'failed' },
      { ...complete(slot), scheduleStatus: 'failed' },
      { ...complete(slot), jobKey: slot.jobKey + '-wrong' },
      { ...complete(slot), scheduledAt: 'invalid' },
      { status: 'completed', createdAt: now },
    ]) assert.equal(scheduledDecision({ kind, eventName: 'schedule', now, completions: [completion] }).due, true);
    const manual = scheduledDecision({ kind, eventName: 'workflow_dispatch', now, completions: [complete(slot)] });
    assert.equal(manual.due, true);
    assert.equal(manual.reason, 'manual_diagnostic');
    assert.equal(manual.eventName, 'workflow_dispatch');
    assert.equal(scheduledDecision({ kind, eventName: 'push', now }).due, false);
  }
});

test('spring gaps and autumn repeated hours retain local IDs without duplicate successful work', () => {
  assert.equal(latestScheduledSlot('research', '2026-03-29T01:05:00Z').scheduledAt, '2026-03-28T22:23:00.000Z');
  assert.equal(latestScheduledSlot('research', '2026-03-29T03:24:00Z').scheduledAt, '2026-03-29T03:23:00.000Z');
  const first = latestScheduledSlot('research', '2026-10-25T00:24:00Z');
  const second = latestScheduledSlot('research', '2026-10-25T01:24:00Z');
  assert.equal(first.jobKey, 'research-2026-10-25-03-23');
  assert.equal(second.jobKey, first.jobKey);
  assert.equal(first.scheduledAt, '2026-10-25T00:23:00.000Z');
  assert.equal(second.scheduledAt, '2026-10-25T01:23:00.000Z');
  assert.equal(scheduledDecision({ kind: 'research', eventName: 'schedule', now: '2026-10-25T01:24:00Z', completions: [complete(first)] }).due, false);
  assert.equal(latestScheduledSlot('measure', '2026-11-10T20:00:00Z').scheduledAt, '2026-11-10T19:37:00.000Z');
  assert.equal(latestScheduledSlot('improve', '2026-11-10T21:00:00Z').scheduledAt, '2026-11-10T20:13:00.000Z');
});

test('record metadata binds a trusted slot while retaining the actual event', () => {
  const slot = latestScheduledSlot('measure', '2026-10-10T19:00:00Z');
  const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', SCHEDULED_JOB_KEY: slot.jobKey, SCHEDULED_AT: slot.scheduledAt };
  assert.deepEqual(trustedScheduledMetadata('measure', env), { eventName: 'workflow_dispatch', jobKey: slot.jobKey, scheduledAt: slot.scheduledAt });
  assert.deepEqual(trustedScheduledMetadata('measure', {}), { eventName: 'unknown', jobKey: null, scheduledAt: null });
  assert.throws(() => trustedScheduledMetadata('measure', { ...env, SCHEDULED_JOB_KEY: 'measure-wrong-slot' }));
  assert.throws(() => trustedScheduledMetadata('measure', { ...env, SCHEDULED_AT: '2026-10-10T18:38:00Z' }));
});

test('trusted gate reads committed completion records and writes auditable outputs', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'wys-scheduled-job-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const now = new Date('2026-10-10T19:30:00Z');
  const slot = latestScheduledSlot('improve', now);
  await mkdir(path.join(root, 'data', 'versions'), { recursive: true });
  await writeFile(path.join(root, 'data', 'versions', 'completed.json'), JSON.stringify({ ...complete(slot), eventName: 'workflow_dispatch' }));
  const output = path.join(root, 'output');
  const env = { GITHUB_EVENT_NAME: 'schedule', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', GITHUB_OUTPUT: output };
  const result = await prepareScheduledJob({ kind: 'improve', root, env, now });
  assert.equal(result.due, false);
  assert.equal(result.runId, 'improve-123-2');
  assert.equal(result.eventName, 'schedule');
  assert.equal(result.reason, 'scheduled_slot_completed');
  assert.equal(JSON.parse(await readFile(path.join(root, 'data', 'versions', 'completed.json'), 'utf8')).eventName, 'workflow_dispatch');
  assert.match(await readFile(output, 'utf8'), /due=false\nrunId=improve-123-2\njobKey=improve-2026-10-10-22-13\n/);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, '.run', 'scheduled-improve.json'), 'utf8')), result);
  const diagnostic = await prepareScheduledJob({ kind: 'improve', root, env: { ...env, GITHUB_EVENT_NAME: 'workflow_dispatch' }, now });
  assert.equal(diagnostic.due, true);
  assert.equal(diagnostic.eventName, 'workflow_dispatch');
});

test('model-writable loop research cannot suppress a standalone research slot', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'wys-research-provenance-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const now = new Date('2026-10-10T13:30:00Z');
  const directory = path.join(root, 'data', 'research');
  await mkdir(directory, { recursive: true });
  const claimed = { ...complete(latestScheduledSlot('research', now)), eventName: 'workflow_dispatch', id: 'research-111-1', runId: 'research-111-1' };
  await writeFile(path.join(directory, 'loop-111-1.json'), JSON.stringify(claimed));
  const env = { GITHUB_EVENT_NAME: 'schedule', GITHUB_RUN_ID: '222', GITHUB_RUN_ATTEMPT: '1' };
  assert.equal((await prepareScheduledJob({ kind: 'research', root, env, now })).due, true);
  await writeFile(path.join(directory, 'research-111-1.json'), JSON.stringify({ ...claimed, runId: 'loop-111-1' }));
  assert.equal((await prepareScheduledJob({ kind: 'research', root, env, now })).due, true);
  await writeFile(path.join(directory, 'research-111-1.json'), JSON.stringify(claimed));
  assert.equal((await prepareScheduledJob({ kind: 'research', root, env, now })).due, false);
});
