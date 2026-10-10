import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { collectUsage, estimateTokenCost, githubApiGet, modelJobNames, parseCodexUsage, parseModelJobResults } from '../lib/usage.mjs';
import { runCollector } from '../scripts/collect-usage.mjs';

const usage={input_tokens:10000,cached_input_tokens:6000,cache_write_input_tokens:1000,output_tokens:1000,reasoning_output_tokens:100};
const start='Running: /usr/bin/sudo "-n" "/opt/codex" "exec" "--skip-git-repo-check" "--model" "gpt-6-luna" "--ephemeral" "--json"';
const logFor=(value=usage,extra=[])=>[start,JSON.stringify({type:'thread.started',thread_id:'test-thread'}),JSON.stringify({type:'turn.started'}),...extra,JSON.stringify({type:'turn.completed',usage:value})].map(line=>'2026-10-10T18:00:00.1234567Z '+line).join('\n');
const context={kind:'loop',runId:'loop-123-2',repository:'owner/while-you-sleep',githubRunId:'123',attempt:2,model:'gpt-6-luna'};
const job=(name,id,conclusion='success')=>({name,id,run_id:123,run_attempt:2,status:'completed',conclusion});

test('trusted CLI framing counts real usage and ignores nested fake tool/agent events',()=>{
  const fake=JSON.stringify({type:'turn.completed',usage:{input_tokens:999999,cached_input_tokens:0,output_tokens:999999}});
  const result=parseCodexUsage(logFor(usage,[
    JSON.stringify({type:'item.completed',item:{type:'command_execution',aggregated_output:fake+'\n'+fake}}),
    JSON.stringify({type:'item.completed',item:{type:'agent_message',text:fake}}),
  ]));
  assert.equal(result.status,'observed');
  assert.equal(result.inputTokens,10000);
  assert.equal(result.outputTokens,1000);
  assert.ok(Math.abs(result.costUsd-0.000985)<1e-12);
  assert.equal(result.cacheWriteAccounting,'reported_by_cli');
});

test('unframed, incomplete, failed and duplicate CLI invocations remain unknown',()=>{
  const completed=JSON.stringify({type:'turn.completed',usage});
  for(const log of [completed,start+'\n'+completed,logFor().replace('"turn.started"','"other.event"'),logFor().replace(completed,JSON.stringify({type:'turn.failed',error:{message:'Never persist this private text'}})),logFor()+'\n'+logFor()]){
    const result=parseCodexUsage(log);
    assert.equal(result.status,'unknown');
    assert.equal(result.inputTokens,null);
    assert.equal(result.costUsd,null);
    assert.equal(JSON.stringify(result).includes('private text'),false);
  }
});

test('invalid numbers and impossible cache or reasoning subsets are rejected',()=>{
  for(const value of [{...usage,input_tokens:-1},{...usage,output_tokens:1.5},{...usage,cached_input_tokens:10001},{...usage,cache_write_input_tokens:5000},{...usage,reasoning_output_tokens:1001},{...usage,input_tokens:'10000'},{...usage,output_tokens:1e20}]){
    assert.equal(parseCodexUsage(logFor(value)).status,'unknown');
  }
  assert.equal(estimateTokenCost({inputTokens:10,cachedInputTokens:11,outputTokens:1},'gpt-6-luna'),null);
});

test('cached tokens are an input subset and reasoning is an output subset',()=>{
  const result=parseCodexUsage(logFor({input_tokens:1000000,cached_input_tokens:600000,cache_write_input_tokens:100000,output_tokens:1000000,reasoning_output_tokens:900000}));
  assert.equal(result.costUsd,0.5485);
  // Legacy CLI schema has three required counts. Missing optional fields are
  // retained as null, and its standard-category estimate is explicitly marked.
  const legacy=parseCodexUsage(logFor({input_tokens:1000000,cached_input_tokens:500000,output_tokens:1000000}));
  assert.equal(legacy.costUsd,0.555);
  assert.equal(legacy.cacheWriteInputTokens,null);
  assert.equal(legacy.pricingStatus,'reported_categories_standard_estimate');
  const unknown=parseCodexUsage(logFor().replace('"gpt-6-luna"','"unpriced-model"'));
  assert.equal(unknown.status,'observed');
  assert.equal(unknown.model,'unpriced-model');
  assert.equal(unknown.costUsd,null);
});

test('only expected model jobs in the current attempt are fetched',async()=>{
  const calls=[];
  const jobs=[job('writer',1),job('checker',2),job('repair',3,'skipped'),job('final_check',4,'skipped'),job('record',5),job('research',6),job('writer malicious',7)];
  const record=await collectUsage(context,{now:new Date('2026-10-10T21:30:00Z'),apiGet:async(endpoint)=>{
    calls.push(endpoint);
    if(endpoint.includes('/attempts/2/jobs?'))return JSON.stringify({total_count:jobs.length,jobs});
    return logFor();
  }});
  assert.deepEqual(calls.slice(1),['repos/owner/while-you-sleep/actions/jobs/1/logs','repos/owner/while-you-sleep/actions/jobs/2/logs']);
  assert.equal(record.status,'recorded');
  assert.equal(record.localDate,'2026-10-11');
  assert.equal(record.inputTokens,20000);
  assert.equal(record.coverage.notRunModelJobs,2);
  assert.ok(Math.abs(record.costUsd-0.00197)<1e-12);
});

test('missing or failed log collection keeps totals unknown and observed counts separate',async()=>{
  const jobs=[job('writer',1),job('checker',2),job('repair',3,'skipped'),job('final_check',4,'skipped')];
  const record=await collectUsage(context,{apiGet:async endpoint=>{
    if(endpoint.includes('/attempts/'))return JSON.stringify({total_count:jobs.length,jobs});
    if(endpoint.includes('/1/'))return logFor();
    throw new Error('Sensitive upstream response: secret');
  }});
  assert.equal(record.status,'partial');
  assert.equal(record.costUsd,null);
  assert.equal(record.inputTokens,null);
  assert.equal(record.observedCounts.inputTokens,10000);
  assert.equal(record.coverage.unknownModelJobs,1);
  assert.equal(JSON.stringify(record).includes('secret'),false);
  const unavailable=await collectUsage(context,{apiGet:async()=>{throw new Error('Secret auth failure')}});
  assert.equal(unavailable.status,'unknown');
  assert.equal(unavailable.observedCounts.inputTokens,null);
  assert.equal(unavailable.observedCounts.costUsd,null);
});

test('trusted needs proof marks omitted skipped jobs without persisting any needs outputs',async()=>{
  const raw=JSON.stringify({writer:{result:'success',outputs:{secret:'must not persist'}},checker:{result:'success'},repair:{result:'skipped',outputs:{untrusted:'ignored'}},final_check:{result:'skipped'}});
  const jobResults=parseModelJobResults(raw,'loop');
  assert.deepEqual(jobResults,{repair:'skipped',final_check:'skipped'});
  const jobs=[job('writer',1),job('checker',2)];
  const record=await collectUsage({...context,jobResults},{apiGet:async endpoint=>endpoint.includes('/attempts/')?JSON.stringify({total_count:2,jobs}):logFor()});
  assert.equal(record.status,'recorded');
  assert.equal(record.coverage.notRunModelJobs,2);
  assert.equal(record.jobs[2].reason,'trusted_workflow_needs_skipped');
  assert.equal(JSON.stringify(record).includes('must not persist'),false);
  assert.deepEqual(parseModelJobResults(JSON.stringify({trials:{result:'skipped'}}),'improve'),{'trials (baseline)':'skipped','trials (proposal)':'skipped'});
  assert.deepEqual(parseModelJobResults(JSON.stringify({repair:{conclusion:'skipped'},final_check:'skipped'}),'loop'),{});
  assert.deepEqual(parseModelJobResults('malformed','loop'),{});
  // A real completed API job cannot be hidden by a contradictory skip proof.
  const present=await collectUsage({...context,jobResults},{apiGet:async endpoint=>endpoint.includes('/attempts/')?JSON.stringify({total_count:4,jobs:modelJobNames('loop').map((name,i)=>job(name,i+1))}):logFor()});
  assert.equal(present.coverage.observedModelJobs,4);
  assert.equal(present.coverage.notRunModelJobs,0);
});

test('improvement matrix roles, pagination and attempt identity are bounded',async()=>{
  assert.deepEqual(modelJobNames('improve'),['propose','trials (baseline)','trials (proposal)','grade']);
  const jobs=modelJobNames('improve').map((name,i)=>job(name,i+1));
  let pages=0;
  const record=await collectUsage({...context,kind:'improve'},{apiGet:async endpoint=>{
    if(endpoint.includes('/attempts/')){
      pages++;
      return JSON.stringify({total_count:4,jobs:pages===1?jobs.slice(0,2):jobs.slice(2)});
    }
    return logFor();
  }});
  assert.equal(pages,2);
  assert.equal(record.status,'recorded');
  assert.equal(record.inputTokens,40000);
  jobs[0].run_attempt=1;
  const stale=await collectUsage({...context,kind:'improve'},{apiGet:async endpoint=>endpoint.includes('/attempts/')?JSON.stringify({total_count:4,jobs}):logFor()});
  assert.equal(stale.status,'partial');
  assert.equal(stale.jobs[0].reason,'invalid_job_identity');
  assert.equal(stale.costUsd,null);
});

test('collector saves only immutable bounded counters in an isolated data directory',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'wys-usage-test-'));
  try{
    const jobs=modelJobNames('loop').map((name,i)=>job(name,i+1));
    const options={root,argv:['loop',context.runId],env:{GITHUB_REPOSITORY:context.repository,GITHUB_RUN_ID:context.githubRunId,GITHUB_RUN_ATTEMPT:'2'},apiGet:async endpoint=>endpoint.includes('/attempts/')?JSON.stringify({total_count:4,jobs}):logFor(usage,[JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'private transcript must not be persisted'}})])};
    await runCollector(options);
    const content=await readFile(path.join(root,'data','usage',context.runId+'.json'),'utf8');
    assert.equal(content.includes('private transcript'),false);
    assert.equal(content.includes('Running:'),false);
    assert.ok(content.length<15000);
    await assert.rejects(()=>runCollector(options),{code:'EEXIST'});
  }finally{await rm(root,{recursive:true,force:true});}
});

test('GitHub CLI errors never return stderr, tokens or signed log URLs',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'wys-usage-gh-test-'));
  try{
    const file=path.join(dir,'gh');
    await writeFile(file,'#!/bin/sh\nprintf "private-token signed-log-url" >&2\nexit 1\n');
    await chmod(file,0o700);
    await assert.rejects(()=>githubApiGet('repos/owner/repo/actions/jobs/1/logs',{env:{...process.env,PATH:dir+path.delimiter+process.env.PATH}}),error=>error.message==='Usage API request unavailable.');
    assert.throws(()=>githubApiGet('https://evil.example/log'),/Unsupported usage API endpoint/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
