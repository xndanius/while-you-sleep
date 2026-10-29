import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {candidateIdentity,hash,sha256,stableJSON} from '../lib/storage.mjs';
import {completedAssessmentReasons,assessmentJobReasons,verifyPublishedPost,checkApproval} from '../lib/validation.mjs';
import {parseScoringPolicy,SCORING_KEYS} from '../lib/scoring.mjs';
import {loopDecision} from '../lib/loop-schedule.mjs';
import {checkerOutputSchema,acceptCheckerOutput,unverifiedAssessment} from '../lib/checker-output.mjs';
import {slotOutcome} from '../lib/loop-schedule.mjs';
import {createNoveltyContext} from '../lib/novelty.mjs';
import {enrichProductLeads} from '../lib/product-evidence.mjs';
import {writerResearchView} from '../lib/candidate-input.mjs';
import {DEMAND_SOURCE_CATALOG,parseDemandSourcePage} from '../lib/demand-sources.mjs';
import {selectLearningTargets} from '../lib/learning.mjs';
import {plainText} from '../lib/research.mjs';
import {privateArtifactCategories} from '../lib/privacy.mjs';
import {DISCUSSION_SOURCE_CATALOG,makeDiscussionSource} from '../lib/discussion-sources.mjs';
import {demandContextReasons,demandContextHash} from '../lib/demand.mjs';
import {SOURCE_PARSER_VERSION} from '../lib/research.mjs';
import {selectDiscussionImplementationReferences} from '../lib/discussion-implementation.mjs';
import {buildNativeReadingContext,nativeReadingContextReasons,normalizeNativePost} from '../lib/native-reading-context.mjs';

const now='2026-10-11T12:20:00.000Z',runId='loop-123-1';
const rules='# Rules\n<!-- scoring-policy:start -->\n```json\n{"weights":{"ease":1,"profit":1,"feasibility":1,"autonomy":1,"evidence":1},"publishThreshold":6}\n```\n<!-- scoring-policy:end -->\n';
const text='The product reads uploaded receipts and extracts structured fields for review. It exports parsed fields as CSV. Human approval remains required before records are sent.';
const jobs={writer:{result:'success'},checker:{result:'success'},repair:{result:'skipped'},final_check:{result:'skipped'}};

test('a privacy hold before model access truthfully records no model execution',async t=>{
 const result=await execute(t,{missing:'research',mutate:f=>{f.jobs={writer:{result:'success',outputs:{scan_privacy_safe:'false',model_attempted:'false',model_completed:'false'}},checker:{result:'skipped'},repair:{result:'skipped'},final_check:{result:'skipped'}};}});
 assert.equal(result.execution.status,0,result.execution.stderr);const run=await result.record('runs');assert.equal(run.modelExecuted,false);assert.equal(run.assessmentOutcome,'unverified');assert.deepEqual(run.published,[]);assert.equal(run.operationalFailures[0].code,'content_privacy_unverified');
});
test('privacy withholding after actual model attempts does not erase their execution or create an approval',async t=>{
 const result=await execute(t,{missing:'research',mutate:f=>{f.jobs={writer:{result:'success',outputs:{model_attempted:'true',model_completed:'true'}},checker:{result:'success',outputs:{model_attempted:'true',model_completed:'true',privacy_safe:'false'}},repair:{result:'skipped'},final_check:{result:'skipped'}};}});
 assert.equal(result.execution.status,0,result.execution.stderr);const run=await result.record('runs');assert.equal(run.modelExecuted,true);assert.equal(run.assessmentOutcome,'unverified');assert.deepEqual(run.published,[]);assert.equal(run.checkedAssessment,undefined);assert.equal(run.operationalFailures[0].code,'content_privacy_unverified');
});
test('inconclusive failed model outcomes remain unknown even if research exists',async t=>{
 const result=await execute(t,{missing:'checks',mutate:f=>{f.jobs={writer:{result:'failure'},checker:{result:'skipped'},repair:{result:'skipped'},final_check:{result:'skipped'}};}});
 assert.equal(result.execution.status,0,result.execution.stderr);const run=await result.record('runs');assert.equal(run.modelExecuted,null);assert.equal(run.assessmentOutcome,'unverified');assert.deepEqual(run.published,[]);assert.equal(run.checkedAssessment,undefined);
});
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
async function execute(t,{count=1,legacy=false,mode='hourly',mutate=()=>{},afterBind=()=>{},mutateResearch=()=>{},script='finalize-run',liveStatus=200,liveText=text,liveByUrl={},checkerResponse,missing,relayConfirmed=true,extraRecords=[],envOverrides={}}={}){
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
 for(const [directory,record,name=runId] of [['scheduling',f.scheduling],['slot-reservations',{...f.scheduling,schedulingSha256}],['drafts',f.draft],['check-context',f.context],['checks',f.manifest],['research',research],...extraRecords]){
  if(directory===missing)continue;await mkdir(path.join(root,'data',directory),{recursive:true});await writeFile(path.join(root,'data',directory,name+'.json'),JSON.stringify(record));
 }
 if(checkerResponse){await mkdir(path.join(root,'.run'),{recursive:true});await writeFile(path.join(root,'.run','checker-response.json'),JSON.stringify(typeof checkerResponse==='function'?checkerResponse(f):checkerResponse));}
 const preload=`import dns from 'node:dns/promises';import {syncBuiltinESMExports} from 'node:module';const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[${JSON.stringify(now)}]));}static now(){return NativeDate.parse(${JSON.stringify(now)});}};dns.lookup=async()=>[{address:'203.0.113.10',family:4}];syncBuiltinESMExports();let count=0;const mapped=${JSON.stringify(liveByUrl)};globalThis.fetch=async url=>{count++;const match=mapped[url];return new Response(match?.text??${JSON.stringify(liveText)},{status:match?.status??${liveStatus},headers:{'content-type':'text/plain',...(match?.headers||{})}});};process.on('exit',()=>console.log('FETCH_COUNT '+count));`;
 await writeFile(path.join(root,'preload.mjs'),preload);
 const env={PATH:process.env.PATH,NODE_OPTIONS:`--import=${path.join(root,'preload.mjs')}`,GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',RUN_ID:runId,LOOP_SCHEDULING_SHA:schedulingSha256,EXPECTED_DRAFT_SHA:sha256(stableJSON(f.draft)),EXPECTED_CONTEXT_SHA:sha256(stableJSON(f.context)),RULES_SHA256:f.context.rulesSha256,MODEL_JOB_RESULTS:JSON.stringify(f.jobs),GITHUB_OUTPUT:path.join(root,'outputs'),...envOverrides};
 const execution=spawnSync(process.execPath,[`scripts/${script}.mjs`,runId],{cwd:root,env,encoding:'utf8'});
 const record=async directory=>JSON.parse(await readFile(path.join(root,'data',directory,runId+'.json'),'utf8'));
 return {root,f,execution,record,outputs:await readFile(path.join(root,'outputs'),'utf8').catch(()=>''),env};
}

test('identified native first-post context reaches the real checker preparation and inspector without private text or extra reads',async t=>{
 const definition=DISCUSSION_SOURCE_CATALOG.find(source=>source.community==='Make community'),url='https://community.make.com/t/54321',createdAt='2026-10-11T10:00:00.000Z';
 const task='Our team manually maps invoice rows every week. We need a draft mapping for review.';
 const detail='Each input row contains an amount and a tax rate. Keep both numeric values together in the draft invoice request.';
 const example='{"invoice_rows":[{"amount":390.4382470119522,"tax":24},{"amount":79.6812749003984,"tax":24}]}';
 const privateBlock='Please contact fixture.person@example.invalid about this input.';
 const body=`<p>${task}</p><p>${detail}</p><pre>${example}</pre><p>${privateBlock}</p><p>Kind regards,</p><p>Casey Fixture</p>`;
 const source={...makeDiscussionSource(definition,{url,title:'How can I map invoice rows?',excerpt:task,date:createdAt},{fetchedAt:now}),verifiedAt:now,enriched:true,evidenceKind:'discussion-post',evidenceFetch:{maxBytes:2000000,complete:true}};
 const validation={publicHttps:true,robotsAllowed:true,readable:true,robots:[{origin:new URL(definition.url).origin,evaluatedUrl:definition.url,robotsUrl:new URL('/robots.txt',definition.url).toString(),status:404,state:'missing',allowed:true,contentType:'text/plain',fetchedAt:now}],redirects:[],httpStatus:200,contentType:'application/rss+xml',resolvedUrl:definition.url,fetchedAt:now,maxBytes:2000000,truncated:false,parserVersion:SOURCE_PARSER_VERSION,itemCount:1};
 const registry={sources:[{...definition,status:'active',validation}]},selection=selectLearningTargets({runId,registry,scoreboard:{segments:[],sources:[]},discussionOnly:true,now,producer:{repository:'xndanius/while-you-sleep',runId:'123',runAttempt:1,workflow:'loop.yml',stage:'pre_model',headSha:'a'.repeat(40)}});
 const assignment={productUrl:url,segment:source.segment,kind:'discussion',demandSourceId:source.id,registrySourceId:definition.id};
 const research={runId,createdAt:now,sources:[source],health:[],githubRunUrl:'https://github.com/xndanius/while-you-sleep/actions/runs/123',enrichment:{schema:1,status:'completed',selected:1,attempted:1,fetched:1,failed:0,observations:[{productUrl:url,status:'fetched',originSourceIds:[source.id],evidenceIds:[source.id]}],discussionBatch:{version:1,maxLeads:10,maxPerDemandSource:3,postIsDemand:true,leadAssignments:[assignment]}},learningSelection:selection};
 const historical={id:'research-111-1',runId:'research-111-1',createdAt:'2026-10-10T10:00:00.000Z',sources:[],health:[]};
 const response=JSON.stringify({id:54321,title:source.title,created_at:createdAt,post_stream:{posts:[{id:765432,topic_id:54321,post_number:1,created_at:createdAt,cooked:body},{id:765433,topic_id:54321,post_number:2,created_at:createdAt,cooked:'A reply must not be retained as original-post context.'}]}});
 source.nativeReadingContext=buildNativeReadingContext({source,raw:body,topicId:54321,postId:765432,postNumber:1,postCreatedAt:createdAt,postUpdatedAt:null,responseUrl:url+'.json',responseText:response,fetchedAt:now});
 assert.ok(source.nativeReadingContext,'The trusted pre-model producer seals the new body contract before checker preparation.');
 const researchBefore=stableJSON(research),selectionBefore=stableJSON(selection);
 const result=await execute(t,{count:0,script:'prepare-check',mutate:f=>{f.context.sources=[source];f.draft.rejected=[{title:source.title,productUrl:url,sourceIds:[source.id],reason:'The synthetic request does not establish a paid service.'}];},mutateResearch:value=>Object.assign(value,research),extraRecords:[['sources',registry,'registry'],['learning-selection',selection],['research',historical,historical.id]],envOverrides:{DEMAND_CONTRACT_VERSION:'1',EXPECTED_LEARNING_SELECTION_SHA:sha256(selectionBefore),EXPECTED_RESEARCH_SHA:sha256(researchBefore)},liveByUrl:{[new URL('/robots.txt',url).toString()]:{status:404,text:''},[url+'.json']:{text:response,headers:{'content-type':'application/json'}}}});
 assert.equal(result.execution.status,0,result.execution.stderr);assert.match(result.execution.stdout,/FETCH_COUNT 2/);
 const context=await result.record('check-context'),fresh=context.sources.find(row=>row.id===source.id),packet=fresh.nativeReadingContext,normalized=normalizeNativePost(body);
 assert.deepEqual(demandContextReasons(context),[]);assert.deepEqual(nativeReadingContextReasons(fresh),[]);assert.deepEqual(privateArtifactCategories(context),[]);
 assert.equal(fresh.text,source.text);assert.deepEqual(fresh.taskExcerpts,source.taskExcerpts);assert.equal(fresh.taskExample,undefined);
 assert.equal(packet.version,2);assert.equal(packet.postId,765432);assert.equal(packet.postNumber,1);assert.equal(packet.responseSha256,sha256(response));
 assert.ok(packet.retainedCharacters>200&&packet.retainedCharacters<=1200);assert.ok(packet.spans.some(span=>span.text.includes(detail)));assert.ok(packet.spans.some(span=>span.text.includes(example)));
 for(const span of packet.spans)assert.equal(normalized.slice(span.start,span.end),span.text);
 assert.equal(JSON.stringify(context).includes(privateBlock),false);assert.equal(JSON.stringify(context).includes('Casey Fixture'),false);assert.equal(JSON.stringify(context).includes('A reply must not be retained'),false);
 assert.equal(context.sourceSnapshotSha256,sha256(stableJSON(context.sources)));assert.deepEqual(context.health,[]);assert.deepEqual(context.considerationEvidence[0].availableSourceIds,[source.id]);
 assert.equal(stableJSON(await result.record('research')),researchBefore);assert.equal(stableJSON(await result.record('learning-selection')),selectionBefore);assert.deepEqual(await result.record('drafts'),result.f.draft);
 assert.deepEqual(JSON.parse(await readFile(path.join(result.root,'data/research',historical.id+'.json'),'utf8')),historical);
 const frozenContext=stableJSON(context),env={...result.env,EXPECTED_DRAFT_SHA:context.draftSha256,EXPECTED_CONTEXT_SHA:sha256(frozenContext)};
 const prepared=spawnSync(process.execPath,['scripts/prepare-run.mjs','checker'],{cwd:result.root,env,encoding:'utf8'});assert.equal(prepared.status,0,prepared.stderr);assert.match(prepared.stdout,/FETCH_COUNT 0/);
 const session=JSON.parse(await readFile(path.join(result.root,'.run/context.json'),'utf8'));assert.equal(session.checkContextSha256,sha256(frozenContext));
 const inspected=spawnSync(process.execPath,['scripts/inspect-check-assessment.mjs',runId],{cwd:result.root,env,encoding:'utf8'});assert.equal(inspected.status,0,inspected.stderr);assert.match(inspected.stdout,/FETCH_COUNT 0/);
 const view=JSON.parse(inspected.stdout.split('\n').find(line=>line.startsWith('{')));assert.equal(view.bindings.sourceSnapshotSha256,context.sourceSnapshotSha256);assert.equal(view.counts.uniqueConsidered,1);
 assert.equal(stableJSON(await result.record('check-context')),frozenContext);assert.equal(stableJSON(await result.record('research')),researchBefore);assert.deepEqual(await result.record('drafts'),result.f.draft);
});

test('sealed discussion exclusions prepare an independent exact-post context without raw fallback or proposals',async t=>{
 const definition=DISCUSSION_SOURCE_CATALOG.find(source=>source.kind==='discourse-discussion'&&source.community==='n8n community'),url='https://community.n8n.io/t/12345',body='Our store manually reviews inventory reports every week. Is there a tool that prepares the report for review?',source={...makeDiscussionSource(definition,{url,title:'How do merchants handle weekly inventory reports?',excerpt:body,date:'2026-10-11T10:00:00.000Z'},{fetchedAt:now}),verifiedAt:now,enriched:true,evidenceKind:'demand-notice',evidenceFetch:{maxBytes:2000000,complete:true}};
 const validation={publicHttps:true,robotsAllowed:true,readable:true,robots:[{origin:new URL(definition.url).origin,evaluatedUrl:definition.url,robotsUrl:new URL('/robots.txt',definition.url).toString(),status:404,state:'missing',allowed:true,contentType:'text/plain',fetchedAt:now}],redirects:[],httpStatus:200,contentType:'application/rss+xml',resolvedUrl:definition.url,fetchedAt:now,maxBytes:2000000,truncated:false,parserVersion:SOURCE_PARSER_VERSION,itemCount:1},registry={sources:[{...definition,status:'active',validation}]},selection=selectLearningTargets({runId,registry,scoreboard:{segments:[],sources:[]},discussionOnly:true,now,producer:{repository:'xndanius/while-you-sleep',runId:'123',runAttempt:1,workflow:'loop.yml',stage:'pre_model',headSha:'a'.repeat(40)}});
 const assignment={productUrl:url,segment:source.segment,kind:'discussion',demandSourceId:source.id,registrySourceId:definition.id},enrichment={schema:1,status:'completed',selected:1,attempted:1,fetched:1,failed:0,observations:[{productUrl:url,status:'fetched',originSourceIds:[source.id],evidenceIds:[source.id]}],discussionBatch:{version:1,maxLeads:10,maxPerDemandSource:3,postIsDemand:true,leadAssignments:[assignment]}},research={runId,createdAt:now,sources:[source],health:[],githubRunUrl:'https://github.com/xndanius/while-you-sleep/actions/runs/123',enrichment,learningSelection:selection};
 const result=await execute(t,{count:0,script:'prepare-check',mutate:f=>{f.context.sources=[source];f.draft.rejected=[{title:source.title,productUrl:url,reason:'The discussion describes a chore; a supported service remains unproved.'}];},mutateResearch:value=>Object.assign(value,research),extraRecords:[['sources',registry,'registry'],['learning-selection',selection]],envOverrides:{DEMAND_CONTRACT_VERSION:'1',EXPECTED_LEARNING_SELECTION_SHA:sha256(stableJSON(selection)),EXPECTED_RESEARCH_SHA:sha256(stableJSON(research))},liveByUrl:{[url+'.json']:{text:JSON.stringify({id:12345,title:source.title,created_at:source.postedAt,post_stream:{posts:[{post_number:1,cooked:body}]}})}}});
 assert.equal(result.execution.status,0,result.execution.stderr);const context=await result.record('check-context');assert.deepEqual(demandContextReasons(context),[]);assert.equal(context.demandContext.selectedSegment,null);assert.deepEqual(context.demandContext.discussionBatchPolicy,{...enrichment.discussionBatch,researchSha256:sha256(stableJSON(research))});assert.equal(context.sources.length,1);assert.equal(context.sources[0].url,url);assert.equal(context.sources[0].evidenceKind,'discussion-post');assert.equal(context.sources[0].text,source.text);assert.deepEqual(context.health,[]);assert.equal(context.primaryFetchDiagnostics.length,1);assert.equal(context.primaryFetchDiagnostics[0].status,'fetched');assert.equal(context.primaryFetchDiagnostics[0].sourceId,source.id);assert.deepEqual((await result.record('drafts')).posts,[]);assert.equal(context.considerationEvidence[0].availableSourceIds[0],source.id);assert.match(result.execution.stdout,/FETCH_COUNT 2/);
 const forged=spawnSync(process.execPath,['scripts/prepare-check.mjs',runId],{cwd:result.root,env:{...result.env,EXPECTED_RESEARCH_SHA:'b'.repeat(64)},encoding:'utf8'});assert.equal(forged.status,1);assert.match(forged.stderr,/Discussion assignments lack their exact sealed research/);assert.match(forged.stdout,/FETCH_COUNT 0/);
});

test('empty and below-threshold discussion batches keep only attached fixed task references with independent provenance',async t=>{
 const definition=DISCUSSION_SOURCE_CATALOG.find(source=>source.community==='Make community'),url='https://community.make.com/t/12345',body='I need help to debug and finish an existing workflow that sends customer invoice records into our accounting system.';
 const demand={...makeDiscussionSource(definition,{url,title:'Debug and finish an existing invoice scenario',excerpt:body,date:'2026-10-11T10:00:00.000Z'},{fetchedAt:now}),verifiedAt:now,enriched:true,evidenceKind:'discussion-post',evidenceFetch:{maxBytes:2000000,complete:true}};
 assert.ok(demand.id);const [reference]=selectDiscussionImplementationReferences([demand]);assert.ok(reference);
 const documentation='Error handlers allow you to control how a scenario responds to an error. You can configure a handler to resume execution with replacement data or stop the incomplete execution for review.';
 const document={...reference,text:documentation,fetchedAt:now,enriched:true,evidenceKind:'product-page',evidenceFetch:{maxBytes:2000000,complete:true},evidenceValidation:{resolvedUrl:'https://stale.example.com',httpStatus:503}};
 const validation={publicHttps:true,robotsAllowed:true,readable:true,robots:[{origin:new URL(definition.url).origin,evaluatedUrl:definition.url,robotsUrl:new URL('/robots.txt',definition.url).toString(),status:404,state:'missing',allowed:true,contentType:'text/plain',fetchedAt:now}],redirects:[],httpStatus:200,contentType:'application/rss+xml',resolvedUrl:definition.url,fetchedAt:now,maxBytes:2000000,truncated:false,parserVersion:SOURCE_PARSER_VERSION,itemCount:1};
 const registry={sources:[{...definition,status:'active',validation}]},selection=selectLearningTargets({runId,registry,scoreboard:{segments:[],sources:[]},discussionOnly:true,now,producer:{repository:'xndanius/while-you-sleep',runId:'123',runAttempt:1,workflow:'loop.yml',stage:'pre_model',headSha:'a'.repeat(40)}});
 const assignment={productUrl:url,segment:demand.segment,kind:'discussion',demandSourceId:demand.id,registrySourceId:definition.id};
 const base={runId,createdAt:now,sources:[demand,document],health:[],githubRunUrl:'https://github.com/xndanius/while-you-sleep/actions/runs/123',enrichment:{schema:1,status:'completed',selected:1,attempted:1,fetched:1,failed:0,observations:[{productUrl:url,status:'fetched',originSourceIds:[demand.id],evidenceIds:[demand.id]}],discussionBatch:{version:1,maxLeads:10,maxPerDemandSource:3,postIsDemand:true,leadAssignments:[assignment]}},learningSelection:selection};
 base.enrichment.supportingReferences={maximum:2,requestLimit:30,requests:1,observations:[{productUrl:document.url,status:'fetched',evidenceIds:[document.id]}]};
 const exactPost=JSON.stringify({id:12345,title:demand.title,created_at:demand.postedAt,post_stream:{posts:[{post_number:1,cooked:body}]}});
 async function prepare({candidate=false,corrupt=()=>{},freshBody=body,redirectDoc=false,sharedDemand=false,omitReference=false,proposal=false,robotsDenied=false}={}){
  const research=structuredClone(base),otherURL='https://community.make.com/t/12346',other={...structuredClone(demand),id:hash(otherURL),url:otherURL,productUrl:otherURL};
  if(sharedDemand){research.sources.push(other);research.sources[1].supportsDemandSourceIds.push(other.id);for(const field of ['selected','attempted','fetched'])research.enrichment[field]++;research.enrichment.observations.push({productUrl:otherURL,status:'fetched',originSourceIds:[other.id],evidenceIds:[other.id]});research.enrichment.discussionBatch.leadAssignments.push({...assignment,productUrl:otherURL,demandSourceId:other.id});}
  corrupt(research.sources[1]);
  return execute(t,{count:proposal?1:0,script:'prepare-check',mutate:f=>{
   f.context.sources=[demand];const item={title:demand.title,productUrl:url,sourceIds:[demand.id],reason:'The stated chore has no established paying service.'};
   if(proposal){Object.assign(f.draft.posts[0],{productUrl:url,sourceIds:[demand.id],segment:demand.segment,demandEvidence:{kind:'community_request',sourceIds:[demand.id],chore:body,evidenceQuote:body}});for(const criterion of Object.values(f.draft.posts[0].scoring.criteria))criterion.sourceIds=[demand.id];}
   else if(candidate){if(!omitReference)item.sourceIds.push(research.sources[1].id);Object.assign(item,{segment:demand.segment,demandEvidence:{kind:'community_request',sourceIds:[demand.id],chore:body,evidenceQuote:body},scoring:{criteria:Object.fromEntries(SCORING_KEYS.map(key=>[key,{value:4,reason:'A bounded unproved hypothesis.',sourceIds:[omitReference?demand.id:research.sources[1].id]}]))}});f.draft.candidates=[item];}
   else {if(!omitReference)item.sourceIds.push(research.sources[1].id);f.draft.rejected=[item];}
   if(sharedDemand)f.draft.rejected.push({title:other.title,productUrl:otherURL,sourceIds:[other.id],reason:'This other discussion does not establish a supported service.'});
  },mutateResearch:value=>Object.assign(value,research),extraRecords:[['sources',registry,'registry'],['learning-selection',selection]],envOverrides:{DEMAND_CONTRACT_VERSION:'1',EXPECTED_LEARNING_SELECTION_SHA:sha256(stableJSON(selection)),EXPECTED_RESEARCH_SHA:sha256(stableJSON(research))},liveByUrl:{[url+'.json']:{text:freshBody===body?exactPost:JSON.stringify({id:12345,title:'Workflow discussion',created_at:demand.postedAt,post_stream:{posts:[{post_number:1,cooked:freshBody}]}})},[otherURL+'.json']:{text:JSON.stringify({id:12346,title:other.title,created_at:other.postedAt,post_stream:{posts:[{post_number:1,cooked:body}]}})},...(robotsDenied?{'https://community.make.com/robots.txt':{status:429,text:'Too many requests'}}:{}),[document.url]:redirectDoc?{status:302,headers:{location:'https://redirected.example.com/docs'}}:{text:`<main><p>${documentation}</p></main>`},'https://redirected.example.com/docs':{text:`<main><p>${documentation}</p></main>`}}});
 }
 for(const candidate of [false,true]){
  const result=await prepare({candidate});assert.equal(result.execution.status,0,result.execution.stderr);const context=await result.record('check-context'),fresh=context.sources.find(source=>source.id===document.id);
  assert.equal(context.sources.length,2);assert.equal(context.candidateScoringVersion,1);assert.equal(fresh.text,documentation);assert.equal(fresh.role,'building');assert.equal(fresh.demand,false);assert.deepEqual(fresh.originSourceIds,[]);
  const prepared=spawnSync(process.execPath,['scripts/prepare-run.mjs','checker'],{cwd:result.root,env:result.env,encoding:'utf8'});assert.equal(prepared.status,0,prepared.stderr);
  assert.equal(JSON.parse(await readFile(path.join(result.root,'.run/context.json'),'utf8')).candidateScoringVersion,1,'the independent model receives the trusted candidate-scoring version');
  assert.equal(fresh.evidenceValidation.resolvedUrl,document.url);assert.equal(fresh.evidenceValidation.httpStatus,200);assert.ok(fresh.evidenceValidation.robots.every(row=>row.allowed));
  assert.deepEqual(context.demandContext.authorizedSources.map(source=>source.sourceId),[demand.id]);assert.equal(context.primaryFetchDiagnostics[0].sourceId,demand.id);assert.deepEqual(context.considerationEvidence[0].availableSourceIds,[demand.id,document.id]);assert.deepEqual(context.health,[]);
 }
 for(const shape of [{},{candidate:true},{proposal:true}]){
  const result=await prepare({...shape,omitReference:true});assert.equal(result.execution.status,0,result.execution.stderr);const context=await result.record('check-context'),draft=await result.record('drafts');
  assert.equal(context.sources.find(source=>source.id===document.id)?.text,documentation,'A sealed preassigned reference must reach the independent checker even when the writer omits its ID.');assert.deepEqual(context.health,[]);
  const items=[...draft.posts,...draft.candidates,...draft.rejected];assert.ok(items.every(item=>!item.sourceIds.includes(document.id)&&Object.values(item.scoring?.criteria||{}).every(criterion=>!criterion.sourceIds.includes(document.id))),'The handoff must not fabricate or rewrite writer citations.');
  if(!shape.proposal){assert.deepEqual(context.considerationEvidence[0].availableSourceIds,[demand.id,document.id]);assert.equal(context.primaryFetchDiagnostics[0].sourceId,demand.id);}
  if(!shape.candidate&&!shape.proposal)for(const role of ['writer','repair']){
   const prepared=spawnSync(process.execPath,['scripts/prepare-run.mjs',role],{cwd:result.root,env:result.env,encoding:'utf8'});assert.equal(prepared.status,0,prepared.stderr);const input=JSON.parse(await readFile(path.join(result.root,'.run/context.json'),'utf8'));
   assert.deepEqual(input.discussionImplementationReferences,[{productUrl:url,demandSourceId:demand.id,availableSourceIds:[document.id]}]);const view=JSON.parse(await readFile(path.join(result.root,input.researchPath),'utf8'));assert.ok(view.sources.some(source=>source.id===document.id));assert.deepEqual(await result.record('drafts'),draft,'An explicit supplied-reference inventory cannot change draft citations, exclusions or ratings.');
  }
 }
 for(const corrupt of [source=>source.url='https://unassigned.example.com/docs',source=>source.id='a'.repeat(24),source=>source.supportsDemandSourceIds=['b'.repeat(24)],source=>{delete source.implementationReferenceVersion;},source=>{delete source.implementationReferenceVersion;delete source.supportsDemandSourceIds;},source=>{delete source.implementationReferenceVersion;delete source.implementationReferenceId;}]){
  for(const omitReference of [false,true]){const result=await prepare({corrupt,omitReference});assert.equal(result.execution.status,1);assert.match(result.execution.stderr,/implementation reference/i);assert.match(result.execution.stdout,/FETCH_COUNT 0/);}
 }
 const robots=await prepare({robotsDenied:true,omitReference:true});assert.equal(robots.execution.status,1);assert.match(robots.outputs,/verified=false/);assert.match(robots.outputs,/checker_preparation_failed/);assert.ok(robots.outputs.includes(`community.make.com [${demand.id}]`));assert.match(robots.outputs,/robots.txt.*429/);assert.match(robots.execution.stdout,/FETCH_COUNT 1/,'A guarded robots denial cannot trigger a primary-page or documentation fallback.');assert.equal((await robots.record('check-context')).sources.some(source=>source.id===document.id),false);assert.doesNotMatch(robots.outputs,/customer invoice records|Error handlers allow/,'Failure diagnostics retain no discussion or documentation body.');
 const deniedReason=robots.outputs.split('\n').find(line=>line.startsWith('unverified_reason=')).slice('unverified_reason='.length),failedJobs={...jobs,checker:{result:'success',outputs:{verified:'false',model_completed:'false',unverified_code:'checker_preparation_failed',unverified_reason:deniedReason}}};
 const closed=spawnSync(process.execPath,['scripts/finalize-run.mjs',runId],{cwd:robots.root,env:{...robots.env,MODEL_JOB_RESULTS:JSON.stringify(failedJobs)},encoding:'utf8'});assert.equal(closed.status,0,closed.stderr);const deniedRun=await robots.record('runs');assert.equal(deniedRun.status,'no_post_unverified');assert.equal(deniedRun.checkedAssessment,undefined);assert.deepEqual(deniedRun.published,[]);assert.ok(JSON.stringify(deniedRun.operationalFailures).includes(`community.make.com [${demand.id}]`),'Trusted failure outputs must preserve the exact safe source identity in the durable unverified run.');
 const redirected=await prepare({redirectDoc:true});assert.equal(redirected.execution.status,0,redirected.execution.stderr);const redirectedContext=await redirected.record('check-context');assert.equal(redirectedContext.sources.some(source=>source.id===document.id),false);assert.ok(redirectedContext.health.some(source=>source.sourceId===document.id&&/redirected away/.test(source.message)));
 // A later redirect also fails the live no-post publisher reread, even though
 // the earlier frozen checker context held a valid fixed reference.
 const staged=await prepare(),draft=await staged.record('drafts'),frozen=await staged.record('check-context'),checked={draft,context:frozen,manifest:{runId,checkedAt:now,checks:[]}};bind(checked);
 await writeFile(path.join(staged.root,'data/checks',runId+'.json'),JSON.stringify(checked.manifest));
 const preloadPath=path.join(staged.root,'preload.mjs'),preload=await readFile(preloadPath,'utf8');
 const marker='const mapped=',start=preload.indexOf(marker)+marker.length,end=preload.indexOf(';globalThis.fetch',start),mapped=JSON.parse(preload.slice(start,end));
 mapped[document.url]={status:302,headers:{location:'https://redirected.example.com/docs'}};mapped['https://redirected.example.com/docs']={text:`<main><p>${documentation}</p></main>`};
 await writeFile(preloadPath,preload.slice(0,start)+JSON.stringify(mapped)+preload.slice(end));
 const finalized=spawnSync(process.execPath,['scripts/finalize-run.mjs',runId],{cwd:staged.root,env:{...staged.env,EXPECTED_DRAFT_SHA:sha256(stableJSON(draft)),EXPECTED_CONTEXT_SHA:sha256(stableJSON(frozen))},encoding:'utf8'});
 assert.equal(finalized.status,0,finalized.stderr);const run=await staged.record('runs');assert.equal(run.status,'no_post_unverified');assert.deepEqual(run.published,[]);assert.ok(run.operationalFailures.some(failure=>failure.sourceId===document.id&&/redirected away/.test(failure.reason)));
 // The proposed-post path must enforce the same exact-URL reread guard.
 const proposed=await prepare(),proposedContext=await proposed.record('check-context'),proposedDraft=await proposed.record('drafts'),post=fixture().draft.posts[0];
 Object.assign(post,{id:candidateIdentity({productUrl:url}),candidateId:candidateIdentity({productUrl:url}),productUrl:url,title:'Invoice workflow error review experiment',promise:'Prepare a failed invoice step for human review.',whatItIs:'An unproved bounded error-review experiment.',whoPays:'Hypothesis: invoice administration teams.',loop:['Choose a synthetic invoice step','Inspect the failed step','Review the proposed recovery'],evidence:'The discussion requests debugging; separate documentation explains error handlers.',uncertainty:'No customer, revenue or unattended reliability is established.',first24Hours:['Use a synthetic invoice.','Configure one error handler.','Review the recovery manually.'],sourceIds:[demand.id,document.id],segment:demand.segment,demandEvidence:{kind:'community_request',sourceIds:[demand.id],chore:body,evidenceQuote:body}});
 for(const key of SCORING_KEYS)post.scoring.criteria[key]={value:6,reason:key==='profit'?'Hypothesis: an administration buyer with an unproved service.':'A bounded experiment needing human review.',sourceIds:[['profit','evidence'].includes(key)?demand.id:document.id]};
 proposedDraft.posts=[post];proposedDraft.candidates=[];proposedDraft.rejected=[];proposedContext.deterministicResults=[{postId:post.id,pass:true,reasons:[]}];
 const capabilityQuote='Error handlers allow you to control how a scenario responds to an error.',check={postId:post.id,pass:true,reasons:[],claimChecks:[{claim:'The public fixture requests debugging.',supported:true,sourceId:demand.id,evidenceQuote:body},{claim:'The fixture docs describe error control.',supported:true,sourceId:document.id,evidenceQuote:capabilityQuote},{claim:'The fixture docs preserve review.',supported:true,sourceId:document.id,evidenceQuote:'stop the incomplete execution for review'}],scoreChecks:SCORING_KEYS.map(criterion=>({criterion,supported:true,maxSupportedScore:6,reason:criterion==='profit'?'Hypothesis: the fixture contains no established purchase.':'This synthetic fixture supports only a reviewed experiment.',sourceId:['profit','evidence'].includes(criterion)?demand.id:document.id,evidenceQuote:['profit','evidence'].includes(criterion)?body:capabilityQuote})),noveltyCheck:{recentPostsSha256:proposedContext.noveltyContext.postsSha256,windowDays:14,comparedPostCount:0,...Object.fromEntries(['product','workflow','customer'].map(dimension=>[dimension,{distinct:true,closestPostId:null,reason:'The synthetic fixture index is empty.'}]))},demandCheck:{demandContextSha256:proposedContext.demandContextSha256,supported:true,segment:demand.segment,sourceId:demand.id,kind:'community_request',chore:body,evidenceQuote:body,reason:'A synthetic public discussion states the task; payment remains hypothetical.',noPersonalData:true}};
 const proposedCheck={draft:proposedDraft,context:proposedContext,manifest:{runId,checkedAt:now,checks:[check]}};bind(proposedCheck);assert.deepEqual(completedAssessmentReasons(proposedDraft,proposedContext,proposedCheck.manifest),[]);assert.equal(checkApproval(proposedDraft,proposedContext,proposedCheck.manifest)[0].pass,true);
 for(const [directory,record] of [['drafts',proposedDraft],['check-context',proposedContext],['checks',proposedCheck.manifest]])await writeFile(path.join(proposed.root,'data',directory,runId+'.json'),JSON.stringify(record));
 await writeFile(path.join(proposed.root,'preload.mjs'),preload.slice(0,start)+JSON.stringify(mapped)+preload.slice(end));
 const published=spawnSync(process.execPath,['scripts/finalize-run.mjs',runId],{cwd:proposed.root,env:{...proposed.env,EXPECTED_DRAFT_SHA:sha256(stableJSON(proposedDraft)),EXPECTED_CONTEXT_SHA:sha256(stableJSON(proposedContext))},encoding:'utf8'});
 assert.equal(published.status,0,published.stderr);const refused=await proposed.record('runs');assert.deepEqual(refused.published,[]);assert.equal(refused.status,'no_post_unverified');assert.ok(refused.operationalFailures.some(failure=>failure.sourceId===document.id&&/redirected away/.test(failure.reason)));
 for(const withProposal of [false,true]){
  const late=await prepare(),lateContext=withProposal?structuredClone(proposedContext):await late.record('check-context'),lateDraft=withProposal?structuredClone(proposedDraft):await late.record('drafts'),lateCheck={draft:lateDraft,context:lateContext,manifest:{runId,checkedAt:now,checks:withProposal?[check]:[]}};bind(lateCheck);
  for(const [directory,record] of [['drafts',lateDraft],['check-context',lateContext],['checks',lateCheck.manifest]])await writeFile(path.join(late.root,'data',directory,runId+'.json'),JSON.stringify(record));
  const lateMap=JSON.parse(preload.slice(start,end));lateMap[url+'.json']={text:JSON.stringify({id:12345,title:'Invoice records discussion',created_at:demand.postedAt,post_stream:{posts:[{post_number:1,cooked:'Our team manually reconciles customer invoices every week. Is there a tool that prepares those records for review?'}]}})};
  await writeFile(path.join(late.root,'preload.mjs'),preload.slice(0,start)+JSON.stringify(lateMap)+preload.slice(end));
  const result=spawnSync(process.execPath,['scripts/finalize-run.mjs',runId],{cwd:late.root,env:{...late.env,EXPECTED_DRAFT_SHA:sha256(stableJSON(lateDraft)),EXPECTED_CONTEXT_SHA:sha256(stableJSON(lateContext))},encoding:'utf8'});assert.equal(result.status,0,result.stderr);const run=await late.record('runs');assert.equal(run.status,'no_post_unverified');assert.deepEqual(run.published,[]);assert.ok(run.operationalFailures.some(failure=>failure.sourceId===document.id&&/freshly fetched discussion-task binding/.test(failure.reason)));
 }
 const shared=await prepare({sharedDemand:true});assert.equal(shared.execution.status,0,shared.execution.stderr);const sharedDraft=await shared.record('drafts'),sharedContext=await shared.record('check-context');
 sharedDraft.posts=[structuredClone(post)];sharedDraft.rejected=sharedDraft.rejected.filter(item=>item.productUrl!==url);sharedContext.deterministicResults=[{postId:post.id,pass:true,reasons:[]}];const sharedCheck=structuredClone(check);sharedCheck.demandCheck.demandContextSha256=sharedContext.demandContextSha256;
 const sharedFixture={draft:sharedDraft,context:sharedContext,manifest:{runId,checkedAt:now,checks:[sharedCheck]}};bind(sharedFixture);assert.deepEqual(completedAssessmentReasons(sharedDraft,sharedContext,sharedFixture.manifest),[]);
 for(const [directory,record] of [['drafts',sharedDraft],['check-context',sharedContext],['checks',sharedFixture.manifest]])await writeFile(path.join(shared.root,'data',directory,runId+'.json'),JSON.stringify(record));
 const sharedMap=JSON.parse(preload.slice(start,end));sharedMap['https://community.make.com/t/12346.json']={status:403,text:'Unavailable unrelated rejected discussion'};await writeFile(path.join(shared.root,'preload.mjs'),preload.slice(0,start)+JSON.stringify(sharedMap)+preload.slice(end));
 const allowed=spawnSync(process.execPath,['scripts/finalize-run.mjs',runId],{cwd:shared.root,env:{...shared.env,EXPECTED_DRAFT_SHA:sha256(stableJSON(sharedDraft)),EXPECTED_CONTEXT_SHA:sha256(stableJSON(sharedContext))},encoding:'utf8'});assert.equal(allowed.status,0,allowed.stderr);const sharedRun=await shared.record('runs');assert.deepEqual(sharedRun.published,[post.id],'Unrelated rejected discussion B cannot veto checked post A using their shared fixed documentation.');assert.deepEqual(sharedRun.operationalFailures,[]);
 // The final publisher must use the same literal native task range as the
 // candidate/checker gates, and must refuse it when the fresh page loses it.
 const nativeQuote='The invoice webhook loses the submitted totals after the form trigger.';
 for(const keepQuote of [true,false]){
  const native=await prepare(),nativeContext=await native.record('check-context'),nativeDraft=await native.record('drafts'),nativeSource=nativeContext.sources.find(source=>source.id===demand.id);
  const nativeBody=`<p>${body}</p><p>${nativeQuote}</p>`,createdAt=demand.postedAt;
  const nativeResponse=JSON.stringify({id:12345,title:demand.title,created_at:createdAt,post_stream:{posts:[{id:987654,topic_id:12345,post_number:1,created_at:createdAt,updated_at:null,cooked:nativeBody}]}});
  nativeSource.nativeReadingContext=buildNativeReadingContext({source:nativeSource,raw:nativeBody,topicId:12345,postId:987654,postNumber:1,postCreatedAt:createdAt,postUpdatedAt:null,responseUrl:url+'.json',responseText:nativeResponse,fetchedAt:now});
  assert.ok(nativeSource.nativeReadingContext);assert.equal(nativeSource.text.includes(nativeQuote),false);
  const nativeResearch=await native.record('research');nativeResearch.sources=nativeResearch.sources.map(source=>source.id===nativeSource.id?structuredClone(nativeSource):source);
  nativeContext.demandContext.discussionBatchPolicy.researchSha256=sha256(stableJSON(nativeResearch));nativeContext.demandContextSha256=demandContextHash(nativeContext.demandContext);
  const nativePost=structuredClone(post);nativePost.demandEvidence.evidenceQuote=nativeQuote;
  nativeDraft.posts=[nativePost];nativeDraft.candidates=[];nativeDraft.rejected=[];nativeContext.deterministicResults=[{postId:post.id,pass:true,reasons:[]}];
  const nativeCheck=structuredClone(check);nativeCheck.demandCheck.evidenceQuote=nativeQuote;nativeCheck.demandCheck.demandContextSha256=nativeContext.demandContextSha256;
  const checked={draft:nativeDraft,context:nativeContext,manifest:{runId,checkedAt:now,checks:[nativeCheck]}};bind(checked);
  assert.deepEqual(completedAssessmentReasons(nativeDraft,nativeContext,checked.manifest),[]);assert.equal(checkApproval(nativeDraft,nativeContext,checked.manifest)[0].pass,true);
  for(const [directory,record] of [['drafts',nativeDraft],['check-context',nativeContext],['checks',checked.manifest],['research',nativeResearch]])await writeFile(path.join(native.root,'data',directory,runId+'.json'),JSON.stringify(record));
  const nativePreload=await readFile(path.join(native.root,'preload.mjs'),'utf8'),nativeStart=nativePreload.indexOf(marker)+marker.length,nativeEnd=nativePreload.indexOf(';globalThis.fetch',nativeStart),nativeMap=JSON.parse(nativePreload.slice(nativeStart,nativeEnd));
  nativeMap[url+'.json']={text:keepQuote?nativeResponse:nativeResponse.replace(nativeQuote,'The old task detail is no longer supplied.')};
  await writeFile(path.join(native.root,'preload.mjs'),nativePreload.slice(0,nativeStart)+JSON.stringify(nativeMap)+nativePreload.slice(nativeEnd));
  const result=spawnSync(process.execPath,['scripts/finalize-run.mjs',runId],{cwd:native.root,env:{...native.env,EXPECTED_DRAFT_SHA:sha256(stableJSON(nativeDraft)),EXPECTED_CONTEXT_SHA:sha256(stableJSON(nativeContext))},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);const run=await native.record('runs');assert.deepEqual(run.published,keepQuote?[post.id]:[],JSON.stringify({run,stdout:result.stdout,stderr:result.stderr}));
  if(!keepQuote)assert.ok(run.rejected.some(row=>(row.reasons||[row.reason]).some(reason=>reason?.includes('checked demand chore quote'))));
 }
 const changed=await prepare({freshBody:'Our team manually reconciles customer invoices every week. Is there a tool that prepares those records for review?'});assert.equal(changed.execution.status,0,changed.execution.stderr);const context=await changed.record('check-context');assert.equal(context.sources.some(source=>source.id===document.id),false);assert.ok(context.health.some(source=>source.sourceId===document.id&&/task binding/.test(source.message)));assert.equal(context.primaryFetchDiagnostics[0].sourceId,demand.id);
});

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

test('exact completed response envelopes agree with their canonical payload without changing frozen checks',()=>{
 for(const count of [0,1]){
  const f=fixture({count}),response={outcome:'completed',reason:'The exact synthetic batch was independently examined.',manifest:f.manifest};
  const pins={expectedDraftSha256:sha256(stableJSON(f.draft)),expectedContextSha256:sha256(stableJSON(f.context))},before=stableJSON({draft:f.draft,context:f.context,response});
  assert.equal(acceptCheckerOutput(response,f.draft,f.context,{...pins,existing:structuredClone(response)}),f.manifest,'A byte-equivalent complete response file is the same validated answer, not a contradictory manifest.');
  for(const existing of [undefined,structuredClone(f.manifest)])assert.equal(acceptCheckerOutput(response,f.draft,f.context,{...pins,existing}),f.manifest);
  assert.deepEqual(completedAssessmentReasons(f.draft,f.context,f.manifest),[]);assert.equal(f.manifest.checks.length,count);assert.equal(stableJSON({draft:f.draft,context:f.context,response}),before);
 }
});

test('the real accept script normalizes exact completed envelopes to payload-only files for empty and proposed batches',async t=>{
 for(const count of [0,1]){
  const result=await execute(t,{count,script:'accept-check-output',afterBind:f=>{f.manifest={outcome:'completed',reason:'The exact synthetic batch was independently examined.',manifest:f.manifest};},checkerResponse:f=>structuredClone(f.manifest)});
  assert.equal(result.execution.status,0,result.execution.stderr);assert.match(result.outputs,/verified=true/);const saved=await result.record('checks'),canonical=result.f.manifest.manifest;
  assert.deepEqual(saved,canonical);assert.equal(sha256(stableJSON(saved)),sha256(stableJSON(canonical)));assert.equal(Object.hasOwn(saved,'outcome'),false);assert.equal(Object.hasOwn(saved,'manifest'),false);assert.equal(saved.checks.length,count);
  assert.deepEqual(await result.record('drafts'),result.f.draft);assert.deepEqual(await result.record('check-context'),result.f.context);assert.deepEqual(completedAssessmentReasons(result.f.draft,result.f.context,saved),[]);
 }
});

test('envelope compatibility rejects changed outer answers, nonobjects and invalid nested completions',()=>{
 const f=fixture(),response={outcome:'completed',reason:'The exact synthetic batch was independently examined.',manifest:f.manifest},pins={expectedDraftSha256:sha256(stableJSON(f.draft)),expectedContextSha256:sha256(stableJSON(f.context))};
 const outerMutations=[value=>value.reason='A different final answer about the same payload.',value=>value.outcome='operational_failure',value=>value.extraField='Unvalidated outer metadata'];
 for(const change of outerMutations){const existing=structuredClone(response);change(existing);assert.deepEqual(existing.manifest,response.manifest);assert.throws(()=>acceptCheckerOutput(response,f.draft,f.context,{...pins,existing}),/disagree/);}
 for(const existing of [null,false,0,'',42,'scalar',[],{}])assert.throws(()=>acceptCheckerOutput(response,f.draft,f.context,{...pins,existing}),/disagree/);
 for(const mutate of [value=>value.manifest.draftSha256='b'.repeat(64),value=>value.manifest.completedAssessment.contextSha256='b'.repeat(64),value=>delete value.manifest.checks[0].claimChecks[0].evidenceQuote,value=>value.manifest.checks[0].scoreChecks[0].maxSupportedScore=11]){
  const invalid=structuredClone(response);mutate(invalid);assert.throws(()=>acceptCheckerOutput(invalid,f.draft,f.context,{...pins,existing:structuredClone(invalid)}),'An identical outer file cannot validate a stale or malformed inner manifest.');
 }
 assert.throws(()=>acceptCheckerOutput({...response,extraField:true},f.draft,f.context,{...pins,existing:{...response,extraField:true}}),/envelope/);
 assert.throws(()=>acceptCheckerOutput(response,f.draft,f.context,{...pins,existing:response,expectedContextSha256:'b'.repeat(64)}),/trusted frozen/);
 const failure={outcome:'operational_failure',reason:'The synthetic independent examination did not complete.',manifest:null};
 for(const existing of [undefined,null,structuredClone(failure),structuredClone(f.manifest)])assert.throws(()=>acceptCheckerOutput(failure,f.draft,f.context,{...pins,existing}),/operational failure/);
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
 const unavailable=await execute(t,{count:0,script:'prepare-check',liveStatus:503});assert.equal(unavailable.execution.status,1);assert.match(unavailable.execution.stderr,/successfully re-fetched privacy-safe/);
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

test('malformed exclusions fail preparation explicitly instead of silently checking a fallback subset',async t=>{
 for(const rejected of [[{title:'A real exclusion',url:'https://example.com/product-0',reason:'No bounded task.'}],[{title:'A real exclusion',productUrl:'not a URL',reason:'No bounded task.'}],{title:'Wrong collection shape'}]){
  const result=await execute(t,{count:0,script:'prepare-check',missing:'checks',mutate:f=>{f.draft.rejected=rejected;}});
  assert.equal(result.execution.status,1);assert.match(result.execution.stdout,/FETCH_COUNT 0/);
  const outputs=Object.fromEntries(result.outputs.trim().split('\n').map(line=>{const index=line.indexOf('=');return [line.slice(0,index),line.slice(index+1)];}));
  assert.equal(outputs.verified,'false');assert.equal(outputs.unverified_code,'checker_preparation_failed');assert.match(outputs.unverified_reason,/Writer rejected/);
  assert.doesNotMatch(outputs.unverified_reason,/fingerprints/);
  const finalized=spawnSync(process.execPath,['scripts/finalize-run.mjs',runId],{cwd:result.root,env:{...result.env,MODEL_JOB_RESULTS:JSON.stringify({...jobs,checker:{result:'failure',outputs}})},encoding:'utf8'});
  assert.equal(finalized.status,0,finalized.stderr);
  const run=await result.record('runs');assert.equal(run.status,'no_post_unverified');assert.equal(run.unverifiedAssessment.code,'checker_preparation_failed');assert.equal(run.unverifiedAssessment.reason,outputs.unverified_reason);assert.deepEqual(run.published,[]);
  assert.match(await readFile(path.join(result.root,'outputs'),'utf8'),/operational_failure=true/);
 }
});

test('each explicit rejected notice receives its own independent evidence and fetch diagnostic',async t=>{
 const result=await execute(t,{count:12,script:'prepare-check',mutate:f=>{f.draft.rejected=f.draft.posts.map(post=>({title:post.title,productUrl:post.productUrl,reason:'No supported new service.'}));f.draft.posts=[];}});
 assert.equal(result.execution.status,0,result.execution.stderr);const context=await result.record('check-context');
 assert.equal(context.considerationEvidence.length,12);assert.equal(context.primaryFetchDiagnostics.length,12);assert.equal(context.sources.length,12);
 assert.deepEqual(context.considerationEvidence.map(item=>item.productUrl),result.f.draft.rejected.map(item=>item.productUrl));
 assert.ok(context.primaryFetchDiagnostics.every(item=>item.status==='fetched'));assert.ok(context.considerationEvidence.every(item=>item.availableSourceIds.length===1));
});

test('new enriched snapshots restrict assessments to their selected product identities',async t=>{
 const accepted=await execute(t,{script:'prepare-check',mutateResearch:research=>research.enrichment={status:'completed',observations:[{productUrl:research.sources[0].url}]}});
 assert.equal(accepted.execution.status,0,accepted.execution.stderr);
 const outside=await execute(t,{script:'prepare-check',mutateResearch:research=>research.enrichment={status:'completed',observations:[{productUrl:'https://example.com/another-product'}]}});
 assert.equal(outside.execution.status,1);assert.match(outside.execution.stderr,/outside the bounded primary evidence selection/);assert.match(outside.outputs,/unverified_code=checker_preparation_failed/);assert.match(outside.outputs,/unverified_reason=Writer assessed a product outside the bounded primary evidence selection\./);
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
  const run=await result.record('runs'),outcome=await result.record('slot-outcomes');assert.equal(run.assessmentOutcome,'unverified');assert.equal(run.status,'no_post_unverified');assert.ok(run.operationalFailures.length);assert.equal(run.checkedAssessment,undefined);assert.equal(run.unverifiedAssessment.completed,false);assert.equal(outcome.status,'no_post_unverified');assert.match(result.outputs,/operational_failure=true/);assert.deepEqual(run.published,[]);
  const next=loopDecision({...result.f.scheduling,now:new Date(now),reservations:[{...result.f.scheduling,schedulingSha256:result.env.LOOP_SCHEDULING_SHA}],outcomes:[outcome]});
  assert.equal(next.slotIds.some(id=>result.f.scheduling.slotIds.includes(id)),false,'an unverified hour cannot spend on the same slot again');
  if(options.liveStatus===429)assert.match(run.unverifiedAssessment.reason,/HTTP 429/);
 }
});

test('unverified content closes even a former third retry without claiming an independent assessment',async t=>{
 const result=await execute(t,{liveStatus:503,mutate:f=>{for(const id of f.scheduling.slotIds)f.scheduling.attemptCounts[id]=3;}});
 const run=await result.record('runs'),outcome=await result.record('slot-outcomes');assert.equal(run.assessmentOutcome,'unverified');assert.equal(outcome.status,'no_post_unverified');assert.ok(outcome.slotOutcomes.every(slot=>slot.status==='no_post_unverified'));assert.equal(run.checkedAssessment,undefined);assert.match(result.outputs,/operational_failure=true/);
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
 for(const name of ['checker','final_check']){assert.match(job(name),/verified: .*steps.prepare.outputs.verified \|\| steps.accept.outputs.verified/);assert.match(job(name),/unverified_reason: .*steps.prepare.outputs.unverified_reason \|\| steps.accept.outputs.unverified_reason/);assert.match(job(name),/id: accept\n        if: always\(\) && steps.prepare.outcome == 'success'/);}
 assert.match(job('report-status'),/needs.record.outputs.operational_failure == 'true'/);assert.match(job('report-status'),/exit 1/);
 assert.match(job('repair'),/if: .*outputs.verified == 'true'/);
 assert.match(job('record'),/name: .*final_check.result != 'skipped'/);
 assert.ok(job('record').split('\n').filter(line=>line.includes('EXPECTED_CONTEXT_SHA:')).every(line=>line.includes("final_check.outputs.context_sha256 != ''")));
});


test('fresh private page content stops preparation before any checker input or model call',async t=>{
 const privateText=text+' Follow @fictionalprivatehandle for more details.';
 const result=await execute(t,{script:'prepare-check',liveText:privateText});
 assert.equal(result.execution.status,1);assert.match(result.execution.stderr,/successfully re-fetched privacy-safe/);assert.match(result.outputs,/checker_preparation_failed/);
 assert.doesNotMatch(result.execution.stdout+result.execution.stderr+result.outputs,/fictionalprivatehandle/);
 assert.ok(!JSON.stringify(await result.record('check-context')).includes('fictionalprivatehandle'));
});

test('exact primary refetches retain a literal safe capability section for exclusions and proposed posts',async t=>{
 const product='https://product.example.com/workflow',raw=`<main><p>${text}</p><p>Follow @private_contact for the creator profile.</p></main>`;
 for(const empty of [true,false]){
  const result=await execute(t,{count:empty?0:1,script:'prepare-check',liveByUrl:{[product]:{text:raw}},mutate:f=>{
   f.context.sources[0].productUrl=product;
   if(empty)f.draft.candidates=[{title:'A bounded receipt experiment',productUrl:product,sourceIds:[f.context.sources[0].id]}];
   else f.draft.posts[0].productUrl=product;
  }});
  assert.equal(result.execution.status,0,result.execution.stderr);const context=await result.record('check-context'),fresh=context.sources.find(source=>source.url===product);
  assert.ok(fresh,'The exact product URL, distinct from its discovery URL, must be freshly fetched.');assert.equal(fresh.text,text);assert.deepEqual(privateArtifactCategories(context),[]);
  assert.equal(fresh.evidenceExtraction.rawSha256,sha256(raw));assert.equal(fresh.evidenceExtraction.normalizedSha256,sha256(plainText(raw)));assert.equal(plainText(raw).slice(fresh.evidenceExtraction.start,fresh.evidenceExtraction.end),fresh.text);assert.ok(fresh.evidenceExtraction.omittedCharacters>0);
  assert.doesNotMatch(JSON.stringify(context),/@private_contact|creator profile/);
  if(empty){assert.equal(context.primaryFetchDiagnostics[0].status,'fetched');assert.equal(context.primaryFetchDiagnostics[0].sourceId,fresh.id);}
  else assert.ok((await result.record('drafts')).posts[0].sourceIds.includes(fresh.id));
 }
});

test('a freshly re-fetched enriched README remains primary evidence for its exact repository identity',async t=>{
 const product='https://github.com/public/receipt-review',readme='https://raw.githubusercontent.com/public/receipt-review/main/README.md';
 const result=await execute(t,{count:0,script:'prepare-check',liveByUrl:{[product]:{status:403,text:'Forbidden'},[readme]:{text}},mutate:f=>{
  Object.assign(f.context.sources[0],{url:readme,productUrl:product,enriched:true,evidenceKind:'github-readme',evidenceFetch:{maxBytes:350000,complete:true}});
  f.draft.candidates=[{title:'A documented receipt workflow',productUrl:product,sourceIds:[f.context.sources[0].id]}];
 }});
 assert.equal(result.execution.status,0,result.execution.stderr);const context=await result.record('check-context');assert.equal(context.primaryFetchDiagnostics[0].status,'fetched');assert.equal(context.primaryFetchDiagnostics[0].sourceId,'source-0');assert.equal(context.sources[0].url,readme);assert.ok(context.sources[0].verifiedAt);assert.ok(!context.health.some(item=>item.url===product),'Verified exact repository documentation must not require its unrelated HTML landing page to work too.');
});

test('an unsafe primary capability paragraph cannot become a model-ready context for either batch shape',async t=>{
 const product='https://product.example.com/workflow',raw=`<main><p>${text} Follow @private_contact for access.</p></main>`;
 for(const empty of [true,false]){
  const result=await execute(t,{count:empty?0:1,script:'prepare-check',liveStatus:503,liveByUrl:{[product]:{status:200,text:raw}},mutate:f=>{
   f.context.sources[0].productUrl=product;
   if(empty)f.draft.candidates=[{title:'An unavailable receipt experiment',productUrl:product,sourceIds:[f.context.sources[0].id]}];
   else f.draft.posts[0].productUrl=product;
  }});
  assert.equal(result.execution.status,1);assert.match(result.execution.stderr,/successfully re-fetched privacy-safe/);assert.match(result.outputs,/checker_preparation_failed/);
  assert.doesNotMatch(result.execution.stdout+result.execution.stderr+result.outputs,/@private_contact/);
  assert.deepEqual(await result.record('check-context'),result.f.context,'Failed preparation must not replace the prior context with unsafe or empty evidence.');
 }
});

test('demand and implementation acquisition reach a frozen draft and accepted independent fixture check without external publication',async t=>{
 const definition=DEMAND_SOURCE_CATALOG.find(source=>source.kind==='jobtech-demand'&&source.segments.includes('professional_services'));
 const task='Register invoice documents and prepare weekly reports for review.',row={id:'111',headline:'Administrator',occupation:{label:'Administratör'},salary_type:{concept_id:'oG8G_9cW_nRf'},publication_date:'2026-10-10T08:00:00',application_deadline:'2026-11-01',description:{text:task}};
 const implementation='The product reads uploaded invoice documents and extracts structured fields for review. It exports parsed fields as CSV. Human approval remains required before records are sent.',raw=`<main><p>${implementation}</p><p>Follow @private_contact for the creator profile.</p></main>`;
 const page=(url,body,{maxBytes=2000000,contentType='application/json'}={})=>({url,text:body,status:200,contentType,fetchedAt:now,maxBytes,bytes:Buffer.byteLength(body),truncated:false,redirects:[],robots:[{origin:new URL(url).origin,evaluatedUrl:url,allowed:true,status:404,state:'missing'}]});
 const demand=parseDemandSourcePage(definition,page(definition.url,JSON.stringify({hits:[row]})))[0],buildingURL='https://documents.example.com/invoice-reports',building={id:hash(buildingURL),url:buildingURL,title:'Invoice reports workflow',text:implementation,fetchedAt:now};
 assert.ok(demand.taskExcerpts.includes(task));
 const validation={publicHttps:true,robotsAllowed:true,readable:true,robots:[{origin:new URL(definition.url).origin,evaluatedUrl:definition.url,robotsUrl:new URL('/robots.txt',definition.url).toString(),status:404,state:'missing',allowed:true,contentType:'text/plain',fetchedAt:now,redirects:[]}],redirects:[],httpStatus:200,contentType:'application/json',resolvedUrl:definition.url,fetchedAt:now,maxBytes:2000000,truncated:false,parserVersion:'public-sources-v1',itemCount:1};
 const registry={sources:[{...definition,status:'probation',validation}]},selection=selectLearningTargets({runId,registry,scoreboard:{segments:[],sources:[]},now,producer:{repository:'xndanius/while-you-sleep',runId:'123',runAttempt:1,workflow:'loop.yml',stage:'pre_model',headSha:'a'.repeat(40)}});
 const requests=[],enriched=await enrichProductLeads({sources:[demand,building],originMap:[{sourceId:demand.id,url:demand.url,productUrl:demand.url,feedIds:[definition.id]},{sourceId:building.id,url:buildingURL,productUrl:buildingURL,feedIds:['building-feed']}],learningSelection:selection,demandDefinitions:[definition],now:()=>Date.parse(now),fetchPage:async(url,options)=>{requests.push(url);assert.ok([demand.url,buildingURL].includes(url),'The fixture must not access a live or unassigned source.');return url===demand.url?page(url,JSON.stringify(row),options):page(url,raw,{...options,contentType:'text/html'});}});
 assert.equal(enriched.enrichment.fetched,1);assert.deepEqual(requests,[demand.url,buildingURL]);
 const snapshot={runId,createdAt:now,...enriched,learningSelection:selection},view=writerResearchView(snapshot),document=view.sources.find(source=>source.enriched&&source.role!=='demand');
 assert.equal(document.text,implementation);assert.deepEqual(privateArtifactCategories(view),[]);
 const result=await execute(t,{script:'prepare-check',extraRecords:[['sources',registry,'registry'],['learning-selection',selection]],envOverrides:{DEMAND_CONTRACT_VERSION:'1',EXPECTED_LEARNING_SELECTION_SHA:sha256(stableJSON(selection))},liveByUrl:{[demand.url]:{text:JSON.stringify(row)},[buildingURL]:{text:raw}},mutateResearch:research=>Object.assign(research,snapshot),mutate:f=>{
  const post=f.draft.posts[0];Object.assign(post,{id:candidateIdentity({productUrl:demand.url}),candidateId:candidateIdentity({productUrl:demand.url}),productUrl:demand.url,title:'Invoice review experiment',promise:'Turn invoice documents into a draft for review.',whatItIs:'A proposed invoice extraction experiment using synthetic inputs.',whoPays:'Hypothesis: administration teams with invoice document chores.',loop:['Upload a synthetic invoice document','Extract draft fields','Review and export CSV'],evidence:'The notice documents an invoice chore; separate documentation describes extraction and export.',uncertainty:'The proposed service has no verified customers or results; human review remains required.',first24Hours:['Choose a synthetic invoice format.','Extract proposed fields from a sample.','Build a human review screen.'],sourceIds:[demand.id,document.id],segment:'professional_services',demandEvidence:{kind:'paid_job',sourceIds:[demand.id],chore:task,evidenceQuote:task}});
  for(const criterion of SCORING_KEYS)post.scoring.criteria[criterion]={value:6,reason:criterion==='profit'?'Hypothesis: administration teams may value help with the stated human chore.':'Documentation supports a bounded extraction experiment with human review.',sourceIds:[['profit','evidence'].includes(criterion)?demand.id:document.id]};
 }});
 assert.equal(result.execution.status,0,result.execution.stderr);
 const draft=await result.record('drafts'),context=await result.record('check-context');assert.equal(context.demandContractVersion,1);assert.deepEqual(context.deterministicResults.map(item=>item.reasons),[[]]);assert.deepEqual(privateArtifactCategories(context),[]);
 assert.ok(context.sources.find(source=>source.id===document.id).text.includes('extracts structured fields for review'));assert.ok(context.sources.find(source=>source.id===demand.id).text.includes(task));
 const env={...result.env,EXPECTED_DRAFT_SHA:sha256(stableJSON(draft)),EXPECTED_CONTEXT_SHA:sha256(stableJSON(context))};
 const runLocal=(script,args=[runId])=>spawnSync(process.execPath,[`scripts/${script}.mjs`,...args],{cwd:result.root,env,encoding:'utf8'});
 const preparation=runLocal('prepare-run',['checker']);assert.equal(preparation.status,0,preparation.stderr);
 const schema=JSON.parse(await readFile(path.join(result.root,'.run/checker-output-schema.json'),'utf8'));assert.ok(schema.properties.manifest.anyOf[1].properties.checks.items.required.includes('demandCheck'));
 const post=draft.posts[0],check={postId:post.id,pass:true,reasons:[],claimChecks:[{claim:'The public vacancy identifies an invoice administration chore.',supported:true,sourceId:demand.id,evidenceQuote:task},{claim:'The implementation documentation describes structured extraction.',supported:true,sourceId:document.id,evidenceQuote:'extracts structured fields for review'},{claim:'The documentation describes CSV export.',supported:true,sourceId:document.id,evidenceQuote:'exports parsed fields as CSV'}],scoreChecks:SCORING_KEYS.map(criterion=>({criterion,supported:true,maxSupportedScore:6,reason:criterion==='profit'?'Hypothesis: the notice establishes human work, with no verified AI purchase.':'The fixture documentation supports a narrow proposed experiment requiring review.',sourceId:['profit','evidence'].includes(criterion)?demand.id:document.id,evidenceQuote:['profit','evidence'].includes(criterion)?task:'extracts structured fields for review'})),noveltyCheck:{recentPostsSha256:context.noveltyContext.postsSha256,windowDays:14,comparedPostCount:0,...Object.fromEntries(['product','workflow','customer'].map(dimension=>[dimension,{distinct:true,closestPostId:null,reason:'The complete frozen fixture index is empty.'}]))},demandCheck:{demandContextSha256:context.demandContextSha256,supported:true,segment:post.segment,sourceId:demand.id,kind:'paid_job',chore:task,evidenceQuote:task,reason:'A sanitized public fixture vacancy states the chore; AI demand and payment remain hypothetical.',noPersonalData:true}};
 // This verdict is explicit test data, never a model decision or a production approval.
 const checked={draft,context,manifest:{runId,checks:[check]}};bind(checked);
 await writeFile(path.join(result.root,'.run/checker-response.json'),JSON.stringify({outcome:'completed',reason:'Synthetic independent fixture examination completed.',manifest:checked.manifest}));
 const accepted=runLocal('accept-check-output');assert.equal(accepted.status,0,accepted.stderr);assert.match(accepted.stdout,/"completed":true/);
 const manifest=await result.record('checks');assert.deepEqual(completedAssessmentReasons(draft,context,manifest),[]);assert.deepEqual(checkApproval(draft,context,manifest).map(item=>({pass:item.pass,reasons:item.reasons})),[{pass:true,reasons:[]}]);
 const fabricated=structuredClone(manifest);fabricated.checks[0].claimChecks[0].evidenceQuote='An invented claim that is absent from every source.';assert.ok(completedAssessmentReasons(draft,context,fabricated).length);
 await assert.rejects(readFile(path.join(result.root,'data/posts',post.id+'.json')),error=>error.code==='ENOENT','Checking must not publish even a local fixture.');
 // Exercise the local no-post finalizer too: independently checked scores below six remain a terminal refusal.
 for(const rating of Object.values(draft.posts[0].scoring.criteria))rating.value=5;bind(checked);Object.assign(env,{EXPECTED_DRAFT_SHA:context.draftSha256,EXPECTED_CONTEXT_SHA:sha256(stableJSON(context))});
 for(const [directory,record] of [['drafts',draft],['check-context',context],['checks',checked.manifest]])await writeFile(path.join(result.root,'data',directory,runId+'.json'),JSON.stringify(record));
 const finalized=runLocal('finalize-run');assert.equal(finalized.status,0,finalized.stderr);const run=await result.record('runs');assert.equal(run.status,'completed_no_post');assert.equal(run.assessmentOutcome,'completed');assert.deepEqual(run.published,[]);assert.deepEqual(run.operationalFailures,[]);
});
