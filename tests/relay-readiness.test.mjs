import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {relayPublicationReady,readRelayStatus} from '../lib/relay.mjs';
import {prepareLoop} from '../scripts/prepare-loop.mjs';

const ready={feedPath:'best.xml',bestFeedSwitch:{state:'confirmed',confirmedAt:'2026-10-11T15:44:00.000Z'}};
test('a corrected or unknown relay approval cannot authorize hourly publication',()=>{
  assert.equal(relayPublicationReady(ready),true);
  for(const status of [null,{}, {...ready,feedPath:'feed.xml'},{...ready,bestFeedSwitch:{...ready.bestFeedSwitch,state:'pending'}},{...ready,bestFeedSwitch:{...ready.bestFeedSwitch,confirmedAt:null}}])assert.equal(relayPublicationReady(status),false);
  assert.equal(relayPublicationReady(null,{hourly:false}),true);
});
test('a hosted hourly gate cheaply defers until the actual switch is confirmed',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'wys-relay-gate-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const env={RUN_ID:'loop-123-1',GITHUB_RUN_ID:'123',GITHUB_EVENT_NAME:'schedule',GITHUB_ACTIONS:'true'};
  const cadence={schema:1,mode:'hourly',activatedAt:'2026-10-11T12:15:00.000Z',relayConfirmedAt:'2026-10-11T12:10:00.000Z'};
  let record=await prepareLoop({root,env,cadence,now:new Date('2026-10-11T16:08:00.000Z')});
  assert.equal(record.decision,'skip');assert.equal(record.reason,'awaiting_confirmed_best_feed_switch');
  await assert.rejects(fs.stat(path.join(root,'data','slot-reservations')),{code:'ENOENT'});
  await fs.mkdir(path.join(root,'data','relay'),{recursive:true});await fs.writeFile(path.join(root,'data','relay','status.json'),JSON.stringify({...ready,feedPath:'feed.xml',bestFeedSwitch:{...ready.bestFeedSwitch,state:'pending',confirmedAt:null}}));
  record=await prepareLoop({root,env,cadence,now:new Date('2026-10-11T16:08:00.000Z')});assert.equal(record.decision,'skip');
  await fs.writeFile(path.join(root,'data','relay','status.json'),JSON.stringify(ready));assert.deepEqual(await readRelayStatus(root),ready);
  record=await prepareLoop({root,env,cadence,now:new Date('2026-10-11T16:08:00.000Z')});assert.equal(record.decision,'run');
  assert.ok((await fs.readdir(path.join(root,'data','slot-reservations'))).length===1);
});
