import test from 'node:test';
import assert from 'node:assert/strict';
import {publicClockRuntime,newerClockRecord} from '../public/clock-runtime.js';

function deployment(){return {
  id:123,environment:'clock-runtime',ref:'main',task:'clock:state',repository_url:'https://api.github.com/repos/xndanius/while-you-sleep',creator:{login:'github-actions[bot]'},transient_environment:true,production_environment:false,created_at:'2026-10-11T10:18:02Z',
  payload:{schema:1,kind:'clock-runtime',repository:'xndanius/while-you-sleep',recordedAt:'2026-10-11T10:18:01Z',transition:'claim',producer:{runId:'101',runAttempt:1,workflow:'clock.yml',eventName:'workflow_dispatch'},state:{phase:'waiting',expectedRunId:'101',expectedRunAttempt:1,waitMinutes:15,chainId:'clock-99-1',generation:2,clockRunUrl:'https://github.com/xndanius/while-you-sleep/actions/runs/101',claimedAt:'2026-10-11T10:18:01Z',nextTickAt:'2026-10-11T10:33:01Z',lastTickAt:'2026-10-11T10:17:01Z',parentRunId:'100'},receipt:{kind:'clock-tick',githubRunId:'100',githubRunAttempt:1,id:'clock-100-1',githubRunUrl:'https://github.com/xndanius/while-you-sleep/actions/runs/100',chainId:'clock-99-1',environment:'clock',waitMinutes:15,claimedAt:'2026-10-11T10:02:00Z',tickedAt:'2026-10-11T10:17:01Z',dispatches:[]}}
};}
const now='2026-10-11T10:20:00Z';
test('public runtime reads a later empty tick without a repository commit',()=>{
  const clock=publicClockRuntime(deployment(),now);
  assert.equal(clock.lastTickAt,'2026-10-11T10:17:01Z');
  assert.equal(clock.nextTickAt,'2026-10-11T10:33:01Z');
  assert.equal(clock.lastTickRunUrl,'https://github.com/xndanius/while-you-sleep/actions/runs/100');
  assert.equal(newerClockRecord({lastTickAt:'2026-10-11T10:01:00Z'},clock),clock);
  const restarted={runtimeUpdatedAt:'2026-10-11T10:19:00Z',phase:'fenced'};
  assert.equal(newerClockRecord(restarted,clock),restarted);
});
test('public runtime rejects another repository, producer, stale creation, and a shortened wait',()=>{
  for(const mutate of [row=>row.repository_url='https://api.github.com/repos/other/repo',row=>row.creator.login='owner',row=>row.task='deploy',row=>row.payload.recordedAt='2026-10-11T10:30:00Z',row=>row.created_at='2026-10-11T10:25:00Z',row=>row.payload.receipt.claimedAt='2026-10-11T10:03:00Z',row=>row.payload.state.expectedRunId='0',row=>row.payload.receipt.id='clock-999-1']){
    const row=deployment();mutate(row);assert.equal(publicClockRuntime(row,now),null);
  }
});
test('display metadata cannot introduce workflow links outside this repository',()=>{
  const row=deployment();row.payload.receipt.dispatches=[{workflow:'loop.yml',runId:'222',requestedAt:now,githubRunUrl:'https://github.com/other/repo/actions/runs/222'},{workflow:'loop.yml',runId:'223',requestedAt:now,githubRunUrl:'https://github.com/xndanius/while-you-sleep/actions/runs/223'}];
  assert.equal(publicClockRuntime(row,now).dispatches.length,1);
});
