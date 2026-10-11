import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {loopDecision,validateLoopScheduling,slotOutcome,TEMPORARY_CATCHUP_CRON,postScheduling} from '../lib/loop-schedule.mjs';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {prepareLoop} from '../scripts/prepare-loop.mjs';

const now=new Date('2026-10-10T13:20:00Z');
const input={runId:'loop-123-1',eventName:'schedule',githubRunId:'123',now};
const decide=extra=>loopDecision({...input,...extra});
const earlyPost={id:'early',publishedAt:'2026-10-10T06:00:00Z',scheduling:{slotId:'publish-2026-10-10-08-07'}};
const reservation={id:'loop-100-1',runId:'loop-100-1',slotId:'publish-2026-10-10-13-07',githubRepository:'xndanius/while-you-sleep',githubRunId:'100'};
test('a delayed schedule reserves every current-day elapsed slot, earliest first',()=>{
 const record=decide();assert.equal(record.decision,'run');assert.equal(record.slotId,'publish-2026-10-10-08-07');assert.equal(record.scheduledAt,'2026-10-10T05:07:00.000Z');assert.equal(record.catchUp,true);assert.equal(record.targetCount,2);assert.deepEqual(record.slots.map(slot=>slot.localTime),['08:07','13:07']);
});
test('a committed slot post and a real legacy publication after that slot both suppress repeats',()=>{
 assert.equal(decide({posts:[{publishedAt:'2026-10-10T06:00:00Z',scheduling:{slotId:'publish-2026-10-10-08-07'}},{publishedAt:'2026-10-10T10:15:00Z',scheduling:{slotId:reservation.slotId}}]}).reason,'slot_already_published');
 assert.equal(decide({posts:[{publishedAt:'2026-10-10T10:15:00Z'}]}).targetCount,1);
 assert.equal(decide({posts:[{publishedAt:'2026-10-10T10:15:00Z'},{publishedAt:'2026-10-10T10:16:00Z'}]}).reason,'slot_already_published');
 assert.equal(decide({posts:[{publishedAt:'2026-10-10T06:53:00Z'}]}).decision,'run');
});
test('three launch posts consume today\'s cap; bootstrap never silently bypasses the cap or initial total',()=>{
 const posts=[1,2,3].map(id=>({id:String(id),publishedAt:'2026-10-10T06:53:00Z'}));
 assert.equal(decide({posts}).reason,'daily_cap_reached');assert.equal(decide({bootstrap:true,eventName:'workflow_dispatch',posts}).reason,'initial_bootstrap_already_completed');
 assert.equal(decide({bootstrap:true,eventName:'workflow_dispatch',posts:posts.slice(0,1)}).targetCount,2);
});
test('a pending or uncertain reservation holds; known failures retry only after bounded backoff',()=>{
 assert.equal(decide({posts:[earlyPost],reservations:[reservation]}).reason,'reservation_in_progress_or_unknown');
 const outcome=slotOutcome(reservation,{id:reservation.id,published:[]},{now:new Date('2026-10-10T13:15:00Z')});
 assert.equal(decide({posts:[earlyPost],reservations:[reservation],outcomes:[outcome]}).reason,'failed_slot_retry_backoff');
 assert.equal(decide({posts:[earlyPost],now:new Date('2026-10-10T13:26:00Z'),reservations:[reservation],outcomes:[outcome]}).reason,'retry_failed_slot');
 assert.equal(decide({posts:[earlyPost],reservations:[reservation],outcomes:[{...outcome,slotOutcomes:[{...outcome.slotOutcomes[0],status:'unknown'}]}]}).reason,'reservation_outcome_uncertain');
});
test('a fulfilled outcome prevents another attempt even before a delayed post import',()=>{
 const outcome=slotOutcome(reservation,{id:reservation.id,published:['post-1']},{now});
 assert.equal(decide({posts:[earlyPost],reservations:[reservation],outcomes:[outcome]}).reason,'slot_already_published');
});
test('temporary control expires at the exact agreed UTC deadline, while normal cron remains eligible',()=>{
 assert.equal(decide({triggerCron:TEMPORARY_CATCHUP_CRON,now:new Date('2026-10-10T13:57:59Z')}).decision,'run');
 assert.equal(decide({triggerCron:TEMPORARY_CATCHUP_CRON,now:new Date('2026-10-10T13:58:00Z')}).reason,'temporary_catchup_expired');
 assert.equal(decide({triggerCron:'7 8,13,19 * * *',now:new Date('2026-10-10T13:58:00Z')}).decision,'run');
 assert.equal(decide({triggerCron:TEMPORARY_CATCHUP_CRON,now:new Date('2027-10-10T13:20:00Z')}).reason,'temporary_catchup_expired');
});
test('trusted gate hash binds count, slot, run identity and actual GitHub event',()=>{
 const record=decide(),expectedSha256=sha256(stableJSON(record));assert.equal(validateLoopScheduling(record,{runId:input.runId,expectedSha256,eventName:'schedule'}),record);
 assert.throws(()=>validateLoopScheduling({...record,targetCount:3},{runId:input.runId,expectedSha256}),/fingerprint/);
 assert.throws(()=>validateLoopScheduling(record,{runId:input.runId,expectedSha256,eventName:'workflow_dispatch'}),/provenance/);
 assert.throws(()=>validateLoopScheduling(record,{runId:'loop-999-1',expectedSha256}),/identity/);
});

async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'wys-slot-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'data','slot-reservations'),{recursive:true});await writeFile(path.join(root,'data','slot-reservations',reservation.id+'.json'),JSON.stringify(reservation));await mkdir(path.join(root,'data','posts'),{recursive:true});await writeFile(path.join(root,'data','posts','early.json'),JSON.stringify(earlyPost));return root;}
const env={RUN_ID:'loop-123-1',GITHUB_RUN_ID:'123',GITHUB_EVENT_NAME:'schedule'};
const terminal={id:100,repository:{full_name:'xndanius/while-you-sleep'},head_branch:'main',path:'.github/workflows/loop.yml',status:'completed',conclusion:'failure',updated_at:'2026-10-10T13:05:00Z'};
test('terminal authoritative failed run recovers a missing settlement without losing the failure audit',async t=>{
 const root=await fixture(t);let calls=0;
 const record=await prepareLoop({root,env,now,apiGet:async endpoint=>{calls++;assert.equal(endpoint,'repos/xndanius/while-you-sleep/actions/runs/100');return JSON.stringify(terminal);}});
 assert.equal(calls,1);assert.equal(record.reason,'retry_failed_slot');
 const outcome=JSON.parse(await readFile(path.join(root,'data','slot-outcomes',reservation.id+'.json'),'utf8'));assert.equal(outcome.status,'failed_retryable');assert.equal(outcome.settledByRunId,env.RUN_ID);
});
test('running, unavailable and untrusted source-run metadata preserve the durable hold',async t=>{
 for(const source of [{...terminal,status:'in_progress'},{...terminal,head_branch:'other'},null]){
  const root=await fixture(t);const record=await prepareLoop({root,env,now,apiGet:async()=>{if(!source)throw new Error('offline');return JSON.stringify(source);}});assert.equal(record.reason,'reservation_in_progress_or_unknown');
 }
});
test('trusted gate persists the reservation before returning model eligibility',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-slot-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const record=await prepareLoop({root,env,now});
 const persisted=JSON.parse(await readFile(path.join(root,'data','slot-reservations',record.runId+'.json'),'utf8'));assert.equal(persisted.schedulingSha256,sha256(stableJSON(record)));assert.equal(persisted.slotId,record.slotId);
});

test('all three missed slots catch up within the current day, while yesterday expires before morning',()=>{
 const evening=decide({now:new Date('2026-10-10T17:00:00Z')});assert.equal(evening.targetCount,3);assert.deepEqual(evening.slots.map(slot=>slot.localTime),['08:07','13:07','19:07']);
 const midnight=decide({now:new Date('2026-10-10T21:01:00Z')});assert.equal(midnight.decision,'skip');assert.equal(midnight.reason,'no_current_day_slot_due');assert.equal(midnight.slotId,null);assert.equal(midnight.localDate,'2026-10-11');
 const nextDay=decide({now:new Date('2026-10-11T05:27:00Z'),posts:[{publishedAt:'2026-10-10T17:00:00Z',scheduling:{slotId:evening.slots[0].id}}],reservations:[{id:'old',runId:'old',slotIds:evening.slotIds}]});assert.equal(nextDay.targetCount,1);assert.equal(nextDay.slots[0].id,'publish-2026-10-11-08-07');
});

test('partial batch settles each slot separately and retries only the missing slots',()=>{
 const record=decide({now:new Date('2026-10-10T17:00:00Z')});
 const batch={id:record.id,runId:record.runId,slotId:record.slotId,slotIds:record.slotIds};
 const posts=[{id:'checked-a',runId:record.runId,publishedAt:'2026-10-10T17:02:00Z',scheduling:postScheduling(record,0)}];
 assert.equal(postScheduling(record,1).slotId,record.slots[1].id);assert.equal(postScheduling(record,2).slotId,record.slots[2].id);assert.throws(()=>postScheduling(record,3),/exceeds/);
 const outcome=slotOutcome(batch,{id:record.id,published:posts.map(post=>post.id)},{posts,now:new Date('2026-10-10T17:05:00Z')});
 assert.deepEqual(outcome.slotOutcomes.map(slot=>slot.status),['published','failed_retryable','failed_retryable']);
 const retry=decide({runId:'loop-200-1',posts,reservations:[batch],outcomes:[outcome],now:new Date('2026-10-10T17:20:00Z')});
 assert.equal(retry.targetCount,2);assert.deepEqual(retry.slotIds,record.slotIds.slice(1));
});

test('skipping a gate writes no repository records and does not inspect historic terminal runs',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-cheap-gate-'));t.after(()=>rm(root,{recursive:true,force:true}));
 let calls=0;const record=await prepareLoop({root,env,now:new Date('2026-10-10T21:00:00Z'),apiGet:async()=>{calls++;throw new Error('No network should be needed.');}});
 assert.equal(record.reason,'no_current_day_slot_due');assert.equal(calls,0);await assert.rejects(readdir(path.join(root,'data')),error=>error.code==='ENOENT');
 assert.equal(JSON.parse(await readFile(path.join(root,'.run','loop-gate.json'),'utf8')).decision,'skip');
});

test('failed terminal recovery backoff uses the real finish time even when the skip is uncommitted',async t=>{
 const root=await fixture(t);const source={...terminal,updated_at:'2026-10-10T13:15:00Z'};
 const held=await prepareLoop({root,env,now,apiGet:async()=>JSON.stringify(source)});assert.equal(held.reason,'failed_slot_retry_backoff');
 await assert.rejects(readFile(path.join(root,'data','slot-outcomes',reservation.id+'.json')),error=>error.code==='ENOENT');
 const retry=await prepareLoop({root,env:{...env,RUN_ID:'loop-124-1'},now:new Date('2026-10-10T13:26:00Z'),apiGet:async()=>JSON.stringify(source)});assert.equal(retry.reason,'retry_failed_slot');
 const outcome=JSON.parse(await readFile(path.join(root,'data','slot-outcomes',reservation.id+'.json'),'utf8'));assert.equal(outcome.settledAt,'2026-10-10T13:15:00.000Z');
});

test('batch validation fails closed on duplicate, future and foreign-day slot identities',()=>{
 const record=decide();
 for(const change of [
  {...record,slots:[record.slots[0],record.slots[0]],slotIds:[record.slotIds[0],record.slotIds[0]]},
  {...record,slots:[record.slots[0],{...record.slots[1],scheduledAt:'2026-10-11T10:07:00.000Z'}]},
  {...record,targetCount:3},
 ])assert.throws(()=>validateLoopScheduling(change,{runId:input.runId,expectedSha256:sha256(stableJSON(change))}),/batch/);
});
