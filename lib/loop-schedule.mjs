import { TIMEZONE, HOURS, PUBLICATION_MINUTE, localParts, previousLocalTime, publicationSlots } from './config.mjs';
import { sha256, stableJSON, validId } from './storage.mjs';

export const DAILY_PUBLICATION_CAP = 3;
export const TEMPORARY_CATCHUP_CRON = '3,13,23,33,43,53 * 10 10 *';
export const TEMPORARY_CATCHUP_EXPIRES_AT = '2026-10-10T13:58:00.000Z';
const time = value => Date.parse(value);
const localDay = value => Number.isFinite(time(value)) ? localParts(new Date(value)).day : null;
const publishedFor = (posts, slotId, runId) => posts.filter(post => post.scheduling?.slotId === slotId || (runId && post.runId === runId));

export function latestPublicationSlot(now = new Date()) {
  const scheduledAt = previousLocalTime(p => HOURS.includes(p.hour) && p.minute === PUBLICATION_MINUTE, now);
  return publicationSlots(new Date(scheduledAt)).find(slot => slot.scheduledAt === scheduledAt);
}

export function dailyPublicationCount(posts, now = new Date()) {
  const day = localParts(now).day;
  return posts.filter(post => localDay(post.publishedAt) === day).length;
}

// Existing launch records predate slot metadata. Their actual publication time
// can fulfil an elapsed slot; a failed/rejected run never fulfils it.
function fulfilled(slot, posts) {
  return publishedFor(posts, slot.id).length > 0 || posts.some(post => !post.scheduling && localDay(post.publishedAt) === slot.localDate && time(post.publishedAt) >= time(slot.scheduledAt));
}

export function loopDecision({ runId, eventName, triggerCron = null, githubRunId = null, githubRunUrl = null, bootstrap = false, now = new Date(), posts = [], reservations = [], outcomes = [] }) {
  if (!validId(runId) || !Number.isFinite(new Date(now).getTime())) throw new Error('Invalid loop scheduling request.');
  const requestedAt = new Date(now).toISOString(), latest = latestPublicationSlot(now);
  const slot = bootstrap ? {id:'bootstrap-initial',scheduledAt:requestedAt,localDate:localParts(now).day,localTime:null} : latest;
  const base = {id:runId,runId,type:'loop-scheduling',eventName,event:eventName,triggerCron,githubRunId:String(githubRunId || ''),githubRunUrl,timezone:TIMEZONE,slotId:slot.id,scheduledAt:slot.scheduledAt,localDate:slot.localDate,localTime:slot.localTime,requestedAt,catchUp:!bootstrap && time(requestedAt) - time(slot.scheduledAt) >= 60000,bootstrap:!!bootstrap,dailyCap:DAILY_PUBLICATION_CAP,dailyCount:dailyPublicationCount(posts,now),missedSlots:bootstrap?[]:publicationSlots(new Date(slot.scheduledAt)).filter(earlier => time(earlier.scheduledAt)<time(slot.scheduledAt) && !fulfilled(earlier,posts)),reservationId:null,targetCount:0};
  const skip = reason => ({...base,decision:'skip',reason});
  if (!['schedule','workflow_dispatch'].includes(eventName)) return skip('unsupported_event');
  if (triggerCron === TEMPORARY_CATCHUP_CRON && (requestedAt.slice(0,10) !== '2026-10-10' || time(requestedAt)>=time(TEMPORARY_CATCHUP_EXPIRES_AT))) return skip('temporary_catchup_expired');
  if (bootstrap && eventName !== 'workflow_dispatch') return skip('bootstrap_requires_manual_dispatch');
  if (bootstrap && posts.length >= 3) return skip('initial_bootstrap_already_completed');
  if (!bootstrap && fulfilled(slot,posts)) return skip('slot_already_published');
  if (base.dailyCount >= DAILY_PUBLICATION_CAP) return skip('daily_cap_reached');
  const attempts = reservations.filter(record => record.slotId === slot.id);
  for (const reservation of attempts) {
    if (publishedFor(posts,slot.id,reservation.runId).length) return skip('slot_already_published');
    const outcome = outcomes.find(record => record.reservationId === reservation.id);
    if (!outcome) return {...skip('reservation_in_progress_or_unknown'),heldReservationId:reservation.id};
    if (outcome.published?.length) return skip('slot_already_published');
    if (outcome.status !== 'failed_retryable') return {...skip('reservation_outcome_uncertain'),heldReservationId:reservation.id};
  }
  const failures = attempts.map(reservation => outcomes.find(outcome => outcome.reservationId === reservation.id)).filter(outcome => outcome?.status === 'failed_retryable').sort((a,b)=>time(b.settledAt)-time(a.settledAt));
  if (failures.length) {
    const retryAt = new Date(time(failures[0].settledAt)+Math.min(60,10 * 2 ** Math.min(3,failures.length-1))*60000).toISOString();
    if (time(requestedAt)<time(retryAt)) return {...skip('failed_slot_retry_backoff'),retryAt};
  }
  const targetCount = bootstrap ? Math.min(3-posts.length,DAILY_PUBLICATION_CAP-base.dailyCount) : 1;
  return {...base,decision:'run',reason:failures.length?'retry_failed_slot':base.catchUp?'catch_up_latest_elapsed_slot':'scheduled_slot_due',reservationId:runId,targetCount};
}

export function validateLoopScheduling(record, { runId, expectedSha256, eventName } = {}) {
  if (!record || record.id !== runId || record.runId !== runId || record.type !== 'loop-scheduling' || !validId(runId)) throw new Error('Trusted loop scheduling identity is missing.');
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 || '') || sha256(stableJSON(record)) !== expectedSha256) throw new Error('Trusted loop scheduling fingerprint changed.');
  if (!['schedule','workflow_dispatch'].includes(record.eventName) || (eventName && record.eventName !== eventName)) throw new Error('Loop event provenance changed.');
  if (!Number.isFinite(time(record.requestedAt)) || record.dailyCap !== DAILY_PUBLICATION_CAP) throw new Error('Trusted loop time or daily cap is invalid.');
  if (record.bootstrap) {
    if (record.eventName !== 'workflow_dispatch' || record.slotId !== 'bootstrap-initial' || record.scheduledAt !== record.requestedAt) throw new Error('Bootstrap scheduling metadata is invalid.');
  } else {
    const slot = publicationSlots(new Date(record.scheduledAt)).find(slot => slot.id === record.slotId && slot.scheduledAt === record.scheduledAt);
    if (!slot || slot.localDate !== record.localDate || slot.localTime !== record.localTime || time(record.scheduledAt)>time(record.requestedAt)) throw new Error('Trusted loop slot does not match the publication schedule.');
  }
  if (record.decision === 'run' && (record.reservationId !== runId || !Number.isInteger(record.targetCount) || record.targetCount<1 || record.targetCount>3 || (!record.bootstrap && record.targetCount!==1))) throw new Error('Trusted loop reservation or target count is invalid.');
  if (record.decision !== 'run' && (record.decision !== 'skip' || record.targetCount !== 0 || record.reservationId !== null)) throw new Error('Invalid skipped loop decision.');
  return record;
}

export function slotOutcome(reservation, run, {settledByRunId=run?.id, now=new Date()} = {}) {
  if (!reservation || !validId(reservation.id) || reservation.runId !== reservation.id || !validId(settledByRunId)) throw new Error('Invalid loop reservation outcome.');
  const published = Array.isArray(run?.published) ? [...run.published] : [];
  return {id:reservation.id,reservationId:reservation.id,runId:reservation.runId,settledByRunId,slotId:reservation.slotId,settledAt:new Date(now).toISOString(),status:published.length?'published':'failed_retryable',published,reason:published.length?'Committed checked posts fulfil this slot.':'The terminal run has no committed publication; the slot can retry after backoff.'};
}
