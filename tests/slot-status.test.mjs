import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationSlotStatus as slotStatus } from '../lib/slot-status.mjs';
import { currentDaySlots as browserSlots } from '../public/slot-display.js';

const legacy={schema:1,mode:'legacy',activatedAt:null,relayConfirmedAt:null};
const publicationSlotStatus=input=>slotStatus({...input,cadence:legacy});
const currentDaySlots=(data,now)=>browserSlots({...data,schedule:{...data.schedule,cadence:legacy}},now);

const now = new Date('2026-10-11T17:00:00Z');
const slots = ['08','13','19'].map(hour=>`publish-2026-10-11-${hour}-07`);
test('slot rows distinguish planned time, late attempts and actual delayed publications',()=>{
  const posts=[{id:'post-a',runId:'loop-1',publishedAt:'2026-10-11T10:15:00Z',eventName:'schedule',scheduling:{slotId:slots[0]}}];
  const runs=[{id:'loop-2',type:'loop',startedAt:'2026-10-11T10:30:00Z',finishedAt:'2026-10-11T10:40:00Z',eventName:'schedule',modelExecuted:true,status:'rejected',published:[],rejected:[{reason:'Source quote failed.'}],scheduling:{slotId:slots[1],requestedAt:'2026-10-11T10:30:00Z'}}];
  const rows=publicationSlotStatus({posts,runs,now});
  assert.equal(rows[0].state,'published');assert.equal(rows[0].scheduledAt,'2026-10-11T05:07:00.000Z');assert.equal(rows[0].actualAt,posts[0].publishedAt);assert.equal(rows[0].delayMinutes,308);
  assert.equal(rows[1].state,'rejected');assert.equal(rows[1].actualAt,null);assert.equal(rows[1].attemptedAt,runs[0].startedAt);assert.equal(rows[1].reason,'Source quote failed.');
  assert.equal(rows[2].state,'late');assert.equal(rows[2].actualAt,null);
});
test('one batch can publish each slot at a distinct actual time without inventing the trigger time',()=>{
  const posts=slots.map((slotId,index)=>({id:`post-${index}`,runId:'loop-3',publishedAt:`2026-10-11T16:${String(20+index).padStart(2,'0')}:00Z`,scheduling:{slotId},eventName:'schedule'}));
  const rows=publicationSlotStatus({posts,now});assert.deepEqual(rows.map(row=>row.actualAt),posts.map(post=>post.publishedAt));assert.ok(rows.every(row=>row.state==='published'));
});
test('future slots remain planned while no-op cap gates do not count as publication',()=>{
  const posts=[1,2,3].map(id=>({id:String(id),publishedAt:'2026-10-11T06:00:00Z',scheduling:{slotId:'bootstrap-initial'}}));
  const runs=[{id:'gate',type:'loop',modelExecuted:false,status:'skipped_daily_cap_reached',startedAt:'2026-10-11T10:27:00Z',scheduling:{slotId:slots[1]}}];
  const rows=publicationSlotStatus({posts,runs,now:new Date('2026-10-11T11:00:00Z')});
  assert.deepEqual(rows.map(row=>row.state),['cap_reached','cap_reached','scheduled']);assert.ok(rows.every(row=>row.actualAt===null));
});
test('pending reservations are running and yesterday never fulfils today',()=>{
  const reservations=[{id:'loop-3',runId:'loop-3',slotId:slots[0],slotIds:[slots[0],slots[1]],createdAt:'2026-10-11T10:27:00Z'}];
  const rows=publicationSlotStatus({posts:[{publishedAt:'2026-10-10T18:00:00Z'}],reservations,now});
  assert.deepEqual(rows.map(row=>row.state),['running','running','late']);assert.ok(rows.every(row=>row.actualAt===null));
});

test('slot rows preserve verified clock origins without making dispatch attempts publications',()=>{
  const clock={source:'github-environment-clock',verified:true,tickId:'clock-111-1',clockRunId:'111',parentAttempt:1,clockRunUrl:'https://github.com/xndanius/while-you-sleep/actions/runs/111',dispatchId:'clock-111-1-loop',runId:'222',workflow:'loop.yml',tickedAt:'2026-10-11T10:27:00Z',requestedAt:'2026-10-11T10:27:00Z',verifiedAt:'2026-10-11T10:28:00Z'};
  const run={id:'loop-222-1',type:'loop',startedAt:'2026-10-11T10:28:00Z',finishedAt:'2026-10-11T10:40:00Z',eventName:'workflow_dispatch',clock,status:'completed',scheduling:{slotIds:[slots[0],slots[1]],requestedAt:'2026-10-11T10:28:00Z'}};
  const posts=[{id:'checked',runId:run.id,publishedAt:'2026-10-11T10:38:00Z',eventName:'workflow_dispatch',scheduling:{slotId:slots[0],clock}}];
  const rows=publicationSlotStatus({posts,runs:[run],now});
  assert.deepEqual(rows[0].clock,clock);
  assert.equal(rows[0].eventName,'workflow_dispatch');
  assert.equal(rows[0].state,'published');
  assert.deepEqual(rows[1].clock,clock);
  assert.equal(rows[1].eventName,'workflow_dispatch');
  assert.equal(rows[1].actualAt,null);
  assert.equal(rows[1].state,'missed');
  const untrusted=publicationSlotStatus({runs:[{...run,clock:{source:'github-environment-clock',verified:true}}],now});
  assert.equal(untrusted[0].clock,null,'An input-like clock label cannot survive as verified metadata.');
  const manualPost=publicationSlotStatus({posts:[{...posts[0],scheduling:{slotId:slots[0]}}],runs:[run],now});
  assert.equal(manualPost[0].clock,null,'A later clock attempt cannot replace a published post’s own origin.');
  const browserRows=currentDaySlots({posts:[{...posts[0],scheduling:{slotId:slots[0]}}],runs:[run],schedule:{slots:manualPost}},now);
  assert.equal(browserRows[0].clock,null,'The browser also retains the published post’s original provenance.');
});


test('terminal checked refusals and exhausted failures remain honest in build and browser rows',()=>{
 const reservations=[{id:'loop-4',runId:'loop-4',slotIds:[slots[0]]},{id:'loop-5',runId:'loop-5',slotIds:[slots[1]]}];
 const outcomes=[{reservationId:'loop-4',slotOutcomes:[{slotId:slots[0],status:'no_post',reason:'No checked idea reached the threshold.'}]},{reservationId:'loop-5',slotOutcomes:[{slotId:slots[1],status:'retry_exhausted',reason:'Fresh source retrieval failed three times.'}]}];
 const rows=publicationSlotStatus({reservations,outcomes,now});
 assert.equal(rows[0].state,'no_post');assert.equal(rows[1].state,'retry_exhausted');assert.ok(rows.every(row=>row.actualAt===null));
 const aged=currentDaySlots({schedule:{slots:rows}},new Date('2026-10-11T19:00:00Z'));
 assert.equal(aged[0].state,'no_post');assert.equal(aged[0].reason,rows[0].reason);assert.equal(aged[1].state,'retry_exhausted');
});

test('an unverified no-post slot remains terminal as the browser clock advances and exposes its reason',()=>{
 const slot={id:slots[0],plannedAt:'2026-10-11T05:07:00.000Z',state:'no_post_unverified',status:'no_post_unverified',actualAt:null,reason:'Final public evidence fetch returned HTTP 429; no independent completion is claimed.'};
 const rows=currentDaySlots({schedule:{slots:[slot]}},new Date('2026-10-11T19:00:00Z'));
 assert.equal(rows[0].state,'no_post_unverified');assert.equal(rows[0].actualAt,null);assert.equal(rows[0].reason,slot.reason);
});
