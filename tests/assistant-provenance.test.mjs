import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assistantFixture} from './fixtures/assistant-execution.mjs';
import {createAssistantExecution,validateAssistantExecution,assistantPostReasons,assistantCheckerId} from '../lib/assistant-provenance.mjs';
import {registerAssistantCheck} from '../scripts/register-assistant-check.mjs';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {contentHash,verifyPublishedPost,deterministicCheck} from '../lib/validation.mjs';
import {publishedScoring} from '../lib/scoring.mjs';
import {writeSiteArtifacts} from '../lib/site-artifacts.mjs';
import {selectCurationPost} from '../lib/curation.mjs';
import {renderCard} from '../lib/card.mjs';
import {WEBSITE_ONLY} from '../lib/publication-distribution.mjs';
import {DISCUSSION_SOURCE_CATALOG,parseDiscussionSourcePage} from '../lib/discussion-sources.mjs';
import {createDemandContext,demandContextHash} from '../lib/demand.mjs';
import {prepareLoop} from '../scripts/prepare-loop.mjs';
import {slotOutcome} from '../lib/loop-schedule.mjs';

const pin=value=>sha256(stableJSON(value));
const refresh=f=>{
 const {draft,context,manifest,research}=f.inputs,{writer,checker}=f.options;
 context.draftSha256=pin(draft);context.sourceSnapshotSha256=pin(context.sources);
 Object.assign(manifest,{draftSha256:context.draftSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,policySha256:context.scoringPolicy.policySha256});
 Object.assign(manifest.completedAssessment,{contextSha256:pin(context),rulesSha256:context.rulesSha256,draftSha256:context.draftSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,policySha256:context.scoringPolicy.policySha256});
 writer.inputSha256=pin(research);writer.outputSha256=pin(draft);checker.inputSha256=pin(context);checker.outputSha256=pin(manifest);
 f.options.expectedWriterReceiptSha256=pin(writer);f.options.expectedCheckerReceiptSha256=pin(checker);
};

test('host-pinned independent runtime receipts bind every input without claiming API execution',()=>{
 const f=assistantFixture(),before=stableJSON(f),{record,decisions}=createAssistantExecution(f.inputs,f.options);
 assert.equal(decisions[0].pass,true);assert.equal(record.kind,'assistant-execution');assert.equal(record.writer.actor.taskId,f.options.writer.actor.taskId);
 assert.equal(record.bindings.manifestSha256,pin(f.inputs.manifest));assert.deepEqual(record.distribution,WEBSITE_ONLY);
 assert.equal(record.engine,undefined);assert.equal(record.costUsd,undefined);assert.equal(stableJSON(f),before);
 assert.equal(validateAssistantExecution(record,f.inputs,{expectedSha256:pin(record),now:f.options.now})[0].pass,true);
});

test('same task with another turn, swapped roles, invented actor fields and time overlap cannot establish independence',()=>{
 const changes=[
  f=>{f.options.checker.actor.taskId=f.options.writer.actor.taskId;},
  f=>{f.options.checker.actor.taskId=f.options.writer.actor.taskId;f.options.checker.actor.surface='chatgpt';},
  f=>{f.options.checker.role='writer';},
  f=>{f.options.checker.actor.name='Claimed independent reviewer';},
  f=>{f.options.checker.actor.taskId='unverified-reviewer';},
  f=>{f.options.checker.startedAt=f.options.writer.startedAt;},
  f=>{f.options.checker.completedAt='2026-10-30T10:07:00.000Z';},
 ];
 for(const change of changes){const f=assistantFixture();change(f);refresh(f);assert.throws(()=>createAssistantExecution(f.inputs,f.options),undefined,change.toString());}
 const f=assistantFixture();delete f.options.expectedCheckerReceiptSha256;assert.throws(()=>createAssistantExecution(f.inputs,f.options),/host-supplied/);
});

test('modified artifacts, wrong host pins and stale contexts fail closed without rebinding history',()=>{
 for(const key of ['draft','context','manifest','research','rules']){
  const f=assistantFixture(),{record}=createAssistantExecution(f.inputs,f.options);
  if(key==='rules')f.inputs.rules+='\nchanged';else f.inputs[key].tampered=true;
  assert.throws(()=>validateAssistantExecution(record,f.inputs,{expectedSha256:pin(record),now:f.options.now}),/changed/);
 }
 const f=assistantFixture(),{record}=createAssistantExecution(f.inputs,f.options);
 assert.throws(()=>validateAssistantExecution(record,f.inputs,{expectedSha256:'a'.repeat(64),now:f.options.now}),/fingerprint/);
 assert.throws(()=>validateAssistantExecution(record,f.inputs,{expectedSha256:pin(record),now:new Date('2026-10-30T14:00:00.000Z')}),/stale/);
});

test('false claims, unavailable score IDs, privacy and downgraded contracts cannot be accepted',()=>{
 const mutations=[
  f=>{f.inputs.manifest.checks[0].claimChecks[0].evidenceQuote='Invented customers pay for this service.';},
  f=>{f.inputs.draft.posts[0].scoring.criteria.ease.sourceIds=['unknown-source'];},
  f=>{f.inputs.context.sources[0].text+=' Contact person@example.invalid';},
  f=>{f.inputs.manifest.checks[0].scoreChecks[0].reason='Contact person@example.invalid for this score';},
  f=>{f.inputs.research.sources[0].fetchedAt=f.inputs.context.createdAt;},
  f=>{f.inputs.context.noveltyContractVersion=undefined;},
  f=>{f.inputs.context.candidateScoringVersion=undefined;},
  f=>{f.inputs.context.scoringPolicy.threshold=5;},
  f=>{f.inputs.context.scoringPolicy.weights.ease=2;},
 ];
 for(const mutate of mutations){const f=assistantFixture();mutate(f);refresh(f);assert.throws(()=>createAssistantExecution(f.inputs,f.options),undefined,mutate.toString());}
});

test('a well-formed rejection and below-six proposal remain rejections',()=>{
 const f=assistantFixture();f.inputs.manifest.checks[0].pass=false;f.inputs.manifest.checks[0].reasons=['Synthetic reviewer finds insufficient evidence.'];refresh(f);
 assert.equal(createAssistantExecution(f.inputs,f.options).decisions[0].pass,false);
 const low=assistantFixture();for(const score of Object.values(low.inputs.draft.posts[0].scoring.criteria))score.value=5;refresh(low);
 const result=createAssistantExecution(low.inputs,low.options);assert.equal(result.decisions[0].pass,false);assert.ok(result.decisions[0].reasons.some(reason=>/threshold|score/i.test(reason)));
});

async function sandbox(t,f){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'wys-assistant-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const [dir,key] of [['drafts','draft'],['check-context','context'],['checks','manifest'],['research','research']]){await fs.mkdir(path.join(root,'data',dir),{recursive:true});await fs.writeFile(path.join(root,'data',dir,f.inputs.draft.runId+'.json'),stableJSON(f.inputs[key]));}
 await fs.writeFile(path.join(root,'RULES.md'),f.inputs.rules);
 const writerPath=path.join(root,'writer.json'),checkerPath=path.join(root,'checker.json');await fs.writeFile(writerPath,stableJSON(f.options.writer));await fs.writeFile(checkerPath,stableJSON(f.options.checker));
 return {root,args:{...f.options,root,runId:f.inputs.draft.runId,writerPath,checkerPath}};
}
test('registration writes only immutable execution metadata, is idempotent and does not publish or alter inputs',async t=>{
 const f=assistantFixture(),{root,args}=await sandbox(t,f),first=await registerAssistantCheck(args),file=path.join(root,'data','assistant-executions',first.runId+'.json'),raw=await fs.readFile(file,'utf8');
 const second=await registerAssistantCheck({...args,now:new Date('2026-10-30T10:07:00.000Z')});assert.deepEqual(second,first);assert.equal(await fs.readFile(file,'utf8'),raw);assert.deepEqual(first.published,[]);
 assert.deepEqual((await fs.readdir(path.join(root,'data'))).sort(),['assistant-executions','check-context','checks','drafts','research']);
 assert.equal(await fs.readFile(path.join(root,'data','checks',first.runId+'.json'),'utf8'),stableJSON(f.inputs.manifest));
 await fs.writeFile(args.checkerPath,stableJSON({...f.options.checker,completedAt:'2026-10-30T10:06:30.000Z'}));await assert.rejects(registerAssistantCheck(args),/conflicts/);assert.equal(await fs.readFile(file,'utf8'),raw);
 const bad=assistantFixture(),s=await sandbox(t,bad);await assert.rejects(registerAssistantCheck({...s.args,expectedCheckerReceiptSha256:'b'.repeat(64)}),/host-supplied/);await assert.rejects(fs.access(path.join(s.root,'data','assistant-executions')),{code:'ENOENT'});
});

function publication(f,record){
 const post=structuredClone(f.inputs.draft.posts[0]),check=f.inputs.manifest.checks[0],checkerRunId=assistantCheckerId(record);
 delete post.sourceIds;
 const sources=f.inputs.context.sources.map(({id,title,url,publisher,fetchedAt,verifiedAt})=>({id,title,url,publisher,fetchedAt,verifiedAt}));
 Object.assign(post,{runId:record.runId,publishedAt:'2026-10-30T10:06:00.000Z',origin:'assistant-checked-publication',rulesSha256:record.bindings.rulesSha256,assistantExecution:record,distribution:{...WEBSITE_ONLY},sources,scoring:publishedScoring(post.scoring.criteria,f.inputs.context.scoringPolicy,{checkedAt:record.checker.completedAt,checkerRunId}),checker:{passed:true,checkerRunId,checkedAt:record.checker.completedAt,draftSha256:record.bindings.draftSha256,sourceSnapshotSha256:record.bindings.sourceSnapshotSha256,manifestSha256:record.bindings.manifestSha256,claimChecks:structuredClone(check.claimChecks),scoreChecks:structuredClone(check.scoreChecks),scoreSources:structuredClone(f.inputs.context.sources),scoringPolicy:f.inputs.context.scoringPolicy,noveltyCheck:check.noveltyCheck,demandCheck:check.demandCheck,approval:structuredClone(check)}});
 post.contentSha256=contentHash(post);return post;
}
test('published assistant records bind checker payload and metadata; legacy originals retain their existing contract',async()=>{
 const f=assistantFixture(),post=publication(f,createAssistantExecution(f.inputs,f.options).record);assert.deepEqual(assistantPostReasons(post),[]);assert.equal(verifyPublishedPost(post),true);
 for(const mutate of [p=>p.title='Changed',p=>p.scoring.criteria.ease.value=9,p=>p.scoring.overall=10,p=>p.sources[0].url='https://example.org/forged',p=>p.sources[0].title='Invented source',p=>p.sources.push({...p.sources[0]}),p=>p.checker.claimChecks=[],p=>p.checker.approval.pass=false,p=>p.checker.checkerRunId='invented',p=>p.distribution.rss=true,p=>p.assistantExecution.writer.actor.taskId=p.assistantExecution.checker.actor.taskId]){const copy=structuredClone(post);mutate(copy);copy.contentSha256=contentHash(copy);assert.equal(verifyPublishedPost(copy),false,mutate.toString());}
 const legacy=JSON.parse(await fs.readFile(new URL('../data/posts/e20bcacf021524725d3fc275.json',import.meta.url),'utf8'));assert.equal(verifyPublishedPost(legacy),true);
});

test('website-only publication leaves both RSS feeds byte-identical and cannot enter curation',async t=>{
 const f=assistantFixture(),post=publication(f,createAssistantExecution(f.inputs,f.options).record),root=await fs.mkdtemp(path.join(os.tmpdir(),'wys-assistant-site-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const legacy=structuredClone(post);legacy.id='legacy-synthetic';legacy.origin='local-checked-publication';delete legacy.assistantExecution;delete legacy.distribution;legacy.publishedAt='2026-10-30T10:05:00.000Z';legacy.contentSha256=contentHash(legacy);
 await fs.mkdir(path.join(root,'public','cards'),{recursive:true});for(const item of [legacy,post])await fs.writeFile(path.join(root,'public','cards',item.id+'.jpg'),renderCard(item));
 const settings={root,baseURL:'https://example.invalid',styleVersion:'abcdef123456'};await writeSiteArtifacts({...settings,posts:[legacy]});const original=await Promise.all(['feed.xml','best.xml'].map(name=>fs.readFile(path.join(root,'public',name),'utf8')));
 await writeSiteArtifacts({...settings,posts:[legacy,post]});assert.deepEqual(await Promise.all(['feed.xml','best.xml'].map(name=>fs.readFile(path.join(root,'public',name),'utf8'))),original);
 const page=await fs.readFile(path.join(root,'public','p',post.id,'index.html'),'utf8');assert.match(page,/Independently checked/);assert.doesNotMatch(page,/Checked by the loop/);
 const config={schema:1,enabled:true,activatedAt:'2026-10-30T09:00:00.000Z'};assert.equal(await selectCurationPost({config,posts:[post],policy:f.inputs.context.scoringPolicy,now:f.options.now}),null);
 await assert.rejects(writeSiteArtifacts({...settings,posts:[post],picks:[{postId:post.id}]}),/website-only/);
});

function nativeFixture(){
 const f=assistantFixture(),{draft,context,manifest,research}=f.inputs;
 const definition=DISCUSSION_SOURCE_CATALOG.find(row=>row.url==='https://community.make.com/latest.rss'),url='https://community.make.com/t/999999';
 const raw={id:999999,title:'Daily filing task',created_at:'2026-10-30T09:00:00.000Z',post_stream:{posts:[{id:999991,post_number:1,created_at:'2026-10-30T09:00:00.000Z',cooked:'<p>Every day our office manually organizes and catalogues incoming filing records. We need a tool to prepare these record categories for human review.</p>'}]}};
 const page={url:url+'.json',text:JSON.stringify(raw),status:200,contentType:'application/json',fetchedAt:context.createdAt,maxBytes:2000000,truncated:false,redirects:[],robots:[]};
 const parsed=parseDiscussionSourcePage(definition,page,{expectedUrl:url})[0];
 const source={...parsed,verifiedAt:context.createdAt,enriched:true,evidenceKind:'discussion-post',evidenceFetch:{maxBytes:2000000,complete:true}};
 const post=draft.posts[0],check=manifest.checks[0];
 Object.assign(post,{id:source.id,candidateId:source.id,productUrl:url,segment:source.segment,sourceIds:[source.id],demandEvidence:{kind:'community_request',sourceIds:[source.id],chore:'Organize incoming filing records and prepare categories for human review.',evidenceQuote:source.text}});
 for(const rating of Object.values(post.scoring.criteria))rating.sourceIds=[source.id];
 research.sources=[{...source,fetchedAt:research.createdAt,verifiedAt:research.createdAt}];
 const discussionBatchPolicy={version:1,maxLeads:10,maxPerDemandSource:3,postIsDemand:true,leadAssignments:[{productUrl:url,segment:source.segment,kind:'discussion',demandSourceId:source.id,registrySourceId:definition.id}],researchSha256:pin(research)};
 context.sources=[source];context.demandContext=createDemandContext({registrySources:[definition],authorizedSources:[{sourceId:source.id,registrySourceId:definition.id,url,role:'demand',demandKind:'community_request',segments:definition.segments}],posts:[],selectedSegment:null,discussionBatchPolicy});context.demandContextSha256=demandContextHash(context.demandContext);
 context.deterministicResults=[{postId:post.id,reasons:deterministicCheck(post,[source],[],{scoringPolicy:context.scoringPolicy,demandContext:context,demandRequired:true,noveltyNow:f.options.now})}];
 check.postId=post.id;for(const row of [...check.claimChecks,...check.scoreChecks])Object.assign(row,{sourceId:source.id,evidenceQuote:source.text});
 Object.assign(check.demandCheck,{demandContextSha256:context.demandContextSha256,segment:source.segment,sourceId:source.id,kind:'community_request',chore:post.demandEvidence.chore,evidenceQuote:source.text});
 research.sources=[{...source,fetchedAt:research.createdAt,verifiedAt:research.createdAt}];refresh(f);
 return {f,definition,url,raw,page};
}

test('actual publisher preserves assistant identity and existing scheduling, fresh checks and no-post settlement offline',async t=>{
 for(const scenario of ['published','unavailable','below-threshold']){
  const unavailable=scenario==='unavailable';
  const {f,definition,url,raw,page}=nativeFixture();
  if(scenario==='below-threshold'){for(const rating of Object.values(f.inputs.draft.posts[0].scoring.criteria))rating.value=5;f.inputs.manifest.checks[0].pass=false;f.inputs.manifest.checks[0].reasons=['Synthetic proposal is below the fixed threshold.'];refresh(f);}
  const {root,args}=await sandbox(t,f);
  const gate=await prepareLoop({root,env:{RUN_ID:f.inputs.draft.runId,GITHUB_EVENT_NAME:'schedule'},now:new Date('2026-10-30T09:59:00.000Z'),apiGet:()=>{throw Error('No GitHub request permitted');}});
  assert.equal(gate.decision,'run');assert.equal(gate.githubRunUrl,null);assert.equal(gate.clock,undefined);
  // The existing clock/cap calculation, not a fabricated GitHub run, creates
  // this isolated reservation. Synthetic content is never copied to the repo.
  f.inputs.draft.targetCount=gate.targetCount;refresh(f);
  for(const [dir,key] of [['drafts','draft'],['check-context','context'],['checks','manifest'],['research','research']])await fs.writeFile(path.join(root,'data',dir,f.inputs.draft.runId+'.json'),stableJSON(f.inputs[key]));
  await fs.writeFile(args.writerPath,stableJSON(f.options.writer));await fs.writeFile(args.checkerPath,stableJSON(f.options.checker));
  const registered=await registerAssistantCheck({...args,...f.options});
  for(const dir of ['lib','scripts'])await fs.cp(new URL('../'+dir,import.meta.url),path.join(root,dir),{recursive:true});
  await fs.mkdir(path.join(root,'public'));for(const name of ['schedule.js','cadence-config.js','historical-overlaps.js'])await fs.copyFile(new URL('../public/'+name,import.meta.url),path.join(root,'public',name));
  await fs.symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),path.join(root,'node_modules'),'dir');
  const robots=[{origin:new URL(definition.url).origin,evaluatedUrl:definition.url,robotsUrl:new URL('/robots.txt',definition.url).href,status:404,state:'missing',allowed:true,contentType:'text/plain',fetchedAt:page.fetchedAt}];
  const validation={publicHttps:true,robotsAllowed:true,readable:true,robots,redirects:[],httpStatus:200,contentType:'application/rss+xml',resolvedUrl:definition.url,fetchedAt:page.fetchedAt,maxBytes:2000000,truncated:false,parserVersion:'public-sources-v2',itemCount:1};
  await fs.mkdir(path.join(root,'data','sources'));await fs.writeFile(path.join(root,'data','sources','registry.json'),stableJSON({sources:[{...definition,status:'active',validation}]}));
  const callsFile=path.join(root,'calls.json');
  const preload=`import dns from 'node:dns/promises';import {syncBuiltinESMExports} from 'node:module';import {writeFileSync} from 'node:fs';const OriginalDate=Date;globalThis.Date=class extends OriginalDate{constructor(...v){super(...(v.length?v:[${JSON.stringify(f.options.now.toISOString())}]));}static now(){return OriginalDate.parse(${JSON.stringify(f.options.now.toISOString())});}};dns.lookup=async()=>[{address:'203.0.113.10',family:4}];syncBuiltinESMExports();const calls=[];globalThis.fetch=async value=>{const url=String(value);calls.push(url);writeFileSync(${JSON.stringify(callsFile)},JSON.stringify(calls));if(url===${JSON.stringify(new URL('/robots.txt',url).href)})return new Response('',{status:404});if(url!==${JSON.stringify(url+'.json')})throw new Error('UNEXPECTED_NETWORK');if(${unavailable})throw new Error('Synthetic source temporarily unavailable');return new Response(${JSON.stringify(JSON.stringify(raw))},{status:200,headers:{'content-type':'application/json'}});};`;
  await fs.writeFile(path.join(root,'offline.mjs'),preload);
  const env={PATH:process.env.PATH,NODE_OPTIONS:'--import='+path.join(root,'offline.mjs'),LOOP_SCHEDULING_SHA:pin(gate),GITHUB_EVENT_NAME:'schedule',ASSISTANT_EXECUTION_SHA256:registered.executionSha256};
  const output=spawnSync(process.execPath,['scripts/publish-checked.mjs',f.inputs.draft.runId],{cwd:root,env,encoding:'utf8'});assert.equal(output.status,0,output.stderr);assert.doesNotMatch(output.stderr,/UNEXPECTED_NETWORK/);
  const run=JSON.parse(await fs.readFile(path.join(root,'data','runs',f.inputs.draft.runId+'.json'),'utf8'));
  assert.equal(run.engine,'assistant-orchestrated');assert.equal(run.githubRunUrl,null);assert.equal(run.usage.costUsd,null);assert.doesNotMatch(JSON.stringify(run),/Codex CLI|Separate Codex|official openai\/codex-action/);
  const reservation=JSON.parse(await fs.readFile(path.join(root,'data','slot-reservations',run.id+'.json'),'utf8'));
  const posts=await fs.readdir(path.join(root,'data','posts')).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  if(scenario==='below-threshold'){assert.equal(run.status,'completed_no_post');assert.deepEqual(posts,[]);assert.equal(slotOutcome(reservation,run,{now:f.options.now}).status,'no_post');}
  else if(unavailable){assert.equal(run.status,'no_post_unverified');assert.deepEqual(posts,[]);assert.equal(slotOutcome(reservation,run,{now:f.options.now}).status,'no_post_unverified');}
  else{assert.equal(run.published.length,1);const post=JSON.parse(await fs.readFile(path.join(root,'data','posts',posts[0]),'utf8'));assert.equal(verifyPublishedPost(post),true,JSON.stringify(assistantPostReasons(post)));assert.deepEqual(post.distribution,WEBSITE_ONLY);const settled=slotOutcome(reservation,run,{posts:[post],now:f.options.now});assert.equal(settled.slotOutcomes[0].status,'published');assert.ok(settled.slotOutcomes.slice(1).every(slot=>slot.status==='no_post'));assert.equal(settled.status,gate.targetCount===1?'published':'no_post');}
  const calls=await fs.readFile(callsFile,'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return [];throw error;});if(scenario!=='below-threshold')assert.ok(calls.includes(url+'.json'));assert.ok(calls.every(value=>[url+'.json',new URL('/robots.txt',url).href].includes(value)));
 }
});
