import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CLOCK_SOURCE,verifyClockDispatch,validClockProvenance,clockReceiptMatches } from '../lib/clock-provenance.mjs';
import { prepareLoop } from '../scripts/prepare-loop.mjs';
import { prepareScheduledJob,latestScheduledSlot,scheduledDecision,trustedScheduledMetadata } from '../scripts/prepare-scheduled-job.mjs';
import { schedulerProof } from '../lib/scheduler-proof.mjs';

const repository='xndanius/while-you-sleep',runURL=id=>`https://github.com/${repository}/actions/runs/${id}`;
const now=new Date('2026-10-11T05:18:00Z');
function fixtures(kind='loop') {
  const env={RUN_ID:`${kind}-222-1`,GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:repository,GITHUB_REF:'refs/heads/main',GITHUB_RUN_ID:'222',GITHUB_RUN_ATTEMPT:'1',GITHUB_ACTOR:'github-actions[bot]',GITHUB_TRIGGERING_ACTOR:'github-actions[bot]',GITHUB_EVENT_NAME:'workflow_dispatch',CLOCK_TICK_RUN_ID:'111',CLOCK_PARENT_ATTEMPT:'1',CLOCK_DISPATCH_ID:`clock-111-1-${kind}`};
  const receipt={id:'clock-111-1',kind:'clock-tick',chainId:'clock-100-1',generation:1,githubRunId:'111',githubRunAttempt:1,githubRunUrl:runURL('111'),environment:'clock',waitMinutes:15,claimedAt:'2026-10-11T05:00:00Z',tickedAt:'2026-10-11T05:15:00Z',dispatches:[{workflow:`${kind}.yml`,dispatchId:env.CLOCK_DISPATCH_ID,runId:'222',githubRunUrl:runURL('222'),requestedAt:'2026-10-11T05:15:00Z'}]};
  const parent={id:111,repository:{full_name:repository},head_repository:{full_name:repository},head_branch:'main',head_sha:'a'.repeat(40),path:'.github/workflows/clock.yml',event:'workflow_dispatch',run_attempt:1,status:'completed'};
  const child={...parent,id:222,path:`.github/workflows/${kind}.yml`,status:'in_progress',actor:{login:'github-actions[bot]'},triggering_actor:{login:'github-actions[bot]'}};
  return {env,receipt,parent,child};
}
function apiFor({parent,child}) {
  return async endpoint=>{
    assert.ok([`repos/${repository}/actions/runs/111`,`repos/${repository}/actions/runs/222`].includes(endpoint));
    return JSON.stringify(endpoint.endsWith('/111')?parent:child);
  };
}
async function fixtureRoot(t,receipt) {
  const root=await mkdtemp(path.join(os.tmpdir(),'wys-clock-provenance-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const directory=path.join(root,'data','clock','ticks');await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,receipt.id+'.json'),JSON.stringify(receipt));
  return root;
}

test('clock inputs alone never prove automation; receipt and authoritative parent and child identities are required',async t=>{
  const fixture=fixtures(),{env,receipt,parent}=fixture,root=await fixtureRoot(t,receipt),calls=[];
  const apiGet=async endpoint=>{calls.push(endpoint);return apiFor(fixture)(endpoint);};
  const clock=await verifyClockDispatch({kind:'loop',root,env,now,apiGet});
  assert.deepEqual(calls,[`repos/${repository}/actions/runs/111`,`repos/${repository}/actions/runs/222`]);
  assert.equal(clock.source,CLOCK_SOURCE);assert.equal(clock.runId,'222');
  assert.equal(clock.runAttempt,1);assert.equal(clock.actor,env.GITHUB_ACTOR);assert.equal(clock.triggeringActor,env.GITHUB_TRIGGERING_ACTOR);
  assert.equal(validClockProvenance(clock,{kind:'loop',runId:'222'}),true);
  assert.equal(clockReceiptMatches(clock,receipt),true);
  assert.equal(await verifyClockDispatch({kind:'loop',root,env:{},apiGet}),null);
  for(const extra of [{GITHUB_RUN_ID:'333'},{CLOCK_DISPATCH_ID:'clock-111-1-research'},{GITHUB_EVENT_NAME:'schedule'},{GITHUB_REF:'refs/heads/other'},{GITHUB_ACTIONS:'false'},{CLOCK_PARENT_ATTEMPT:'2'}]) {
    await assert.rejects(()=>verifyClockDispatch({kind:'loop',root,env:{...env,...extra},now,apiGet}));
  }
  for(const extra of [{head_branch:'other'},{path:'.github/workflows/loop.yml'},{run_attempt:2},{event:'schedule'},{status:'unknown'},{head_repository:{full_name:'other/repo'}}]) {
    await assert.rejects(()=>verifyClockDispatch({kind:'loop',root,env,now,apiGet:apiFor({...fixture,parent:{...parent,...extra}})}),/GitHub did not verify/);
  }
  await writeFile(path.join(root,'data','clock','ticks',receipt.id+'.json'),JSON.stringify({...receipt,tickedAt:'2026-10-11T05:01:00Z'}));
  await assert.rejects(()=>verifyClockDispatch({kind:'loop',root,env,now,apiGet}),/parent tick/);
});

test('a committed exact clock dispatch remains verified while its parent waits for a later Pages job',async t=>{
  const fixture=fixtures(),{env,receipt,parent}=fixture,root=await fixtureRoot(t,receipt);
  for(const status of ['queued','requested','pending','waiting','in_progress','completed']) {
    const clock=await verifyClockDispatch({kind:'loop',root,env,now,apiGet:apiFor({...fixture,parent:{...parent,status}})});
    assert.equal(clock.verified,true,status);
    assert.equal(clockReceiptMatches(clock,receipt),true,status);
  }
  await writeFile(path.join(root,'data','clock','ticks',receipt.id+'.json'),JSON.stringify({...receipt,tickedAt:'2026-10-11T05:01:00Z'}));
  await assert.rejects(()=>verifyClockDispatch({kind:'loop',root,env,now,apiGet:apiFor({...fixture,parent:{...parent,status:'waiting'}})}),/parent tick/);
});

test('retained clock markers cannot authorize a human rerun or an unverified child identity',async t=>{
  const fixture=fixtures(),{env,receipt,child}=fixture,root=await fixtureRoot(t,receipt);
  for(const extra of [{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_RUN_ATTEMPT:''},{GITHUB_ACTOR:'xndanius'},
    {GITHUB_TRIGGERING_ACTOR:'xndanius'},{GITHUB_ACTOR:undefined},{GITHUB_TRIGGERING_ACTOR:undefined}]) {
    await assert.rejects(()=>verifyClockDispatch({kind:'loop',root,env:{...env,...extra},now,
      apiGet:async()=>{assert.fail('Untrusted runner identity must be rejected before API access.');}}),/Untrusted clock dispatch context/);
  }
  for(const extra of [{id:333},{run_attempt:2},{run_attempt:'1'},{head_branch:'other'},
    {path:'.github/workflows/improve.yml'},{event:'schedule'},{status:'unknown'},
    {repository:{full_name:'other/repo'}},{head_repository:{full_name:'other/repo'}},
    {actor:{login:'xndanius'}},{triggering_actor:{login:'xndanius'}},{actor:null},{triggering_actor:null}]) {
    await assert.rejects(()=>verifyClockDispatch({kind:'loop',root,env,now,
      apiGet:apiFor({...fixture,child:{...child,...extra}})}),/exact first-attempt clock child/);
  }
  await assert.rejects(()=>verifyClockDispatch({kind:'loop',root,env,now,
    apiGet:async endpoint=>{if(endpoint.endsWith('/222'))throw new Error('GitHub unavailable');return apiFor(fixture)(endpoint);}}),/GitHub unavailable/);
});

test('clock-launched auxiliary gates retain workflow_dispatch and suppress completed work instead of forcing diagnostics',async t=>{
  const fixture=fixtures('research'),{env,receipt}=fixture,root=await fixtureRoot(t,receipt);
  env.GITHUB_OUTPUT=path.join(root,'verified-auxiliary-output');
  const slot=latestScheduledSlot('research',now),completion={id:'research-333-1',runId:'research-333-1',...slot,eventName:'workflow_dispatch',scheduleStatus:'completed'};
  await mkdir(path.join(root,'data','research'),{recursive:true});await writeFile(path.join(root,'data','research',completion.id+'.json'),JSON.stringify(completion));
  const result=await prepareScheduledJob({kind:'research',root,env,now,apiGet:apiFor(fixture)});
  assert.equal(result.due,false);assert.equal(result.reason,'scheduled_slot_completed');assert.equal(result.eventName,'workflow_dispatch');
  assert.equal(result.clock.runId,'222');assert.equal(result.clock.workflow,'research.yml');
  assert.match(await readFile(env.GITHUB_OUTPUT,'utf8'),/clock_verified=true\n/);
  assert.deepEqual(JSON.parse(await readFile(path.join(root,'data','research',completion.id+'.json'),'utf8')),completion);
  const metadata=trustedScheduledMetadata('research',{...env,SCHEDULED_JOB_KEY:result.jobKey,SCHEDULED_AT:result.scheduledAt,SCHEDULED_CLOCK_JSON:JSON.stringify(result.clock)});
  assert.equal(metadata.eventName,'workflow_dispatch');assert.deepEqual(metadata.clock,result.clock);
  assert.throws(()=>trustedScheduledMetadata('research',{...env,GITHUB_RUN_ID:'333',SCHEDULED_CLOCK_JSON:JSON.stringify(result.clock)}),/clock gate metadata/);
  const diagnostic=scheduledDecision({kind:'research',eventName:'workflow_dispatch',now,completions:[completion]});
  assert.equal(diagnostic.due,true);assert.equal(diagnostic.reason,'manual_diagnostic');
});

test('verified clock publication gates preserve ordinary cap and duplicate guards and never bootstrap',async t=>{
  const fixture=fixtures(),{env,receipt}=fixture,root=await fixtureRoot(t,receipt);
  env.GITHUB_OUTPUT=path.join(root,'verified-loop-output');
  const gate=await prepareLoop({root,env:{...env,BOOTSTRAP:'true'},now,apiGet:apiFor(fixture)});
  assert.equal(gate.eventName,'workflow_dispatch');assert.equal(gate.bootstrap,false);assert.equal(gate.targetCount,1);
  assert.equal(gate.clock.source,CLOCK_SOURCE);assert.equal(gate.slotId,'publish-2026-10-11-08-07');
  assert.match(await readFile(env.GITHUB_OUTPUT,'utf8'),/clock_verified=true\n/);
  await mkdir(path.join(root,'data','posts'),{recursive:true});
  await writeFile(path.join(root,'data','posts','published.json'),JSON.stringify({id:'published',publishedAt:'2026-10-11T05:17:00Z',scheduling:{slotId:gate.slotId}}));
  const repeated=await prepareLoop({root,env,now,apiGet:apiFor(fixture)});
  assert.equal(repeated.decision,'skip');assert.equal(repeated.reason,'slot_already_published');
  assert.equal(repeated.eventName,'workflow_dispatch');
});

test('ordinary manual diagnostics never gain bot access from a claimed clock flag',async t=>{
  const {env,receipt}=fixtures(),root=await fixtureRoot(t,receipt);
  const manual={...env,CLOCK_TICK_RUN_ID:'',CLOCK_PARENT_ATTEMPT:'',CLOCK_DISPATCH_ID:'',CLOCK_VERIFIED:'true',GITHUB_OUTPUT:path.join(root,'manual-loop-output')};
  const result=await prepareLoop({root,env:manual,now,apiGet:async()=>{throw new Error('A manual gate must not verify a claimed bot flag.');}});
  assert.equal(result.clock,undefined);assert.equal(result.eventName,'workflow_dispatch');
  assert.match(await readFile(manual.GITHUB_OUTPUT,'utf8'),/clock_verified=false\n/);
  const auxiliary={...manual,RUN_ID:'improve-222-1',GITHUB_OUTPUT:path.join(root,'manual-auxiliary-output')};
  const diagnostic=await prepareScheduledJob({kind:'improve',root,env:auxiliary,now});
  assert.equal(diagnostic.reason,'manual_diagnostic');assert.equal(diagnostic.clock,undefined);
  assert.match(await readFile(auxiliary.GITHUB_OUTPUT,'utf8'),/clock_verified=false\n/);
});

test('the fixed curator dispatch requires exact first-attempt bot child identity and receipt binding',async t=>{
  const fixture=fixtures('curate'),{env,receipt,child}=fixture,root=await fixtureRoot(t,receipt);
  const clock=await verifyClockDispatch({kind:'curate',root,env,now,apiGet:apiFor(fixture)});
  assert.equal(clock.workflow,'curate.yml');assert.equal(clock.dispatchId,'clock-111-1-curate');
  assert.equal(clock.runAttempt,1);assert.equal(clock.actor,'github-actions[bot]');
  assert.equal(clock.triggeringActor,'github-actions[bot]');
  assert.equal(validClockProvenance(clock,{kind:'curate',runId:'222'}),true);
  assert.equal(clockReceiptMatches(clock,receipt),true);
  assert.equal(validClockProvenance({...clock,workflow:'arbitrary.yml'}),false);
  for(const extra of [{path:'.github/workflows/loop.yml'},{run_attempt:2},{event:'schedule'},
    {actor:{login:'xndanius'}},{triggering_actor:{login:'xndanius'}},
    {head_branch:'other'},{repository:{full_name:'other/repo'}},{id:333}]){
    await assert.rejects(verifyClockDispatch({kind:'curate',root,env,now,
      apiGet:apiFor({...fixture,child:{...child,...extra}})}),/exact first-attempt clock child/);
  }
  for(const extra of [{workflow:'loop.yml'},{runId:'333'},{githubRunUrl:runURL('333')},
    {dispatchId:'clock-111-1-arbitrary'},{requestedAt:'2026-10-11T05:14:00Z'}]){
    await writeFile(path.join(root,'data','clock','ticks',receipt.id+'.json'),JSON.stringify({...receipt,dispatches:[{...receipt.dispatches[0],...extra}]}));
    await assert.rejects(verifyClockDispatch({kind:'curate',root,env,now,
      apiGet:async()=>assert.fail('A forged receipt must fail before authoritative API calls.')}),/exact dispatched run/);
  }
});

test('curator human diagnostics remain manual and forged clock markers never authorize arbitrary targets',async()=>{
  const {env}=fixtures('curate');
  const apiGet=async()=>assert.fail('No API call may upgrade an ordinary human diagnostic or invalid target.');
  const manual={...env,GITHUB_ACTOR:'xndanius',GITHUB_TRIGGERING_ACTOR:'xndanius',
    CLOCK_TICK_RUN_ID:'',CLOCK_PARENT_ATTEMPT:'',CLOCK_DISPATCH_ID:'',CLOCK_VERIFIED:'true'};
  assert.equal(await verifyClockDispatch({kind:'curate',env:manual,apiGet}),null);
  for(const extra of [{GITHUB_ACTOR:'xndanius'},{GITHUB_TRIGGERING_ACTOR:'xndanius'},
    {GITHUB_RUN_ATTEMPT:'2'},{GITHUB_EVENT_NAME:'schedule'}]){
    await assert.rejects(verifyClockDispatch({kind:'curate',env:{...env,...extra},apiGet}),/Untrusted clock dispatch context/);
  }
  for(const kind of ['arbitrary','curate.yml','../curate','social']){
    await assert.rejects(verifyClockDispatch({kind,env:{...env,CLOCK_DISPATCH_ID:`clock-111-1-${kind}`},apiGet}),/Untrusted clock dispatch context/);
  }
});

test('clock publication proof requires its trusted loop and exact clock receipt without claiming a schedule event',async t=>{
  const fixture=fixtures(),{env,receipt}=fixture,root=await fixtureRoot(t,receipt);
  const clock=await verifyClockDispatch({kind:'loop',root,env,now,apiGet:apiFor(fixture)});
  const run={id:'loop-222-1',type:'loop',eventName:'workflow_dispatch',startedAt:'2026-10-11T05:18:00Z',githubRunUrl:runURL('222'),published:['post'],modelExecuted:true,scheduling:{clock}};
  const post={id:'post',runId:run.id,githubRunUrl:run.githubRunUrl,publishedAt:'2026-10-11T05:22:00Z',eventName:'workflow_dispatch'};
  assert.equal(schedulerProof([],[run],[post]).state,'unverified','claimed verified metadata is insufficient without its committed tick');
  const proof=schedulerProof([],[run],[post],[receipt]);
  assert.equal(proof.state,'publication_observed');assert.equal(proof.publicationSource,CLOCK_SOURCE);
  assert.equal(proof.scheduledRunCount,0);assert.equal(proof.lastScheduledPublicationAt,null);
  assert.equal(proof.lastAutomaticPostId,'post');assert.equal(proof.lastClockLoopRunUrl,runURL('222'));
  assert.equal(proof.clockTickCount,1);assert.equal(proof.clockRunCount,1);
  assert.equal(schedulerProof([],[],[post],[receipt]).state,'trigger_observed','posts cannot supply their own loop proof');
  for(const changed of [{...post,runId:'loop-333-1'},{...post,id:'unlisted'},{...post,githubRunUrl:runURL('333')}]) {
    assert.equal(schedulerProof([],[run],[changed],[receipt]).state,'loop_observed');
  }
  const forged={...receipt,dispatches:[{...receipt.dispatches[0],runId:'333',githubRunUrl:runURL('333')}]};
  assert.equal(schedulerProof([],[run],[post],[forged]).state,'trigger_observed');
});

test('historical exact attempt-1 clock proofs remain valid while retained rerun metadata fails closed',async t=>{
  const fixture=fixtures(),{env,receipt}=fixture,root=await fixtureRoot(t,receipt);
  const verified=await verifyClockDispatch({kind:'loop',root,env,now,apiGet:apiFor(fixture)});
  const {runAttempt,actor,triggeringActor,...legacy}=verified;
  const run={id:'loop-222-1',type:'loop',eventName:'workflow_dispatch',startedAt:now.toISOString(),githubRunUrl:runURL('222'),published:['post'],clock:legacy};
  const post={id:'post',runId:run.id,githubRunUrl:run.githubRunUrl,publishedAt:'2026-10-11T05:22:00Z'};
  assert.equal(validClockProvenance(legacy),true);
  assert.equal(schedulerProof([],[run],[post],[receipt]).state,'publication_observed');
  for(const changed of [{...run,id:'loop-222-2'},{...run,id:'loop-333-1'},{...run,runId:'loop-222-2'},
    {...run,runAttempt:2},{...run,githubRunAttempt:2},{...run,id:'improve-222-1'}]) {
    const proof=schedulerProof([],[changed],[{...post,runId:changed.id}],[receipt]);
    assert.equal(proof.state,'trigger_observed');assert.equal(proof.clockRunCount,0);
    assert.equal(proof.lastAutomaticPublicationAt,null);assert.equal(proof.lastClockLoopAt,null);
  }
  for(const changed of [{...verified,runAttempt:2},{...verified,actor:'xndanius'},
    {...verified,triggeringActor:'xndanius'},{...legacy,runAttempt:1},{...legacy,actor:'github-actions[bot]'}]) {
    assert.equal(validClockProvenance(changed),false);
    assert.equal(schedulerProof([],[{...run,clock:changed}],[post],[receipt]).state,'trigger_observed');
  }
});

test('clock backup writes are confined to trusted workflow gates and never model jobs',async()=>{
  const read=name=>readFile(new URL(`../.github/workflows/${name}.yml`,import.meta.url),'utf8');
  const job=(workflow,name)=>workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [A-Za-z][A-Za-z_-]*:|$(?![\\s\\S]))`,'m'))?.[1]||'';
  const loop=await read('loop'),improve=await read('improve');
  for(const workflow of [loop,improve,await read('research'),await read('measure')]) {
    for(const input of ['clock_tick_run_id','clock_dispatch_id','clock_parent_attempt'])assert.match(workflow,new RegExp(`^      ${input}:`,'m'));
    assert.match(workflow,/node scripts\/ensure-clock\.mjs/);
    assert.match(workflow,/CLOCK_TICK_RUN_ID: \$\{\{ inputs\.clock_tick_run_id/);
  }
  for(const [workflow,names] of [[loop,['writer','checker','repair','final_check']],[improve,['propose','trials','grade']]]) {
    assert.match(workflow,/^permissions:\n  contents: read\n/m);
    for(const name of names) {
      const text=job(workflow,name);
      assert.doesNotMatch(text,/actions: write|GH_TOKEN:|contents: write/);
      assert.match(text,/needs: (?:gate|\[gate,)/,'every model job must consume the trusted gate directly');
      assert.match(text,/allow-bot-users: \$\{\{ needs\.gate\.outputs\.clock_verified == 'true' && 'github-actions\[bot\]' \|\| '' \}\}/);
      assert.equal((text.match(/allow-bot-users:/g)||[]).length,1,'only the explicit trusted bot is allowed');
      assert.doesNotMatch(text,/allow-bots:|allow-users:/,'no broad bot or user override');
      assert.match(text,/safety-strategy: drop-sudo/);
      assert.match(text,/permission-profile: ':workspace'/);
    }
    assert.match(job(workflow,'gate'),/actions: write/);
    assert.match(job(workflow,'gate'),/group: while-you-sleep-record/);
    assert.match(job(workflow,'gate'),/clock_verified: \$\{\{ steps\.(?:slot|gate)\.outputs\.clock_verified \}\}/);
  }
  for(const name of ['research','measure']) {
    const workflow=await read(name);
    assert.match(job(workflow,'ensure-clock'),/contents: write\n      actions: write/);
    assert.doesNotMatch(job(workflow,name),/actions: write/);
  }
});
