import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {repairHash,repairActorIsTrusted,repairEpisodeMatches,validateRepairContext} from '../scripts/prepare-watchdog-repair.mjs';
import {allowedRepairPath,repairPatchPaths,openWatchdogRepair,publisherRetryAuthorized} from '../scripts/open-watchdog-repair.mjs';

const episodeId='starvation-'+'a'.repeat(20),issueNumber=12;
const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'xndanius/while-you-sleep',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_ACTOR:'github-actions[bot]',GITHUB_TRIGGERING_ACTOR:'github-actions[bot]',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'123',WATCHDOG_EPISODE_ID:episodeId,WATCHDOG_ISSUE_NUMBER:String(issueNumber)};
const state={schema:1,mode:'repair',episode:{id:episodeId},actions:{issueNumber,repairEpisode:episodeId,repairStatus:'dispatch_reserved'}};
const metadata={id:123,event:'workflow_dispatch',run_attempt:1,path:'.github/workflows/repair.yml',head_branch:'main',repository:{full_name:env.GITHUB_REPOSITORY},head_repository:{full_name:env.GITHUB_REPOSITORY,fork:false},actor:{login:'github-actions[bot]'},triggering_actor:{login:'github-actions[bot]'}};
const patch='diff --git a/lib/retrieval.mjs b/lib/retrieval.mjs\n--- a/lib/retrieval.mjs\n+++ b/lib/retrieval.mjs\n@@ -1 +1 @@\n-export const working=false;\n+export const working=true;\n';
const git=(root,args)=>{const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
async function fixture(t,{proposal=patch,currentState=state,existing=[],reasonCounts={'No fresh public demand lead':86},retryMetadata=null}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'watchdog-repair-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));git(root,['init','-q']);git(root,['config','user.name','Test']);git(root,['config','user.email','test@example.invalid']);
 const put=async(file,value)=>{await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.writeFile(path.join(root,file),typeof value==='string'?value:JSON.stringify(value));};
 await put('lib/retrieval.mjs','export const working=false;\n');await put('data/watchdog/state.json',currentState);git(root,['add','.']);git(root,['commit','-qm','baseline']);const baseSha=git(root,['rev-parse','HEAD']);
 const context={schema:1,type:'watchdog-repair-context',repository:env.GITHUB_REPOSITORY,episodeId,issueNumber,baseSha,githubRunId:'123',runAttempt:1,mode:'repair',stateSha256:repairHash(state),createdAt:'2026-10-19T08:00:00Z',diagnosis:{hoursWithoutPost:180,postsLast12Hours:0,reasonCounts,noPostRuns:[]},constraints:{publishThreshold:6,independentChecks:'unchanged',autoMerge:false,proposalOnly:true}};
 await put('.staging/repair-context/context.json',context);if(proposal!==null)await put('.staging/repair-proposal/proposal.patch',proposal);
 const calls=[];const execute=(command,args,options={})=>{calls.push({command,args});if(command==='gh'){if(args[0]==='api'&&retryMetadata)return JSON.stringify(retryMetadata);if(args[0]==='pr'&&args[1]==='list')return JSON.stringify(existing);if(args[0]==='pr'&&args[1]==='create')return 'https://github.com/xndanius/while-you-sleep/pull/999';throw new Error('Unexpected GitHub operation');}assert.equal(command,'git','no generated code or tests execute with publisher credentials');if(args[0]==='push')return '';const result=spawnSync(command,args,{cwd:root,encoding:'utf8',...options});if(result.status!==0)throw new Error('git operation failed');return result.stdout.trim();};
 return {root,context,calls,execute,log:()=>{},env:{...env,EXPECTED_REPAIR_CONTEXT_SHA:repairHash(context)}};
}
test('repair gate requires exact hosted bot actor, first attempt and matching current reserved episode',()=>{
 assert.equal(repairActorIsTrusted(metadata,env),true);for(const change of [value=>value.actor.login='xndanius',value=>value.run_attempt=2,value=>value.head_repository.fork=true,value=>value.path='.github/workflows/loop.yml']){const row=structuredClone(metadata);change(row);assert.equal(repairActorIsTrusted(row,env),false);}assert.equal(repairActorIsTrusted(metadata,{...env,GITHUB_ACTOR:'xndanius'}),false);
 assert.equal(repairEpisodeMatches(state,{episodeId,issueNumber}),true);assert.equal(repairEpisodeMatches({...state,actions:{...state.actions,repairStatus:'dispatched'}},{episodeId,issueNumber}),true);assert.equal(repairEpisodeMatches({...state,mode:'normal'},{episodeId,issueNumber}),false);assert.equal(repairEpisodeMatches(state,{episodeId,issueNumber:13}),false);
});
test('bounded repair patches cannot change checks, credentials, workflow authority, generated posts or file modes',()=>{
 assert.deepEqual(repairPatchPaths(patch),['lib/retrieval.mjs']);for(const file of ['RULES.md','AGENTS.md','.github/workflows/loop.yml','lib/privacy.mjs','lib/validation.mjs','lib/demand.mjs','scripts/publish-checked.mjs','scripts/open-watchdog-repair.mjs','public/api/feed.json','public/p/post/index.html','lib/../RULES.md','lib/.env','package.json'])assert.equal(allowedRepairPath(file),false,file);
 for(const changed of [patch.replaceAll('lib/retrieval.mjs','lib/privacy.mjs'),patch.replace('--- a/','new file mode 120000\n--- a/'),patch+'GIT binary patch\n',patch+'\n+const key="sk-proj-'+ 'x'.repeat(40)+'";\n',patch.replace('b/lib/retrieval.mjs','b/lib/other.mjs')])assert.throws(()=>repairPatchPaths(changed));
});
test('publisher applies a safe bounded patch and opens only a draft PR without executing model code',async t=>{
 const f=await fixture(t),result=await openWatchdogRepair(f);assert.equal(result.diagnosisOnly,false);assert.equal(result.autoMerge,false);assert.equal(await fs.readFile(path.join(f.root,'lib/retrieval.mjs'),'utf8'),'export const working=true;\n');const create=f.calls.find(call=>call.command==='gh'&&call.args[1]==='create');assert.ok(create.args.includes('--draft'));assert.equal(f.calls.some(call=>call.args.includes('merge')||call.command==='node'||call.command==='npm'),false);assert.equal(git(f.root,['branch','--show-current']),'watchdog/repair-'+'a'.repeat(20));assert.equal(JSON.parse(await fs.readFile(path.join(f.root,'.run/watchdog-repair-result.json'),'utf8')).pullRequestUrl,result.pullRequestUrl);
});
test('missing or protected model proposals yield an honest diagnosis-only draft rather than a claimed fix',async t=>{
 for(const proposal of [null,patch.replaceAll('lib/retrieval.mjs','lib/privacy.mjs')]){const f=await fixture(t,{proposal}),result=await openWatchdogRepair(f);assert.equal(result.diagnosisOnly,true);const diagnosis=await fs.readFile(path.join(f.root,'docs',`WATCHDOG_DIAGNOSIS_${episodeId}.md`),'utf8');assert.match(diagnosis,/No verified functional repair/);assert.match(await fs.readFile(path.join(f.root,'.run/watchdog-repair-pr-body.md'),'utf8'),/does not claim|did not produce a verified functional fix/);assert.equal(await fs.readFile(path.join(f.root,'lib/retrieval.mjs'),'utf8'),'export const working=false;\n');}
});
test('a malformed proposal and truncated trailing-space reasons produce a clean real-git diagnosis draft',async t=>{
 const f=await fixture(t,{proposal:patch.replace('@@ -1 +1 @@','@@ malformed @@'),reasonCounts:{'A truncated historical chore ends here ':1,'Another historical reason\t':2}}),result=await openWatchdogRepair(f);
 assert.equal(result.diagnosisOnly,true);const text=await fs.readFile(path.join(f.root,'docs',`WATCHDOG_DIAGNOSIS_${episodeId}.md`),'utf8');assert.ok(text.split('\n').every(line=>line===line.trimEnd()));git(f.root,['show','--check','HEAD']);
});
test('a valid docs-only model patch is labelled diagnosis-only rather than a functional repair',async t=>{
 const proposal='diff --git a/docs/diagnosis.md b/docs/diagnosis.md\nnew file mode 100644\n--- /dev/null\n+++ b/docs/diagnosis.md\n@@ -0,0 +1 @@\n+# Publishing diagnosis\n';
 const f=await fixture(t,{proposal}),result=await openWatchdogRepair(f);assert.equal(result.diagnosisOnly,true);assert.match(await fs.readFile(path.join(f.root,'.run/watchdog-repair-pr-body.md'),'utf8'),/did not produce a verified functional fix/);
});
test('publisher-only attempt two requires its committed exact reservation and authoritative bot metadata',async t=>{
 const reserved={...state,actions:{...state.actions,publisherRetryEpisode:episodeId,publisherRetryRunId:'123',publisherRetryAttempt:2,publisherRetryStatus:'reserved',publisherRetrySourceHeadSha:'c'.repeat(40)}};
 const retryMetadata={...metadata,run_attempt:2,head_sha:'c'.repeat(40),actor:{login:'github-actions[bot]',type:'Bot'},triggering_actor:{login:'github-actions[bot]',type:'Bot'}};
 const f=await fixture(t,{currentState:reserved,retryMetadata});f.env.GITHUB_RUN_ATTEMPT='2';const result=await openWatchdogRepair(f);assert.equal(result.autoMerge,false);assert.equal(f.calls.filter(call=>call.command==='gh'&&call.args[0]==='api').length,1);assert.equal(f.calls.some(call=>call.command==='node'||call.command==='npm'),false);
 assert.equal(publisherRetryAuthorized(reserved,f.context,f.env),true);
 for(const change of [{publisherRetryRunId:'124'},{publisherRetryEpisode:'starvation-'+'b'.repeat(20)},{publisherRetryAttempt:3},{publisherRetryStatus:'unknown'}])assert.equal(publisherRetryAuthorized({...reserved,actions:{...reserved.actions,...change}},f.context,f.env),false);
 const noReservation=await fixture(t);await assert.rejects(openWatchdogRepair({...noReservation,env:{...noReservation.env,GITHUB_RUN_ATTEMPT:'2'}}),/reservation/);assert.equal(noReservation.calls.length,0);
 for(const change of [{run_attempt:3},{head_sha:'d'.repeat(40)},{triggering_actor:{login:'xndanius',type:'User'}},{head_repository:{full_name:env.GITHUB_REPOSITORY,fork:true}}]){
  const invalid=await fixture(t,{currentState:reserved,retryMetadata:{...retryMetadata,...change}});await assert.rejects(openWatchdogRepair({...invalid,env:{...invalid.env,GITHUB_RUN_ATTEMPT:'2'}}),/metadata/);assert.equal(invalid.calls.some(call=>call.command==='git'),false);
 }
 await assert.rejects(openWatchdogRepair({...f,env:{...f.env,GITHUB_RUN_ATTEMPT:'3'}}),/bounded/);await assert.rejects(openWatchdogRepair({...f,env:{...f.env,GITHUB_TRIGGERING_ACTOR:'xndanius'}}),/bounded/);
});
test('a changed trusted context or a resolved episode cannot create a branch or PR',async t=>{
 const f=await fixture(t);await assert.rejects(openWatchdogRepair({...f,env:{...f.env,EXPECTED_REPAIR_CONTEXT_SHA:'b'.repeat(64)}}),/exact gate hash/);assert.equal(f.calls.length,0);const resolved=await fixture(t,{currentState:{...state,mode:'normal'}});assert.equal((await openWatchdogRepair(resolved)).status,'episode_resolved');assert.equal(resolved.calls.length,0);
});
test('an existing repair PR is reused without another branch, push or PR creation',async t=>{
 const f=await fixture(t,{existing:[{url:'https://github.com/xndanius/while-you-sleep/pull/999',state:'OPEN',isDraft:true}]}),result=await openWatchdogRepair(f);assert.equal(result.status,'already_recorded');assert.equal(f.calls.length,1);assert.equal(f.calls[0].args[1],'list');
});
test('workflow separates the readonly credential-free model checkout from trusted draft publication',async()=>{
 const source=await fs.readFile(new URL('../.github/workflows/repair.yml',import.meta.url),'utf8'),model=source.split('  propose:\n')[1].split('  publish-draft:\n')[0],publisher=source.split('  publish-draft:\n')[1];assert.match(model,/contents: read/);assert.match(model,/persist-credentials: false/);assert.match(model,/permission-profile: ':workspace'/);assert.match(model,/safety-strategy: drop-sudo/);assert.doesNotMatch(model,/contents: write|pull-requests: write|GH_TOKEN:/);assert.match(publisher,/contents: write/);assert.match(publisher,/pull-requests: write/);assert.doesNotMatch(publisher,/codex-action|npm |node --test|OPENAI_API_KEY/);assert.match(publisher,/EXPECTED_REPAIR_CONTEXT_SHA/);assert.doesNotMatch(source,/pr merge|enable-automerge|auto-merge/);
});
