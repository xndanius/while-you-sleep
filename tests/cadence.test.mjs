import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DEFAULT_CADENCE_CONFIG,LEGACY_CADENCE_CONFIG,validateCadenceConfig,cadenceAt,dailyPublicationCap,researchEveryHours} from '../public/cadence-config.js';
import {publicationSlots,schedule,loopTiming} from '../public/schedule.js';
import {loopDecision,validateLoopScheduling,slotOutcome} from '../lib/loop-schedule.mjs';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {prepareLoop} from '../scripts/prepare-loop.mjs';
import {latestScheduledSlot,scheduledDecision,trustedScheduledMetadata} from '../scripts/prepare-scheduled-job.mjs';

const hourly={schema:1,mode:'hourly',activatedAt:'2026-10-11T11:30:00.000Z',relayConfirmedAt:'2026-10-11T11:29:00.000Z'};
const decide=(extra={})=>loopDecision({runId:'loop-123-1',githubRunId:'123',eventName:'schedule',now:new Date('2026-10-11T18:30:00.000Z'),cadence:hourly,...extra});
const validate=record=>validateLoopScheduling(record,{runId:record.runId,expectedSha256:sha256(stableJSON(record))});
function reservation(record){return {id:record.id,runId:record.runId,slotId:record.slotId,slotIds:record.slotIds,assessmentContractVersion:record.assessmentContractVersion,attemptCounts:record.attemptCounts,schedulingSha256:sha256(stableJSON(record))};}
function completed(record){return {id:record.id,published:[],assessmentOutcome:'completed',checkedAssessment:{schema:1,completed:true,contractVersion:1,runId:record.id,schedulingSha256:sha256(stableJSON(record)),slotIds:record.slotIds,draftSha256:'a'.repeat(64),contextSha256:'b'.repeat(64),rulesSha256:'c'.repeat(64),sourceSnapshotSha256:'d'.repeat(64),policySha256:'e'.repeat(64),checkerRunId:record.id+'-independent-check',completedAt:record.requestedAt,decision:'no_supported_candidate',reason:'Fresh evidence supports no candidate above the current threshold.',checkedPostIds:[]}};}

test('hourly activation requires an actual relay confirmation first; the configured policy stays valid',()=>{
 assert.deepEqual(validateCadenceConfig(DEFAULT_CADENCE_CONFIG),[]);assert.equal(LEGACY_CADENCE_CONFIG.mode,'legacy');assert.deepEqual(validateCadenceConfig(hourly),[]);
 for(const config of [{...hourly,relayConfirmedAt:null},{...hourly,relayConfirmedAt:'2026-10-11T11:31:00.000Z'},{...hourly,activatedAt:'not-a-time'},{...LEGACY_CADENCE_CONFIG,activatedAt:hourly.activatedAt},{...hourly,extra:true},{...hourly,mode:'automatic'}])assert.ok(validateCadenceConfig(config).length);
 assert.equal(cadenceAt('2026-10-11T11:29:59.999Z',hourly),'legacy');assert.equal(cadenceAt(hourly.activatedAt,hourly),'hourly');
 assert.equal(dailyPublicationCap('2026-10-11T11:29:59Z',hourly),3);assert.equal(dailyPublicationCap(hourly.activatedAt,hourly),24);assert.equal(researchEveryHours(hourly.activatedAt,hourly),1);
});
test('activation day retains real legacy slots and starts hourly only after the activation instant',()=>{
 const slots=publicationSlots('2026-10-11T12:00:00Z',hourly);
 assert.deepEqual(slots.map(slot=>slot.localTime),['08:07','13:07','15:07','16:07','17:07','18:07','19:07','20:07','21:07','22:07','23:07']);
 const record=decide({now:new Date('2026-10-11T11:45:00Z')});assert.deepEqual(record.slotIds,['publish-2026-10-11-08-07','publish-2026-10-11-13-07']);assert.equal(record.dailyCap,24);assert.equal(record.targetCount,2);
 const boundary={...hourly,activatedAt:'2026-10-11T10:07:00.000Z',relayConfirmedAt:'2026-10-11T10:06:00.000Z'};assert.equal(publicationSlots('2026-10-11T12:00:00Z',boundary).filter(slot=>slot.localTime==='13:07').length,1);
 assert.equal(publicationSlots('2026-10-12T12:00:00Z',hourly).length,24);assert.deepEqual(publicationSlots('2026-10-10T12:00:00Z',hourly).map(slot=>slot.localTime),['08:07','13:07','19:07']);
});
test('DST skips nonexistent hours and dedupes repeated local IDs without a second timer slot',()=>{
 const config={...hourly,activatedAt:'2026-01-01T00:00:00.000Z',relayConfirmedAt:'2026-01-01T00:00:00.000Z'};
 const spring=publicationSlots('2026-03-29T12:00:00Z',config),autumn=publicationSlots('2026-10-25T12:00:00Z',config);
 assert.equal(spring.length,23);assert.ok(!spring.some(slot=>slot.localTime==='03:07'));assert.equal(autumn.length,24);assert.equal(new Set(autumn.map(slot=>slot.id)).size,24);
 assert.equal(autumn.find(slot=>slot.localTime==='03:07').scheduledAt,'2026-10-25T00:07:00.000Z');
 const times=schedule('2026-10-25T01:08:00Z',config);assert.equal(times.previousPublicationAt,'2026-10-25T00:07:00.000Z');assert.equal(times.nextPublicationAt,'2026-10-25T02:07:00.000Z');
 assert.equal(schedule('2026-03-29T21:01:00Z',config).previousPublicationAt,'2026-03-29T20:07:00.000Z','midnight after a short DST day must not skip yesterday');
 const between={...config,activatedAt:'2026-10-25T00:30:00.000Z',relayConfirmedAt:'2026-10-25T00:29:00.000Z'};assert.equal(publicationSlots('2026-10-25T12:00:00Z',between).find(slot=>slot.localTime==='03:07').scheduledAt,'2026-10-25T01:07:00.000Z');
});
test('hourly catchup reserves at most six elapsed slots, observes cap24 and never carries yesterday',()=>{
 const record=decide();assert.equal(record.targetCount,6);assert.equal(record.maxBatchSize,6);assert.equal(record.assessmentContractVersion,1);assert.deepEqual(record.cadence,hourly);assert.deepEqual(record.slots.map(slot=>slot.localTime),['08:07','13:07','15:07','16:07','17:07','18:07']);assert.equal(validate(record),record);
 const posts=Array.from({length:23},(_,id)=>({id:String(id),publishedAt:'2026-10-11T10:00:00Z',scheduling:{slotId:'other'}}));assert.equal(decide({posts}).targetCount,1);assert.equal(decide({posts:[...posts,posts[0]]}).reason,'daily_cap_reached');
 const tomorrow=decide({now:new Date('2026-10-11T21:01:00Z')});assert.equal(tomorrow.reason,'no_current_day_slot_due');assert.equal(tomorrow.localDate,'2026-10-12');
});
test('historical reservations validate against frozen legacy cadence after activation, while forged hourly slots fail',()=>{
 const current=decide({cadence:LEGACY_CADENCE_CONFIG,now:new Date('2026-10-10T13:20:00Z')}),old=structuredClone(current);for(const key of ['cadence','assessmentContractVersion','maxBatchSize','attemptCounts'])delete old[key];assert.equal(validate(old),old);
 for(const change of [{...current,dailyCap:24},{...current,cadence:{...hourly,activatedAt:'2026-10-09T00:00:00.000Z',relayConfirmedAt:'2026-10-09T00:00:00.000Z'}},{...decide(),maxBatchSize:24},{...decide(),attemptCounts:{}},{...decide(),assessmentContractVersion:2}])assert.throws(()=>validate(change));
 const forged=decide();forged.slots[2]={...forged.slots[2],id:'publish-2026-10-11-14-07',scheduledAt:'2026-10-11T11:07:00.000Z',localTime:'14:07'};forged.slotIds[2]=forged.slots[2].id;forged.attemptCounts=Object.fromEntries(forged.slotIds.map(id=>[id,1]));assert.throws(()=>validate(forged),/invalid.*slot/);
});
test('only a bound trusted completed assessment makes missing posts terminal; scalar or forged proofs retry',()=>{
 const record=decide(),held=reservation(record),run=completed(record),outcome=slotOutcome(held,run,{now:new Date('2026-10-11T18:35:00Z')});assert.ok(outcome.slotOutcomes.every(slot=>slot.status==='no_post'));assert.equal(outcome.status,'no_post');
 const next=decide({reservations:[held],outcomes:[outcome]});assert.deepEqual(next.slotIds,['publish-2026-10-11-19-07','publish-2026-10-11-20-07','publish-2026-10-11-21-07']);
 for(const changed of [{...run,checkedAssessment:null},{...run,assessmentOutcome:'incomplete'},{...run,checkedAssessment:{...run.checkedAssessment,schedulingSha256:'f'.repeat(64)}},{...run,checkedAssessment:{...run.checkedAssessment,slotIds:record.slotIds.slice(1)}},{...run,checkedAssessment:{...run.checkedAssessment,checkerRunId:'someone-else'}}])assert.equal(slotOutcome(held,changed).status,'failed_retryable');
});
test('operational retries are capped at three independently per slot and exhaustion stops model work',()=>{
 const one=decide({now:new Date('2026-10-11T11:45:00Z')}),slotId=one.slotIds[0],posts=[{id:'second',publishedAt:'2026-10-11T11:40:00Z',scheduling:{slotId:one.slotIds[1]}}],reservations=[],outcomes=[];
 for(let attempt=1;attempt<=3;attempt++){
  const record=decide({runId:'loop-'+attempt+'-1',now:new Date('2026-10-11T11:45:00Z'),posts,reservations,outcomes});assert.equal(record.attemptCounts[slotId],attempt);
  const held=reservation(record);reservations.push(held);const outcome=slotOutcome(held,{id:record.id,published:[],assessmentOutcome:'incomplete'},{now:new Date('2026-10-11T10:00:00Z')});outcomes.push(outcome);assert.equal(outcome.status,attempt===3?'retry_exhausted':'failed_retryable');
 }
 assert.equal(decide({now:new Date('2026-10-11T11:45:00Z'),posts,reservations,outcomes}).reason,'slots_terminally_assessed');
});
test('research starts hourly at activation, freezes metadata and accepts old legacy completions honestly',()=>{
 assert.equal(latestScheduledSlot('research','2026-10-11T11:45:00Z',hourly).jobKey,'research-2026-10-11-12-23');
 const slot=latestScheduledSlot('research','2026-10-11T13:24:00Z',hourly);assert.equal(slot.jobKey,'research-2026-10-11-16-23');
 const env={GITHUB_EVENT_NAME:'schedule',SCHEDULED_JOB_KEY:slot.jobKey,SCHEDULED_AT:slot.scheduledAt,SCHEDULED_CADENCE_JSON:JSON.stringify(hourly)};assert.deepEqual(trustedScheduledMetadata('research',env).cadence,hourly);assert.throws(()=>trustedScheduledMetadata('research',{...env,SCHEDULED_CADENCE_JSON:''}));
 const completion={...slot,eventName:'schedule',scheduleStatus:'completed',cadence:hourly};assert.equal(scheduledDecision({kind:'research',eventName:'schedule',now:'2026-10-11T13:24:00Z',cadence:hourly,completions:[completion]}).due,false);
 const old=latestScheduledSlot('research','2026-10-11T11:29:00Z',LEGACY_CADENCE_CONFIG);assert.equal(scheduledDecision({kind:'research',eventName:'schedule',now:'2026-10-11T11:29:00Z',cadence:hourly,completions:[{...old,eventName:'schedule',scheduleStatus:'completed'}]}).due,false);
});
test('public schedule exposes the active policy while next times are real and loopTiming stays compatible',()=>{
 const before=schedule('2026-10-11T11:29:00Z',hourly),after=schedule('2026-10-11T11:30:00Z',hourly);assert.equal(before.dailyCap,3);assert.equal(before.hourlyActive,false);assert.equal(after.dailyCap,24);assert.equal(after.hourlyActive,true);assert.equal(after.maxBatchSize,6);assert.equal(after.publicationTimes.length,24);assert.equal(after.researchEveryHours,1);assert.deepEqual(after.cadence,hourly);assert.equal(after.nextPublicationAt,'2026-10-11T12:07:00.000Z');
 assert.equal(loopTiming('2026-10-11T12:10:00Z','2026-10-11T12:40:00Z',hourly).slotState,'recorded');
});
test('trusted gate persists frozen cadence and attempt counts; completed terminal recovery makes no model reservation',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-cadence-gate-'));t.after(()=>rm(root,{recursive:true,force:true}));const env={RUN_ID:'loop-123-1',GITHUB_RUN_ID:'123',GITHUB_EVENT_NAME:'schedule'};
 const record=await prepareLoop({root,env,now:new Date('2026-10-11T11:45:00Z'),cadence:hourly}),held=JSON.parse(await readFile(path.join(root,'data','slot-reservations',record.id+'.json'),'utf8'));assert.deepEqual(held.cadence,hourly);assert.deepEqual(held.attemptCounts,record.attemptCounts);assert.equal(held.dailyCap,24);
 await mkdir(path.join(root,'data','runs'),{recursive:true});await writeFile(path.join(root,'data','runs',record.id+'.json'),JSON.stringify(completed(record)));
 const retry=await prepareLoop({root,env:{...env,RUN_ID:'loop-124-1'},now:new Date('2026-10-11T11:50:00Z'),cadence:hourly,apiGet:async()=>JSON.stringify({id:123,repository:{full_name:'xndanius/while-you-sleep'},head_branch:'main',path:'.github/workflows/loop.yml',status:'completed',updated_at:'2026-10-11T11:49:00Z'})});assert.equal(retry.reason,'slots_terminally_assessed');assert.equal((await readdir(path.join(root,'data','slot-reservations'))).length,1);
});
