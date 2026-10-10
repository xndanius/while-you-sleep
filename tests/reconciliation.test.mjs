import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile,chmod,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {effectiveUsageRecords,githubApiGet} from '../lib/usage.mjs';
import {sha256,stableJSON,writeJSON} from '../lib/storage.mjs';
import {REPOSITORY,reconcileUsage,validateSourceRun} from '../scripts/reconcile-usage.mjs';
import {updateCostReadme} from '../scripts/update-cost-readme.mjs';

const source={id:123,repository:{full_name:REPOSITORY},head_repository:{full_name:REPOSITORY},status:'completed',head_branch:'main',head_sha:'a'.repeat(40),path:'.github/workflows/loop.yml',event:'workflow_dispatch',run_attempt:2,conclusion:'success'};
const original={id:'loop-123-2',type:'usage',runId:'loop-123-2',workflowKind:'loop',githubRunId:'123',runAttempt:2,localDate:'2026-10-10',model:'gpt-6-luna',status:'unknown',inputTokens:null,cachedInputTokens:null,cacheWriteInputTokens:null,outputTokens:null,reasoningOutputTokens:null,costUsd:null,coverage:{expectedModelJobs:4,observedModelJobs:0,notRunModelJobs:2,unknownModelJobs:2},jobs:[{name:'repair',status:'not_run',reason:'trusted_workflow_needs_skipped'},{name:'final_check',status:'not_run',reason:'trusted_workflow_needs_skipped'}]};
const log=[
  'Running: /usr/bin/sudo "-n" "/opt/codex" "exec" "--skip-git-repo-check" "--model" "gpt-6-luna" "--ephemeral" "--json"',
  JSON.stringify({type:'thread.started',thread_id:'fictional'}),JSON.stringify({type:'turn.started'}),
  JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'fictional private transcript never persist'}}),
  JSON.stringify({type:'turn.completed',usage:{input_tokens:10000,cached_input_tokens:6000,cache_write_input_tokens:1000,output_tokens:1000,reasoning_output_tokens:100}}),
].map(line=>'2026-10-10T18:00:00Z \x1b[32m'+line+'\x1b[0m').join('\n');
const jobs=['writer','checker'].map((name,i)=>({name,id:i+1,run_id:123,run_attempt:2,status:'completed',conclusion:'success'}));
const apiGet=async endpoint=>endpoint.endsWith('/runs/123')?JSON.stringify(source):endpoint.includes('/attempts/')?JSON.stringify({total_count:2,jobs}):log;
const env={GITHUB_REPOSITORY:REPOSITORY,GITHUB_REF:'refs/heads/main',GITHUB_RUN_ID:'999'};

test('reconciliation rejects nonterminal, fork, wrong workflow, branch, event and attempt metadata',()=>{
  assert.equal(validateSourceRun(source,'123').runId,'loop-123-2');
  const invalid=[{status:'in_progress'},{repository:{full_name:'evil/repo'}},{head_repository:{full_name:'evil/repo'}},{head_branch:'feature'},{head_sha:'not-a-commit'},{path:'.github/workflows/other.yml'},{event:'pull_request'},{run_attempt:0},{id:124}];
  for(const patch of invalid)assert.throws(()=>validateSourceRun({...source,...patch},'123'),/trusted completed-main/);
  assert.throws(()=>validateSourceRun(source,'123; echo secret'),/trusted completed-main/);
  assert.equal(validateSourceRun({...source,path:'.github/workflows/improve.yml'},'123').kind,'improve');
});

test('terminal reconciliation preserves original bytes/date and writes only bounded immutable counters',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'wys-reconcile-test-'));
  try {
    const file=path.join(root,'data','usage',original.id+'.json');
    await writeJSON(file,original,{immutable:true});
    const before=await readFile(file,'utf8');
    const result=await reconcileUsage({root,sourceRunId:'123',env,apiGet,now:new Date('2026-10-12T10:00:00Z')});
    assert.equal(result.changed,true);assert.equal(result.status,'recorded');
    assert.equal(await readFile(file,'utf8'),before);
    const text=await readFile(path.join(root,'data','usage',original.id+'-reconciled.json'),'utf8');
    const record=JSON.parse(text);
    assert.equal(record.localDate,original.localDate);
    assert.equal(record.collectedAt,'2026-10-12T10:00:00.000Z');
    assert.equal(record.supersedesSha256,sha256(stableJSON(original)));
    assert.equal(record.inputTokens,20000);assert.equal(record.outputTokens,2000);
    assert.ok(Math.abs(record.costUsd-0.00197)<1e-12);
    for(const secret of ['fictional private transcript','Running:','\x1b'])assert.equal(text.includes(secret),false);
    assert.equal((await reconcileUsage({root,sourceRunId:'123',env,apiGet})).status,'already_reconciled');
    assert.deepEqual((await readdir(path.dirname(file))).sort(),[original.id+'-reconciled.json',original.id+'.json'].sort());
  } finally {await rm(root,{recursive:true,force:true});}
});

test('unavailable logs leave the original unknown and permit a later successful retry',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'wys-reconcile-missing-'));
  try {
    const file=path.join(root,'data','usage',original.id+'.json');await writeJSON(file,original,{immutable:true});
    const result=await reconcileUsage({root,sourceRunId:'123',env,apiGet:async endpoint=>{
      if(endpoint.endsWith('/logs'))throw new Error('provider secret error body');return apiGet(endpoint);
    }});
    assert.equal(result.changed,false);assert.equal(result.status,'still_incomplete');
    assert.equal(JSON.stringify(result).includes('provider secret'),false);
    assert.deepEqual(await readdir(path.dirname(file)),[original.id+'.json']);
    assert.equal((await reconcileUsage({root,sourceRunId:'123',env,apiGet})).changed,true);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('initial record identity and trusted runner context fail closed before writes',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'wys-reconcile-context-'));
  try {
    await assert.rejects(()=>reconcileUsage({root,sourceRunId:'123',env:{...env,GITHUB_REPOSITORY:'other/repo'},apiGet}),/trusted main/);
    await assert.rejects(()=>reconcileUsage({root,sourceRunId:'123',env:{...env,GITHUB_REF:'refs/heads/feature'},apiGet}),/trusted main/);
    assert.equal((await reconcileUsage({root,sourceRunId:'123',env,apiGet})).status,'initial_record_missing');
    await writeJSON(path.join(root,'data','usage',original.id+'.json'),{...original,githubRunId:'124'},{immutable:true});
    await assert.rejects(()=>reconcileUsage({root,sourceRunId:'123',env,apiGet}),/does not match/);
    assert.deepEqual(await readdir(path.join(root,'data','usage')),[original.id+'.json']);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('complete initial counters are not re-fetched, even when model pricing remains unknown',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'wys-reconcile-complete-'));
  try {
    const known={...original,status:'recorded',inputTokens:20,cachedInputTokens:10,outputTokens:2,costUsd:null,coverage:{expectedModelJobs:4,observedModelJobs:2,notRunModelJobs:2,unknownModelJobs:0}};
    await writeJSON(path.join(root,'data','usage',original.id+'.json'),known,{immutable:true});
    const calls=[];
    const result=await reconcileUsage({root,sourceRunId:'123',env,apiGet:async endpoint=>{calls.push(endpoint);return apiGet(endpoint);}});
    assert.equal(result.status,'already_complete');
    assert.deepEqual(calls,[`repos/${REPOSITORY}/actions/runs/123`]);
    assert.deepEqual(await readdir(path.join(root,'data','usage')),[original.id+'.json']);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('effective correction replaces exactly one run; stale, cross-run and partial corrections never win',async()=>{
  const complete={...original,status:'recorded',inputTokens:20000,cachedInputTokens:12000,cacheWriteInputTokens:2000,outputTokens:2000,reasoningOutputTokens:200,costUsd:0.00197,coverage:{expectedModelJobs:4,observedModelJobs:2,notRunModelJobs:2,unknownModelJobs:0}};
  const correction={...complete,id:original.id+'-reconciled',supersedes:original.id,supersedesSha256:sha256(stableJSON(original))};
  for(const rows of [[original,correction],[correction,original]])assert.deepEqual(effectiveUsageRecords(rows),[correction]);
  for(const patch of [{supersedes:'loop-124-2'},{supersedesSha256:'a'.repeat(64)},{localDate:'2026-10-12'},{status:'partial'},{cachedInputTokens:99999},{costUsd:-1},{runId:'loop-124-2'}])assert.deepEqual(effectiveUsageRecords([original,{...correction,...patch}]),[original]);
  const knownCorrection={...correction,supersedesSha256:sha256(stableJSON(complete))};
  assert.deepEqual(effectiveUsageRecords([complete,knownCorrection]),[complete]);
  const root=await mkdtemp(path.join(os.tmpdir(),'wys-cost-table-test-'));
  try {
    await writeFile(path.join(root,'README.md'),'Before\n<!-- MODEL_COSTS_START -->\nold\n<!-- MODEL_COSTS_END -->\nAfter\n');
    await updateCostReadme({root,usageRecords:[correction,original]});
    const readme=await readFile(path.join(root,'README.md'),'utf8');
    assert.ok(readme.includes('| 2026-10-10 | 1 | $0.00197 | Reported CLI counters |'));
    assert.equal(readme.includes('| 2 |'),false);assert.ok(readme.endsWith('After\n'));
  } finally {await rm(root,{recursive:true,force:true});}
});

test('log endpoint escape flag is captured in RAM; metadata endpoints never enable it',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'wys-gh-escape-test-'));
  try {
    const file=path.join(dir,'gh'),argsFile=path.join(dir,'args.json');
    await writeFile(file,'#!'+process.execPath+'\nconst fs=require("node:fs");fs.writeFileSync(process.env.TEST_ARGS_FILE,JSON.stringify(process.argv.slice(2)));process.stdout.write(process.env.TEST_FAKE_RESPONSE);');
    await chmod(file,0o700);
    const fakeEnv={...process.env,PATH:dir+path.delimiter+process.env.PATH,TEST_ARGS_FILE:argsFile,TEST_FAKE_RESPONSE:log};
    assert.equal(await githubApiGet('repos/owner/repo/actions/jobs/1/logs',{env:fakeEnv}),log);
    assert.ok(JSON.parse(await readFile(argsFile,'utf8')).includes('--allow-escape-sequences'));
    await githubApiGet('repos/owner/repo/actions/runs/123',{env:{...fakeEnv,TEST_FAKE_RESPONSE:'{}'}});
    assert.equal(JSON.parse(await readFile(argsFile,'utf8')).includes('--allow-escape-sequences'),false);
  } finally {await rm(dir,{recursive:true,force:true});}
});
