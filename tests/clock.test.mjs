import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,chmod,rm,copyFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {clockAPI,clockClaim,clockLiveness,clockRunURL,clockTickId,dueClockDispatches,dispatchClockWorkflow,validateClockTick,CLOCK_REPOSITORY} from '../lib/clock.mjs';
import {claimClock,tickClock} from '../scripts/clock.mjs';
import {ensureClock} from '../scripts/ensure-clock.mjs';
import {latestScheduledSlot} from '../scripts/prepare-scheduled-job.mjs';

const now=new Date('2026-10-11T05:22:00Z');
const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:CLOCK_REPOSITORY,GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'100',GITHUB_RUN_ATTEMPT:'1'};
const source=(id,status='waiting')=>({id,run_attempt:1,repository:{full_name:CLOCK_REPOSITORY},head_repository:{full_name:CLOCK_REPOSITORY},head_branch:'main',path:'.github/workflows/clock.yml',event:'workflow_dispatch',status,conclusion:status==='completed'?'success':null});
const waiting=clockClaim({runId:'100',now:new Date('2026-10-11T05:07:00Z')}).state;
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'wys-clock-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
async function saveState(root,state){await mkdir(path.join(root,'data','clock'),{recursive:true});await writeFile(path.join(root,'data','clock','state.json'),JSON.stringify(state));}
const fakeDispatch=(id)=>({workflow_run_id:id,html_url:clockRunURL(id),run_url:`https://api.github.com/repos/${CLOCK_REPOSITORY}/actions/runs/${id}`});

test('clock, recovery and cheap due gates import in an isolated checkout without node_modules',async t=>{
 const root=await fixture(t),checkout=new URL('../',import.meta.url);
 await copyFile(new URL('package.json',checkout),path.join(root,'package.json'));
 for(const directory of ['lib','scripts','public']){
  await mkdir(path.join(root,directory));for(const file of await readdir(new URL(directory+'/',checkout)))if(/\.(?:mjs|js)$/.test(file))await copyFile(new URL(directory+'/'+file,checkout),path.join(root,directory,file));
 }
 await assert.rejects(readdir(path.join(root,'node_modules')),error=>error.code==='ENOENT');
 const code="for(const entry of ['clock.mjs','ensure-clock.mjs','prepare-loop.mjs','prepare-scheduled-job.mjs','watchdog.mjs'])await import(new URL('./scripts/'+entry,import.meta.url));console.log('dependency-free gates loaded');";
 const result=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:root,env:{PATH:process.env.PATH},encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/dependency-free gates loaded/);
});

test('singleton claim stops duplicates before the environment and binds exact child generation',()=>{
 assert.equal(clockClaim({runId:'101',state:waiting,sourceRun:source(100),now}).claimed,false);
 const queued={...waiting,phase:'queued',expectedRunId:'200',generation:1,parentRunId:'100',parentRunAttempt:1,clockRunUrl:clockRunURL(200)};
 const input={state:queued,runId:'200',chainId:queued.chainId,parentRunId:'100',parentAttempt:'1',generation:'1',now};
 assert.equal(clockClaim(input).claimed,true);
 for(const change of [{runId:'201'},{chainId:'fake'},{parentRunId:'99'},{parentAttempt:'2'},{generation:'2'},{attempt:2}])assert.equal(clockClaim({...input,...change}).claimed,false);
 assert.equal(clockClaim({runId:'100',state:waiting,now}).claimed,false,'same run cannot claim twice');
});

test('timer holds no runner job script and enforces a full fifteen-minute wait',()=>{
 assert.throws(()=>validateClockTick(waiting,{runId:'100',now:new Date('2026-10-11T05:21:59Z')}),/wait/);
 assert.equal(validateClockTick(waiting,{runId:'100',now}),waiting);
 for(const state of [{...waiting,phase:'queued'},{...waiting,expectedRunId:'other'},{...waiting,expectedRunAttempt:2},{...waiting,phase:'fenced'}])assert.throws(()=>validateClockTick(state,{runId:'100',now}),/claim/);
});

test('liveness respects recent waiting/queued runs but exposes a stale lease for fencing',()=>{
 for(const status of ['waiting','queued','in_progress'])assert.equal(clockLiveness(waiting,source(100,status),now).alive,true);
 assert.equal(clockLiveness(waiting,source(100,'completed'),now).alive,true);
 assert.equal(clockLiveness(waiting,source(100),new Date('2026-10-11T06:00:00Z')).alive,false);
 assert.equal(clockLiveness(null,null,now).alive,false);
});

test('an exact unsuccessful completed attempt is dead immediately despite a recent claim',()=>{
 for(const conclusion of ['failure','cancelled','timed_out','action_required','startup_failure','neutral','skipped','stale']){
  assert.deepEqual(clockLiveness(waiting,{...source(100,'completed'),conclusion},now),{alive:false,reason:'clock_run_terminal_non_success'});
 }
 for(const conclusion of [undefined,null,'','unknown','success'])assert.equal(clockLiveness(waiting,{...source(100,'completed'),conclusion},now).alive,true);
 for(const status of ['waiting','queued','in_progress','requested','pending','unknown'])assert.equal(clockLiveness(waiting,{...source(100,status),conclusion:'failure'},now).alive,true);
 for(const change of [{id:101},{run_attempt:2},{path:'.github/workflows/loop.yml'},{event:'schedule'},{head_branch:'other'},{repository:{full_name:'other/repo'}},{head_repository:{full_name:'other/repo'}}])assert.equal(clockLiveness(waiting,{...source(100,'completed'),conclusion:'failure',...change},now).alive,true);
});

test('backup immediately fences a recent failed attempt before dispatching one exact replacement',async t=>{
 const root=await fixture(t);await saveState(root,waiting);const actions=[];
 const result=await ensureClock({root,env:{...env,GITHUB_EVENT_NAME:'schedule',GITHUB_RUN_ID:'900'},now,api:async(endpoint,options={})=>{
  if(options.method==='POST'){
   assert.ok(endpoint.endsWith('/clock.yml/dispatches'),'a terminal source never needs cancellation');
   assert.equal(JSON.parse(await readFile(path.join(root,'data','clock','state.json'),'utf8')).phase,'fenced');
   actions.push('dispatch');return fakeDispatch(300);
  }
  assert.ok(endpoint.endsWith('/runs/100'));return {...source(100,'completed'),conclusion:'failure'};
 },commit:async value=>actions.push(value.message.includes('fence')?'fence':'restart')});
 assert.deepEqual(result,{restarted:true,runId:'300',reason:'clock_run_terminal_non_success'});
 assert.deepEqual(actions,['fence','dispatch','restart']);
 const replacement=JSON.parse(await readFile(path.join(root,'data','clock','state.json'),'utf8'));
 assert.equal(replacement.expectedRunId,'300');assert.equal(replacement.phase,'queued');
 await assert.rejects(tickClock({root,env,now,api:async()=>{throw new Error('Old failed attempt cannot tick.');},commit:async()=>{}}),/claim/);
});

test('recent uncertain terminal conclusions and a different attempt never trigger backup writes',async t=>{
 for(const change of [{conclusion:null},{conclusion:'unknown'},{conclusion:'failure',run_attempt:2}]){
  const root=await fixture(t);await saveState(root,waiting);let writes=0;
  const result=await ensureClock({root,env:{...env,GITHUB_EVENT_NAME:'schedule',GITHUB_RUN_ID:'900'},now,api:async(endpoint,options={})=>{
   if(options.method==='POST'){writes++;throw new Error('No replacement.');}
   return {...source(100,'completed'),...change};
  },commit:async()=>{writes++;}});
  assert.equal(result.restarted,false);assert.equal(writes,0);
 }
});

test('pure clock planner skips completed slots, preserves the cap and sends an unresolved lock to its real gate',()=>{
 const completions=Object.fromEntries(['research','measure','improve'].map(kind=>[kind,[{...latestScheduledSlot(kind,now),eventName:'workflow_dispatch',scheduleStatus:'completed'}]]));
 const posts=[{id:'a',publishedAt:'2026-10-11T05:10:00Z',scheduling:{slotId:'publish-2026-10-11-08-07'}}];
 assert.deepEqual(dueClockDispatches({posts,completions,runId:'100',now}),[]);
 const reservations=[{id:'loop-77-1',runId:'loop-77-1',slotId:'publish-2026-10-11-08-07'}];
 const plans=dueClockDispatches({reservations,completions,runId:'100',now});assert.equal(plans.length,1);assert.equal(plans[0].kind,'loop');assert.equal(plans[0].reason,'reservation_in_progress_or_unknown');
 const capped=[1,2,3].map(id=>({id:String(id),publishedAt:'2026-10-11T05:10:00Z'}));assert.deepEqual(dueClockDispatches({posts:capped,completions,runId:'100',now}),[]);
});

test('dispatch accepts only the exact returned child ID and canonical repository URL',async()=>{
 let body;const result=await dispatchClockWorkflow('loop.yml',{bootstrap:false},{api:async(endpoint,options)=>{body=options.body;assert.match(endpoint,/loop\.yml\/dispatches$/);return fakeDispatch(200);}});
 assert.equal(result.runId,'200');assert.equal(body.ref,'main');assert.equal(body.inputs.bootstrap,false);
 for(const response of [null,{}, {...fakeDispatch(200),html_url:'https://github.com/other/repo/actions/runs/200'}])await assert.rejects(dispatchClockWorkflow('loop.yml',{}, {api:async()=>response}),/binding/);
 await assert.rejects(dispatchClockWorkflow('social.yml',{}, {api:async()=>fakeDispatch(200)}),/target/);
});

test('tick dispatches bounded due workflows, records their exact IDs, and chains once',async t=>{
 const root=await fixture(t);await saveState(root,waiting);let id=200;const requests=[],commits=[];
 const receipt=await tickClock({root,env,now,api:async(endpoint,options)=>{requests.push({endpoint,body:options.body});return fakeDispatch(id++);},commit:async value=>commits.push(value)});
 assert.deepEqual(receipt.dispatches.map(row=>row.workflow),['loop.yml','research.yml','measure.yml','improve.yml']);
 assert.equal(requests.length,5);assert.equal(commits.length,1);assert.equal(receipt.child.runId,'204');
 const loop=receipt.dispatches[0];assert.equal(loop.dispatchId,'clock-100-1-loop');assert.equal(loop.runId,'200');assert.deepEqual(loop.slotIds,['publish-2026-10-11-08-07']);assert.equal(requests[0].body.inputs.clock_tick_run_id,'100');
 const state=JSON.parse(await readFile(path.join(root,'data','clock','state.json'),'utf8'));assert.equal(state.expectedRunId,'204');assert.equal(state.phase,'queued');assert.equal(state.generation,1);assert.equal(state.lastTickAt,now.toISOString());
 assert.equal(JSON.parse(await readFile(path.join(root,'data','clock','ticks','clock-100-1.json'),'utf8')).child.runId,'204');
 await assert.rejects(tickClock({root,env,now,api:async()=>{throw new Error('Never called.');},commit:async()=>{}}),/claim/);
 await assert.rejects(readdir(path.join(root,'data','slot-reservations')),error=>error.code==='ENOENT');
});

test('expected child requires the exact immutable parent receipt and authoritative parent run',async t=>{
 const root=await fixture(t);const queued={...waiting,phase:'queued',expectedRunId:'200',generation:1,parentRunId:'100',parentRunAttempt:1,clockRunUrl:clockRunURL(200)};await saveState(root,queued);
 const parent={chainId:queued.chainId,githubRunId:'100',githubRunAttempt:1,child:{runId:'200',generation:1,githubRunUrl:clockRunURL(200)}};
 await mkdir(path.join(root,'data','clock','ticks'),{recursive:true});await writeFile(path.join(root,'data','clock','ticks',clockTickId(100)+'.json'),JSON.stringify(parent));
 const childEnv={...env,GITHUB_RUN_ID:'200',CLOCK_CHAIN_ID:queued.chainId,CLOCK_PARENT_RUN_ID:'100',CLOCK_PARENT_RUN_ATTEMPT:'1',CLOCK_GENERATION:'1'};
 const result=await claimClock({root,env:childEnv,now,api:async()=>source(100,'completed'),commit:async()=>{}});assert.equal(result.claimed,true);
 await saveState(root,queued);await assert.rejects(claimClock({root,env:childEnv,now,api:async()=>({...source(100,'completed'),head_branch:'other'}),commit:async()=>{}}),/untrusted/);
 await writeFile(path.join(root,'data','clock','ticks',clockTickId(100)+'.json'),JSON.stringify({...parent,child:{...parent.child,runId:'999'}}));await assert.rejects(claimClock({root,env:childEnv,now,api:async()=>source(100,'completed'),commit:async()=>{}}),/receipt/);
});

test('an exact tick-bound child can claim while its trusted parent has a pending post-tick tail',async t=>{
 const root=await fixture(t),queued={...waiting,phase:'queued',expectedRunId:'200',generation:1,parentRunId:'100',parentRunAttempt:1,clockRunUrl:clockRunURL(200)};
 const parent={chainId:queued.chainId,githubRunId:'100',githubRunAttempt:1,child:{runId:'200',generation:1,githubRunUrl:clockRunURL(200)}};
 const receiptFile=path.join(root,'data','clock','ticks',clockTickId(100)+'.json');
 await saveState(root,queued);await mkdir(path.dirname(receiptFile),{recursive:true});await writeFile(receiptFile,JSON.stringify(parent));
 const childEnv={...env,GITHUB_RUN_ID:'200',CLOCK_CHAIN_ID:queued.chainId,CLOCK_PARENT_RUN_ID:'100',CLOCK_PARENT_RUN_ATTEMPT:'1',CLOCK_GENERATION:'1'};
 let commits=0,dispatches=0;const api=async(endpoint,options={})=>{if(options.method&&options.method!=='GET')dispatches++;assert.match(endpoint,/actions\/runs\/100$/);return source(100,'pending');};
 assert.equal((await claimClock({root,env:childEnv,now,api,commit:async()=>commits++})).claimed,true);assert.equal(commits,1);assert.equal(dispatches,0);
 assert.equal((await claimClock({root,env:childEnv,now,api,commit:async()=>commits++})).claimed,false);assert.equal(commits,1);
 for(const change of [{id:99},{run_attempt:2},{repository:{full_name:'other/repo'}},{head_repository:{full_name:'other/repo'}},{head_branch:'other'},{path:'.github/workflows/other.yml'},{event:'push'},{status:'unknown'},{status:'queued'}]){
  await saveState(root,queued);const before=await readFile(path.join(root,'data','clock','state.json'),'utf8');
  await assert.rejects(claimClock({root,env:childEnv,now,api:async()=>({...source(100,'pending'),...change}),commit:async()=>commits++}),/untrusted/);
  assert.equal(await readFile(path.join(root,'data','clock','state.json'),'utf8'),before);
 }
 await saveState(root,queued);await writeFile(receiptFile,JSON.stringify({...parent,child:{...parent.child,generation:2}}));
 await assert.rejects(claimClock({root,env:childEnv,now,api,commit:async()=>commits++}),/receipt/);
 await rm(receiptFile);await assert.rejects(claimClock({root,env:childEnv,now,api,commit:async()=>commits++}));assert.equal(commits,1);assert.equal(dispatches,0);
});

test('healthy backup makes no writes, dispatches or cancellation',async t=>{
 const root=await fixture(t);await saveState(root,waiting);const before=await readFile(path.join(root,'data','clock','state.json'),'utf8');let calls=0;
 const result=await ensureClock({root,env:{...env,GITHUB_EVENT_NAME:'schedule'},now,api:async(endpoint)=>{calls++;assert.match(endpoint,/runs\/100$/);return source(100);},commit:async()=>{throw new Error('No commit expected.');}});
 assert.equal(result.restarted,false);assert.equal(calls,1);assert.equal(await readFile(path.join(root,'data','clock','state.json'),'utf8'),before);
});

test('stale backup fences before cancellation then dispatches and stores one exact replacement',async t=>{
 const root=await fixture(t);await saveState(root,waiting);const actions=[];
 const backupEnv={...env,GITHUB_EVENT_NAME:'schedule',GITHUB_RUN_ID:'900'};
 const result=await ensureClock({root,env:backupEnv,now:new Date('2026-10-11T06:00:00Z'),api:async(endpoint,options)=>{if(options.method==='POST'){actions.push(endpoint);if(endpoint.endsWith('/cancel')){const fenced=JSON.parse(await readFile(path.join(root,'data','clock','state.json'),'utf8'));assert.equal(fenced.phase,'fenced');return null;}return fakeDispatch(300);}return source(100);},commit:async value=>actions.push(value.message)});
 assert.equal(result.restarted,true);assert.equal(result.runId,'300');assert.match(actions[0],/fence/);assert.match(actions[1],/cancel/);assert.match(actions[2],/dispatches/);
 const replacement=JSON.parse(await readFile(path.join(root,'data','clock','state.json'),'utf8'));assert.equal(replacement.expectedRunId,'300');assert.equal(replacement.phase,'queued');assert.equal(replacement.chainId,'clock-restart-900-1');
 assert.equal(clockClaim({state:replacement,runId:'300',chainId:replacement.chainId,generation:'0',now}).claimed,true);
 await assert.rejects(tickClock({root,env,now:new Date('2026-10-11T06:00:00Z'),api:async()=>{throw new Error('Old tick must stop.');},commit:async()=>{}}),/claim/);
});

test('API failures leave the existing lease unchanged rather than spawn uncertain replacements',async t=>{
 const root=await fixture(t);await saveState(root,waiting);const before=await readFile(path.join(root,'data','clock','state.json'),'utf8');
 await assert.rejects(ensureClock({root,env,now:new Date('2026-10-11T06:00:00Z'),api:async()=>{throw new Error('Offline.');},commit:async()=>{throw new Error('No commit.');}}),/Offline/);
 assert.equal(await readFile(path.join(root,'data','clock','state.json'),'utf8'),before);
});

test('clock workflow claims before wait, uses no sleep and deploys receipt updates explicitly',async()=>{
 const workflow=await readFile('.github/workflows/clock.yml','utf8');assert.match(workflow,/group: while-you-sleep-clock/);assert.ok(workflow.indexOf('  claim:')<workflow.indexOf('  timer:'));assert.match(workflow,/environment:\n      name: clock\n      deployment: false/);assert.match(workflow,/needs\.claim\.outputs\.claimed == 'true'/);assert.match(workflow,/uses: \.\/\.github\/workflows\/pages\.yml/);assert.doesNotMatch(workflow,/run:[^\n]*\bsleep\s|codex-action|OPENAI_API_KEY/);
});

test('duplicate seed exits before waiting and never overwrites a healthy queued lease',async t=>{
 const root=await fixture(t);const queued={...waiting,phase:'queued'};await saveState(root,queued);const before=await readFile(path.join(root,'data','clock','state.json'),'utf8');let commits=0;
 const result=await claimClock({root,env:{...env,GITHUB_RUN_ID:'101'},now,api:async()=>source(100,'queued'),commit:async()=>commits++});assert.equal(result.claimed,false);assert.equal(commits,0);assert.equal(await readFile(path.join(root,'data','clock','state.json'),'utf8'),before);
});

test('an active trusted loop reservation does not receive another cheap clock dispatch',async t=>{
 const root=await fixture(t);await saveState(root,waiting);
 await mkdir(path.join(root,'data','slot-reservations'),{recursive:true});await writeFile(path.join(root,'data','slot-reservations','loop-77-1.json'),JSON.stringify({id:'loop-77-1',runId:'loop-77-1',slotId:'publish-2026-10-11-08-07',githubRepository:CLOCK_REPOSITORY,githubRunId:'77'}));
 const requests=[];let id=200;
 const receipt=await tickClock({root,env,now,api:async(endpoint,options)=>{requests.push(endpoint);return options.method==='POST'?fakeDispatch(id++):{...source(77,'in_progress'),path:'.github/workflows/loop.yml'};},commit:async()=>{}});
 assert.ok(!receipt.dispatches.some(row=>row.workflow==='loop.yml'));assert.ok(requests.some(endpoint=>endpoint.endsWith('/runs/77')));assert.ok(!requests.some(endpoint=>endpoint.endsWith('/loop.yml/dispatches')));
});

test('GitHub API uses structured stdin and suppresses private stdout/stderr on errors',async t=>{
 const root=await fixture(t);const executable=path.join(root,'gh');
 await writeFile(executable,"#!/bin/sh\ncat >/dev/null\necho 'fictional-private-auth-value'\necho 'fictional-private-stderr-value' >&2\nexit 1\n");await chmod(executable,0o755);
 const fakeEnv={...process.env,PATH:root+path.delimiter+process.env.PATH,GH_TOKEN:'fictional-test-only-token'};
 await assert.rejects(clockAPI(`repos/${CLOCK_REPOSITORY}/actions/workflows/clock.yml/dispatches`,{method:'POST',body:{ref:'main',inputs:{}},env:fakeEnv}),error=>error.message==='Clock GitHub API is unavailable.' && !error.message.includes('private'));
 assert.throws(()=>clockAPI('https://example.com/collect',{env:fakeEnv}),/endpoint/);
 await writeFile(executable,`#!/bin/sh\ncat >/dev/null\necho '${JSON.stringify(fakeDispatch(200))}'\n`);
 const result=await dispatchClockWorkflow('clock.yml',{}, {env:fakeEnv});assert.equal(result.runId,'200');
});

test('a newly claimed replacement does not inherit a stale timestamp that cancels its fresh wait',()=>{
 const stale={...waiting,lastTickAt:'2026-10-10T20:00:00Z'};
 const claim=clockClaim({state:stale,sourceRun:source(100,'completed'),runId:'101',now});assert.equal(claim.claimed,true);assert.equal(claim.state.lastTickAt,null);assert.equal(claim.state.claimedAt,now.toISOString());assert.equal(clockLiveness(claim.state,source(101,'waiting'),now).alive,true);
});

async function blockedClockFixture(t){
 const root=await fixture(t);
 const state={...waiting,expectedRunId:'200',phase:'queued',generation:1,parentRunId:'100',parentRunAttempt:1,lastTickAt:'2026-10-11T05:00:00Z',clockRunUrl:clockRunURL(200)};
 const receipt={id:'clock-100-1',kind:'clock-tick',chainId:state.chainId,githubRunId:'100',githubRunAttempt:1,child:{runId:'200',githubRunUrl:clockRunURL(200),generation:1}};
 await saveState(root,state);await mkdir(path.join(root,'data','clock','ticks'),{recursive:true});await writeFile(path.join(root,'data','clock','ticks','clock-100-1.json'),JSON.stringify(receipt));
 return {root,state,receipt};
}

test('stale queued child recovery fences and cancels its exact active blocking parent before replacement',async t=>{
 const {root}=await blockedClockFixture(t);const actions=[];
 const result=await ensureClock({root,env:{...env,GITHUB_RUN_ID:'900'},now:new Date('2026-10-11T06:00:00Z'),api:async(endpoint,options)=>{
   if(options.method==='POST'){
    actions.push(endpoint);
    if(endpoint.endsWith('/cancel')){assert.equal(JSON.parse(await readFile(path.join(root,'data','clock','state.json'),'utf8')).phase,'fenced');return null;}
    return fakeDispatch(300);
   }
   return endpoint.endsWith('/runs/200')?source(200,'queued'):source(100,'in_progress');
  },commit:async value=>actions.push(value.message)});
 assert.equal(result.restarted,true);assert.match(actions[0],/fence/);assert.ok(actions[1].endsWith('/runs/200/cancel'));assert.ok(actions[2].endsWith('/runs/100/cancel'));assert.ok(actions[3].endsWith('/clock.yml/dispatches'));
});

test('unrelated parent receipt or metadata cannot cancel a parent or create a replacement',async t=>{
 for(const mode of ['receipt','metadata']){
  const {root,receipt}=await blockedClockFixture(t);const before=await readFile(path.join(root,'data','clock','state.json'),'utf8');let mutations=0;
  if(mode==='receipt')await writeFile(path.join(root,'data','clock','ticks','clock-100-1.json'),JSON.stringify({...receipt,child:{...receipt.child,runId:'999'}}));
  await assert.rejects(ensureClock({root,env,now:new Date('2026-10-11T06:00:00Z'),api:async(endpoint,options)=>{if(options.method==='POST'){mutations++;throw new Error('Never mutate.');}return endpoint.endsWith('/runs/200')?source(200,'queued'):{...source(100,'in_progress'),head_branch:'unrelated'};},commit:async()=>mutations++}),/parent/);
  assert.equal(mutations,0);assert.equal(await readFile(path.join(root,'data','clock','state.json'),'utf8'),before);
 }
});

test('natural parent completion during cancellation permits safe replacement only after authoritative confirmation',async t=>{
 const {root}=await blockedClockFixture(t);let parentReads=0;const mutations=[];
 const result=await ensureClock({root,env:{...env,GITHUB_RUN_ID:'900'},now:new Date('2026-10-11T06:00:00Z'),api:async(endpoint,options)=>{
   if(options.method==='POST'){
    mutations.push(endpoint);
    if(endpoint.endsWith('/runs/100/cancel'))throw new Error('Already completed.');
    if(endpoint.endsWith('/cancel'))return null;
    return fakeDispatch(300);
   }
   if(endpoint.endsWith('/runs/200'))return source(200,'queued');
   parentReads++;return source(100,parentReads===1?'in_progress':'completed');
  },commit:async()=>{}});
 assert.equal(result.restarted,true);assert.equal(parentReads,2);assert.ok(mutations.at(-1).endsWith('/clock.yml/dispatches'));
});

test('pending and requested singleton children recover their active parent just like queued children',async t=>{
 for(const childStatus of ['pending','requested']){
  const {root}=await blockedClockFixture(t);const cancelled=[];
  const result=await ensureClock({root,env:{...env,GITHUB_RUN_ID:'900'},now:new Date('2026-10-11T06:00:00Z'),api:async(endpoint,options)=>{
    if(options.method==='POST'){
     if(endpoint.endsWith('/cancel')){cancelled.push(endpoint);return null;}
     return fakeDispatch(300);
    }
    return endpoint.endsWith('/runs/200')?source(200,childStatus):source(100,'in_progress');
   },commit:async()=>{}});
  assert.equal(result.restarted,true);assert.deepEqual(cancelled.map(endpoint=>endpoint.match(/runs\/(\d+)\/cancel$/)[1]),['200','100']);
 }
});
