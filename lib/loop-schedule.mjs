import { TIMEZONE, localParts, publicationSlots } from './config.mjs';
import {publicationTime} from '../public/schedule.js';
import {DEFAULT_CADENCE_CONFIG,LEGACY_CADENCE_CONFIG,normalizeCadenceConfig,dailyPublicationCap,MAX_PUBLICATION_BATCH_SIZE} from '../public/cadence-config.js';
import { sha256, stableJSON, validId } from './storage.mjs';
import { validClockProvenance } from './clock-provenance.mjs';
import {noFreshLeadsSettlement} from './no-fresh-leads-settlement.mjs';
import {assistantCheckerId,assistantProvenanceReasons} from './assistant-identity.mjs';

export const DAILY_PUBLICATION_CAP = 3;
export const MAX_SLOT_ATTEMPTS = 3;
export const TEMPORARY_CATCHUP_CRON = '3,13,23,33,43,53 * 10 10 *';
export const TEMPORARY_CATCHUP_EXPIRES_AT = '2026-10-10T13:58:00.000Z';
const time = value => Date.parse(value);
const localDay = value => Number.isFinite(time(value)) ? localParts(new Date(value)).day : null;
export const reservationSlotIds = reservation => Array.isArray(reservation.slotIds) ? reservation.slotIds : [reservation.slotId];

export function latestPublicationSlot(now = new Date(), cadence = DEFAULT_CADENCE_CONFIG) {
  const scheduledAt = publicationTime(now,cadence,'previous');
  return publicationSlots(new Date(scheduledAt),cadence).find(slot => slot.scheduledAt === scheduledAt);
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

export function loopDecision({ runId, eventName, triggerCron = null, githubRunId = null, githubRunUrl = null, clock = null, bootstrap = false, now = new Date(), posts = [], reservations = [], outcomes = [], cadence = DEFAULT_CADENCE_CONFIG }) {
  if (!validId(runId) || !Number.isFinite(new Date(now).getTime())) throw new Error('Invalid loop scheduling request.');
  const requestedAt = new Date(now).toISOString(), localDate = localParts(now).day;
  cadence=normalizeCadenceConfig(cadence);const cap=dailyPublicationCap(now,cadence);
  const allSlots = publicationSlots(now,cadence), elapsed = allSlots.filter(slot => time(slot.scheduledAt) <= time(requestedAt));
  const fulfilled = fulfilledPublicationSlots(posts, allSlots);
  const missing = elapsed.filter(slot => !fulfilled.has(slot.id));
  const primary = bootstrap ? {id:'bootstrap-initial',scheduledAt:requestedAt,localDate,localTime:null} : missing[0] || elapsed.at(-1) || {id:null,scheduledAt:null,localDate,localTime:null};
  const base = {id:runId,runId,type:'loop-scheduling',eventName,event:eventName,triggerCron,githubRunId:String(githubRunId || ''),githubRunUrl,...(clock?{clock}:{}),timezone:TIMEZONE,slotId:primary.id,scheduledAt:primary.scheduledAt,localDate,localTime:primary.localTime,requestedAt,catchUp:!bootstrap && !!primary.scheduledAt && time(requestedAt)-time(primary.scheduledAt)>=60000,bootstrap:!!bootstrap,cadence,assessmentContractVersion:1,maxBatchSize:MAX_PUBLICATION_BATCH_SIZE,dailyCap:cap,dailyCount:dailyPublicationCount(posts,now),missedSlots:bootstrap?[]:missing,slots:[],slotIds:[],attemptCounts:{},reservationId:null,targetCount:0};
  const skip = (reason, extra={}) => ({...base,decision:'skip',reason,...extra});
  if (!['schedule','workflow_dispatch'].includes(eventName)) return skip('unsupported_event');
  if (triggerCron === TEMPORARY_CATCHUP_CRON && (requestedAt.slice(0,10) !== '2026-10-10' || time(requestedAt)>=time(TEMPORARY_CATCHUP_EXPIRES_AT))) return skip('temporary_catchup_expired');
  if (bootstrap && eventName !== 'workflow_dispatch') return skip('bootstrap_requires_manual_dispatch');
  if (bootstrap && posts.length >= 3) return skip('initial_bootstrap_already_completed');
  if (base.dailyCount >= cap) return skip('daily_cap_reached');
  if (!bootstrap && !elapsed.length) return skip('no_current_day_slot_due');
  if (!bootstrap && !missing.length) return skip('slot_already_published');
  const due = bootstrap ? [primary] : missing;
  const eligible = [], deferred = [], attemptCounts={}; let retrying = false, terminallyAssessed=false;
  for (const slot of due) {
    const attempts = reservations.filter(record => reservationSlotIds(record).includes(slot.id));
    const failures = []; let completed = false;
    for (const reservation of attempts) {
      const outcome = outcomeForSlot(outcomes.find(record => record.reservationId === reservation.id), slot.id);
      if (!outcome) return skip('reservation_in_progress_or_unknown',{heldReservationId:reservation.id});
      if (outcome.published?.length) { completed = true; break; }
      if (['no_post','no_post_unverified','retry_exhausted'].includes(outcome.status)) { completed=true;terminallyAssessed=true;break; }
      if (outcome.status !== 'failed_retryable') return skip('reservation_outcome_uncertain',{heldReservationId:reservation.id});
      failures.push(outcome);
    }
    if (completed) continue;
    if (failures.length>=MAX_SLOT_ATTEMPTS) {terminallyAssessed=true;continue;}
    failures.sort((a,b)=>time(b.settledAt)-time(a.settledAt));
    if (failures.length) {
      const retryAt = new Date(time(failures[0].settledAt)+Math.min(60,10*2**Math.min(3,failures.length-1))*60000).toISOString();
      if (time(requestedAt)<time(retryAt)) { deferred.push({slotId:slot.id,retryAt}); continue; }
      retrying = true;
    }
    eligible.push(slot);
    attemptCounts[slot.id]=failures.length+1;
  }
  if (!eligible.length) return deferred.length ? skip('failed_slot_retry_backoff',{retryAt:deferred[0].retryAt,deferredSlots:deferred}) : skip(terminallyAssessed?'slots_terminally_assessed':'slot_already_published');
  const slots = eligible.slice(0, Math.min(MAX_PUBLICATION_BATCH_SIZE,cap-base.dailyCount));
  const first = slots[0], targetCount = bootstrap ? Math.min(3-posts.length,cap-base.dailyCount) : slots.length;
  return {...base,slotId:first.id,scheduledAt:first.scheduledAt,localTime:first.localTime,catchUp:!bootstrap && time(requestedAt)-time(first.scheduledAt)>=60000,slots,slotIds:slots.map(slot=>slot.id),attemptCounts:Object.fromEntries(slots.map(slot=>[slot.id,attemptCounts[slot.id]])),decision:'run',reason:retrying?'retry_failed_slot':slots.length>1?'catch_up_all_elapsed_slots':base.catchUp?'catch_up_elapsed_slot':'scheduled_slot_due',reservationId:runId,targetCount,...(deferred.length?{deferredSlots:deferred}:{})};
}

export function validateLoopScheduling(record, { runId, expectedSha256, eventName } = {}) {
  if (!record || record.id !== runId || record.runId !== runId || record.type !== 'loop-scheduling' || !validId(runId)) throw new Error('Trusted loop scheduling identity is missing.');
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 || '') || sha256(stableJSON(record)) !== expectedSha256) throw new Error('Trusted loop scheduling fingerprint changed.');
  if (!['schedule','workflow_dispatch'].includes(record.eventName) || (eventName && record.eventName !== eventName)) throw new Error('Loop event provenance changed.');
  if(record.clock&&(record.eventName!=='workflow_dispatch'||!validClockProvenance(record.clock,{kind:'loop',runId:record.githubRunId})))throw new Error('Loop clock provenance changed.');
  const modern=Object.hasOwn(record,'cadence');
  const cadence=modern?normalizeCadenceConfig(record.cadence):LEGACY_CADENCE_CONFIG;
  if (!Number.isFinite(time(record.requestedAt)) || record.dailyCap !== dailyPublicationCap(record.requestedAt,cadence)) throw new Error('Trusted loop time or daily cap is invalid.');
  if(modern&&(record.assessmentContractVersion!==1||record.maxBatchSize!==MAX_PUBLICATION_BATCH_SIZE))throw new Error('Trusted loop assessment contract or batch bound changed.');
  if(!modern&&['assessmentContractVersion','maxBatchSize','attemptCounts'].some(key=>Object.hasOwn(record,key)))throw new Error('Legacy reservation contains an incomplete modern cadence contract.');
  if (record.bootstrap) {
    if (record.eventName !== 'workflow_dispatch' || record.slotId !== 'bootstrap-initial' || record.scheduledAt !== record.requestedAt) throw new Error('Bootstrap scheduling metadata is invalid.');
  } else if (record.slotId !== null) {
    const slot = publicationSlots(new Date(record.scheduledAt),cadence).find(slot => slot.id === record.slotId && slot.scheduledAt === record.scheduledAt);
    if (!slot || slot.localDate !== record.localDate || slot.localTime !== record.localTime || time(record.scheduledAt)>time(record.requestedAt)) throw new Error('Trusted loop slot does not match the publication schedule.');
  }
  if (record.decision === 'run') {
    if (record.reservationId !== runId || !Number.isInteger(record.targetCount) || record.targetCount<1 || record.targetCount>(modern?MAX_PUBLICATION_BATCH_SIZE:3) || (record.bootstrap&&record.targetCount>3) || record.targetCount>record.dailyCap-record.dailyCount) throw new Error('Trusted loop reservation or target count is invalid.');
    if(modern&&(!record.attemptCounts||typeof record.attemptCounts!=='object'||Array.isArray(record.attemptCounts)||Object.keys(record.attemptCounts).length!==record.slotIds?.length||record.slotIds.some(id=>!Number.isInteger(record.attemptCounts[id])||record.attemptCounts[id]<1||record.attemptCounts[id]>MAX_SLOT_ATTEMPTS)))throw new Error('Trusted per-slot attempt count changed.');
    if (!record.bootstrap && record.slots) {
      const currentDay = publicationSlots(new Date(record.requestedAt),cadence);
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
  const retrievalComplete=noFreshLeadsSettlement(reservation,run,settledAt);
  const proof=run?.checkedAssessment,hex=value=>/^[a-f0-9]{64}$/.test(value||'');
  const execution=run?.assistantExecution;
  const assistantBound=execution&&assistantProvenanceReasons(execution).length===0&&run.engine==='assistant-orchestrated'&&execution.runId===run.id&&['draftSha256','contextSha256','rulesSha256','sourceSnapshotSha256','policySha256'].every(key=>execution.bindings[key]===proof?.[key]);
  const expectedChecker=(execution!==undefined||run?.id?.startsWith('assistant-'))?(assistantBound?assistantCheckerId(execution):null):`${reservation.runId}-independent-check`;
  const unverified=run?.unverifiedAssessment;
  const unverifiedKeys=['schema','completed','contractVersion','runId','schedulingSha256','slotIds','decision','reason','stage','code','completedAt'];
  const noPostUnverified=reservation.assessmentContractVersion===1&&run?.assessmentOutcome==='unverified'&&run.id===reservation.runId&&!run.checkedAssessment
    &&['no_post_unverified','completed_with_unverified'].includes(run.status)
    &&unverified&&typeof unverified==='object'&&!Array.isArray(unverified)&&Object.keys(unverified).length===unverifiedKeys.length&&unverifiedKeys.every(key=>Object.hasOwn(unverified,key))
    &&unverified.schema===1&&unverified.completed===false&&unverified.contractVersion===1&&unverified.runId===reservation.runId&&unverified.decision==='no_post_unverified'
    &&hex(reservation.schedulingSha256)&&unverified.schedulingSha256===reservation.schedulingSha256&&stableJSON(unverified.slotIds)===stableJSON(reservationSlotIds(reservation))
    &&Number.isFinite(time(unverified.completedAt))&&new Date(unverified.completedAt).toISOString()===unverified.completedAt&&time(unverified.completedAt)<=time(settledAt)
    &&['reason','stage','code'].every(key=>typeof unverified[key]==='string'&&unverified[key].trim().length>=1&&unverified[key].length<=(key==='reason'?500:80)&&!/[\r\n]/.test(unverified[key]));
  const proofKeys=['schema','completed','contractVersion','runId','schedulingSha256','slotIds','draftSha256','contextSha256','rulesSha256','sourceSnapshotSha256','policySha256','checkerRunId','completedAt','decision','reason','checkedPostIds'];
  const assessed=reservation.assessmentContractVersion===1&&run?.assessmentOutcome==='completed'&&run?.id===reservation.runId
    &&(!run.operationalFailures||Array.isArray(run.operationalFailures)&&run.operationalFailures.length===0)
    &&proof&&typeof proof==='object'&&!Array.isArray(proof)&&Object.keys(proof).length===proofKeys.length&&proofKeys.every(key=>Object.hasOwn(proof,key))
    &&proof?.schema===1&&proof.completed===true&&proof.contractVersion===1&&proof.runId===reservation.runId
    &&hex(reservation.schedulingSha256)&&proof.schedulingSha256===reservation.schedulingSha256
    &&stableJSON(proof.slotIds)===stableJSON(reservationSlotIds(reservation))
    &&Array.isArray(proof.checkedPostIds)&&proof.checkedPostIds.length<=MAX_PUBLICATION_BATCH_SIZE&&new Set(proof.checkedPostIds).size===proof.checkedPostIds.length&&proof.checkedPostIds.every(validId)&&published.every(id=>proof.checkedPostIds.includes(id))
    &&['draftSha256','contextSha256','rulesSha256','sourceSnapshotSha256','policySha256'].every(key=>hex(proof[key]))
    &&proof.checkerRunId===expectedChecker&&Number.isFinite(time(proof.completedAt))&&new Date(proof.completedAt).toISOString()===proof.completedAt&&time(proof.completedAt)<=time(settledAt)
    &&['assessed','no_supported_candidate'].includes(proof.decision)&&typeof proof.reason==='string'&&proof.reason.length>=1&&proof.reason.length<=500&&!/[\r\n]/.test(proof.reason);
  const slotOutcomes = reservationSlotIds(reservation).map(slotId => {
    const ids = posts.filter(post => post.runId===reservation.runId && post.scheduling?.slotId===slotId && published.includes(post.id)).map(post=>post.id);
    // A pre-v3 single-slot reservation or bootstrap is fulfilled by its run's checked posts.
    const fulfilled = !reservation.slotIds || slotId==='bootstrap-initial' ? published : ids;
    const attempts=reservation.attemptCounts?.[slotId]||1;
    return {slotId,settledAt,status:fulfilled.length?'published':assessed||retrievalComplete?'no_post':noPostUnverified?'no_post_unverified':attempts>=MAX_SLOT_ATTEMPTS?'retry_exhausted':'failed_retryable',published:fulfilled,reason:fulfilled.length?'Checked post published.':retrievalComplete?run.retrievalCompletion.reason:assessed?proof.reason:noPostUnverified?unverified.reason:attempts>=MAX_SLOT_ATTEMPTS?'Three operational attempts exhausted for this slot.':'Operational assessment did not complete; a bounded retry may run.'};
  });
  const status=slotOutcomes.every(slot=>slot.status==='published')?'published':slotOutcomes.some(slot=>slot.status==='failed_retryable')?'failed_retryable':slotOutcomes.some(slot=>slot.status==='retry_exhausted')?'retry_exhausted':slotOutcomes.some(slot=>slot.status==='no_post_unverified')?'no_post_unverified':'no_post';
  return {id:reservation.id,reservationId:reservation.id,runId:reservation.runId,settledByRunId,slotId:reservation.slotId,slotIds:reservationSlotIds(reservation),settledAt,status,published,slotOutcomes,reason:status==='published'?'Committed checked posts fulfil every reserved slot.':status==='no_post'?retrievalComplete?run.retrievalCompletion.reason:'Independent checked assessment completed; remaining slots honestly have no supported post.':status==='no_post_unverified'?unverified.reason:status==='retry_exhausted'?'Three operational attempts exhausted; remaining slots are terminal.':'Missing reserved slots remain eligible for bounded retries; committed posts cannot repeat.'};
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
