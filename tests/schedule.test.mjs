import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {schedule as configuredSchedule,publicationSlots as configuredSlots,dueJobs as configuredJobs,previousLocalTime,localParts} from '../lib/config.mjs';
import {loopTiming as configuredTiming} from '../public/schedule.js';
import {LEGACY_CADENCE_CONFIG} from '../public/cadence-config.js';
const schedule=date=>configuredSchedule(date,LEGACY_CADENCE_CONFIG),publicationSlots=date=>configuredSlots(date,LEGACY_CADENCE_CONFIG),dueJobs=date=>configuredJobs(date,LEGACY_CADENCE_CONFIG),loopTiming=(last,date)=>configuredTiming(last,date,LEGACY_CADENCE_CONFIG);
import {schedulerProof,standaloneResearchRecords} from '../lib/scheduler-proof.mjs';

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
  const runs=[{id:'loop-manual',type:'loop',eventName:'workflow_dispatch',triggerEvent:'schedule',startedAt:'2026-10-10T07:13:00Z',githubRunUrl:url,published:['post']}];
  const posts=[{id:'post',runId:'loop-manual',publishedAt:'2026-10-10T07:15:00Z',githubRunUrl:url,eventName:'schedule',triggerEvent:'schedule'}];
  const proof=schedulerProof([diagnosis],runs,posts);
  assert.equal(proof.state,'unverified');
  assert.equal(proof.scheduledRunCount,0);
  assert.equal(proof.lastScheduledPublicationAt,null);
});

test('scheduler trigger, loop execution and checked publication remain separate proof levels',()=>{
  const url='https://github.com/xndanius/while-you-sleep/actions/runs/123';
  const probe={kind:'probe',eventName:'schedule',createdAt:'2026-10-10T13:03:00Z',githubRunUrl:url};
  assert.equal(schedulerProof([probe]).state,'trigger_observed');
  const run={id:'loop-123-1',type:'loop',eventName:'schedule',startedAt:'2026-10-10T13:07:00Z',githubRunUrl:url,published:[]};
  assert.equal(schedulerProof([probe],[run]).state,'loop_observed');
  run.published=['post'];
  const post={id:'post',runId:run.id,publishedAt:'2026-10-10T13:10:00Z',githubRunUrl:url,scheduling:{event:'schedule'}};
  const proof=schedulerProof([probe],[run],[post]);
  assert.equal(proof.state,'publication_observed');
  assert.equal(proof.lastScheduledPostId,'post');
  assert.equal(proof.scheduledRunCount,1,'the same hosted run must not be counted three times');
});

test('scheduled publication requires matching trusted loop identity, URL and published ID',()=>{
  const url='https://github.com/xndanius/while-you-sleep/actions/runs/123';
  const run={id:'loop-123-1',type:'loop',eventName:'schedule',modelExecuted:true,startedAt:'2026-10-10T13:07:00Z',githubRunUrl:url,published:['post']};
  const post={id:'post',runId:run.id,publishedAt:'2026-10-10T13:10:00Z',githubRunUrl:url,eventName:'schedule'};
  assert.equal(schedulerProof([],[],[post]).state,'unverified','a post cannot supply its own provenance');
  assert.equal(schedulerProof([],[run],[post]).state,'publication_observed');
  for(const changed of [{...post,runId:'loop-other'},{...post,id:'unlisted'},{...post,githubRunUrl:url+'4'}])assert.equal(schedulerProof([],[run],[changed]).state,'loop_observed');
  const gate={...run,modelExecuted:false};
  assert.equal(schedulerProof([],[gate],[post]).state,'trigger_observed','a gate audit proves only the trigger');
  assert.equal(schedulerProof([],[gate],[post]).lastScheduledLoopAt,null);
});

test('cron reruns retain trigger evidence but cannot prove automatic execution or publication',()=>{
  const url='https://github.com/xndanius/while-you-sleep/actions/runs/123';
  const run={id:'loop-123-1',type:'loop',eventName:'schedule',modelExecuted:true,startedAt:'2026-10-10T13:07:00Z',githubRunUrl:url,published:['post']};
  const post={id:'post',runId:run.id,publishedAt:'2026-10-10T13:10:00Z',githubRunUrl:url};
  for(const changed of [{...run,id:'loop-123-2'},{...run,id:'loop-124-1'},
    {...run,runId:'loop-123-2'},{...run,runAttempt:2},{...run,githubRunAttempt:2}]) {
    const proof=schedulerProof([],[changed],[{...post,runId:changed.id}]);
    assert.equal(proof.state,'trigger_observed');assert.equal(proof.scheduledRunCount,1);
    assert.equal(proof.automaticRunCount,0);assert.equal(proof.lastAutomaticLoopAt,null);
    assert.equal(proof.lastScheduledLoopAt,null);assert.equal(proof.lastScheduledPublicationAt,null);
    assert.equal(proof.lastAutomaticPublicationAt,null);
  }
  const proof=schedulerProof([],[run,{...run,id:'loop-123-2'}],[post]);
  assert.equal(proof.state,'publication_observed','a later rerun does not erase the original automatic publication');
  assert.equal(proof.lastAutomaticPostId,'post');assert.equal(proof.automaticRunCount,1);
});

test('loop research cannot fake a standalone research identity by editing JSON fields',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'wys-proof-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const record={id:'research-123-1',runId:'research-123-1',eventName:'schedule',createdAt:'2026-10-10T13:07:00Z',githubRunUrl:'https://github.com/xndanius/while-you-sleep/actions/runs/123'};
  await writeFile(path.join(directory,'loop-123-1.json'),JSON.stringify(record));
  assert.deepEqual(await standaloneResearchRecords(directory),[]);
  await writeFile(path.join(directory,'research-123-1.json'),JSON.stringify(record));
  assert.deepEqual(await standaloneResearchRecords(directory),[record]);
  await writeFile(path.join(directory,'research-124-1.json'),JSON.stringify(record));
  assert.equal((await standaloneResearchRecords(directory)).length,1,'standalone record must bind its actual filename');
});
