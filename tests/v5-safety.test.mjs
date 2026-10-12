import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {ROOT,sha256,stableJSON} from '../lib/storage.mjs';
import {V5_BASELINE,trustedAutomaticLoop,v5RunEligibility,safetyDecision,rollbackV5} from '../lib/v5-safety.mjs';
import {verifyV5Safety} from '../scripts/verify-v5-safety.mjs';
const config={schema:1,id:'v5-2026-10-12',state:'active',activatedAt:'2026-10-12T12:00:00.000Z',baselineCommit:V5_BASELINE,morningCodePath:'data/maintenance/v5-morning-code.json',morningSourcesPath:'data/maintenance/v5-morning-sources.json'};
function sample(id='123'){
 const run={id:Number(id),repository:{full_name:'xndanius/while-you-sleep'},head_repository:{full_name:'xndanius/while-you-sleep',fork:false},head_branch:'main',path:'.github/workflows/loop.yml',run_attempt:1,event:'schedule',actor:{login:'github-actions[bot]'},triggering_actor:{login:'github-actions[bot]'},run_started_at:'2026-10-12T12:10:00Z',html_url:`https://github.com/xndanius/while-you-sleep/actions/runs/${id}`,status:'completed',conclusion:'success'};
 const scheduling={id:`loop-${id}-1`,runId:`loop-${id}-1`,githubRunId:id,githubRunUrl:run.html_url,decision:'run',eventName:'schedule',requestedAt:'2026-10-12T12:10:00.000Z'};
 const selection={schema:1,type:'learning-selection',id:scheduling.id,runId:scheduling.id,createdAt:'2026-10-12T12:11:00.000Z',producer:{repository:'xndanius/while-you-sleep',runId:id,runAttempt:1,workflow:'loop.yml',stage:'pre_model',headSha:'a'.repeat(40)}};
 return {run,scheduling,selection,config,codeConfig:config};
}
test('only exact activated automatic model reservations count; cheap skips, preactivation, human and rerun inputs do not',()=>{
 const f=sample();assert.equal(v5RunEligibility(f.run,f).eligible,true);
 for(const change of [v=>v.run.run_attempt=2,v=>v.run.head_repository.fork=true,v=>v.run.repository.full_name='other/repo',v=>v.run.head_branch='other',v=>v.run.path='.github/workflows/improve.yml',v=>v.scheduling.decision='skip',v=>v.run.run_started_at='2026-10-12T11:59:00Z',v=>v.scheduling.requestedAt='2026-10-12T11:59:00.000Z',v=>v.codeConfig={...config,activatedAt:'2026-10-12T11:59:00.000Z'},v=>v.selection.producer.runId='999']){const v=structuredClone(f);change(v);assert.equal(v5RunEligibility(v.run,v).eligible,false);}
 const missing=sample();delete missing.selection;assert.equal(v5RunEligibility(missing.run,missing).eligible,true,'a reserved V5 writer failure before selector persistence cannot evade rollback');
 const manual=sample();manual.run.event='workflow_dispatch';manual.scheduling.eventName='workflow_dispatch';assert.equal(trustedAutomaticLoop(manual.run,manual),false,'clock flags alone do not authorize automation');
});
test('first two are chronological, failure includes Pages or cancellation, later failures cannot trigger rollback',()=>{
 const row=(id,startedAt,conclusion)=>({eligible:true,runId:`loop-${id}-1`,githubRunId:id,startedAt,conclusion,proof:'pre_model_selection_and_reserved_gate'});
 const first=row('1','2026-10-12T12:10:00Z','success'),second=row('2','2026-10-12T13:10:00Z','success'),third=row('3','2026-10-12T14:10:00Z','failure');
 assert.equal(safetyDecision([third,second,first]).state,'verified');assert.equal(safetyDecision([first]).state,'awaiting_first_two');assert.equal(safetyDecision([first,{...second,conclusion:null}]).state,'awaiting_first_two');
 for(const conclusion of ['failure','cancelled','timed_out'])assert.equal(safetyDecision([first,{...second,conclusion}]).failedRunId,second.runId);
});
test('a clock-dispatched model reservation needs its exact waited receipt and authoritative bot parent and child',()=>{
 const f=sample();f.run.event='workflow_dispatch';f.scheduling.eventName='workflow_dispatch';
 const clock={source:'github-environment-clock',verified:true,tickId:'clock-99-1',clockRunId:'99',parentAttempt:1,clockRunUrl:'https://github.com/xndanius/while-you-sleep/actions/runs/99',dispatchId:'clock-99-1-loop',runId:'123',workflow:'loop.yml',runAttempt:1,actor:'github-actions[bot]',triggeringActor:'github-actions[bot]',tickedAt:'2026-10-12T12:15:00.000Z',requestedAt:'2026-10-12T12:15:00.000Z',verifiedAt:'2026-10-12T12:16:00.000Z'};
 f.scheduling.clock=clock;f.receipt={kind:'clock-tick',id:'clock-99-1',githubRunId:'99',githubRunAttempt:1,githubRunUrl:clock.clockRunUrl,environment:'clock',waitMinutes:15,claimedAt:'2026-10-12T12:00:00.000Z',tickedAt:clock.tickedAt,dispatches:[{dispatchId:clock.dispatchId,workflow:'loop.yml',runId:'123',githubRunUrl:f.run.html_url,requestedAt:clock.requestedAt}]};
 f.parent={id:99,repository:f.run.repository,head_repository:f.run.head_repository,head_branch:'main',path:'.github/workflows/clock.yml',event:'workflow_dispatch',run_attempt:1,actor:f.run.actor,triggering_actor:f.run.triggering_actor};
 assert.equal(trustedAutomaticLoop(f.run,f),true);
 for(const change of [v=>v.run.actor.login='xndanius',v=>v.run.triggering_actor.login='xndanius',v=>v.parent.actor.login='xndanius',v=>v.receipt.dispatches[0].runId='124',v=>v.receipt.claimedAt='2026-10-12T12:14:00.000Z',v=>v.scheduling.clock.runAttempt=2]){const v=structuredClone(f);change(v);assert.equal(trustedAutomaticLoop(v.run,v),false);}
});
function git(root,args){const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();}
async function write(root,file,value){await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.writeFile(path.join(root,file),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');}
test('rollback appends restored inventory, archives incompatible receipts, and preserves posts, clock and already-spent daily probes',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'wys-v5-safety-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));git(root,['init','-b','main']);git(root,['config','user.name','Test']);git(root,['config','user.email','test@example.org']);git(root,['fetch','--depth=1',ROOT,V5_BASELINE]);
 const morning=JSON.parse(await fs.readFile(path.join(ROOT,config.morningCodePath))),morningSources=JSON.parse(await fs.readFile(path.join(ROOT,config.morningSourcesPath)));
 await write(root,config.morningCodePath,morning);await write(root,config.morningSourcesPath,morningSources);await write(root,'RULES.md','Changed V5 rules');await write(root,'lib/added-v5.mjs','export const changed=true;');
 await write(root,'data/sources/registry.json',{...morningSources,sources:[...morningSources.sources,{id:'new-demand',kind:'jobtech-demand'}]});await write(root,'data/posts/new.json',{id:'new',title:'Preserve this checked publication'});await write(root,'data/clock/state.json',{chainId:'same-active-chain'});
 await write(root,'data/source-scans/v5.json',{id:'v5',definitions:[{id:'new-demand',kind:'jobtech-demand'}]});await write(root,'data/source-attributions/v5.json',{runId:'v5'});await write(root,'data/source-changes/new.json',{id:'new',sourceId:'new-demand'});
 await write(root,'data/source-changes/quota.json',{id:'quota',sourceId:'new-demand'});await write(root,'data/source-discovery/source-discovery-2026-10-12-3.json',{changeId:'quota',quotaAfter:0});await write(root,'data/source-evolution/source-evolution-2026-10-12.json',{changeIds:[],probes:[]});
 git(root,['add','.']);git(root,['commit','-m','Current fixture']);const before=git(root,['rev-parse','HEAD']);
 const decision={state:'rollback_required',failedRunId:'loop-123-1',runs:[{runId:'loop-123-1',startedAt:'2026-10-12T12:10:00Z',conclusion:'failure',proof:'pre_model_selection_and_reserved_gate'}]};
 const result=await rollbackV5({root,config,decision,now:'2026-10-12T14:00:00.000Z'});assert.equal(result.alreadyRecorded,false);assert.equal(result.receipt.restoredCodeFiles,154);assert.equal(git(root,['rev-parse','HEAD']),before,'restoration does not reset or rewrite Git history');
 assert.equal(sha256(await fs.readFile(path.join(root,'RULES.md'))),morning.files['RULES.md']);await assert.rejects(fs.readFile(path.join(root,'lib/added-v5.mjs')),{code:'ENOENT'});assert.equal(JSON.parse(await fs.readFile(path.join(root,'data/posts/new.json'))).id,'new');assert.equal(JSON.parse(await fs.readFile(path.join(root,'data/clock/state.json'))).chainId,'same-active-chain');
 assert.equal(JSON.parse(await fs.readFile(path.join(root,'data/sources/registry.json'))).sources.length,morningSources.sources.length);assert.equal(result.receipt.archived.length,3);for(const archive of result.receipt.archived)assert.equal(sha256(await fs.readFile(path.join(root,archive.to))),archive.sha256);
 assert.equal(JSON.parse(await fs.readFile(path.join(root,'data/source-discovery/source-discovery-2026-10-12-3.json'))).quotaAfter,0);assert.equal(JSON.parse(await fs.readFile(path.join(root,'data/source-changes/quota.json'))).id,'quota');
 assert.equal((await rollbackV5({root,config,decision,now:'2026-10-12T14:01:00.000Z'})).alreadyRecorded,true);
});
test('freeze refuses rollback code mutations at or after 18:00 Vilnius before reading or changing files',async()=>{
 for(const now of ['2026-10-12T15:00:00.000Z','2026-10-13T13:00:00.000Z'])await assert.rejects(rollbackV5({root:'/does-not-exist',config,decision:{state:'rollback_required',failedRunId:'loop-123-1'},now}),/freeze/);
});
test('safety workflow has no model or dispatch authority and shares the record lock',async()=>{
 const workflow=await fs.readFile(new URL('../.github/workflows/v5-safety.yml',import.meta.url),'utf8');assert.match(workflow,/workflow_run:/);assert.match(workflow,/workflows: \[Codex autonomous loop\]/);assert.match(workflow,/group: while-you-sleep-record/);assert.match(workflow,/actions: read/);assert.doesNotMatch(workflow,/actions: write|codex-action@|OPENAI_API_KEY|workflow_dispatch/);assert.match(workflow,/uses: \.\/\.github\/workflows\/pages.yml/);
});
test('Pages checks retain the morning commit required by the actual rollback inventory test',async()=>{
 const workflow=await fs.readFile(new URL('../.github/workflows/pages.yml',import.meta.url),'utf8');
 assert.match(workflow,/fetch-depth: 0/);
 assert.match(workflow,/npm run check && npm test && npm run build/);
});
test('terminal first-two proof prevents every later API query and commit, but never conceals a corrupt result',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'wys-v5-terminal-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await write(root,'data/v5-safety/config.json',config);
 const results=['123','124'].map((id,index)=>({schema:1,id:`loop-${id}-1`,type:'v5-safety-result',activatedAt:config.activatedAt,ordinal:index+1,githubRunId:id,githubRunUrl:`https://github.com/xndanius/while-you-sleep/actions/runs/${id}`,startedAt:`2026-10-12T${index?13:12}:10:00Z`,conclusion:'success',proof:'pre_model_selection_and_reserved_gate',checkedAt:'2026-10-12T14:00:00.000Z'}));
 for(const result of results)await write(root,`data/v5-safety/results/${result.id}.json`,result);
 const completion={schema:1,id:'v5-safety-complete',type:'v5-safety-complete',activatedAt:config.activatedAt,baselineCommit:config.baselineCommit,completedAt:'2026-10-12T14:00:00.000Z',firstTwo:results.map(result=>({runId:result.id,githubRunId:result.githubRunId,ordinal:result.ordinal,startedAt:result.startedAt,conclusion:'success',proof:result.proof,resultSha256:sha256(stableJSON(result))}))};await write(root,'data/v5-safety/complete.json',completion);
 let calls=0;const input={root,env:{GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'xndanius/while-you-sleep',GITHUB_EVENT_NAME:'workflow_run'},now:new Date('2026-11-12T14:00:00Z'),apiGet:async()=>{calls++;throw new Error('A completed proof must never re-query GitHub.');}};
 const result=await verifyV5Safety(input);assert.equal(result.state,'verified');assert.equal(result.committed,false);assert.equal(result.rollback,false);assert.equal(calls,0);assert.equal(result.runs.length,2);
 for(const corrupt of [value=>value.conclusion='failure',value=>value.ordinal=3,value=>value.activatedAt='2026-10-12T11:00:00.000Z']){const changed=structuredClone(results[0]);corrupt(changed);await write(root,`data/v5-safety/results/${changed.id}.json`,changed);await assert.rejects(verifyV5Safety(input),/immutable per-run/);assert.equal(calls,0);}
 await write(root,`data/v5-safety/results/${results[0].id}.json`,results[0]);const invalid=structuredClone(completion);invalid.firstTwo[0].conclusion='failure';await write(root,'data/v5-safety/complete.json',invalid);await assert.rejects(verifyV5Safety(input),/mask a failed/);assert.equal(calls,0);
});
