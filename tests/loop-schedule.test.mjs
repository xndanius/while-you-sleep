import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {loopDecision,validateLoopScheduling,slotOutcome,TEMPORARY_CATCHUP_CRON} from '../lib/loop-schedule.mjs';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {prepareLoop} from '../scripts/prepare-loop.mjs';

const now=new Date('2026-10-10T13:20:00Z');
const input={runId:'loop-123-1',eventName:'schedule',githubRunId:'123',now};
const decide=extra=>loopDecision({...input,...extra});
const reservation={id:'loop-100-1',runId:'loop-100-1',slotId:'publish-2026-10-10-13-07',githubRepository:'xndanius/while-you-sleep',githubRunId:'100'};
test('a delayed schedule catches up only the latest elapsed slot and audits earlier missed slots',()=>{
 const record=decide();assert.equal(record.decision,'run');assert.equal(record.slotId,'publish-2026-10-10-13-07');assert.equal(record.scheduledAt,'2026-10-10T10:07:00.000Z');assert.equal(record.catchUp,true);assert.equal(record.targetCount,1);assert.deepEqual(record.missedSlots.map(slot=>slot.localTime),['08:07']);
});
test('a committed slot post and a real legacy publication after that slot both suppress repeats',()=>{
 assert.equal(decide({posts:[{publishedAt:'2026-10-10T10:15:00Z',scheduling:{slotId:reservation.slotId}}]}).reason,'slot_already_published');
 assert.equal(decide({posts:[{publishedAt:'2026-10-10T10:15:00Z'}]}).reason,'slot_already_published');
 assert.equal(decide({posts:[{publishedAt:'2026-10-10T06:53:00Z'}]}).decision,'run');
});
test('three launch posts consume today\'s cap; bootstrap never silently bypasses the cap or initial total',()=>{
 const posts=[1,2,3].map(id=>({id:String(id),publishedAt:'2026-10-10T06:53:00Z'}));
 assert.equal(decide({posts}).reason,'daily_cap_reached');assert.equal(decide({bootstrap:true,eventName:'workflow_dispatch',posts}).reason,'initial_bootstrap_already_completed');
 assert.equal(decide({bootstrap:true,eventName:'workflow_dispatch',posts:posts.slice(0,1)}).targetCount,2);
});
test('a pending or uncertain reservation holds; known failures retry only after bounded backoff',()=>{
 assert.equal(decide({reservations:[reservation]}).reason,'reservation_in_progress_or_unknown');
 const outcome=slotOutcome(reservation,{id:reservation.id,published:[]},{now:new Date('2026-10-10T13:15:00Z')});
 assert.equal(decide({reservations:[reservation],outcomes:[outcome]}).reason,'failed_slot_retry_backoff');
 assert.equal(decide({now:new Date('2026-10-10T13:26:00Z'),reservations:[reservation],outcomes:[outcome]}).reason,'retry_failed_slot');
 assert.equal(decide({reservations:[reservation],outcomes:[{...outcome,status:'unknown'}]}).reason,'reservation_outcome_uncertain');
});
test('a fulfilled outcome prevents another attempt even before a delayed post import',()=>{
 const outcome=slotOutcome(reservation,{id:reservation.id,published:['post-1']},{now});
 assert.equal(decide({reservations:[reservation],outcomes:[outcome]}).reason,'slot_already_published');
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

async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'wys-slot-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'data','slot-reservations'),{recursive:true});await writeFile(path.join(root,'data','slot-reservations',reservation.id+'.json'),JSON.stringify(reservation));return root;}
const env={RUN_ID:'loop-123-1',GITHUB_RUN_ID:'123',GITHUB_EVENT_NAME:'schedule'};
const terminal={id:100,repository:{full_name:'xndanius/while-you-sleep'},head_branch:'main',path:'.github/workflows/loop.yml',status:'completed',conclusion:'failure'};
test('terminal authoritative failed run recovers a missing settlement without losing the failure audit',async t=>{
 const root=await fixture(t);let calls=0;
 const record=await prepareLoop({root,env,now,apiGet:async endpoint=>{calls++;assert.equal(endpoint,'repos/xndanius/while-you-sleep/actions/runs/100');return JSON.stringify(terminal);}});
 assert.equal(calls,1);assert.equal(record.reason,'failed_slot_retry_backoff');
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
