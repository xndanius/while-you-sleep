import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, validId, writeJSON } from '../lib/storage.mjs';
import { TIMEZONE, RESEARCH_MINUTE, MEASUREMENT_TIME, IMPROVEMENT_TIME, localParts, previousLocalTime } from '../lib/config.mjs';
import {DEFAULT_CADENCE_CONFIG,LEGACY_CADENCE_CONFIG,normalizeCadenceConfig,researchEveryHours} from '../public/cadence-config.js';
import { verifyClockDispatch,validClockProvenance } from '../lib/clock-provenance.mjs';

const directories = { research: 'research', measure: 'measurements', improve: 'versions' };
const pad = value => String(value).padStart(2, '0');

function predicate(kind,cadence=DEFAULT_CADENCE_CONFIG) {
  if (kind === 'research') return (part,at) => part.hour % researchEveryHours(at,cadence) === 0 && part.minute === RESEARCH_MINUTE;
  const value = kind === 'measure' ? MEASUREMENT_TIME : kind === 'improve' ? IMPROVEMENT_TIME : null;
  if (!value) throw new Error('Unknown scheduled job kind.');
  const [hour, minute] = value.split(':').map(Number);
  return part => part.hour === hour && part.minute === minute;
}

export function latestScheduledSlot(kind, now = new Date(), cadence = DEFAULT_CADENCE_CONFIG) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid scheduled job time.');
  cadence=normalizeCadenceConfig(cadence);
  const scheduledAt = previousLocalTime(predicate(kind,cadence), date);
  if (!scheduledAt) throw new Error('No elapsed scheduled job slot.');
  const part = localParts(scheduledAt);
  return { jobKey: `${kind}-${part.day}-${pad(part.hour)}-${pad(part.minute)}`, scheduledAt, timezone: TIMEZONE };
}

export function scheduledDecision({ kind, eventName, automatic = false, now = new Date(), completions = [], cadence = DEFAULT_CADENCE_CONFIG }) {
  const slot = latestScheduledSlot(kind, now,cadence);
  const completed = completions.some(record => {
    if (!['schedule', 'workflow_dispatch'].includes(record.eventName) || record.jobKey !== slot.jobKey || record.scheduleStatus !== 'completed') return false;
    try {
      // The autumn clock change can produce two UTC instants for one local
      // slot ID. A successful first occurrence must also suppress the second.
      return trustedScheduledMetadata(kind, { GITHUB_EVENT_NAME: record.eventName, SCHEDULED_JOB_KEY: record.jobKey, SCHEDULED_AT: record.scheduledAt,...(record.cadence?{SCHEDULED_CADENCE_JSON:JSON.stringify(record.cadence)}:{}) }).jobKey === slot.jobKey;
    } catch { return false; }
  });
  const manual = eventName === 'workflow_dispatch' && !automatic;
  const scheduled = eventName === 'schedule' || (eventName === 'workflow_dispatch' && automatic);
  return { ...slot, eventName, due: manual || (scheduled && !completed),
    reason: manual ? 'manual_diagnostic' : completed ? 'scheduled_slot_completed' : scheduled ? 'scheduled_slot_stale' : 'unsupported_event' };
}

// These values come from a trusted gate job, never a model artifact. A successful
// manual diagnostic can fulfil its exact auxiliary slot, while retaining its
// true event name. Completion is idempotence, never evidence of an automatic trigger.
export function trustedScheduledMetadata(kind, env = process.env) {
  const eventName = ['schedule', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME) ? env.GITHUB_EVENT_NAME : 'unknown';
  let clock;
  if(env.SCHEDULED_CLOCK_JSON){clock=JSON.parse(env.SCHEDULED_CLOCK_JSON);if(clock&&(eventName!=='workflow_dispatch'||!env.GITHUB_RUN_ID||!validClockProvenance(clock,{kind,runId:env.GITHUB_RUN_ID})))throw new Error('Invalid trusted clock gate metadata.');}
  const cadence=env.SCHEDULED_CADENCE_JSON?normalizeCadenceConfig(JSON.parse(env.SCHEDULED_CADENCE_JSON)):LEGACY_CADENCE_CONFIG;
  const provenance={eventName,...(clock?{clock}:{} ),...(env.SCHEDULED_CADENCE_JSON?{cadence}:{})};
  if (!env.SCHEDULED_JOB_KEY && !env.SCHEDULED_AT) return { ...provenance, jobKey: null, scheduledAt: null };
  const scheduledAt = new Date(env.SCHEDULED_AT);
  if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getUTCSeconds() || scheduledAt.getUTCMilliseconds()
    || !predicate(kind,cadence)(localParts(scheduledAt),scheduledAt)) throw new Error('Invalid trusted scheduled slot timestamp.');
  const slot = latestScheduledSlot(kind, scheduledAt,cadence);
  if (slot.jobKey !== env.SCHEDULED_JOB_KEY || slot.scheduledAt !== scheduledAt.toISOString()) throw new Error('Trusted scheduled slot ID and timestamp disagree.');
  return { ...provenance, jobKey: slot.jobKey, scheduledAt: slot.scheduledAt };
}

export async function prepareScheduledJob({ kind, root = ROOT, env = process.env, now = new Date(),apiGet,cadence=DEFAULT_CADENCE_CONFIG } = {}) {
  if (!directories[kind]) throw new Error('Unknown scheduled job kind.');
  const clock=await verifyClockDispatch({kind,root,env,now,apiGet});
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
  cadence=normalizeCadenceConfig(cadence);
  const decision = scheduledDecision({ kind, eventName: env.GITHUB_EVENT_NAME || 'unknown', automatic:!!clock,now, completions,cadence });
  const runId = env.RUN_ID || `${kind}-${env.GITHUB_RUN_ID || new Date(now).getTime()}-${env.GITHUB_RUN_ATTEMPT || 1}`;
  if (!validId(runId)) throw new Error('Invalid scheduled job run ID.');
  const record = { ...decision, runId, selectedAt: new Date(now).toISOString(),cadence,...(clock?{clock}:{} ) };
  await writeJSON(path.join(root, '.run', `scheduled-${kind}.json`), record);
  const values = { due: String(record.due), runId, jobKey: record.jobKey, scheduledAt: record.scheduledAt, eventName: record.eventName, reason: record.reason,cadence:JSON.stringify(cadence),clock:JSON.stringify(clock),clock_verified:String(clock?.verified===true) };
  if (env.GITHUB_OUTPUT) await fs.appendFile(env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
  console.log(JSON.stringify(values));
  return record;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareScheduledJob({ kind: process.argv[2] }).catch(() => { console.error('Scheduled job gate failed before selecting a trusted slot.'); process.exitCode = 1; });
}
