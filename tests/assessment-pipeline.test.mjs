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
import {checkerOutputSchema,acceptCheckerOutput,unverifiedAssessment} from '../lib/checker-output.mjs';
import {slotOutcome} from '../lib/loop-schedule.mjs';
import {createNoveltyContext} from '../lib/novelty.mjs';

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
async function execute(t,{count=1,legacy=false,mode='hourly',mutate=()=>{},afterBind=()=>{},mutateResearch=()=>{},script='finalize-run',liveStatus=200,liveText=text,liveByUrl={},checkerResponse,missing,relayConfirmed=true}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-assessment-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await cp(new URL('../lib',import.meta.url),path.join(root,'lib'),{recursive:true});
 await mkdir(path.join(root,'public'));for(const file of ['schedule.js','cadence-config.js'])await cp(new URL('../public/'+file,import.meta.url),path.join(root,'public',file));
 await cp(new URL('../scripts',import.meta.url),path.join(root,'scripts'),{recursive:true});
 await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),path.join(root,'node_modules'),'dir');
 await writeFile(path.join(root,'package.json'),JSON.stringify({type:'module'}));await writeFile(path.join(root,'RULES.md'),rules);
 await mkdir(path.join(root,'data','relay'),{recursive:true});await writeFile(path.join(root,'data','relay','status.json'),JSON.stringify({feedPath:'best.xml',bestFeedSwitch:{state:relayConfirmed?'confirmed':'pending',confirmedAt:relayConfirmed?now:null}}));
 const f=fixture({count,legacy,mode});mutate(f);bind(f);afterBind(f);
 const schedulingSha256=sha256(stableJSON(f.scheduling));
 const research={runId,createdAt:now,sources:f.context.sources,health:[],githubRunUrl:f.scheduling.githubRunUrl};
 mutateResearch(research);
 for(const [directory,record] of [['scheduling',f.scheduling],['slot-reservations',{...f.scheduling,schedulingSha256}],['drafts',f.draft],['check-context',f.context],['checks',f.manifest],['research',research]]){
  if(directory===missing)continue;await mkdir(path.join(root,'data',directory),{recursive:true});await writeFile(path.join(root,'data',directory,runId+'.json'),JSON.stringify(record));
 }
 if(checkerResponse){await mkdir(path.join(root,'.run'),{recursive:true});await writeFile(path.join(root,'.run','checker-response.json'),JSON.stringify(typeof checkerResponse==='function'?checkerResponse(f):checkerResponse));}
 const preload=`import dns from 'node:dns/promises';import {syncBuiltinESMExports} from 'node:module';const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[${JSON.stringify(now)}]));}static now(){return NativeDate.parse(${JSON.stringify(now)});}};dns.lookup=async()=>[{address:'203.0.113.10',family:4}];syncBuiltinESMExports();let count=0;const mapped=${JSON.stringify(liveByUrl)};globalThis.fetch=async url=>{count++;const match=mapped[url];return new Response(match?.text??${JSON.stringify(liveText)},{status:match?.status??${liveStatus},headers:{'content-type':'text/plain'}});};process.on('exit',()=>console.log('FETCH_COUNT '+count));`;
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
 assert.deepEqual(assessmentJobReasons({}, {...jobs,repair:{result:'success'},final_check:{result:'success'}},{required:true}),[],'actual repair success survives a model rewrite that omits repairAttempt');
 for(const result of ['failure','cancelled','skipped'])assert.ok(assessmentJobReasons({}, {...jobs,repair:{result:'success'},final_check:{result}},{required:true}).length);
});

test('fresh structured checker output can carry an independently completed empty verdict but never fabricates one',()=>{
 const f=fixture({count:0}),response={outcome:'completed',reason:'The independently examined exclusions lack sufficient support.',manifest:f.manifest};
 const expected={expectedDraftSha256:sha256(stableJSON(f.draft)),expectedContextSha256:sha256(stableJSON(f.context))};
 assert.equal(acceptCheckerOutput(response,f.draft,f.context,expected),f.manifest);
 assert.throws(()=>acceptCheckerOutput({...response,outcome:'operational_failure',manifest:null},f.draft,f.context,expected),/operational failure/);
 assert.throws(()=>acceptCheckerOutput({...response,manifest:null},f.draft,f.context,expected),/completed manifest/);
 assert.throws(()=>acceptCheckerOutput(response,f.draft,f.context,{...expected,existing:{...f.manifest,draftSha256:'a'.repeat(64)}}),/disagree/);
 assert.throws(()=>acceptCheckerOutput(response,f.draft,f.context,{...expected,expectedContextSha256:'a'.repeat(64)}),/trusted frozen/);
 const bad=structuredClone(response);bad.manifest.completedAssessment.contextSha256='a'.repeat(64);assert.throws(()=>acceptCheckerOutput(bad,f.draft,f.context,expected),/fingerprints/);
 const schema=checkerOutputSchema(f.draft,f.context),manifestSchema=schema.properties.manifest.anyOf[1];
 assert.equal(manifestSchema.properties.checks.maxItems,0);assert.deepEqual(manifestSchema.properties.completedAssessment.properties.contextSha256.enum,[expected.expectedContextSha256]);
 assert.equal(schema.properties.outcome.enum.includes('operational_failure'),true);
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
 const meetingText='The product reads meeting transcripts and extracts decisions for review. It exports action items as CSV. Human approval remains required before follow-ups are sent.';
 const result=await execute(t,{count:6,liveText:text+' '+meetingText,mutate:f=>{
  for(const post of f.draft.posts.slice(2))for(const rating of Object.values(post.scoring.criteria))rating.value=5;
  const post=f.draft.posts[1],source=f.context.sources[1],check=f.manifest.checks[1];source.url='https://meeting-example.org/product';source.text=meetingText;
  Object.assign(post,{productUrl:source.url,title:'Meeting decision assistant',promise:'Turn meetings into a draft action list.',whatItIs:'A meeting transcript experiment.',whoPays:'Hypothesis: architectural practices may value decision follow-ups.',loop:['Read a meeting transcript','Extract decisions','Review and export action items'],evidence:'The source describes decision extraction and action-list export.',first24Hours:['Choose a transcript format.','Extract sample decisions.','Build an action review screen.']});post.id=candidateIdentity(post);post.candidateId=post.id;check.postId=post.id;f.context.deterministicResults[1].postId=post.id;
  check.claimChecks=[{claim:'Decision extraction exists.',supported:true,sourceId:source.id,evidenceQuote:'reads meeting transcripts and extracts decisions for review'},{claim:'Action export exists.',supported:true,sourceId:source.id,evidenceQuote:'exports action items as CSV'},{claim:'Human review remains.',supported:true,sourceId:source.id,evidenceQuote:'Human approval remains required before follow-ups are sent'}];
  for(const rating of Object.values(post.scoring.criteria))rating.reason=rating===post.scoring.criteria.profit?'Hypothesis: an architectural buyer may value decision follow-ups.':'The source supports bounded meeting decision extraction.';
  for(const score of check.scoreChecks){score.reason=score.criterion==='profit'?'Hypothesis: an architectural buyer without proven demand.':'A bounded decision extraction experiment with review.';score.evidenceQuote='extracts decisions for review';}
 }});
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

test('repair may legitimately return no posts without retaining a model-owned repair marker',async t=>{
 const result=await execute(t,{count:0,mutate:f=>{f.jobs.repair.result='success';f.jobs.final_check.result='success';}});
 assert.equal(result.execution.status,0,result.execution.stderr);assert.equal(result.f.draft.repairAttempt,undefined);
 assert.equal((await result.record('runs')).assessmentOutcome,'completed');assert.equal((await result.record('slot-outcomes')).status,'no_post');assert.match(result.outputs,/operational_failure=false/);
});

test('empty assessment refetch covers each actual exclusion rather than arbitrary first-six source records',async t=>{
 const result=await execute(t,{count:8,script:'prepare-check',mutate:f=>{
  f.draft.candidates=f.draft.posts.map(post=>({title:post.title,productUrl:post.productUrl,sourceIds:post.sourceIds}));f.draft.posts=[];
 }});
 assert.equal(result.execution.status,0,result.execution.stderr);const context=await result.record('check-context');
 assert.equal(context.sources.length,8);assert.equal(context.considerationEvidence.length,8);assert.ok(context.considerationEvidence.every(item=>item.availableSourceIds.length===1));
});

test('new enriched snapshots restrict assessments to their selected product identities',async t=>{
 const accepted=await execute(t,{script:'prepare-check',mutateResearch:research=>research.enrichment={status:'completed',observations:[{productUrl:research.sources[0].url}]}});
 assert.equal(accepted.execution.status,0,accepted.execution.stderr);
 const outside=await execute(t,{script:'prepare-check',mutateResearch:research=>research.enrichment={status:'completed',observations:[{productUrl:'https://example.com/another-product'}]}});
 assert.equal(outside.execution.status,1);assert.match(outside.execution.stderr,/outside the bounded primary evidence selection/);
 const ordinary=await execute(t,{script:'prepare-check',mutateResearch:research=>research.enrichment={status:'not_requested',observations:[]}});
 assert.equal(ordinary.execution.status,0,ordinary.execution.stderr);
});

test('every independent checker starts without a stale inherited manifest and gets a non-verdict hash template',async t=>{
 const result=await execute(t,{count:0,script:'prepare-run'});
 const execution=spawnSync(process.execPath,['scripts/prepare-run.mjs','final-checker'],{cwd:result.root,env:result.env,encoding:'utf8'});
 assert.equal(execution.status,0,execution.stderr);
 await assert.rejects(readFile(path.join(result.root,'data','checks',runId+'.json'),'utf8'),error=>error.code==='ENOENT');
 const context=JSON.parse(await readFile(path.join(result.root,'.run','context.json'),'utf8')),template=JSON.parse(await readFile(path.join(result.root,'.run','checker-template.json'),'utf8'));
 assert.equal(context.checkContextSha256,sha256(stableJSON(result.f.context)));assert.equal(template.completedAssessment.completed,false);assert.equal(template.completedAssessment.contextSha256,context.checkContextSha256);assert.equal(context.priorPostsPath,'.run/prior-posts.json');
});

test('pending relay holds eligible publication but honest checked threshold refusal stays green',async t=>{
 const held=await execute(t,{relayConfirmed:false});const heldRun=await held.record('runs');assert.equal(heldRun.assessmentOutcome,'unverified');assert.deepEqual(heldRun.published,[]);assert.ok(heldRun.operationalFailures.some(failure=>failure.code==='relay_confirmation_pending'));
 const refusal=await execute(t,{relayConfirmed:false,mutate:f=>{for(const rating of Object.values(f.draft.posts[0].scoring.criteria))rating.value=5;}});
 assert.equal((await refusal.record('runs')).assessmentOutcome,'completed');assert.equal((await refusal.record('slot-outcomes')).status,'no_post');assert.match(refusal.outputs,/operational_failure=false/);
});

test('missing checks, corrupt completion, unavailable sources and failed model stages safely close as unverified without approvals',async t=>{
 for(const options of [{missing:'checks'},{afterBind:f=>delete f.manifest.completedAssessment},{afterBind:f=>f.manifest.completedAssessment.rulesSha256='a'.repeat(64)},{afterBind:f=>f.manifest.checks=[]},{liveStatus:503},{count:0,liveStatus:503},{count:0,liveStatus:429},{mutate:f=>f.jobs.repair.result='failure'}]){
  const result=await execute(t,options);assert.equal(result.execution.status,0,result.execution.stderr,'finalizer persists failure before the separate hosted status check');
  const run=await result.record('runs'),outcome=await result.record('slot-outcomes');assert.equal(run.assessmentOutcome,'unverified');assert.equal(run.status,'no_post_unverified');assert.ok(run.operationalFailures.length);assert.equal(run.checkedAssessment,undefined);assert.equal(run.unverifiedAssessment.completed,false);assert.equal(outcome.status,'no_post_unverified');assert.match(result.outputs,/operational_failure=false/);assert.deepEqual(run.published,[]);
  const next=loopDecision({...result.f.scheduling,now:new Date(now),reservations:[{...result.f.scheduling,schedulingSha256:result.env.LOOP_SCHEDULING_SHA}],outcomes:[outcome]});
  assert.equal(next.slotIds.some(id=>result.f.scheduling.slotIds.includes(id)),false,'an unverified hour cannot spend on the same slot again');
  if(options.liveStatus===429)assert.match(run.unverifiedAssessment.reason,/HTTP 429/);
 }
});

test('unverified content closes even a former third retry without claiming an independent assessment',async t=>{
 const result=await execute(t,{liveStatus:503,mutate:f=>{for(const id of f.scheduling.slotIds)f.scheduling.attemptCounts[id]=3;}});
 const run=await result.record('runs'),outcome=await result.record('slot-outcomes');assert.equal(run.assessmentOutcome,'unverified');assert.equal(outcome.status,'no_post_unverified');assert.ok(outcome.slotOutcomes.every(slot=>slot.status==='no_post_unverified'));assert.equal(run.checkedAssessment,undefined);assert.match(result.outputs,/operational_failure=false/);
});

test('legacy cap-three reservations retain their original checker contract and rejection behavior',async t=>{
 const positive=await execute(t,{legacy:true});assert.equal(positive.execution.status,0,positive.execution.stderr);assert.equal((await positive.record('runs')).published.length,1);assert.equal((await positive.record('runs')).checkedAssessment,undefined);
 const refusal=await execute(t,{legacy:true,mutate:f=>{for(const rating of Object.values(f.draft.posts[0].scoring.criteria))rating.value=5;}});assert.equal((await refusal.record('slot-outcomes')).status,'failed_retryable');assert.equal((await refusal.record('runs')).checkedAssessment,undefined);
});

test('writer receives selected evidence, recent provisional decisions and the exact unchanged scoring policy',async t=>{
 const result=await execute(t,{count:0,script:'prepare-run'});
 const execution=spawnSync(process.execPath,['scripts/prepare-run.mjs','writer'],{cwd:result.root,env:result.env,encoding:'utf8'});assert.equal(execution.status,0,execution.stderr);
 const context=JSON.parse(await readFile(path.join(result.root,'.run','context.json'),'utf8'));
 assert.deepEqual(context.scoringPolicy,parseScoringPolicy(rules));assert.equal(context.scoringPolicy.threshold,6);assert.equal(context.originalResearchPath,`data/research/${runId}.json`);assert.equal(context.researchPath,'.run/writer-research.json');assert.deepEqual(JSON.parse(await readFile(path.join(result.root,context.recentRejectionsPath),'utf8')),[]);
 const view=JSON.parse(await readFile(path.join(result.root,context.researchPath),'utf8'));assert.deepEqual(view.sources,result.f.context.sources);
});

test('acceptance preserves an explicit independent refusal as a neutral trusted output and deletes stale model files',async t=>{
 const result=await execute(t,{count:0,script:'accept-check-output',checkerResponse:{outcome:'operational_failure',reason:'Primary-fetch diagnostics for four excluded products are unavailable.',manifest:null}});
 assert.equal(result.execution.status,0,result.execution.stderr);assert.match(result.outputs,/verified=false/);assert.match(result.outputs,/unverified_code=checker_examination_unverified/);assert.match(result.outputs,/four excluded products/);
 await assert.rejects(result.record('checks'),error=>error.code==='ENOENT');
 const finalized=spawnSync(process.execPath,['scripts/finalize-run.mjs',runId],{cwd:result.root,env:{...result.env,MODEL_JOB_RESULTS:JSON.stringify({...jobs,checker:{result:'success',outputs:{verified:'false',unverified_code:'checker_examination_unverified',unverified_reason:'Primary-fetch diagnostics for four excluded products are unavailable.'}}})},encoding:'utf8'});
 assert.equal(finalized.status,0,finalized.stderr);
 const run=await result.record('runs');assert.equal(run.status,'no_post_unverified');assert.match(run.unverifiedAssessment.reason,/four excluded products/);assert.equal(run.checkedAssessment,undefined);assert.equal((await result.record('slot-outcomes')).status,'no_post_unverified');
});

test('missing or stale structured checker output stays unverified with no invented manifest',async t=>{
 for(const options of [{},{checkerResponse:f=>({outcome:'completed',reason:'A purported completed output.',manifest:{...f.manifest,draftSha256:'a'.repeat(64)}})}]){
  const result=await execute(t,{count:0,script:'accept-check-output',...options});assert.equal(result.execution.status,0,result.execution.stderr);assert.match(result.outputs,/verified=false/);await assert.rejects(result.record('checks'),error=>error.code==='ENOENT');
 }
 const valid=await execute(t,{count:0,script:'accept-check-output',checkerResponse:f=>({outcome:'completed',reason:'Fresh exclusions were independently examined.',manifest:f.manifest})});assert.match(valid.outputs,/verified=true/);assert.deepEqual(await valid.record('checks'),valid.f.manifest);
});

test('a final checker refusal after a successful repair cannot fall back to the first manifest',async t=>{
 const reason='Fresh primary-fetch diagnostics for VendIQ and Lumro are unavailable.';
 const result=await execute(t,{count:0,script:'accept-check-output',checkerResponse:{outcome:'operational_failure',reason,manifest:null}});
 const modelJobs={...jobs,checker:{result:'success',outputs:{verified:'true',model_completed:'true'}},repair:{result:'success',outputs:{model_completed:'true'}},final_check:{result:'success',outputs:{verified:'false',model_completed:'true',unverified_code:'checker_examination_unverified',unverified_reason:reason}}};
 const finalized=spawnSync(process.execPath,['scripts/finalize-run.mjs',runId],{cwd:result.root,env:{...result.env,MODEL_JOB_RESULTS:JSON.stringify(modelJobs)},encoding:'utf8'});
 assert.equal(finalized.status,0,finalized.stderr);const run=await result.record('runs');assert.equal(run.status,'no_post_unverified');assert.equal(run.unverifiedAssessment.reason,reason);assert.equal(run.checkedAssessment,undefined);assert.deepEqual(run.published,[]);assert.equal((await result.record('slot-outcomes')).status,'no_post_unverified');
});

test('unverified settlement is exact, reservation-bound and cannot be forged into a checked assessment',()=>{
 const f=fixture(),reservation={...f.scheduling,schedulingSha256:sha256(stableJSON(f.scheduling))};
 const run={id:runId,status:'no_post_unverified',assessmentOutcome:'unverified',published:[],unverifiedAssessment:unverifiedAssessment(f.scheduling,{stage:'check',code:'checker_examination_unverified',reason:'Fresh source verification did not complete.'},now)};
 assert.equal(slotOutcome(reservation,run,{now}).status,'no_post_unverified');
 for(const corrupt of [value=>value.unverifiedAssessment.completed=true,value=>value.unverifiedAssessment.schedulingSha256='a'.repeat(64),value=>value.unverifiedAssessment.slotIds=[],value=>value.unverifiedAssessment.runId='other',value=>value.unverifiedAssessment.extra=true,value=>value.checkedAssessment={},value=>value.assessmentOutcome='completed',value=>value.unverifiedAssessment.completedAt='2026-10-11T15:00:00.000Z']){
  const changed=structuredClone(run);corrupt(changed);assert.equal(slotOutcome(reservation,changed,{now}).status,'failed_retryable');
 }
 const previous={...reservation};delete previous.assessmentContractVersion;assert.equal(slotOutcome(previous,run,{now}).status,'failed_retryable','historical reservations retain their recorded semantics');
});

test('fresh empty context records a failed primary request separately from available discovery evidence',async t=>{
 const product='https://product.example.com/workflow';
 const result=await execute(t,{count:0,script:'prepare-check',mutate:f=>{f.context.sources[0].productUrl=product;f.draft.candidates=[{title:'A primary page that is unavailable',productUrl:product,sourceIds:[f.context.sources[0].id]}];},liveByUrl:{[product]:{status:403,text:'Forbidden'}}});
 assert.equal(result.execution.status,0,result.execution.stderr);const context=await result.record('check-context');
 assert.equal(context.primaryFetchDiagnostics.length,1);assert.equal(context.primaryFetchDiagnostics[0].status,'failed');assert.match(context.primaryFetchDiagnostics[0].reason,/HTTP 403/);assert.equal(context.primaryFetchDiagnostics[0].sourceId,null);assert.equal(context.sources.length,1);assert.deepEqual(context.considerationEvidence[0].availableSourceIds,['source-0']);assert.ok(context.health.some(failure=>failure.url===product));
});

test('novelty output schema freezes the complete index and missing novelty examination is never accepted',()=>{
 const f=fixture();f.context.noveltyContractVersion=1;f.context.noveltyContext=createNoveltyContext([],{now});
 f.manifest.checks[0].noveltyCheck={recentPostsSha256:f.context.noveltyContext.postsSha256,windowDays:14,comparedPostCount:0,...Object.fromEntries(['product','workflow','customer'].map(dimension=>[dimension,{distinct:true,closestPostId:null,reason:'The frozen recent index is empty.'}]))};bind(f);
 assert.deepEqual(completedAssessmentReasons(f.draft,f.context,f.manifest),[]);
 const schema=checkerOutputSchema(f.draft,f.context).properties.manifest.anyOf[1].properties.checks.items.properties.noveltyCheck;
 assert.deepEqual(schema.properties.recentPostsSha256.enum,[f.context.noveltyContext.postsSha256]);assert.deepEqual(schema.properties.comparedPostCount.enum,[0]);
 delete f.manifest.checks[0].noveltyCheck;assert.ok(completedAssessmentReasons(f.draft,f.context,f.manifest).some(reason=>/novelty/.test(reason)));
});

test('workflow neutral content errors retain explicit model outcomes and only verified checker output can trigger a repair',async()=>{
 const workflow=await readFile(new URL('../.github/workflows/loop.yml',import.meta.url),'utf8');
 const job=name=>workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [A-Za-z][A-Za-z_-]*:|$(?![\\s\\S]))`,'m'))?.[1]||'';
 for(const name of ['writer','checker','repair','final_check']){
  const text=job(name);assert.match(text,/id: model\n(?:        if: [^\n]+\n)?        continue-on-error: true\n        uses: openai\/codex-action@/);assert.match(text,/model_completed: .*steps.model.outcome == 'success'/);
 }
 for(const name of ['checker','final_check']){assert.match(job(name),/verified: .*steps.accept.outputs.verified/);assert.match(job(name),/id: accept\n        if: always\(\)/);}
 assert.match(job('repair'),/if: .*outputs.verified == 'true'/);
 assert.match(job('record'),/name: .*final_check.result != 'skipped'/);
 assert.ok(job('record').split('\n').filter(line=>line.includes('EXPECTED_CONTEXT_SHA:')).every(line=>line.includes("final_check.outputs.context_sha256 != ''")));
});
