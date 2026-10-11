import { TIMEZONE, HOURS, PUBLICATION_MINUTE, localParts, previousLocalTime, publicationSlots } from './config.mjs';
import { sha256, stableJSON, validId } from './storage.mjs';

export const DAILY_PUBLICATION_CAP = 3;
export const TEMPORARY_CATCHUP_CRON = '3,13,23,33,43,53 * 10 10 *';
export const TEMPORARY_CATCHUP_EXPIRES_AT = '2026-10-10T13:58:00.000Z';
const time = value => Date.parse(value);
const localDay = value => Number.isFinite(time(value)) ? localParts(new Date(value)).day : null;
export const reservationSlotIds = reservation => Array.isArray(reservation.slotIds) ? reservation.slotIds : [reservation.slotId];

export function latestPublicationSlot(now = new Date()) {
  const scheduledAt = previousLocalTime(p => HOURS.includes(p.hour) && p.minute === PUBLICATION_MINUTE, now);
  return publicationSlots(new Date(scheduledAt)).find(slot => slot.scheduledAt === scheduledAt);
}

export function dailyPublicationCount(posts, now = new Date()) {
  const day = localParts(now).day;
  return posts.filter(post => localDay(post.publishedAt) === day).length;
}

// Old launch posts have no slot identity. Allocate each at most once, to an
// elapsed slot on its actual publication date; do not invent future timing.
export function fulfilledPublicationSlots(posts, slots) {
  const fulfilled = new Set(slots.filter(slot => posts.some(post => post.scheduling?.slotId === slot.id)).map(slot => slot.id));
  const legacy = posts.filter(post => !post.scheduling && localDay(post.publishedAt) === slots[0]?.localDate).sort((a,b) => time(a.publishedAt)-time(b.publishedAt));
  for (const post of legacy) {
    const slot = slots.find(slot => !fulfilled.has(slot.id) && time(slot.scheduledAt) <= time(post.publishedAt));
    if (slot) fulfilled.add(slot.id);
  }
  return fulfilled;
}

export function outcomeForSlot(outcome, slotId) {
  if (!outcome) return null;
  if (Array.isArray(outcome.slotOutcomes)) return outcome.slotOutcomes.find(slot => slot.slotId === slotId) || null;
  return outcome.slotId === slotId ? outcome : null;
}

export function loopDecision({ runId, eventName, triggerCron = null, githubRunId = null, githubRunUrl = null, bootstrap = false, now = new Date(), posts = [], reservations = [], outcomes = [] }) {
  if (!validId(runId) || !Number.isFinite(new Date(now).getTime())) throw new Error('Invalid loop scheduling request.');
  const requestedAt = new Date(now).toISOString(), localDate = localParts(now).day;
  const allSlots = publicationSlots(now), elapsed = allSlots.filter(slot => time(slot.scheduledAt) <= time(requestedAt));
  const fulfilled = fulfilledPublicationSlots(posts, allSlots);
  const missing = elapsed.filter(slot => !fulfilled.has(slot.id));
  const primary = bootstrap ? {id:'bootstrap-initial',scheduledAt:requestedAt,localDate,localTime:null} : missing[0] || elapsed.at(-1) || {id:null,scheduledAt:null,localDate,localTime:null};
  const base = {id:runId,runId,type:'loop-scheduling',eventName,event:eventName,triggerCron,githubRunId:String(githubRunId || ''),githubRunUrl,timezone:TIMEZONE,slotId:primary.id,scheduledAt:primary.scheduledAt,localDate,localTime:primary.localTime,requestedAt,catchUp:!bootstrap && !!primary.scheduledAt && time(requestedAt)-time(primary.scheduledAt)>=60000,bootstrap:!!bootstrap,dailyCap:DAILY_PUBLICATION_CAP,dailyCount:dailyPublicationCount(posts,now),missedSlots:bootstrap?[]:missing,slots:[],slotIds:[],reservationId:null,targetCount:0};
  const skip = (reason, extra={}) => ({...base,decision:'skip',reason,...extra});
  if (!['schedule','workflow_dispatch'].includes(eventName)) return skip('unsupported_event');
  if (triggerCron === TEMPORARY_CATCHUP_CRON && (requestedAt.slice(0,10) !== '2026-10-10' || time(requestedAt)>=time(TEMPORARY_CATCHUP_EXPIRES_AT))) return skip('temporary_catchup_expired');
  if (bootstrap && eventName !== 'workflow_dispatch') return skip('bootstrap_requires_manual_dispatch');
  if (bootstrap && posts.length >= 3) return skip('initial_bootstrap_already_completed');
  if (base.dailyCount >= DAILY_PUBLICATION_CAP) return skip('daily_cap_reached');
  if (!bootstrap && !elapsed.length) return skip('no_current_day_slot_due');
  if (!bootstrap && !missing.length) return skip('slot_already_published');
  const due = bootstrap ? [primary] : missing;
  const eligible = [], deferred = []; let retrying = false;
  for (const slot of due) {
    const attempts = reservations.filter(record => reservationSlotIds(record).includes(slot.id));
    const failures = []; let completed = false;
    for (const reservation of attempts) {
      const outcome = outcomeForSlot(outcomes.find(record => record.reservationId === reservation.id), slot.id);
      if (!outcome) return skip('reservation_in_progress_or_unknown',{heldReservationId:reservation.id});
      if (outcome.published?.length) { completed = true; break; }
      if (outcome.status !== 'failed_retryable') return skip('reservation_outcome_uncertain',{heldReservationId:reservation.id});
      failures.push(outcome);
    }
    if (completed) continue;
    failures.sort((a,b)=>time(b.settledAt)-time(a.settledAt));
    if (failures.length) {
      const retryAt = new Date(time(failures[0].settledAt)+Math.min(60,10*2**Math.min(3,failures.length-1))*60000).toISOString();
      if (time(requestedAt)<time(retryAt)) { deferred.push({slotId:slot.id,retryAt}); continue; }
      retrying = true;
    }
    eligible.push(slot);
  }
  if (!eligible.length) return deferred.length ? skip('failed_slot_retry_backoff',{retryAt:deferred[0].retryAt,deferredSlots:deferred}) : skip('slot_already_published');
  const slots = eligible.slice(0, DAILY_PUBLICATION_CAP-base.dailyCount);
  const first = slots[0], targetCount = bootstrap ? Math.min(3-posts.length,DAILY_PUBLICATION_CAP-base.dailyCount) : slots.length;
  return {...base,slotId:first.id,scheduledAt:first.scheduledAt,localTime:first.localTime,catchUp:!bootstrap && time(requestedAt)-time(first.scheduledAt)>=60000,slots,slotIds:slots.map(slot=>slot.id),decision:'run',reason:retrying?'retry_failed_slot':slots.length>1?'catch_up_all_elapsed_slots':base.catchUp?'catch_up_elapsed_slot':'scheduled_slot_due',reservationId:runId,targetCount,...(deferred.length?{deferredSlots:deferred}:{})};
}

export function validateLoopScheduling(record, { runId, expectedSha256, eventName } = {}) {
  if (!record || record.id !== runId || record.runId !== runId || record.type !== 'loop-scheduling' || !validId(runId)) throw new Error('Trusted loop scheduling identity is missing.');
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 || '') || sha256(stableJSON(record)) !== expectedSha256) throw new Error('Trusted loop scheduling fingerprint changed.');
  if (!['schedule','workflow_dispatch'].includes(record.eventName) || (eventName && record.eventName !== eventName)) throw new Error('Loop event provenance changed.');
  if (!Number.isFinite(time(record.requestedAt)) || record.dailyCap !== DAILY_PUBLICATION_CAP) throw new Error('Trusted loop time or daily cap is invalid.');
  if (record.bootstrap) {
    if (record.eventName !== 'workflow_dispatch' || record.slotId !== 'bootstrap-initial' || record.scheduledAt !== record.requestedAt) throw new Error('Bootstrap scheduling metadata is invalid.');
  } else if (record.slotId !== null) {
    const slot = publicationSlots(new Date(record.scheduledAt)).find(slot => slot.id === record.slotId && slot.scheduledAt === record.scheduledAt);
    if (!slot || slot.localDate !== record.localDate || slot.localTime !== record.localTime || time(record.scheduledAt)>time(record.requestedAt)) throw new Error('Trusted loop slot does not match the publication schedule.');
  }
  if (record.decision === 'run') {
    if (record.reservationId !== runId || !Number.isInteger(record.targetCount) || record.targetCount<1 || record.targetCount>3) throw new Error('Trusted loop reservation or target count is invalid.');
    if (!record.bootstrap && record.slots) {
      const currentDay = publicationSlots(new Date(record.requestedAt));
      if (record.slots.length !== record.targetCount || record.slotIds?.length !== record.targetCount || new Set(record.slotIds).size !== record.targetCount || record.slots[0].id !== record.slotId) throw new Error('Trusted batch slot count is invalid.');
      let previous = -Infinity;
      for (const [index, reserved] of record.slots.entries()) {
        const slot = currentDay.find(slot => slot.id === reserved.id && slot.scheduledAt === reserved.scheduledAt);
        if (!slot || slot.localDate !== record.localDate || slot.localTime !== reserved.localTime || time(slot.scheduledAt)>time(record.requestedAt) || time(slot.scheduledAt)<=previous || record.slotIds[index]!==slot.id) throw new Error('Trusted batch contains an invalid, future or duplicate slot.');
        previous = time(slot.scheduledAt);
      }
    } else if (!record.bootstrap && record.targetCount !== 1) throw new Error('Legacy reservation has an invalid target count.');
  } else if (record.decision !== 'skip' || record.targetCount !== 0 || record.reservationId !== null) throw new Error('Invalid skipped loop decision.');
  return record;
}

export function slotOutcome(reservation, run, {settledByRunId=run?.id, now=new Date(), posts=[]} = {}) {
  if (!reservation || !validId(reservation.id) || reservation.runId !== reservation.id || !validId(settledByRunId)) throw new Error('Invalid loop reservation outcome.');
  const published = Array.isArray(run?.published) ? [...run.published] : [];
  const settledAt = new Date(now).toISOString();
  const slotOutcomes = reservationSlotIds(reservation).map(slotId => {
    const ids = posts.filter(post => post.runId===reservation.runId && post.scheduling?.slotId===slotId && published.includes(post.id)).map(post=>post.id);
    // A pre-v3 single-slot reservation or bootstrap is fulfilled by its run's checked posts.
    const fulfilled = !reservation.slotIds || slotId==='bootstrap-initial' ? published : ids;
    return {slotId,settledAt,status:fulfilled.length?'published':'failed_retryable',published:fulfilled};
  });
  return {id:reservation.id,reservationId:reservation.id,runId:reservation.runId,settledByRunId,slotId:reservation.slotId,slotIds:reservationSlotIds(reservation),settledAt,status:slotOutcomes.every(slot=>slot.status==='published')?'published':'failed_retryable',published,slotOutcomes,reason:slotOutcomes.every(slot=>slot.status==='published')?'Committed checked posts fulfil every reserved slot.':'Missing reserved slots remain eligible for bounded retries; committed posts cannot repeat.'};
}

// Called by the deterministic publisher after an independent approval. Each
// accepted post consumes the next reserved slot; a rejected candidate does not.
export function postScheduling(scheduling, publicationIndex) {
  if (!Number.isInteger(publicationIndex) || publicationIndex<0 || publicationIndex>=scheduling.targetCount) throw new Error('Publication index exceeds the trusted reservation.');
  if (scheduling.bootstrap) return scheduling;
  const slot = scheduling.slots?.[publicationIndex] || (publicationIndex===0?scheduling:null);
  if (!slot) throw new Error('No trusted slot remains for this checked post.');
  return {...scheduling,batchSlotId:scheduling.slotId,slotId:slot.id?.startsWith('publish-')?slot.id:slot.slotId,scheduledAt:slot.scheduledAt,localDate:slot.localDate,localTime:slot.localTime};
}
