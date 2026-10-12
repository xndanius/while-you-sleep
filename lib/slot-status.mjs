import { publicationSlots, localParts, schedule } from './config.mjs';
import { dailyPublicationCount, reservationSlotIds, outcomeForSlot } from './loop-schedule.mjs';
import { validClockProvenance } from './clock-provenance.mjs';
const time = value => Date.parse(value);
const validTime = value => Number.isFinite(time(value));
const covers = (record, id) => reservationSlotIds(record.scheduling || record).includes(id);

// Planned times are cadence, actual times are committed publications. A trigger
// or failed attempt never masquerades as a published slot.
export function publicationSlotStatus({posts=[],runs=[],reservations=[],outcomes=[],now=new Date(),cadence} = {}) {
  const date = new Date(now), slots = publicationSlots(date,cadence), today = localParts(date).day;
  const legacy = posts.filter(post => !post.scheduling && validTime(post.publishedAt) && localParts(post.publishedAt).day===today).sort((a,b)=>time(a.publishedAt)-time(b.publishedAt));
  const assigned = new Map();
  for (const slot of slots) {
    const post = posts.filter(post => post.scheduling?.slotId===slot.id && validTime(post.publishedAt)).sort((a,b)=>time(a.publishedAt)-time(b.publishedAt))[0];
    if (post) assigned.set(slot.id,post);
  }
  for (const post of legacy) {
    const slot = slots.find(slot => !assigned.has(slot.id) && time(slot.scheduledAt)<=time(post.publishedAt));
    if (slot) assigned.set(slot.id,post);
  }
  const cap=schedule(date,cadence).dailyCap||3,atCap = dailyPublicationCount(posts,date)>=cap;
  return slots.map(slot => {
    const post = assigned.get(slot.id);
    const attempts = runs.filter(run=>run.type==='loop' && covers(run,slot.id) && validTime(run.scheduling?.requestedAt || run.startedAt)).sort((a,b)=>time(b.scheduling?.requestedAt||b.startedAt)-time(a.scheduling?.requestedAt||a.startedAt));
    const attempt = attempts[0];
    const reservationsFor = reservations.filter(record=>covers(record,slot.id));
    const terminal=reservationsFor.map(reservation=>outcomeForSlot(outcomes.find(outcome=>outcome.reservationId===reservation.id),slot.id)).filter(outcome=>['no_post','no_post_unverified','retry_exhausted'].includes(outcome?.status)).at(-1);
    const held = reservationsFor.find(reservation=>!outcomeForSlot(outcomes.find(outcome=>outcome.reservationId===reservation.id),slot.id) && !runs.some(run=>run.id===reservation.runId && validTime(run.finishedAt)));
    const actualAt = post?.publishedAt || null, attemptedAt = attempt?.scheduling?.requestedAt || attempt?.startedAt || held?.createdAt || null;
    const elapsed = (date.getTime()-time(slot.scheduledAt))/60000;
    const clockRecord=post?(post.clock||post.scheduling?.clock):(attempt?.clock||attempt?.scheduling?.clock);
    const clock=validClockProvenance(clockRecord,{kind:'loop'})?clockRecord:null;
    let state, reason;
    if (post) { state='published'; reason='A checked post is committed for this slot.'; }
    else if (elapsed<0) { state='scheduled'; reason='The planned publication time is still ahead.'; }
    else if (terminal) {state=terminal.status;reason=terminal.reason||(state==='no_post'?'Independent checking completed without a qualifying idea.':'The slot stopped after three operational failures.');}
    else if (atCap) { state='cap_reached'; reason=`The ${cap}-post cap is already reached for this Vilnius day.`; }
    else if (held) { state='running'; reason='A trusted reservation is held; publication is not complete.'; }
    else if (attempt?.modelExecuted!==false && attempt && ['rejected','failed_closed','completed_with_failure','completed_with_rejections'].includes(attempt.status)) { state='rejected'; reason=attempt.rejected?.[0]?.reason || 'The attempt did not publish this slot; a bounded retry is due.'; }
    else { state=elapsed<30?'waiting':elapsed<60?'late':'missed'; reason='No checked publication has been committed for this elapsed slot.'; }
    return {...slot,state,actualAt,attemptedAt,delayMinutes:actualAt?Math.max(0,Math.floor((time(actualAt)-time(slot.scheduledAt))/60000)):null,postId:post?.id||null,runId:post?.runId||attempt?.id||held?.runId||null,eventName:post?.eventName||post?.scheduling?.eventName||attempt?.eventName||null,githubRunUrl:post?.githubRunUrl||attempt?.githubRunUrl||null,clock,reason};
  });
}
