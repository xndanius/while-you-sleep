import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {clockAPI,clockClaim,clockRunURL,CLOCK_REPOSITORY} from '../lib/clock.mjs';
import {loadClockState,persistClockRuntime,validateRuntimeDeployment,CLOCK_RUNTIME_MODE,CLOCK_RUNTIME_ENDPOINT} from '../lib/clock-runtime.mjs';
import {claimClock,tickClock} from '../scripts/clock.mjs';
import {ensureClock} from '../scripts/ensure-clock.mjs';
import {latestScheduledSlot} from '../scripts/prepare-scheduled-job.mjs';

const now=new Date('2026-10-11T05:22:00Z');
const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:CLOCK_REPOSITORY,GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'100',GITHUB_RUN_ATTEMPT:'1',CLOCK_RUNTIME_MODE};
const source=(id,status='in_progress',workflow='clock.yml',event='workflow_dispatch')=>({id:Number(id),run_attempt:1,repository:{full_name:CLOCK_REPOSITORY},head_repository:{full_name:CLOCK_REPOSITORY},head_branch:'main',path:`.github/workflows/${workflow}`,event,status,head_sha:'a'.repeat(40)});
const waiting=clockClaim({runId:'100',now:new Date('2026-10-11T05:07:00Z')}).state;
const fakeDispatch=id=>({workflow_run_id:id,html_url:clockRunURL(id)});
const deployment=(payload,id=1)=>({id,ref:'main',sha:'a'.repeat(40),task:'clock:state',environment:'clock-runtime',repository_url:`https://api.github.com/repos/${CLOCK_REPOSITORY}`,creator:{login:'github-actions[bot]',type:'Bot'},transient_environment:true,production_environment:false,created_at:payload.recordedAt,payload});
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'wys-runtime-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
async function save(root,directory,id,value){await mkdir(path.join(root,'data',directory),{recursive:true});await writeFile(path.join(root,'data',directory,id+'.json'),JSON.stringify(value));}
async function completeSlots(root){for(const [kind,dir] of [['research','research'],['measure','measurements'],['improve','versions']]){const id=kind==='research'?'research-99-1':kind+'-complete';await save(root,dir,id,{id,runId:id,...latestScheduledSlot(kind,now),eventName:'schedule',scheduleStatus:'completed'});}await save(root,'posts','existing',{id:'existing',publishedAt:'2026-10-11T05:10:00Z',scheduling:{slotId:'publish-2026-10-11-08-07'}});}
const claimPayload=(state=waiting)=>({schema:1,kind:'clock-runtime',repository:CLOCK_REPOSITORY,transition:'claim',recordedAt:state.claimedAt,producer:{runId:String(state.expectedRunId),runAttempt:state.expectedRunAttempt,workflow:'clock.yml',eventName:'workflow_dispatch'},state:{...state,runtimeUpdatedAt:state.claimedAt},receipt:null});

test('latest deployment lease wins over stale repository state; invalid newest metadata fails closed',async t=>{
 const root=await fixture(t);await save(root,'clock','state',{...waiting,expectedRunId:'99',clockRunUrl:clockRunURL(99)});const row=deployment(claimPayload());
 const api=async endpoint=>endpoint===CLOCK_RUNTIME_ENDPOINT?[row]:source(100);
 const loaded=await loadClockState({root,env,now,api});assert.equal(loaded.source,'deployment');assert.equal(loaded.state.expectedRunId,'100');
 for(const change of [{creator:{login:'someone',type:'User'}},{ref:'other'},{environment:'clock'},{repository_url:'https://api.github.com/repos/other/repo'},{payload:{...row.payload,schema:2}}])await assert.rejects(loadClockState({root,env,now,api:async endpoint=>endpoint===CLOCK_RUNTIME_ENDPOINT?[{...row,...change}]:source(100)}),/untrusted/);
 await assert.rejects(loadClockState({root,env,now,api:async endpoint=>endpoint===CLOCK_RUNTIME_ENDPOINT?[row]:{...source(100),head_repository:{full_name:'other/repo'}}}),/producer/);
 await assert.rejects(loadClockState({root,env,now,api:async()=>{throw new Error('Offline.');}}),/Offline/);
});

test('repo config makes older workflow definitions read runtime while preserving legacy write capability',async t=>{
 const root=await fixture(t);await save(root,'clock','state',waiting);await save(root,'clock','runtime-config',{mode:CLOCK_RUNTIME_MODE});const older={...env};delete older.CLOCK_RUNTIME_MODE;
 const loaded=await loadClockState({root,env:older,now,api:async endpoint=>endpoint===CLOCK_RUNTIME_ENDPOINT?[deployment(claimPayload())]:source(100)});assert.equal(loaded.source,'deployment');
 await assert.rejects(persistClockRuntime({state:waiting,transition:'claim',env:older,now,api:async()=>{throw Error('No write.');}}),/capability/);
});

test('one legacy transition hands the running chain to runtime mode without a restart',async t=>{
 const root=await fixture(t);await save(root,'clock','state',waiting);await save(root,'clock','runtime-config',{mode:CLOCK_RUNTIME_MODE});await completeSlots(root);
 const legacy={...env};delete legacy.CLOCK_RUNTIME_MODE;let row=null,id=200;const commits=[],dispatches=[];
 const api=async(endpoint,options={})=>{
  if(endpoint===CLOCK_RUNTIME_ENDPOINT)return row?[row]:[];
  if(endpoint.endsWith('/deployments')){row=deployment(options.body.payload);return row;}
  if(endpoint.endsWith('/clock.yml/dispatches')){dispatches.push(options.body.inputs);return fakeDispatch(id++);}
  const run=endpoint.match(/\/actions\/runs\/(\d+)$/);if(run)return source(run[1],'completed');
  throw Error('Unexpected request.');
 };
 const old=await tickClock({root,env:legacy,now,api,commit:async value=>commits.push(value)});assert.equal(commits.length,1);assert.equal(row,null);assert.equal(old.child.runId,'200');
 const child={...env,GITHUB_RUN_ID:'200',CLOCK_CHAIN_ID:waiting.chainId,CLOCK_PARENT_RUN_ID:'100',CLOCK_PARENT_RUN_ATTEMPT:'1',CLOCK_GENERATION:'1'};
 await claimClock({root,env:child,now:new Date('2026-10-11T05:23:00Z'),api,commit:async()=>{throw Error('No runtime claim commit.');}});
 const next=await tickClock({root,env:child,now:new Date('2026-10-11T05:38:00Z'),api,commit:async()=>{throw Error('No empty runtime tick commit.');}});
 assert.equal(next.child.runId,'201');assert.equal(next.chainId,old.chainId);assert.equal(row.payload.state.generation,2);assert.equal(commits.length,1);assert.deepEqual(dispatches.map(input=>input.chain_id),[waiting.chainId,waiting.chainId]);
 await assert.rejects(readFile(path.join(root,'data','clock','ticks','clock-200-1.json')),error=>error.code==='ENOENT');
});

test('runtime persistence retries identical state, never another workflow dispatch',async()=>{
 const state=clockClaim({runId:'100',now}).state;const writes=[];
 const result=await persistClockRuntime({state,transition:'claim',env,now,api:async(endpoint,options)=>{
  if(endpoint.endsWith('/actions/runs/100'))return source(100);
  assert.ok(endpoint.endsWith('/deployments'));writes.push(options.body);if(writes.length===1)throw Error('Uncertain response.');return deployment(options.body.payload,2);
 }});
 assert.equal(result.state.runtimeUpdatedAt,now.toISOString());assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.equal(writes[0].auto_merge,false);assert.deepEqual(writes[0].required_contexts,[]);
});

test('legacy runtime reads require no token capability and suppress HTTP error details',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let options;
 globalThis.fetch=async(url,value)=>{options=value;assert.equal(url,`https://api.github.com/${CLOCK_RUNTIME_ENDPOINT}`);return new Response('[]',{status:200});};
 assert.deepEqual(await clockAPI(CLOCK_RUNTIME_ENDPOINT,{env:{GH_TOKEN:'fictional-test-token'}}),[]);assert.equal(options.headers.Authorization,undefined);
 globalThis.fetch=async()=>new Response('fictional-private-error-detail',{status:403});
 await assert.rejects(clockAPI(CLOCK_RUNTIME_ENDPOINT,{env:{GH_TOKEN:'fictional-test-token'}}),error=>error.message==='Clock public runtime API is unavailable.');
});

test('an empty runtime tick makes zero commits and continues through a receipt held outside Git',async t=>{
 const root=await fixture(t);await save(root,'clock','state',waiting);await completeSlots(root);let current=null;const posts=[],commits=[];
 const api=async(endpoint,options={})=>{
  if(endpoint===CLOCK_RUNTIME_ENDPOINT)return current?[current]:[];
  if(endpoint.endsWith('/deployments')){current=deployment(options.body.payload,posts.length+1);posts.push(current);return current;}
  if(endpoint.endsWith('/clock.yml/dispatches'))return fakeDispatch(200);
  if(endpoint.endsWith('/actions/runs/100'))return source(100,'completed');
  if(endpoint.endsWith('/actions/runs/200'))return source(200);
  throw Error('Unexpected API request.');
 };
 const before=await readFile(path.join(root,'data','clock','state.json'),'utf8');
 const receipt=await tickClock({root,env,now,api,commit:async value=>commits.push(value)});
 assert.equal(receipt.dispatches.length,0);assert.equal(commits.length,0);assert.equal(posts.length,1);assert.equal(current.payload.state.expectedRunId,'200');assert.equal(current.payload.state.lastTickAt,now.toISOString());
 assert.equal(await readFile(path.join(root,'data','clock','state.json'),'utf8'),before);await assert.rejects(readdir(path.join(root,'data','clock','ticks')),error=>error.code==='ENOENT');
 const childEnv={...env,GITHUB_RUN_ID:'200',CLOCK_CHAIN_ID:waiting.chainId,CLOCK_PARENT_RUN_ID:'100',CLOCK_PARENT_RUN_ATTEMPT:'1',CLOCK_GENERATION:'1'};
 const claim=await claimClock({root,env:childEnv,now:new Date('2026-10-11T05:23:00Z'),api,commit:async value=>commits.push(value)});
 assert.equal(claim.claimed,true);assert.equal(commits.length,0);assert.deepEqual(current.payload.receipt,receipt);assert.equal(current.payload.state.lastTickAt,now.toISOString());assert.equal(current.payload.state.nextTickAt,'2026-10-11T05:38:00.000Z');
 const duplicate=await claimClock({root,env:{...env,GITHUB_RUN_ID:'300'},now:new Date('2026-10-11T05:24:00Z'),api:async(endpoint,options)=>endpoint.endsWith('/actions/runs/200')?source(200,'waiting'):api(endpoint,options),commit:async()=>{throw Error('No duplicate commit.');}});
 assert.equal(duplicate.claimed,false);assert.equal(posts.length,2);
});

test('a due runtime tick commits exact content receipts, so deterministic target gates keep their proof',async t=>{
 const root=await fixture(t);await save(root,'clock','state',waiting);let id=200;const commits=[];
 const receipt=await tickClock({root,env,now,api:async(endpoint,options={})=>{
  if(endpoint===CLOCK_RUNTIME_ENDPOINT)return[];
  if(endpoint.endsWith('/actions/runs/100'))return source(100);
  if(endpoint.endsWith('/deployments'))return deployment(options.body.payload);
  return fakeDispatch(id++);
 },commit:async value=>commits.push(value)});
 assert.equal(receipt.dispatches.length,4);assert.equal(commits.length,1);assert.equal(JSON.parse(await readFile(path.join(root,'data','clock','ticks','clock-100-1.json'),'utf8')).child.runId,'204');
});

test('a failed content dispatch cannot kill the successor or acquire a trusted run binding',async t=>{
 const root=await fixture(t);await save(root,'clock','state',waiting);let id=200;const commits=[];
 const receipt=await tickClock({root,env,now,api:async(endpoint,options={})=>{
  if(endpoint===CLOCK_RUNTIME_ENDPOINT)return[];
  if(endpoint.endsWith('/actions/runs/100'))return source(100);
  if(endpoint.endsWith('/deployments'))return deployment(options.body.payload);
  if(endpoint.endsWith('/loop.yml/dispatches'))throw Error('fictional-private-api-detail');
  return fakeDispatch(id++);
 },commit:async value=>commits.push(value)});
 assert.deepEqual(receipt.dispatches.map(row=>row.kind),['research','measure','improve']);assert.equal(receipt.dispatchFailures.length,1);assert.equal(receipt.dispatchFailures[0].kind,'loop');assert.equal(receipt.dispatchFailures[0].runId,undefined);assert.ok(!JSON.stringify(receipt).includes('private'));assert.equal(receipt.child.runId,'203');assert.equal(commits.length,1);
});

test('all unbound content responses still leave one runtime successor and no Git commits',async t=>{
 const root=await fixture(t);await save(root,'clock','state',waiting);let row=null;
 const receipt=await tickClock({root,env,now,api:async(endpoint,options={})=>{
  if(endpoint===CLOCK_RUNTIME_ENDPOINT)return[];
  if(endpoint.endsWith('/actions/runs/100'))return source(100);
  if(endpoint.endsWith('/deployments')){row=deployment(options.body.payload);return row;}
  if(endpoint.endsWith('/clock.yml/dispatches'))return fakeDispatch(200);
  return {workflow_run_id:300,html_url:'https://github.com/other/repo/actions/runs/300'};
 },commit:async()=>{throw Error('No empty commit.');}});
 assert.equal(receipt.dispatches.length,0);assert.equal(receipt.dispatchFailures.length,4);assert.equal(row.payload.state.expectedRunId,'200');assert.deepEqual(row.payload.receipt,receipt);
});

test('an unfinished target slot retries on the next runtime tick and success acquires its own exact receipt',async t=>{
 const root=await fixture(t);await save(root,'clock','state',waiting);let row=null;const posted=[],commits=[];
 const api=async(endpoint,options={})=>{
  if(endpoint===CLOCK_RUNTIME_ENDPOINT)return row?[row]:[];
  if(endpoint.endsWith('/deployments')){row=deployment(options.body.payload);return row;}
  const run=endpoint.match(/\/actions\/runs\/(\d+)$/);if(run)return source(run[1],'completed');
  if(endpoint.endsWith('/clock.yml/dispatches'))return fakeDispatch(options.body.inputs.parent_run_id==='100'?200:201);
  posted.push(endpoint);if(row?.payload.state.expectedRunId==='200'&&options.body.inputs.clock_tick_run_id==='200')return fakeDispatch(300+posted.length);
  throw Error('Target API failed.');
 };
 const first=await tickClock({root,env,now,api,commit:async()=>{throw Error('No unbound target commit.');}});assert.equal(first.dispatches.length,0);
 const child={...env,GITHUB_RUN_ID:'200',CLOCK_CHAIN_ID:waiting.chainId,CLOCK_PARENT_RUN_ID:'100',CLOCK_PARENT_RUN_ATTEMPT:'1',CLOCK_GENERATION:'1'};
 await claimClock({root,env:child,now:new Date('2026-10-11T05:23:00Z'),api,commit:async()=>{throw Error('No claim commit.');}});
 const second=await tickClock({root,env:child,now:new Date('2026-10-11T05:38:00Z'),api,commit:async value=>commits.push(value)});
 assert.equal(second.dispatches.length,4);assert.equal(second.dispatchFailures.length,0);assert.equal(commits.length,1);assert.deepEqual(second.dispatches.find(item=>item.kind==='loop').slotIds,['publish-2026-10-11-08-07']);assert.equal(second.child.runId,'201');
});

test('an unbound successor remains fatal before any runtime transition or Git commit',async t=>{
 const root=await fixture(t);await save(root,'clock','state',waiting);await completeSlots(root);let writes=0;
 await assert.rejects(tickClock({root,env,now,api:async(endpoint,options={})=>{
  if(endpoint===CLOCK_RUNTIME_ENDPOINT)return[];
  if(endpoint.endsWith('/deployments')){writes++;throw Error('No transition.');}
  return null;
 },commit:async()=>{throw Error('No commit.');}}),/binding/);assert.equal(writes,0);
});

test('healthy backups trust the runtime lease without mutations over stale Git state',async t=>{
 const root=await fixture(t);await save(root,'clock','state',{...waiting,claimedAt:'2026-10-10T05:07:00Z'});const row=deployment(claimPayload());let writes=0;
 const result=await ensureClock({root,env:{...env,GITHUB_RUN_ID:'900',GITHUB_EVENT_NAME:'schedule'},now,api:async(endpoint,options={})=>{if(options.method==='POST'){writes++;throw Error('No write.');}return endpoint===CLOCK_RUNTIME_ENDPOINT?[row]:source(100,'waiting');},commit:async()=>{throw Error('No commit.');}});
 assert.equal(result.restarted,false);assert.equal(writes,0);
});

test('stale runtime recovery fences before cancelling, persists one replacement and commits restart history',async t=>{
 const root=await fixture(t);await save(root,'clock','state',waiting);let row=deployment(claimPayload()),id=2;const actions=[];const backup={...env,GITHUB_RUN_ID:'900',GITHUB_EVENT_NAME:'schedule'};
 const result=await ensureClock({root,env:backup,now:new Date('2026-10-11T06:00:00Z'),api:async(endpoint,options={})=>{
  if(endpoint===CLOCK_RUNTIME_ENDPOINT)return[row];
  if(endpoint.endsWith('/actions/runs/100'))return source(100,'waiting');
  if(endpoint.endsWith('/actions/runs/900'))return source(900,'in_progress','loop.yml','schedule');
  if(endpoint.endsWith('/deployments')){row=deployment(options.body.payload,id++);actions.push(row.payload.transition);return row;}
  if(endpoint.endsWith('/cancel')){assert.equal(row.payload.state.phase,'fenced');actions.push('cancel');return null;}
  if(endpoint.endsWith('/clock.yml/dispatches')){actions.push('dispatch');return fakeDispatch(300);}
  throw Error('Unexpected API request.');
 },commit:async value=>actions.push(value.message.includes('fence')?'fence-commit':'restart-commit')});
 assert.equal(result.restarted,true);assert.deepEqual(actions,['fence','fence-commit','cancel','dispatch','restart','restart-commit']);assert.equal(row.payload.state.expectedRunId,'300');
});

test('recent terminal runtime failure is fenced immediately before its only replacement',async t=>{
 const root=await fixture(t);await save(root,'clock','state',waiting);let row=deployment(claimPayload()),id=2;const actions=[];
 const backup={...env,GITHUB_RUN_ID:'900',GITHUB_EVENT_NAME:'schedule'};
 const result=await ensureClock({root,env:backup,now,api:async(endpoint,options={})=>{
  if(endpoint===CLOCK_RUNTIME_ENDPOINT)return[row];
  if(endpoint.endsWith('/actions/runs/100'))return {...source(100,'completed'),conclusion:'failure'};
  if(endpoint.endsWith('/actions/runs/900'))return source(900,'in_progress','loop.yml','schedule');
  if(endpoint.endsWith('/deployments')){row=deployment(options.body.payload,id++);actions.push(row.payload.transition);return row;}
  if(endpoint.endsWith('/clock.yml/dispatches')){assert.equal(row.payload.state.phase,'fenced');actions.push('dispatch');return fakeDispatch(300);}
  throw Error('No cancellation or unbound mutation is permitted.');
 },commit:async value=>actions.push(value.message.includes('fence')?'fence-commit':'restart-commit')});
 assert.deepEqual(result,{restarted:true,runId:'300',reason:'clock_run_terminal_non_success'});
 assert.deepEqual(actions,['fence','fence-commit','dispatch','restart','restart-commit']);assert.equal(row.payload.state.expectedRunId,'300');
});

test('a fresh stale seed is not checked against the previous chain child receipt',async t=>{
 const root=await fixture(t);const stale={...waiting,expectedRunId:'200',clockRunUrl:clockRunURL(200),parentRunId:'99',parentRunAttempt:1,phase:'queued',generation:1,claimedAt:'2026-10-10T05:07:00Z',lastTickAt:'2026-10-10T05:00:00Z'};await save(root,'clock','state',stale);
 const legacy={...env};delete legacy.CLOCK_RUNTIME_MODE;
 const result=await claimClock({root,env:legacy,now,api:async()=>source(200,'completed'),commit:async()=>{}});assert.equal(result.claimed,true);assert.equal(result.state.parentRunId,null);
});

test('only clock and trusted backup jobs receive deployment write permissions',async()=>{
 for(const kind of ['clock','loop','research','measure','improve']){const workflow=await readFile(`.github/workflows/${kind}.yml`,'utf8');assert.match(workflow,/deployments: write/);assert.match(workflow,/CLOCK_RUNTIME_MODE: deployments-v1/);
  if(kind==='loop')assert.ok(!workflow.slice(workflow.indexOf('  writer:')).includes('deployments: write'));
  if(kind==='improve')assert.ok(!workflow.slice(workflow.indexOf('  propose:')).includes('deployments: write'));
 }
 const clock=await readFile('.github/workflows/clock.yml','utf8');assert.match(clock,/needs\.tick\.outputs\.committed == 'true'/);
});
