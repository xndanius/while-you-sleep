import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {candidateIdentity,sha256,stableJSON} from '../lib/storage.mjs';
import {completedAssessmentReasons,assessmentJobReasons,verifyPublishedPost} from '../lib/validation.mjs';
import {parseScoringPolicy,SCORING_KEYS} from '../lib/scoring.mjs';
import {loopDecision} from '../lib/loop-schedule.mjs';

const now='2026-10-11T12:20:00.000Z',runId='loop-123-1';
const rules='# Rules\n<!-- scoring-policy:start -->\n```json\n{"weights":{"ease":1,"profit":1,"feasibility":1,"autonomy":1,"evidence":1},"publishThreshold":6}\n```\n<!-- scoring-policy:end -->\n';
const text='The product reads uploaded receipts and extracts structured fields for review. It exports parsed fields as CSV. Human approval remains required before records are sent.';
const jobs={writer:{result:'success'},checker:{result:'success'},repair:{result:'skipped'},final_check:{result:'skipped'}};
function bind(fixture){
 fixture.context.draftSha256=sha256(stableJSON(fixture.draft));
 fixture.context.sourceSnapshotSha256=sha256(stableJSON(fixture.context.sources));
 Object.assign(fixture.manifest,{draftSha256:fixture.context.draftSha256,sourceSnapshotSha256:fixture.context.sourceSnapshotSha256,policySha256:fixture.context.scoringPolicy.policySha256});
 if(fixture.context.assessmentContractVersion===1)fixture.manifest.completedAssessment={schema:1,completed:true,decision:fixture.draft.posts.length?'assessed':'no_supported_candidate',reason:fixture.draft.posts.length?'Every proposed idea was independently assessed against the frozen public evidence.':'Fresh public evidence describes only previously assessed ideas; no supported new candidate remains.',contextSha256:sha256(stableJSON(fixture.context)),rulesSha256:fixture.context.rulesSha256,draftSha256:fixture.context.draftSha256,sourceSnapshotSha256:fixture.context.sourceSnapshotSha256,policySha256:fixture.context.scoringPolicy.policySha256};
}
function fixture({count=1,legacy=false,mode='hourly'}={}){
 const cadence=mode==='legacy'?{schema:1,mode:'legacy',activatedAt:null,relayConfirmedAt:null}:{schema:1,mode:'hourly',activatedAt:'2026-10-11T00:00:00.000Z',relayConfirmedAt:'2026-10-10T23:00:00.000Z'};
 const scheduling=loopDecision({runId,eventName:'workflow_dispatch',githubRunId:'123',githubRunUrl:'https://github.com/xndanius/while-you-sleep/actions/runs/123',now:new Date(now),cadence,...(legacy?{bootstrap:true,cadence:{schema:1,mode:'legacy',activatedAt:null,relayConfirmedAt:null}}:{})});
 if(legacy)for(const key of ['cadence','assessmentContractVersion','maxBatchSize','attemptCounts'])delete scheduling[key];
 const sources=Array.from({length:Math.max(1,count)},(_,index)=>({id:`source-${index}`,url:`https://example.com/product-${index}`,text,fetchedAt:now,verifiedAt:now}));
 const posts=sources.slice(0,count).map((source,index)=>{
  const id=candidateIdentity({productUrl:source.url});
  const criteria=Object.fromEntries(SCORING_KEYS.map(key=>[key,{value:6,reason:key==='profit'?'Hypothesis: small teams may value reduced receipt administration.':'The source supports bounded receipt extraction with human review.',sourceIds:[source.id]}]));
  return {id,candidateId:id,title:`Receipt review assistant ${index}`,promise:'Turn receipts into a draft for human review.',whatItIs:'A receipt extraction experiment.',whoPays:'Hypothesis: teams with receipt administration.',loop:['Upload a receipt','Extract a draft','Review and export'],evidence:'The source describes extraction and CSV export.',uncertainty:'Demand and revenue are unproved; review remains manual.',first24Hours:['Choose a receipt format.','Extract sample fields.','Build a review screen.'],sourceIds:[source.id],productUrl:source.url,scoring:{criteria}};
 });
 const draft={runId,targetCount:scheduling.targetCount,posts,rejected:[],candidates:[]};
 const context={runId,createdAt:now,rulesSha256:sha256(rules),scoringPolicy:parseScoringPolicy(rules),sources,health:[],deterministicResults:posts.map(post=>({postId:post.id,pass:true,reasons:[]})),...(legacy?{}:{assessmentContractVersion:1})};
 const checks=posts.map((post,index)=>({postId:post.id,pass:true,reasons:[],claimChecks:[
  {claim:'Receipt extraction exists.',supported:true,sourceId:sources[index].id,evidenceQuote:'reads uploaded receipts and extracts structured fields'},
  {claim:'CSV export exists.',supported:true,sourceId:sources[index].id,evidenceQuote:'exports parsed fields as CSV'},
  {claim:'Human review remains.',supported:true,sourceId:sources[index].id,evidenceQuote:'Human approval remains required before records are sent'},
 ],scoreChecks:SCORING_KEYS.map(criterion=>({criterion,supported:true,maxSupportedScore:6,reason:criterion==='profit'?'Hypothesis: an administration buyer without proven demand.':'The source supports a bounded extraction experiment with review.',sourceId:sources[index].id,evidenceQuote:'extracts structured fields for review'}))}));
 const value={scheduling,draft,context,manifest:{runId,checks,checkedAt:now},jobs:structuredClone(jobs)};bind(value);return value;
}
async function execute(t,{count=1,legacy=false,mode='hourly',mutate=()=>{},afterBind=()=>{},script='finalize-run',liveStatus=200,liveText=text,missing}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-assessment-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await cp(new URL('../lib',import.meta.url),path.join(root,'lib'),{recursive:true});
 await mkdir(path.join(root,'public'));for(const file of ['schedule.js','cadence-config.js'])await cp(new URL('../public/'+file,import.meta.url),path.join(root,'public',file));
 await cp(new URL('../scripts',import.meta.url),path.join(root,'scripts'),{recursive:true});
 await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),path.join(root,'node_modules'),'dir');
 await writeFile(path.join(root,'package.json'),JSON.stringify({type:'module'}));await writeFile(path.join(root,'RULES.md'),rules);
 const f=fixture({count,legacy,mode});mutate(f);bind(f);afterBind(f);
 const schedulingSha256=sha256(stableJSON(f.scheduling));
 const research={runId,createdAt:now,sources:f.context.sources,health:[],githubRunUrl:f.scheduling.githubRunUrl};
 for(const [directory,record] of [['scheduling',f.scheduling],['slot-reservations',{...f.scheduling,schedulingSha256}],['drafts',f.draft],['check-context',f.context],['checks',f.manifest],['research',research]]){
  if(directory===missing)continue;await mkdir(path.join(root,'data',directory),{recursive:true});await writeFile(path.join(root,'data',directory,runId+'.json'),JSON.stringify(record));
 }
 const preload=`import dns from 'node:dns/promises';import {syncBuiltinESMExports} from 'node:module';const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[${JSON.stringify(now)}]));}static now(){return NativeDate.parse(${JSON.stringify(now)});}};dns.lookup=async()=>[{address:'203.0.113.10',family:4}];syncBuiltinESMExports();let count=0;globalThis.fetch=async()=>{count++;return new Response(${JSON.stringify(liveText)},{status:${liveStatus},headers:{'content-type':'text/plain'}});};process.on('exit',()=>console.log('FETCH_COUNT '+count));`;
 await writeFile(path.join(root,'preload.mjs'),preload);
 const env={PATH:process.env.PATH,NODE_OPTIONS:`--import=${path.join(root,'preload.mjs')}`,GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',RUN_ID:runId,LOOP_SCHEDULING_SHA:schedulingSha256,EXPECTED_DRAFT_SHA:sha256(stableJSON(f.draft)),EXPECTED_CONTEXT_SHA:sha256(stableJSON(f.context)),RULES_SHA256:f.context.rulesSha256,MODEL_JOB_RESULTS:JSON.stringify(f.jobs),GITHUB_OUTPUT:path.join(root,'outputs')};
 const execution=spawnSync(process.execPath,[`scripts/${script}.mjs`,runId],{cwd:root,env,encoding:'utf8'});
 const record=async directory=>JSON.parse(await readFile(path.join(root,'data',directory,runId+'.json'),'utf8'));
 return {root,f,execution,record,outputs:await readFile(path.join(root,'outputs'),'utf8').catch(()=>''),env};
}

test('completion binds every fingerprint and exact known decisions, including an empty assessment',()=>{
 const f=fixture();assert.deepEqual(completedAssessmentReasons(f.draft,f.context,f.manifest),[]);
 for(const corrupt of [value=>delete value.manifest.completedAssessment,value=>value.manifest.completedAssessment.contextSha256='a'.repeat(64),value=>value.manifest.completedAssessment.rulesSha256='a'.repeat(64),value=>value.manifest.completedAssessment.policySha256='a'.repeat(64),value=>value.manifest.checks=[],value=>value.manifest.checks.push({...value.manifest.checks[0],postId:'unknown'}),value=>value.manifest.checks.push(value.manifest.checks[0]),value=>value.manifest.checks[0].claimChecks[0].evidenceQuote='This text never appeared in the fetched source.',value=>value.manifest.checks[0].scoreChecks[0].maxSupportedScore=11]){
  const changed=fixture();corrupt(changed);assert.ok(completedAssessmentReasons(changed.draft,changed.context,changed.manifest).length);
 }
 const empty=fixture({count:0});assert.deepEqual(completedAssessmentReasons(empty.draft,empty.context,empty.manifest),[]);
 empty.context.sources=[];bind(empty);assert.ok(completedAssessmentReasons(empty.draft,empty.context,empty.manifest).length);
});

test('trusted completion requires successful applicable model jobs; input labels cannot conceal a failed repair',()=>{
 assert.deepEqual(assessmentJobReasons({},jobs,{required:true}),[]);
 assert.ok(assessmentJobReasons({},undefined,{required:true}).length);
 assert.ok(assessmentJobReasons({}, {...jobs,checker:{result:'failure'}},{required:true}).length);
 assert.ok(assessmentJobReasons({}, {...jobs,repair:{result:'failure'}},{required:true}).length);
 assert.ok(assessmentJobReasons({repairAttempt:1},jobs,{required:true}).length);
 assert.deepEqual(assessmentJobReasons({repairAttempt:1},{...jobs,repair:{result:'success'},final_check:{result:'success'}},{required:true}),[]);
});

test('a genuinely checked below-threshold refusal settles green without publishing, repair or quota retry',async t=>{
 const result=await execute(t,{mode:'legacy',mutate:f=>{for(const rating of Object.values(f.draft.posts[0].scoring.criteria))rating.value=5;}});
 assert.equal(result.execution.status,0,result.execution.stderr);assert.match(result.outputs,/operational_failure=false/);
 const run=await result.record('runs'),outcome=await result.record('slot-outcomes');
 assert.equal(run.status,'completed_no_post');assert.equal(run.assessmentOutcome,'completed');assert.deepEqual(run.published,[]);assert.equal(run.checkedAssessment.checkedPostIds.length,1);
 assert.equal(outcome.status,'no_post');assert.ok(outcome.slotOutcomes.every(slot=>slot.status==='no_post'));assert.match(outcome.slotOutcomes[0].reason,/below the frozen publish threshold/);
 const next=loopDecision({...result.f.scheduling,now:new Date(now),reservations:[{...result.f.scheduling,schedulingSha256:result.env.LOOP_SCHEDULING_SHA}],outcomes:[outcome]});
 assert.equal(next.decision,'skip');assert.equal(next.reason,'slots_terminally_assessed');assert.equal(next.slotIds.some(id=>result.f.scheduling.slotIds.includes(id)),false);
 const verdict=await execute(t,{script:'check-verdict',mutate:f=>{for(const rating of Object.values(f.draft.posts[0].scoring.criteria))rating.value=5;}});
 assert.equal(verdict.execution.status,0,verdict.execution.stderr);assert.match(verdict.outputs,/repair=false/);
});

test('unrounded checked mean below six remains a green terminal refusal even when displayed as six',async t=>{
 const result=await execute(t,{mutate:f=>{f.draft.posts[0].scoring.criteria.evidence.value=5;f.context.scoringPolicy=parseScoringPolicy(rules.replace('"evidence":1','"evidence":0.1'));}});
 assert.equal(result.execution.status,0,result.execution.stderr);assert.equal((await result.record('runs')).assessmentOutcome,'completed');assert.equal((await result.record('slot-outcomes')).status,'no_post');assert.match(result.execution.stdout,/FETCH_COUNT 0/);
});

test('mixed six-slot batch publishes two checked ideas and terminally closes remaining slots',async t=>{
 const result=await execute(t,{count:6,mutate:f=>{for(const post of f.draft.posts.slice(2))for(const rating of Object.values(post.scoring.criteria))rating.value=5;}});
 assert.equal(result.execution.status,0,result.execution.stderr);const run=await result.record('runs'),outcome=await result.record('slot-outcomes');
 assert.equal(run.published.length,2);assert.equal(run.assessmentOutcome,'completed');assert.equal(outcome.slotOutcomes.filter(slot=>slot.status==='published').length,2);assert.equal(outcome.slotOutcomes.filter(slot=>slot.status==='no_post').length,4);
 for(const id of run.published)assert.equal(verifyPublishedPost(JSON.parse(await readFile(path.join(result.root,'data','posts',id+'.json'),'utf8'))),true);
});

test('well formed independent rejection after one repair is terminal, with no fake approved scores',async t=>{
 const result=await execute(t,{mutate:f=>{
  f.draft.repairAttempt=1;f.jobs.repair.result='success';f.jobs.final_check.result='success';
  f.manifest.checks[0].pass=false;f.manifest.checks[0].reasons=['The source does not substantiate the proposed customer attribution.'];f.manifest.checks[0].claimChecks[0].supported=false;
 }});
 assert.equal(result.execution.status,0,result.execution.stderr);const run=await result.record('runs');assert.equal(run.assessmentOutcome,'completed');assert.deepEqual(run.checkedAssessment.checkedPostIds,[]);assert.equal((await result.record('slot-outcomes')).status,'no_post');
});

test('independently checked empty research stays green but never produces scored candidate metrics',async t=>{
 const result=await execute(t,{count:0});assert.equal(result.execution.status,0,result.execution.stderr);
 const run=await result.record('runs');assert.equal(run.assessmentOutcome,'completed');assert.equal(run.picked,0);assert.deepEqual(run.checkedAssessment.checkedPostIds,[]);assert.equal(run.checkedAssessment.decision,'no_supported_candidate');assert.equal((await result.record('slot-outcomes')).status,'no_post');
 const prepare=await execute(t,{count:0,script:'prepare-check'});assert.equal(prepare.execution.status,0,prepare.execution.stderr);assert.ok((await prepare.record('check-context')).sources.length);
 const unavailable=await execute(t,{count:0,script:'prepare-check',liveStatus:503});assert.equal(unavailable.execution.status,1);assert.match(unavailable.execution.stderr,/empty assessment needs at least one/);
});

test('missing checks, corrupt completion, unavailable sources and failed model stages remain operational',async t=>{
 for(const options of [{missing:'checks'},{afterBind:f=>delete f.manifest.completedAssessment},{afterBind:f=>f.manifest.completedAssessment.rulesSha256='a'.repeat(64)},{afterBind:f=>f.manifest.checks=[]},{liveStatus:503},{count:0,liveStatus:503},{mutate:f=>f.jobs.repair.result='failure'}]){
  const result=await execute(t,options);assert.equal(result.execution.status,0,result.execution.stderr,'finalizer persists failure before the separate hosted status check');
  const run=await result.record('runs'),outcome=await result.record('slot-outcomes');assert.equal(run.assessmentOutcome,'incomplete');assert.ok(run.operationalFailures.length);assert.equal(outcome.status,'failed_retryable');assert.match(result.outputs,/operational_failure=true/);
 }
});

test('third operational attempt is durably exhausted while a missing assessment never becomes no_post',async t=>{
 const result=await execute(t,{liveStatus:503,mutate:f=>{for(const id of f.scheduling.slotIds)f.scheduling.attemptCounts[id]=3;}});
 const run=await result.record('runs'),outcome=await result.record('slot-outcomes');assert.equal(run.assessmentOutcome,'incomplete');assert.equal(outcome.status,'retry_exhausted');assert.ok(outcome.slotOutcomes.every(slot=>slot.status==='retry_exhausted'));assert.match(result.outputs,/operational_failure=true/);
});

test('legacy cap-three reservations retain their original checker contract and rejection behavior',async t=>{
 const positive=await execute(t,{legacy:true});assert.equal(positive.execution.status,0,positive.execution.stderr);assert.equal((await positive.record('runs')).published.length,1);assert.equal((await positive.record('runs')).checkedAssessment,undefined);
 const refusal=await execute(t,{legacy:true,mutate:f=>{for(const rating of Object.values(f.draft.posts[0].scoring.criteria))rating.value=5;}});assert.equal((await refusal.record('slot-outcomes')).status,'failed_retryable');assert.equal((await refusal.record('runs')).checkedAssessment,undefined);
});
