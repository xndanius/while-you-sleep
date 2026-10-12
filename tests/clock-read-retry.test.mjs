import test from 'node:test';
import assert from 'node:assert/strict';
import {retryClockRead,requestClockAPI} from '../lib/clock.mjs';

test('a transient metadata read can recover without changing its trusted response',async()=>{
 const expected={id:123,status:'completed',repository:{full_name:'xndanius/while-you-sleep'}};
 let calls=0;const pauses=[];
 const result=await retryClockRead(async()=>{calls++;if(calls<3)throw new Error('Clock GitHub API is unavailable.');return expected;},{pause:async milliseconds=>pauses.push(milliseconds)});
 assert.equal(result,expected);assert.equal(calls,3);assert.deepEqual(pauses,[250,500]);
});
test('an unavailable read still fails closed after a bounded budget',async()=>{
 let calls=0;await assert.rejects(retryClockRead(async()=>{calls++;throw new Error('Clock GitHub API is unavailable.');},{pause:async()=>{}}),/unavailable/);assert.equal(calls,3);
 await assert.rejects(retryClockRead(async()=>{}, {attempts:4}),/bounded/);
});
test('the automatic retry boundary applies only to reads, never uncertain mutating requests',async()=>{
 for(const endpoint of ['repos/xndanius/while-you-sleep/deployments','repos/xndanius/while-you-sleep/actions/workflows/clock.yml/dispatches']){
  let calls=0;const body={ref:'main'};
  await assert.rejects(requestClockAPI(async(url,options)=>{calls++;assert.equal(url,endpoint);assert.equal(options.body,body);throw new Error('An uncertain POST must not be repeated.');},endpoint,{method:'POST',body}),/uncertain POST/);
  assert.equal(calls,1);
 }
});
