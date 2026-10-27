import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {candidateIdentity,sha256,stableJSON} from '../lib/storage.mjs';
import {DISCUSSION_SOURCE_CATALOG,parseDiscussionSourcePage} from '../lib/discussion-sources.mjs';
import {createDemandContext,demandContextHash,demandContextReasons} from '../lib/demand.mjs';
import {createNoveltyContext} from '../lib/novelty.mjs';
import {parseScoringPolicy,SCORING_KEYS} from '../lib/scoring.mjs';
import {loopDecision} from '../lib/loop-schedule.mjs';
import {checkApproval,completedAssessmentReasons,deterministicCheck,verifyPublishedPost} from '../lib/validation.mjs';
import {discussionEvidenceReasons} from '../lib/evidence-contract.mjs';
import {sourceValidationMatchesDefinition} from '../lib/source-registry.mjs';
import {SOURCE_PARSER_VERSION} from '../lib/research.mjs';

// The topic, post and verdict are synthetic offline fixtures. They exercise
// actual publisher code, not a real article or approval to publish one.
const now='2026-10-27T22:08:00.000Z',postedAt='2026-10-27T21:00:00.000Z';
const runId='loop-987654321-1',topicId=987654321,url=`https://community.make.com/t/${topicId}`;
const definition=DISCUSSION_SOURCE_CATALOG.find(source=>source.community==='Make community');
const task='I cannot map array data for dynamic amount of invoice rows to the HTTP POST module’s “invoice rows” section.';
const example='“Hinta 0% (from Ostettu tuote)”: [ 390.4382470119522, 79.6812749003984 ]';
const exampleHtml='<p>“Hinta 0% (from Ostettu tuote)”: [</p><p>390.4382470119522,</p><p>79.6812749003984 ]</p>';
const body=`<p>${task}</p>${exampleHtml}`;
const readingDetail='The first input has two amounts and two tax categories. The second input has the corresponding item descriptions in the same order. Review the draft mapping before sending it.';
const readingBody=`${body}<p>${readingDetail}</p>`;
const rules='# Synthetic rules\n<!-- scoring-policy:start -->\n```json\n{"weights":{"ease":1,"profit":1,"feasibility":1,"autonomy":1,"evidence":1},"publishThreshold":6}\n```\n<!-- scoring-policy:end -->\n';

function primaryJSON(raw=body,{identified=false}={}){
 return JSON.stringify({id:topicId,title:'How can I map invoice rows?',created_at:postedAt,post_stream:{posts:[{post_number:1,cooked:raw,...(identified?{id:7654321,topic_id:topicId,created_at:postedAt}: {})}]}});
}

function fixture({version=1}={}){
 const parsed=parseDiscussionSourcePage(definition,{url:url+'.json',text:primaryJSON(version===2?readingBody:body,{identified:version===2}),status:200,contentType:'application/json',fetchedAt:now,maxBytes:2000000,truncated:false},{expectedUrl:url,includeNativeReadingContext:version===2})[0];
 const source={...parsed,verifiedAt:now,enriched:true,evidenceKind:'discussion-post',evidenceFetch:{maxBytes:2000000,complete:true}};
 if(version===1)assert.deepEqual(source.taskExample,{version:1,text:example,sha256:sha256(example)});
 else{
  assert.equal(source.taskExample,undefined);assert.equal(source.nativeReadingContext.version,2);
  assert.ok(source.nativeReadingContext.retainedCharacters>200&&source.nativeReadingContext.retainedCharacters<=1200);
  assert.ok(source.nativeReadingContext.spans.some(span=>span.text.includes(readingDetail)));
 }
 assert.deepEqual(discussionEvidenceReasons(source,{definition,asOf:now}),[]);
 const validation={publicHttps:true,robotsAllowed:true,readable:true,robots:[{origin:new URL(definition.url).origin,evaluatedUrl:definition.url,robotsUrl:new URL('/robots.txt',definition.url).toString(),status:404,state:'missing',allowed:true,contentType:'text/plain',fetchedAt:now}],redirects:[],httpStatus:200,contentType:'application/rss+xml',resolvedUrl:definition.url,fetchedAt:now,maxBytes:2000000,truncated:false,parserVersion:SOURCE_PARSER_VERSION,itemCount:1};
 const registry={sources:[{...definition,status:'active',validation}]};
 assert.equal(sourceValidationMatchesDefinition(validation,registry.sources[0]),true);
 const cadence={schema:1,mode:'hourly',activatedAt:'2026-10-11T00:00:00.000Z',relayConfirmedAt:'2026-10-10T23:00:00.000Z'};
 const scheduling=loopDecision({runId,eventName:'workflow_dispatch',githubRunId:'987654321',githubRunUrl:'https://github.com/xndanius/while-you-sleep/actions/runs/987654321',now:new Date(now),cadence});
 assert.equal(scheduling.targetCount,1,'The synthetic midnight fixture reserves exactly one current-day slot.');
 const id=candidateIdentity({productUrl:url});
 const criteria=Object.fromEntries(SCORING_KEYS.map(key=>[key,{value:6,reason:key==='profit'?'Hypothesis: accounting teams may value a reviewed mapping draft.':'The synthetic evidence supports only a bounded mapping experiment with review.',sourceIds:[source.id]}]));
 const post={id,candidateId:id,title:'Review a draft mapping for invoice rows',promise:'Turn supplied invoice rows into a mapping draft for review.',whatItIs:'A synthetic invoice mapping experiment.',whoPays:'Hypothesis: accounting teams with repetitive invoice administration.',loop:['Read supplied invoice rows','Prepare a mapping draft','Ask a person to review before sending'],evidence:'The fixture states a mapping request and supplies a named numeric array.',uncertainty:'The fixture proves no working implementation, paying customer or revenue.',first24Hours:['Choose one invoice field.','Map the synthetic numeric input.','Review the draft before sending.'],sourceIds:[source.id],productUrl:url,segment:source.segment,demandEvidence:{kind:'community_request',sourceIds:[source.id],chore:task,evidenceQuote:task},scoring:{criteria}};
 const draft={runId,targetCount:1,posts:[post],candidates:[],rejected:[]};
 const research={runId,createdAt:now,sources:[source],health:[]};
 const assignment={productUrl:url,segment:source.segment,kind:'discussion',demandSourceId:source.id,registrySourceId:definition.id};
 const demandContext=createDemandContext({registrySources:[definition],authorizedSources:[{sourceId:source.id,registrySourceId:definition.id,url,role:'demand',demandKind:'community_request',segments:[source.segment]}],posts:[],selectedSegment:null,discussionBatchPolicy:{version:1,maxLeads:10,maxPerDemandSource:3,postIsDemand:true,leadAssignments:[assignment],researchSha256:sha256(stableJSON(research))}});
 const noveltyContext=createNoveltyContext([],{now:new Date(now)});
 const context={runId,createdAt:now,rulesSha256:sha256(rules),scoringPolicy:parseScoringPolicy(rules),sources:[source],health:[],assessmentContractVersion:1,noveltyContractVersion:1,noveltyContext,demandContractVersion:1,demandContext,demandContextSha256:demandContextHash(demandContext)};
 assert.deepEqual(demandContextReasons(context),[]);
 context.deterministicResults=[{postId:id,pass:true,reasons:[]}];
 context.draftSha256=sha256(stableJSON(draft));context.sourceSnapshotSha256=sha256(stableJSON(context.sources));
 const check={postId:id,pass:true,reasons:[],claimChecks:[
  {claim:'The synthetic discussion asks to map invoice rows.',supported:true,sourceId:source.id,evidenceQuote:task},
  {claim:'The synthetic input names an invoice-price array.',supported:true,sourceId:source.id,evidenceQuote:'“Hinta 0% (from Ostettu tuote)”'},
  {claim:'The synthetic array contains two numeric values.',supported:true,sourceId:source.id,evidenceQuote:'390.4382470119522, 79.6812749003984'},
 ],scoreChecks:SCORING_KEYS.map(criterion=>({criterion,supported:true,maxSupportedScore:6,reason:criterion==='profit'?'Hypothesis: this synthetic example establishes no purchase.':'The synthetic example supports only a reviewed mapping experiment.',sourceId:source.id,evidenceQuote:['ease','feasibility','evidence'].includes(criterion)?example:task})),noveltyCheck:{recentPostsSha256:noveltyContext.postsSha256,windowDays:14,comparedPostCount:0,...Object.fromEntries(['product','workflow','customer'].map(dimension=>[dimension,{distinct:true,closestPostId:null,reason:'The synthetic comparison index is empty.'}]))},demandCheck:{demandContextSha256:context.demandContextSha256,supported:true,segment:source.segment,sourceId:source.id,kind:'community_request',chore:task,evidenceQuote:task,reason:'A synthetic first post states the task; payment remains hypothetical.',noPersonalData:true}};
 if(version===2){
  check.claimChecks[1]={claim:'The synthetic original post describes corresponding input fields.',supported:true,sourceId:source.id,evidenceQuote:readingDetail};
  check.scoreChecks.find(row=>row.criterion==='feasibility').evidenceQuote=readingDetail;
 }
 const manifest={runId,checkedAt:now,draftSha256:context.draftSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,policySha256:context.scoringPolicy.policySha256,checks:[check],completedAssessment:{schema:1,completed:true,decision:'assessed',reason:'The synthetic proposed experiment was independently checked against its frozen evidence.',contextSha256:sha256(stableJSON(context)),rulesSha256:context.rulesSha256,draftSha256:context.draftSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,policySha256:context.scoringPolicy.policySha256}};
 assert.deepEqual(deterministicCheck(post,[source],[],{scoringPolicy:context.scoringPolicy,demandContext:context,demandRequired:true}),[]);
 assert.deepEqual(completedAssessmentReasons(draft,context,manifest),[]);
 assert.equal(checkApproval(draft,context,manifest)[0].pass,true);
 return {source,post,scheduling,registry,draft,research,context,manifest};
}

async function runPublisher(t,liveBody=body,{version=1,identified=version===2,mutateFrozen,expectedExit=0,expectedRequests=['https://community.make.com/robots.txt',url+'.json']}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-structured-publication-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await cp(new URL('../lib',import.meta.url),path.join(root,'lib'),{recursive:true});
 await mkdir(path.join(root,'public'));for(const file of ['schedule.js','cadence-config.js'])await cp(new URL('../public/'+file,import.meta.url),path.join(root,'public',file));
 await mkdir(path.join(root,'scripts'));await cp(new URL('../scripts/publish-checked.mjs',import.meta.url),path.join(root,'scripts','publish-checked.mjs'));
 await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),path.join(root,'node_modules'),'dir');
 await writeFile(path.join(root,'package.json'),JSON.stringify({type:'module'}));
 const f=fixture({version}),schedulingSha256=sha256(stableJSON(f.scheduling));
 if(mutateFrozen){
  mutateFrozen(f);
  f.context.draftSha256=sha256(stableJSON(f.draft));f.context.sourceSnapshotSha256=sha256(stableJSON(f.context.sources));
  Object.assign(f.manifest,{draftSha256:f.context.draftSha256,sourceSnapshotSha256:f.context.sourceSnapshotSha256});
  Object.assign(f.manifest.completedAssessment,{draftSha256:f.context.draftSha256,sourceSnapshotSha256:f.context.sourceSnapshotSha256,contextSha256:sha256(stableJSON(f.context))});
 }
 const records=[['scheduling',runId,f.scheduling],['slot-reservations',runId,{...f.scheduling,schedulingSha256}],['drafts',runId,f.draft],['research',runId,f.research],['check-context',runId,f.context],['checks',runId,f.manifest],['sources','registry',f.registry],['relay','status',{feedPath:'best.xml',bestFeedSwitch:{state:'confirmed',confirmedAt:now}}]];
 for(const [directory,name,record] of records){await mkdir(path.join(root,'data',directory),{recursive:true});await writeFile(path.join(root,'data',directory,name+'.json'),stableJSON(record));}
 const preload=`import dns from 'node:dns/promises';import {syncBuiltinESMExports} from 'node:module';const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[${JSON.stringify(now)}]));}static now(){return NativeDate.parse(${JSON.stringify(now)});}};dns.lookup=async host=>{if(host!=='community.make.com')throw new Error('Unexpected DNS lookup: '+host);return [{address:'203.0.113.10',family:4}];};syncBuiltinESMExports();const requests=[];globalThis.fetch=async input=>{const url=String(input);requests.push(url);if(url==='https://community.make.com/robots.txt')return new Response('User-agent: *\\nAllow: /\\n',{status:200,headers:{'content-type':'text/plain'}});if(url===${JSON.stringify(url+'.json')})return new Response(${JSON.stringify(primaryJSON(liveBody,{identified}))},{status:200,headers:{'content-type':'application/json'}});throw new Error('Unexpected network request: '+url);};process.on('exit',()=>console.log('FETCH_URLS '+JSON.stringify(requests)));`;
 await writeFile(path.join(root,'preload.mjs'),preload);
 const execution=spawnSync(process.execPath,['scripts/publish-checked.mjs',runId,'1'],{cwd:root,env:{PATH:process.env.PATH,NODE_OPTIONS:`--import=${path.join(root,'preload.mjs')}`,GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',LOOP_SCHEDULING_SHA:schedulingSha256,EXPECTED_DRAFT_SHA:f.context.draftSha256,EXPECTED_CONTEXT_SHA:sha256(stableJSON(f.context)),RULES_SHA256:f.context.rulesSha256,DEMAND_CONTRACT_VERSION:'1',MODEL_JOB_RESULTS:JSON.stringify({writer:{result:'success'},checker:{result:'success'},repair:{result:'skipped'},final_check:{result:'skipped'}})},encoding:'utf8'});
 assert.equal(execution.status,expectedExit,execution.stderr||execution.stdout);
 const requestLine=execution.stdout.split('\n').find(line=>line.startsWith('FETCH_URLS '));
 assert.deepEqual(JSON.parse(requestLine.slice('FETCH_URLS '.length)),expectedRequests);
 assert.deepEqual(JSON.parse(await readFile(path.join(root,'data','check-context',runId+'.json'),'utf8')),f.context,'The live recheck must preserve the frozen checker context.');
 const run=await readFile(path.join(root,'data','runs',runId+'.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 return {root,f,execution,run};
}

test('actual publisher accepts a fresh V2 original-post packet quote beyond the discovery excerpt',async t=>{
 const {root,f,run}=await runPublisher(t,readingBody,{version:2});
 assert.equal(f.source.text.includes(readingDetail),false);assert.equal(f.source.taskExample,undefined);
 assert.deepEqual(run.published,[f.post.id]);assert.deepEqual(run.operationalFailures,[]);
 const saved=JSON.parse(await readFile(path.join(root,'data','posts',f.post.id+'.json'),'utf8'));
 assert.equal(verifyPublishedPost(saved),true);assert.equal(saved.scoring.overall,6);
 assert.equal(saved.demandEvidence.evidenceQuote,task);assert.equal(saved.checker.demandCheck.evidenceQuote,task);
 assert.deepEqual(saved.checker.scoreSources[0].nativeReadingContext,f.source.nativeReadingContext);
 assert.equal(saved.checker.scoreChecks.find(row=>row.criterion==='feasibility').evidenceQuote,readingDetail);
 assert.ok(saved.checker.claimChecks.some(row=>row.evidenceQuote===readingDetail));
});

for(const [name,liveBody,identified] of [['missing',`<p>${task}</p>`,false],['changed',readingBody.replace('two tax categories','three tax categories'),true]]){
 test(`actual publisher blocks a ${name} V2 reading context quote at the final reread`,async t=>{
  const {root,f,run}=await runPublisher(t,liveBody,{version:2,identified});
  assert.equal(checkApproval(f.draft,f.context,f.manifest)[0].pass,true);
  assert.equal(run.status,'no_post_unverified');assert.deepEqual(run.published,[]);
  assert.ok(run.operationalFailures.some(failure=>failure.code==='live_evidence_unavailable'&&/quote no longer exists/.test(failure.reason)));
  assert.deepEqual(await readdir(path.join(root,'data','posts')).catch(error=>{if(error.code==='ENOENT')return [];throw error;}),[]);
 });
}

test('actual publisher rejects a corrupt V2 packet even when the outer frozen fingerprints match',async t=>{
 const {root,f,execution,run}=await runPublisher(t,readingBody,{version:2,expectedExit:1,expectedRequests:[],mutateFrozen:value=>{value.source.nativeReadingContext.packetSha256='0'.repeat(64);}});
 assert.equal(checkApproval(f.draft,f.context,f.manifest)[0].pass,false);
 assert.match(execution.stderr,/packet fingerprint|reading context/i);assert.equal(run,null);
 assert.deepEqual(await readdir(path.join(root,'data','posts')).catch(error=>{if(error.code==='ENOENT')return [];throw error;}),[]);
});

test('actual publisher accepts a frozen native task example at score six with the demand quote kept in the main task',async t=>{
 const {root,f,run}=await runPublisher(t);
 assert.deepEqual(run.published,[f.post.id]);assert.equal(run.assessmentOutcome,'completed');assert.deepEqual(run.operationalFailures,[]);
 const saved=JSON.parse(await readFile(path.join(root,'data','posts',f.post.id+'.json'),'utf8'));
 assert.equal(verifyPublishedPost(saved),true);assert.equal(saved.scoring.overall,6);
 assert.equal(saved.demandEvidence.evidenceQuote,task);assert.equal(saved.checker.demandCheck.evidenceQuote,task);
 assert.deepEqual(saved.checker.scoreSources[0].taskExample,f.source.taskExample);
 assert.ok(saved.checker.scoreChecks.some(check=>check.evidenceQuote===example));
 assert.equal(sha256(stableJSON(saved.checker.scoreSources)),saved.checker.sourceSnapshotSha256);
});

for(const [name,liveBody] of [['missing',`<p>${task}</p>`],['changed',body.replace('79.6812749003984','80.5')]]){
 test(`actual publisher blocks a ${name} example at its final native reread without creating a post`,async t=>{
  const {root,f,run}=await runPublisher(t,liveBody);
  assert.equal(checkApproval(f.draft,f.context,f.manifest)[0].pass,true,'The original frozen approval is valid; only the live example changed.');
  assert.deepEqual(run.published,[]);assert.equal(run.status,'no_post_unverified');assert.equal(run.assessmentOutcome,'unverified');
  assert.ok(run.operationalFailures.some(failure=>failure.code==='live_evidence_unavailable'&&/quote no longer exists/.test(failure.reason)));
  assert.deepEqual(await readdir(path.join(root,'data','posts')).catch(error=>{if(error.code==='ENOENT')return [];throw error;}),[]);
  await assert.rejects(readFile(path.join(root,'data','posts',f.post.id+'.json')),error=>error.code==='ENOENT');
  assert.equal(f.context.sources[0].text,task);assert.equal(f.manifest.checks[0].demandCheck.evidenceQuote,task);
 });
}
