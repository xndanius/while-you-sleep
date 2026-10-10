import test from 'node:test';
import assert from 'node:assert/strict';
import {schedule,publicationSlots,dueJobs,previousLocalTime,localParts} from '../lib/config.mjs';
import {loopTiming} from '../public/schedule.js';
import {schedulerProof} from '../lib/scheduler-proof.mjs';

test('Vilnius slots preserve minutes and identity over summer, winter and DST changes',()=>{
  for(const [day,offset] of [['2026-10-10',3],['2026-11-10',2],['2026-10-25',2],['2027-03-28',3]]){
    const slots=publicationSlots(new Date(day+'T12:00:00Z'));
    assert.deepEqual(slots.map(slot=>slot.localTime),['08:07','13:07','19:07']);
    assert.deepEqual(slots.map(slot=>slot.id),['08','13','19'].map(hour=>`publish-${day}-${hour}-07`));
    assert.equal(slots[0].scheduledAt,`${day}T${String(8-offset).padStart(2,'0')}:07:00.000Z`);
    assert.ok(slots.every(slot=>slot.localDate===day));
  }
});

test('future timers roll forward at the exact slot and retain odd daily minutes',()=>{
  const now=new Date('2026-10-10T10:07:00Z'),value=schedule(now);
  assert.equal(value.nextPublicationAt,'2026-10-10T16:07:00.000Z');
  assert.equal(value.previousPublicationAt,'2026-10-10T10:07:00.000Z');
  assert.equal(value.nextResearchAt,'2026-10-10T12:23:00.000Z');
  assert.equal(value.nextMeasurementAt,'2026-10-10T18:37:00.000Z');
  assert.equal(value.nextImprovementAt,'2026-10-10T19:13:00.000Z');
  assert.equal(value.nextDigestAt,'2026-10-12T05:17:00.000Z');
  for(const field of ['nextPublicationAt','nextResearchAt','nextMeasurementAt','nextImprovementAt','nextDigestAt'])assert.ok(new Date(value[field])>now,field);
});

test('elapsed slot computation respects exact minutes and previous local day',()=>{
  assert.ok(!dueJobs(new Date('2026-10-10T10:06:59Z')).some(job=>job.jobKey==='publish-2026-10-10-13-07'));
  assert.ok(dueJobs(new Date('2026-10-10T10:07:00Z')).some(job=>job.jobKey==='publish-2026-10-10-13-07'));
  const previous=previousLocalTime(p=>p.hour===21&&p.minute===37,new Date('2026-10-10T17:00:00Z'));
  assert.equal(previous,'2026-10-09T18:37:00.000Z');
  assert.equal(localParts(previous).day,'2026-10-09');
});

test('client clock distinguishes waiting, late, missed and recorded loops without a stale next time',()=>{
  const last='2026-10-10T07:13:15Z';
  assert.equal(loopTiming(last,new Date('2026-10-10T10:08:00Z')).slotState,'waiting');
  assert.equal(loopTiming(last,new Date('2026-10-10T10:40:00Z')).slotState,'late');
  const missed=loopTiming(last,new Date('2026-10-10T12:58:00Z'));
  assert.equal(missed.slotState,'missed');
  assert.equal(missed.nextPublicationAt,'2026-10-10T16:07:00.000Z');
  assert.equal(loopTiming('2026-10-10T10:10:00Z',new Date('2026-10-10T12:58:00Z')).slotState,'recorded');
});

test('hosted runs, enabled cron and manual posts cannot establish scheduled-event proof',()=>{
  const url='https://github.com/xndanius/while-you-sleep/actions/runs/123';
  const diagnosis={kind:'diagnosis',checkedAt:'2026-10-10T12:58:00Z',scheduledRunCount:0,actionsEnabled:true};
  const runs=[{id:'loop-manual',type:'loop',triggerEvent:'workflow_dispatch',startedAt:'2026-10-10T07:13:00Z',githubRunUrl:url,published:['post']}];
  const posts=[{id:'post',runId:'loop-manual',publishedAt:'2026-10-10T07:15:00Z',githubRunUrl:url}];
  const proof=schedulerProof([diagnosis],runs,posts);
  assert.equal(proof.state,'unverified');
  assert.equal(proof.scheduledRunCount,0);
  assert.equal(proof.lastScheduledPublicationAt,null);
});

test('scheduler trigger, loop execution and checked publication remain separate proof levels',()=>{
  const url='https://github.com/xndanius/while-you-sleep/actions/runs/123';
  const probe={kind:'probe',eventName:'schedule',createdAt:'2026-10-10T13:03:00Z',githubRunUrl:url};
  assert.equal(schedulerProof([probe]).state,'trigger_observed');
  const run={id:'loop-scheduled',type:'loop',triggerEvent:'schedule',startedAt:'2026-10-10T13:07:00Z',githubRunUrl:url,published:[]};
  assert.equal(schedulerProof([probe],[run]).state,'loop_observed');
  run.published=['post'];
  const post={id:'post',runId:run.id,publishedAt:'2026-10-10T13:10:00Z',githubRunUrl:url,scheduling:{event:'schedule'}};
  const proof=schedulerProof([probe],[run],[post]);
  assert.equal(proof.state,'publication_observed');
  assert.equal(proof.lastScheduledPostId,'post');
  assert.equal(proof.scheduledRunCount,1,'the same hosted run must not be counted three times');
});
