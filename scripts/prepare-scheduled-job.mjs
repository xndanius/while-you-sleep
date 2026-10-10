import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, validId, writeJSON } from '../lib/storage.mjs';
import { TIMEZONE, RESEARCH_MINUTE, RESEARCH_EVERY_HOURS, MEASUREMENT_TIME, IMPROVEMENT_TIME, localParts, previousLocalTime } from '../lib/config.mjs';

const directories = { research: 'research', measure: 'measurements', improve: 'versions' };
const pad = value => String(value).padStart(2, '0');

function predicate(kind) {
  if (kind === 'research') return part => part.hour % RESEARCH_EVERY_HOURS === 0 && part.minute === RESEARCH_MINUTE;
  const value = kind === 'measure' ? MEASUREMENT_TIME : kind === 'improve' ? IMPROVEMENT_TIME : null;
  if (!value) throw new Error('Unknown scheduled job kind.');
  const [hour, minute] = value.split(':').map(Number);
  return part => part.hour === hour && part.minute === minute;
}

export function latestScheduledSlot(kind, now = new Date()) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid scheduled job time.');
  const scheduledAt = previousLocalTime(predicate(kind), date);
  if (!scheduledAt) throw new Error('No elapsed scheduled job slot.');
  const part = localParts(scheduledAt);
  return { jobKey: `${kind}-${part.day}-${pad(part.hour)}-${pad(part.minute)}`, scheduledAt, timezone: TIMEZONE };
}

export function scheduledDecision({ kind, eventName, now = new Date(), completions = [] }) {
  const slot = latestScheduledSlot(kind, now);
  const completed = completions.some(record => {
    if (record.eventName !== 'schedule' || record.jobKey !== slot.jobKey || record.scheduleStatus !== 'completed') return false;
    try {
      // The autumn clock change can produce two UTC instants for one local
      // slot ID. A successful first occurrence must also suppress the second.
      return trustedScheduledMetadata(kind, { GITHUB_EVENT_NAME: 'schedule', SCHEDULED_JOB_KEY: record.jobKey, SCHEDULED_AT: record.scheduledAt }).jobKey === slot.jobKey;
    } catch { return false; }
  });
  return { ...slot, eventName, due: eventName === 'workflow_dispatch' || (eventName === 'schedule' && !completed),
    reason: eventName === 'workflow_dispatch' ? 'manual_diagnostic' : completed ? 'scheduled_slot_completed' : eventName === 'schedule' ? 'scheduled_slot_stale' : 'unsupported_event' };
}

// These values come from a trusted gate job, never a model artifact. A manual
// diagnostic retains its true event name and cannot complete a scheduled slot.
export function trustedScheduledMetadata(kind, env = process.env) {
  const eventName = ['schedule', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME) ? env.GITHUB_EVENT_NAME : 'unknown';
  if (!env.SCHEDULED_JOB_KEY && !env.SCHEDULED_AT) return { eventName, jobKey: null, scheduledAt: null };
  const scheduledAt = new Date(env.SCHEDULED_AT);
  if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getUTCSeconds() || scheduledAt.getUTCMilliseconds()
    || !predicate(kind)(localParts(scheduledAt))) throw new Error('Invalid trusted scheduled slot timestamp.');
  const slot = latestScheduledSlot(kind, scheduledAt);
  if (slot.jobKey !== env.SCHEDULED_JOB_KEY || slot.scheduledAt !== scheduledAt.toISOString()) throw new Error('Trusted scheduled slot ID and timestamp disagree.');
  return { eventName, jobKey: slot.jobKey, scheduledAt: slot.scheduledAt };
}

export async function prepareScheduledJob({ kind, root = ROOT, env = process.env, now = new Date() } = {}) {
  if (!directories[kind]) throw new Error('Unknown scheduled job kind.');
  const directory = path.join(root, 'data', directories[kind]);
  let files = [];
  try { files = await fs.readdir(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Loop research crosses a model workspace. Only the dedicated, no-model
  // research workflow's bounded filename can complete a research slot.
  const completionFiles = files.filter(file => kind === 'research' ? /^research-\d+-\d+\.json$/.test(file) : file.endsWith('.json'));
  const completions = (await Promise.all(completionFiles.map(async file => {
    const record = JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'));
    return kind !== 'research' || (record.id + '.json' === file && record.runId === record.id) ? record : null;
  }))).filter(Boolean);
  const decision = scheduledDecision({ kind, eventName: env.GITHUB_EVENT_NAME || 'unknown', now, completions });
  const runId = env.RUN_ID || `${kind}-${env.GITHUB_RUN_ID || new Date(now).getTime()}-${env.GITHUB_RUN_ATTEMPT || 1}`;
  if (!validId(runId)) throw new Error('Invalid scheduled job run ID.');
  const record = { ...decision, runId, selectedAt: new Date(now).toISOString() };
  await writeJSON(path.join(root, '.run', `scheduled-${kind}.json`), record);
  const values = { due: String(record.due), runId, jobKey: record.jobKey, scheduledAt: record.scheduledAt, eventName: record.eventName };
  if (env.GITHUB_OUTPUT) await fs.appendFile(env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
  console.log(JSON.stringify(values));
  return record;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareScheduledJob({ kind: process.argv[2] }).catch(() => { console.error('Scheduled job gate failed before selecting a trusted slot.'); process.exitCode = 1; });
}
