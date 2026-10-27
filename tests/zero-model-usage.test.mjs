import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {collectUsage,modelJobNames,usageCountersComplete,effectiveModelExecution,deriveModelExecution,effectiveUsageRecords,usageCostSummary} from '../lib/usage.mjs';
import {sha256,stableJSON,writeJSON} from '../lib/storage.mjs';
import {runCollector} from '../scripts/collect-usage.mjs';
import {reconcileUsage} from '../scripts/reconcile-usage.mjs';
import {updateCostReadme} from '../scripts/update-cost-readme.mjs';

const repository='xndanius/while-you-sleep',githubRunId='40175800861',runId=`loop-${githubRunId}-1`,runUrl=`https://github.com/${repository}/actions/runs/${githubRunId}`;
const context={kind:'loop',runId,repository,githubRunId,attempt:1,model:'gpt-6-luna'};
const fields=['inputTokens','cachedInputTokens','cacheWriteInputTokens','outputTokens','reasoningOutputTokens','costUsd'];
const stepNames={writer:'Codex picks and writes',checker:'Independent Codex checker',repair:'Codex repairs once',final_check:'Fresh Codex checker after the single repair'};
const load=directory=>readFile(new URL(`../data/${directory}/${runId}.json`,import.meta.url),'utf8').then(JSON.parse);
const quietLog='2026-10-25T08:15:00Z Completed a deterministic source check; no model invocation.\n';
const start='Running: /usr/bin/sudo "-n" "/opt/codex" "exec" "--skip-git-repo-check" "--model" "gpt-6-luna" "--ephemeral" "--json"';
const counts={input_tokens:10000,cached_input_tokens:6000,cache_write_input_tokens:1000,output_tokens:1000,reasoning_output_tokens:100};
const observedLog=[start,JSON.stringify({type:'thread.started',thread_id:'synthetic-thread'}),JSON.stringify({type:'turn.started'}),JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'PRIVATE_TRANSCRIPT_MUST_NOT_PERSIST'}}),JSON.stringify({type:'turn.completed',usage:counts})].join('\n');
const source={id:Number(githubRunId),repository:{full_name:repository},head_repository:{full_name:repository},status:'completed',head_branch:'main',head_sha:'a'.repeat(40),path:'.github/workflows/loop.yml',event:'workflow_dispatch',run_attempt:1,conclusion:'success'};
const env={GITHUB_REPOSITORY:repository,GITHUB_REF:'refs/heads/main',GITHUB_RUN_ID:'999',GITHUB_RUN_ATTEMPT:'1',CODEX_MODEL:'gpt-6-luna'};

// Job IDs come from the immutable failed accounting record; step metadata is
// an explicitly synthetic API fixture, not a claim about the original logs.
async function jobs({allWrappers=false}={}){
 const original=await load('usage');
 return original.jobs.map((row,index)=>({name:row.name,id:row.jobId,run_id:Number(githubRunId),run_attempt:1,status:'completed',conclusion:allWrappers||index===0?'success':'skipped',steps:[{name:'Prepare deterministic inputs',number:1,status:'completed',conclusion:'success'},...(allWrappers||index===0?[{name:stepNames[row.name],number:9,status:'completed',conclusion:'skipped',privateText:'PRIVATE_STEP_DATA_MUST_NOT_PERSIST'}]:[])]}));
}
function apiFor(list,{logs={},unavailable=false}={}){
 const calls=[];
 const apiGet=async endpoint=>{
  calls.push(endpoint);
  if(endpoint===`repos/${repository}/actions/runs/${githubRunId}`)return JSON.stringify(source);
  if(endpoint===`repos/${repository}/actions/runs/${githubRunId}/attempts/1/jobs?per_page=100&page=1`){if(unavailable)throw new Error('PRIVATE_API_ERROR');return JSON.stringify({total_count:list.length,jobs:list});}
  const id=endpoint.match(/\/jobs\/(\d+)\/logs$/)?.[1];
  if(id&&Object.hasOwn(logs,id)){if(logs[id] instanceof Error)throw logs[id];return logs[id];}
  if(id)throw new Error('PRIVATE_LOG_ERROR');
  throw new Error('Unexpected fixture API path: '+endpoint);
 };
 return {apiGet,calls};
}
const collect=(api,extra={})=>collectUsage({...context,...extra},{apiGet:api.apiGet,now:new Date('2026-10-26T12:00:00.000Z')});
const zero=record=>{assert.equal(record.status,'recorded');assert.equal(record.pricingStatus,'no_model_invocation');for(const field of fields){assert.equal(record[field],0,field);assert.equal(record.observedCounts[field],0,'observed '+field);}assert.deepEqual(record.coverage,{expectedModelJobs:4,observedModelJobs:0,notRunModelJobs:4,unknownModelJobs:0});assert.equal(usageCountersComplete(record),true);};

test('the successful-wrapper/skipped-model regression records verified zero without rewriting the original unknown usage',async()=>{
 const original=await load('usage'),run=await load('runs'),before=stableJSON({original,run}),list=await jobs(),api=apiFor(list);
 assert.equal(original.status,'unknown');assert.equal(original.coverage.unknownModelJobs,1);assert.equal(original.jobs[0].reason,'completed_cli_usage_not_found');
 const record=await collect(api);zero(record);
 assert.equal(record.jobs[0].reason,'github_model_step_skipped');assert.deepEqual(record.jobs[0].modelStep,{name:stepNames.writer,number:9,status:'completed',conclusion:'skipped'});
 assert.ok(record.jobs.slice(1).every(row=>row.reason==='github_job_skipped'));
 assert.equal(deriveModelExecution({runId,githubRunUrl:runUrl,usage:record}),false);assert.equal(effectiveModelExecution({...run,modelExecuted:true},record),false);
 assert.equal(stableJSON({original,run}),before);assert.equal(JSON.stringify(record).includes('PRIVATE_'),false);
 assert.equal(api.calls.filter(value=>value.endsWith('/logs')).length,1,'Only the completed wrapper needs a log consistency check.');
});

test('all four exact skipped model steps work with missing logs or logs without invocation, but not from absence alone',async()=>{
 const list=await jobs({allWrappers:true});
 for(const logs of [{},Object.fromEntries(list.map(row=>[row.id,quietLog]))]){
  const record=await collect(apiFor(list,{logs}));zero(record);assert.ok(record.jobs.every(row=>row.reason==='github_model_step_skipped'));
  assert.deepEqual(record.jobs.map(row=>row.modelStep.name),Object.values(stepNames));assert.ok(record.jobs.every(row=>fields.every(field=>row[field]===null)));
 }
 const noSteps=structuredClone(list);for(const row of noSteps)delete row.steps;
 const unknown=await collect(apiFor(noSteps));assert.equal(unknown.status,'unknown');assert.equal(unknown.costUsd,null);assert.equal(usageCountersComplete(unknown),false);
 assert.equal(deriveModelExecution({runId,githubRunUrl:runUrl,usage:unknown}),null);
});

test('omitted optional API run_attempt retains the exact requested attempt endpoint binding',async()=>{
 const list=await jobs();for(const row of list)delete row.run_attempt;
 const api=apiFor(list),record=await collect(api);zero(record);
 assert.equal(record.runAttempt,1);assert.equal(record.githubRunUrl,runUrl+'/attempts/1');
 assert.equal(api.calls[0],`repos/${repository}/actions/runs/${githubRunId}/attempts/1/jobs?per_page=100&page=1`);
 const wrongAttempt=structuredClone(list);wrongAttempt[0].run_attempt=2;
 const refused=await collect(apiFor(wrongAttempt));assert.equal(refused.jobs[0].status,'unknown');assert.equal(refused.jobs[0].reason,'invalid_job_identity');assert.equal(usageCountersComplete(refused),false);
});

test('observed usage wins contradictory skipped metadata; mixed skipped jobs add no tokens',async()=>{
 const list=await jobs({allWrappers:true}),api=apiFor(list,{logs:{[list[0].id]:observedLog}}),record=await collect(api);
 assert.equal(record.status,'recorded');assert.equal(record.coverage.observedModelJobs,1);assert.equal(record.coverage.notRunModelJobs,3);assert.equal(record.inputTokens,counts.input_tokens);assert.equal(record.outputTokens,counts.output_tokens);
 assert.equal(record.jobs[0].status,'observed');assert.equal(usageCountersComplete(record),true);assert.equal(deriveModelExecution({runId,githubRunUrl:runUrl,usage:record}),true);
 assert.equal(JSON.stringify(record).includes('PRIVATE_TRANSCRIPT'),false);assert.equal(JSON.stringify(record).includes('Running:'),false);
});

test('started, failed and incomplete CLI invocations remain unknown despite a skipped API step',async()=>{
 const list=await jobs(),attempts=[start,[start,JSON.stringify({type:'thread.started',thread_id:'x'})].join('\n'),JSON.stringify({type:'thread.started',thread_id:'x'}),JSON.stringify({type:'turn.started'}),[start,JSON.stringify({type:'thread.started',thread_id:'x'}),JSON.stringify({type:'turn.started'}),JSON.stringify({type:'turn.failed',error:{message:'PRIVATE_FAILURE'}})].join('\n')];
 for(const log of attempts){const record=await collect(apiFor(list,{logs:{[list[0].id]:log}}));assert.equal(record.status,'unknown');assert.equal(record.jobs[0].status,'unknown');assert.equal(record.costUsd,null);assert.equal(usageCountersComplete(record),false);assert.equal(JSON.stringify(record).includes('PRIVATE_FAILURE'),false);}
 for(const conclusion of ['success','failure','cancelled']){const altered=structuredClone(list);altered[0].steps[1].conclusion=conclusion;const record=await collect(apiFor(altered));assert.equal(record.jobs[0].status,'unknown');assert.equal(usageCountersComplete(record),false);}
});

test('forged or ambiguous step and job identities cannot establish zero usage',async()=>{
 const mutations=[
  row=>row.steps[1].name='Codex picks and writes malicious',row=>row.steps.push({...row.steps[1],number:10}),row=>row.steps[1].number=0,row=>row.steps[1].number='9',row=>row.steps[1].number=1,row=>row.steps[1].status='in_progress',row=>delete row.steps[1].number,row=>delete row.steps,row=>row.id='121116277520',row=>row.run_id=123,row=>row.run_attempt=2,row=>row.name='writer malicious',row=>row.status='in_progress',
 ];
 for(const mutate of mutations){const list=await jobs();mutate(list[0]);const record=await collect(apiFor(list));assert.equal(record.status,'unknown',mutate.toString());assert.equal(record.costUsd,null);assert.equal(usageCountersComplete(record),false);}
 const list=await jobs();list.push({...list[0],id:list[0].id+1});assert.equal((await collect(apiFor(list))).status,'unknown');
 assert.equal((await collect(apiFor(await jobs(),{unavailable:true}))).status,'unknown');
});

test('verified-zero presentation rejects forged receipts and retains legacy all-skipped execution evidence',async()=>{
 const record=await collect(apiFor(await jobs()));zero(record);
 const mutations=[
  r=>r.jobs[0].modelStep.name=stepNames.checker,r=>r.jobs[0].modelStep.number=0,r=>r.jobs[0].modelStep.status='in_progress',r=>r.jobs[0].modelStep.conclusion='success',r=>r.jobs[0].modelStep.extra='ignored',r=>delete r.jobs[0].modelStep,r=>r.jobs[0].githubJobUrl='https://github.com/other/repo/actions/runs/1/job/1',r=>r.jobs[0].name='foreign',r=>r.jobs.push(r.jobs[0]),r=>r.coverage.notRunModelJobs=3,r=>r.inputTokens=1,r=>r.costUsd=null,r=>r.runAttempt=2,r=>r.githubRunUrl=runUrl+'/attempts/2',
 ];
 for(const mutate of mutations){const forged=structuredClone(record);mutate(forged);assert.equal(usageCountersComplete(forged),false,mutate.toString());assert.equal(deriveModelExecution({runId,githubRunUrl:runUrl,usage:forged}),null);}
 const legacy=structuredClone(record);legacy.status='unknown';for(const field of fields)legacy[field]=null;
 for(const job of legacy.jobs){job.reason='github_job_skipped';job.conclusion='skipped';delete job.modelStep;}
 assert.equal(usageCountersComplete(legacy),false);assert.equal(effectiveModelExecution({id:runId,githubRunUrl:runUrl,modelExecuted:true},legacy),false);
});

test('different expected job names cannot reuse one GitHub job ID as independent zero proofs',async()=>{
 const list=await jobs();list[1].id=list[0].id;
 const refused=await collect(apiFor(list));assert.equal(refused.status,'unknown');assert.equal(refused.costUsd,null);assert.equal(usageCountersComplete(refused),false);
 const record=await collect(apiFor(await jobs()));zero(record);
 record.jobs[1].jobId=record.jobs[0].jobId;record.jobs[1].githubJobUrl=record.jobs[0].githubJobUrl;
 assert.equal(usageCountersComplete(record),false);assert.equal(deriveModelExecution({runId,githubRunUrl:runUrl,usage:record}),null);
});

test('zero reconciliation appends an exact original-bound correction and never rewrites the usage or run history',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-zero-reconcile-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const original=await load('usage'),run=await load('runs'),file=path.join(root,'data/usage',runId+'.json');await writeJSON(file,original,{immutable:true});await writeJSON(path.join(root,'data/runs',runId+'.json'),run,{immutable:true});
 const originalBytes=await readFile(file),runBytes=await readFile(path.join(root,'data/runs',runId+'.json'));
 const result=await reconcileUsage({sourceRunId:githubRunId,root,env,apiGet:apiFor(await jobs()).apiGet,now:new Date('2026-10-26T12:00:00.000Z')});assert.equal(result.changed,true);assert.equal(result.status,'recorded');
 const correction=JSON.parse(await readFile(path.join(root,'data/usage',runId+'-reconciled.json'),'utf8'));zero(correction);assert.equal(correction.supersedesSha256,sha256(stableJSON(original)));assert.equal(correction.localDate,original.localDate);
 assert.deepEqual(await readFile(file),originalBytes);assert.deepEqual(await readFile(path.join(root,'data/runs',runId+'.json')),runBytes);assert.deepEqual(effectiveUsageRecords([original,correction]),[correction]);
 assert.equal(effectiveModelExecution({...run,usage:original},correction),false);const forged={...correction,supersedesSha256:'0'.repeat(64)};assert.deepEqual(effectiveUsageRecords([original,forged]),[original]);
 assert.equal((await reconcileUsage({sourceRunId:githubRunId,root,env,apiGet:apiFor(await jobs()).apiGet})).status,'already_reconciled');assert.equal((await readdir(path.dirname(file))).length,2);
});

test('missing skip proof cannot create a zero reconciliation or persist private log material',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-zero-missing-'));t.after(()=>rm(root,{recursive:true,force:true}));const original=await load('usage'),file=path.join(root,'data/usage',runId+'.json');await writeJSON(file,original,{immutable:true});const before=await readFile(file);
 const list=await jobs();delete list[0].steps;
 const result=await reconcileUsage({sourceRunId:githubRunId,root,env,apiGet:apiFor(list).apiGet});assert.equal(result.changed,false);assert.equal(result.status,'still_incomplete');assert.deepEqual(await readFile(file),before);assert.deepEqual(await readdir(path.dirname(file)),[runId+'.json']);
 const other=await mkdtemp(path.join(os.tmpdir(),'wys-zero-collector-'));t.after(()=>rm(other,{recursive:true,force:true}));const wrapped=await jobs({allWrappers:true});
 await runCollector({argv:['loop',runId],root:other,env:{...env,GITHUB_RUN_ID:githubRunId},apiGet:apiFor(wrapped,{logs:{[wrapped[0].id]:observedLog}}).apiGet,now:new Date('2026-10-26T12:00:00.000Z')});
 const stored=await readFile(path.join(other,'data/usage',runId+'.json'),'utf8');assert.equal(stored.includes('PRIVATE_'),false);assert.equal(stored.includes('Running:'),false);assert.equal(stored.includes('signed-log-url'),false);
});

test('verified zeros do not inflate model-cost coverage and have an explicit README label',async t=>{
 const zeroRecord=await collect(apiFor(await jobs())),list=await jobs(),observed=await collect(apiFor(list,{logs:{[list[0].id]:observedLog}}));
 assert.deepEqual(usageCostSummary([zeroRecord],0),{totalCostUsd:0,costStatus:'no_model_invocation'});assert.equal(usageCostSummary([zeroRecord,observed],1).costStatus,'recorded_token_estimate');assert.equal(usageCostSummary([zeroRecord,observed],2).costStatus,'invoice_or_usage_not_connected');
 const unknown=await load('usage');assert.notEqual(usageCostSummary([zeroRecord,unknown],0).costStatus,'no_model_invocation');
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-zero-readme-'));t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(path.join(root,'README.md'),'Before\n<!-- MODEL_COSTS_START -->\nold\n<!-- MODEL_COSTS_END -->\nAfter');
 await updateCostReadme({root,usageRecords:[zeroRecord]});const readme=await readFile(path.join(root,'README.md'),'utf8');assert.match(readme,/\$0\.00000.*Verified no model execution/);assert.doesNotMatch(readme,/Missing or partial counters/);assert.match(readme,/Before[\s\S]*After/);
});

test('score and improvement workflows with every whole job skipped retain verified zero cost summaries',async()=>{
 for(const kind of ['score','improve']){
  const names=modelJobNames(kind),list=names.map((name,index)=>({name,id:500+index,run_id:Number(githubRunId),status:'completed',conclusion:'skipped'}));
  const calls=[],record=await collectUsage({...context,kind,runId:`${kind}-${githubRunId}-1`},{now:new Date('2026-10-26T12:00:00.000Z'),apiGet:async endpoint=>{calls.push(endpoint);assert.equal(endpoint,`repos/${repository}/actions/runs/${githubRunId}/attempts/1/jobs?per_page=100&page=1`);return JSON.stringify({total_count:list.length,jobs:list});}});
  assert.equal(record.status,'recorded');assert.equal(record.pricingStatus,'no_model_invocation');assert.equal(record.coverage.expectedModelJobs,names.length);assert.equal(record.coverage.notRunModelJobs,names.length);assert.equal(record.coverage.observedModelJobs,0);assert.equal(record.coverage.unknownModelJobs,0);
  for(const field of fields)assert.equal(record[field],0);assert.equal(usageCountersComplete(record),true);assert.deepEqual(usageCostSummary([record],0),{totalCostUsd:0,costStatus:'no_model_invocation'});assert.equal(calls.length,1);
 }
});
