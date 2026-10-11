import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationSlotStatus } from '../lib/slot-status.mjs';

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
