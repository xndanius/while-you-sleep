import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {DISCUSSION_SOURCE_CATALOG,makeDiscussionSource} from '../lib/discussion-sources.mjs';
import {selectLearningTargets} from '../lib/learning.mjs';
import {SCORING_KEYS} from '../lib/scoring.mjs';
import {loopDecision} from '../lib/loop-schedule.mjs';
import {SOURCE_PARSER_VERSION} from '../lib/research.mjs';

// Only these identity tuples are copied from the original immutable research
// for loop-39405925881-1. Every body, title, timestamp and HTTP response below
// is synthetic. The production denied host was UNKNOWN; this Shopify robots
// 429 is a deliberately labelled regression fixture, not production evidence.
const assignments=[
 {productUrl:'https://news.ycombinator.com/item?id=50163382',segment:'professional_services',kind:'discussion',demandSourceId:'8280f372ef7cce46fa694bee',registrySourceId:'9357203ec00a097f7f2cdfaa'},
 {productUrl:'https://community.shopify.com/t/701361',segment:'professional_services',kind:'discussion',demandSourceId:'a61c69775108d8b18feb240c',registrySourceId:'31fb2b3a59fe1a234dfff556'},
 {productUrl:'https://news.ycombinator.com/item?id=50163117',segment:'professional_services',kind:'discussion',demandSourceId:'a78cf3ac6207875cddb27a4b',registrySourceId:'9357203ec00a097f7f2cdfaa'},
 {productUrl:'https://news.ycombinator.com/item?id=50163035',segment:'professional_services',kind:'discussion',demandSourceId:'2332c09c7747b6de35e5051c',registrySourceId:'9357203ec00a097f7f2cdfaa'},
];
const runId='loop-424242-1',now='2026-10-20T10:20:00.000Z',postedAt='2026-10-20T10:00:00.000Z';
const rules='# Synthetic offline scoring fixture\n<!-- scoring-policy:start -->\n```json\n{"weights":{"ease":1,"profit":1,"feasibility":1,"autonomy":1,"evidence":1},"publishThreshold":6}\n```\n<!-- scoring-policy:end -->\n';
const bodies=[
 'Every morning our team manually reviews invoice records and prepares a report for human approval.',
 'Every week our team manually reconciles invoice records and prepares a report for human approval.',
 'Every month our team manually collects invoice records and prepares a report for human approval.',
 'Every morning our team manually copies invoice records and prepares a report for human approval.',
];
const receiptFile=`data/check-diagnostics/${runId}.json`;
const recordFile=directory=>`data/${directory}/${runId}.json`;
const readRecord=(root,directory)=>readFile(path.join(root,recordFile(directory)),'utf8').then(JSON.parse);
const missing=async file=>assert.rejects(readFile(file),error=>error.code==='ENOENT');
const outputs=text=>Object.fromEntries(text.trim().split('\n').filter(line=>line.includes('=')).map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];}));

async function put(root,file,value){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),JSON.stringify(value));}
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-check-diagnostics-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const directory of ['lib','scripts'])await cp(new URL('../'+directory,import.meta.url),path.join(root,directory),{recursive:true});
 await mkdir(path.join(root,'public'));for(const file of ['schedule.js','cadence-config.js'])await cp(new URL('../public/'+file,import.meta.url),path.join(root,'public',file));
 await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),path.join(root,'node_modules'),'dir');
 await writeFile(path.join(root,'package.json'),JSON.stringify({type:'module'}));await writeFile(path.join(root,'RULES.md'),rules);
 const definitions=[...new Set(assignments.map(row=>row.registrySourceId))].map(id=>DISCUSSION_SOURCE_CATALOG.find(row=>row.id===id));assert.ok(definitions.every(Boolean));
 const validation=definition=>({publicHttps:true,robotsAllowed:true,readable:true,robots:[{origin:new URL(definition.url).origin,evaluatedUrl:definition.url,robotsUrl:new URL('/robots.txt',definition.url).toString(),status:404,state:'missing',allowed:true,contentType:'text/plain',fetchedAt:now}],redirects:[],httpStatus:200,contentType:definition.kind==='hn-discussion'?'application/json':'application/rss+xml',resolvedUrl:definition.url,fetchedAt:now,maxBytes:2000000,truncated:false,parserVersion:SOURCE_PARSER_VERSION,itemCount:4});
 const registry={sources:definitions.map(definition=>({...definition,status:'active',validation:validation(definition)}))};
 const producer={repository:'xndanius/while-you-sleep',runId:'424242',runAttempt:1,workflow:'loop.yml',stage:'pre_model',headSha:'a'.repeat(40)};
 const selection=selectLearningTargets({runId,registry,scoreboard:{segments:[],sources:[]},discussionOnly:true,now,producer});
 const sources=assignments.map((assignment,index)=>{
  const definition=definitions.find(row=>row.id===assignment.registrySourceId),title=`${definition.kind==='hn-discussion'?'Show HN: ':''}Synthetic invoice review fixture ${index+1}`;
  const source=makeDiscussionSource(definition,{url:assignment.productUrl,title,excerpt:bodies[index],date:postedAt},{fetchedAt:now});assert.ok(source);assert.equal(source.id,assignment.demandSourceId);assert.equal(source.segment,assignment.segment);
  return {...source,enriched:true,verifiedAt:now,evidenceKind:'discussion-post',evidenceFetch:{maxBytes:2000000,complete:true}};
 });
 const cadence={schema:1,mode:'hourly',activatedAt:'2026-10-19T00:00:00.000Z',relayConfirmedAt:'2026-10-18T23:00:00.000Z'};
 const scheduling=loopDecision({runId,eventName:'workflow_dispatch',githubRunId:'424242',githubRunUrl:'https://github.com/xndanius/while-you-sleep/actions/runs/424242',now:new Date(now),cadence});assert.equal(scheduling.decision,'run');
 const research={id:runId,runId,createdAt:now,sources,health:[],githubRunUrl:scheduling.githubRunUrl,learningSelection:selection,enrichment:{schema:1,status:'completed',selected:4,attempted:4,fetched:4,failed:0,observations:sources.map(source=>({productUrl:source.url,status:'fetched',originSourceIds:[source.id],evidenceIds:[source.id],fetchedAt:now})),discussionBatch:{version:1,maxLeads:10,maxPerDemandSource:3,postIsDemand:true,leadAssignments:structuredClone(assignments)}}};
 const draft={runId,targetCount:scheduling.targetCount,posts:[],candidates:sources.map(source=>({title:source.title,productUrl:source.url,sourceIds:[source.id],segment:source.segment,demandEvidence:{kind:'community_request',sourceIds:[source.id],chore:source.text,evidenceQuote:source.text},scoring:{criteria:Object.fromEntries(SCORING_KEYS.map(key=>[key,{value:4,reason:key==='profit'?'Hypothesis: no paying service is established by this synthetic fixture.':'Synthetic evidence supports only a bounded untested experiment.',sourceIds:[source.id]}]))},reason:'Synthetic provisional assessment; independent verification has not completed.'})),rejected:[]};
 const schedulingSha=sha256(stableJSON(scheduling)),draftSha=sha256(stableJSON(draft)),researchSha=sha256(stableJSON(research)),selectionSha=sha256(stableJSON(selection));
 for(const [directory,record] of [['scheduling',scheduling],['slot-reservations',{...scheduling,schedulingSha256:schedulingSha}],['research',research],['drafts',draft],['learning-selection',selection]])await put(root,recordFile(directory),record);
 await put(root,'data/sources/registry.json',registry);
 // The preload denies every unlisted URL. It cannot make a live model,
 // provider or network call, even if the production implementation regresses.
 const responses=Object.fromEntries(sources.filter(source=>source.url.startsWith('https://news.ycombinator.com/')).map(source=>[`https://hn.algolia.com/api/v1/items/${new URL(source.url).searchParams.get('id')}`,{id:Number(new URL(source.url).searchParams.get('id')),title:source.title,text:source.text,created_at:source.postedAt}]));
 const preload=`import dns from 'node:dns/promises';import {syncBuiltinESMExports} from 'node:module';import {writeFileSync} from 'node:fs';const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[${JSON.stringify(now)}]));}static now(){return NativeDate.parse(${JSON.stringify(now)});}};dns.lookup=async()=>[{address:'203.0.113.10',family:4}];syncBuiltinESMExports();const calls=[],responses=${JSON.stringify(responses)};globalThis.fetch=async input=>{const url=String(input);calls.push(url);if(url==='https://community.shopify.com/robots.txt')return new Response('Synthetic robots rate limit',{status:429,headers:{'content-type':'text/plain'}});if(url==='https://hn.algolia.com/robots.txt')return new Response('Synthetic missing robots file',{status:404,headers:{'content-type':'text/plain'}});if(Object.hasOwn(responses,url))return new Response(JSON.stringify(responses[url]),{status:200,headers:{'content-type':'application/json'}});throw new Error('Offline fixture denied unexpected URL '+url);};process.on('exit',()=>writeFileSync(${JSON.stringify(path.join(root,'http-calls.json'))},JSON.stringify(calls)));`;
 await writeFile(path.join(root,'preload.mjs'),preload);
 const env={PATH:process.env.PATH,NODE_OPTIONS:'--import='+path.join(root,'preload.mjs'),GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',RUN_ID:runId,LOOP_SCHEDULING_SHA:schedulingSha,DEMAND_CONTRACT_VERSION:'1',CHECKER_PHASE:'initial',EXPECTED_DIAGNOSTIC_PHASE:'initial',EXPECTED_DRAFT_SHA:draftSha,EXPECTED_DIAGNOSTIC_DRAFT_SHA:draftSha,EXPECTED_RESEARCH_SHA:researchSha,EXPECTED_LEARNING_SELECTION_SHA:selectionSha,RULES_SHA256:sha256(rules),GITHUB_OUTPUT:path.join(root,'outputs')};
 return {root,env,draft,research,selection,scheduling,pins:{draftSha,researchSha,selectionSha,schedulingSha},invoke:(script,options={})=>spawnSync(process.execPath,['scripts/'+script+'.mjs',...(options.args||[runId])],{cwd:root,env:{...env,...options.env},encoding:'utf8'})};
}

test('four original discussion identities retain a typed safe failure through preparation, import and unverified settlement',async t=>{
 const f=await fixture(t),protectedFiles=['RULES.md','data/sources/registry.json',...['drafts','research','learning-selection','scheduling','slot-reservations'].map(recordFile)];
 const before=await Promise.all(protectedFiles.map(async file=>[file,await readFile(path.join(f.root,file),'utf8')]));
 const prepared=f.invoke('prepare-check');assert.equal(prepared.status,1,prepared.stderr);
 for(const [file,bytes] of before)assert.equal(await readFile(path.join(f.root,file),'utf8'),bytes,'Failed preparation cannot rewrite '+file);
 const receipt=await readRecord(f.root,'check-diagnostics'),receiptBytes=await readFile(path.join(f.root,receiptFile),'utf8'),out=outputs(await readFile(f.env.GITHUB_OUTPUT,'utf8'));
 assert.equal(receipt.schema,1);assert.equal(receipt.kind,'check_preparation_diagnostics');assert.equal(receipt.runId,runId);assert.equal(receipt.phase,'initial');
 assert.equal(receipt.draftSha256,f.pins.draftSha);assert.equal(receipt.researchSha256,f.pins.researchSha);assert.equal(receipt.selectionSha256,f.pins.selectionSha);assert.deepEqual(receipt.assignments,assignments);
 const successful=assignments.filter(row=>row.productUrl.startsWith('https://news.ycombinator.com/')).map(row=>row.demandSourceId);
 assert.deepEqual(new Set(receipt.successfulSourceIds),new Set(successful));assert.equal(receipt.failures.length,1);
 const failed=receipt.failures[0];assert.deepEqual(failed,{sourceId:assignments[1].demandSourceId,productUrl:assignments[1].productUrl,registrySourceId:assignments[1].registrySourceId,adapterUrl:assignments[1].productUrl+'.json',robotsUrl:'https://community.shopify.com/robots.txt',stage:'robots',code:'robots_unavailable',httpStatus:429,observedAt:now});
 assert.equal(out.verified,'false');assert.equal(out.check_diagnostics_sha256,sha256(stableJSON(receipt)));assert.equal(out.check_diagnostics_draft_sha256,f.pins.draftSha);
 for(const body of bodies)assert.equal(receiptBytes.includes(body),false,'Diagnostics contain metadata only, never discussion bodies.');
 for(const directory of ['check-context','checks'])await missing(path.join(f.root,recordFile(directory)));await missing(path.join(f.root,'.run/checker-response.json'));await missing(path.join(f.root,'.run/context.json'));
 const calls=JSON.parse(await readFile(path.join(f.root,'http-calls.json'),'utf8'));
 for(const assignment of assignments.filter(row=>row.productUrl.startsWith('https://news.ycombinator.com/')))assert.equal(calls.filter(url=>url===`https://hn.algolia.com/api/v1/items/${new URL(assignment.productUrl).searchParams.get('id')}`).length,1);
 assert.equal(calls.filter(url=>url==='https://community.shopify.com/robots.txt').length,1);assert.equal(calls.some(url=>url.startsWith(assignments[1].productUrl)),false);assert.equal(calls.length,5);
 const guarded=f.invoke('guard-private-artifacts',{args:[runId,'checker']});assert.equal(guarded.status,0,guarded.stderr);const guardResult=JSON.parse(guarded.stdout);assert.equal(guardResult.safe,true);assert.equal(guardResult.checkedFiles,3,'The diagnostic file is included in the guarded artifact set.');assert.equal(await readFile(path.join(f.root,receiptFile),'utf8'),receiptBytes);
 const artifact=path.join(f.root,'downloaded-check-diagnostics');await mkdir(artifact);await writeFile(path.join(artifact,runId+'.json'),receiptBytes);await rm(path.join(f.root,receiptFile));
 await put(f.root,'generic-model-artifact/check-diagnostics/'+runId+'.json',receipt);
 const genericImport=f.invoke('import-artifact',{args:[path.join(f.root,'generic-model-artifact'),runId]});assert.equal(genericImport.status,1);assert.match(genericImport.stderr,/Unexpected artifact directory/);await missing(path.join(f.root,receiptFile));
 const diagnosticEnv={EXPECTED_CHECK_DIAGNOSTICS_SHA:sha256(stableJSON(receipt)),EXPECTED_DIAGNOSTIC_PHASE:'initial',EXPECTED_DIAGNOSTIC_DRAFT_SHA:f.pins.draftSha};
 const wrongPin=f.invoke('import-check-diagnostics',{args:[artifact,runId],env:{...diagnosticEnv,EXPECTED_CHECK_DIAGNOSTICS_SHA:'b'.repeat(64)}});assert.equal(wrongPin.status,1);await missing(path.join(f.root,receiptFile));
 const imported=f.invoke('import-check-diagnostics',{args:[artifact,runId],env:diagnosticEnv});assert.equal(imported.status,0,imported.stderr);assert.deepEqual(await readRecord(f.root,'check-diagnostics'),receipt);
 const publicationScript=path.join(f.root,'scripts/publish-checked.mjs'),publicationMarker=path.join(f.root,'publication-attempted');
 await writeFile(publicationScript,`import {writeFileSync as diagnosticTestMarker} from 'node:fs';diagnosticTestMarker(${JSON.stringify(publicationMarker)},'Publication was invoked');\n`+await readFile(publicationScript,'utf8'));
 const jobs={writer:{result:'success',outputs:{model_attempted:'true',model_completed:'true'}},checker:{result:'success',outputs:{verified:'false',model_attempted:'false',model_completed:'false',unverified_code:'checker_preparation_failed',unverified_reason:'Synthetic guarded preparation did not complete.'}},repair:{result:'skipped'},final_check:{result:'skipped'}};
 const finalized=f.invoke('finalize-run',{env:{...diagnosticEnv,MODEL_JOB_RESULTS:JSON.stringify(jobs)}});assert.equal(finalized.status,0,finalized.stderr);
 await missing(publicationMarker);
 const run=await readRecord(f.root,'runs');assert.equal(run.status,'no_post_unverified');assert.equal(run.assessmentOutcome,'unverified');assert.deepEqual(run.published,[]);assert.equal(run.checkedAssessment,undefined);assert.equal(run.modelExecuted,true);
 assert.deepEqual(run.checkPreparationDiagnostics,{sha256:diagnosticEnv.EXPECTED_CHECK_DIAGNOSTICS_SHA,receipt});
 assert.equal(run.checkPreparationDiagnostics.receipt.assignments.length,4);assert.equal(run.checkPreparationDiagnostics.receipt.successfulSourceIds.length,3);assert.equal(run.checkPreparationDiagnostics.receipt.failures.length,1);
 const learned=f.invoke('record-learning',{env:{...diagnosticEnv,MODEL_JOB_RESULTS:JSON.stringify(jobs)}});assert.equal(learned.status,0,learned.stderr);const learning=await readRecord(f.root,'learning');assert.equal(learning.outcome,'unverified');assert.equal(learning.samples.length,4);assert.ok(learning.samples.every(sample=>sample.status==='unknown'&&sample.reward===null));
 assert.deepEqual(await readdir(path.join(f.root,'data/posts')).catch(error=>error.code==='ENOENT'?[]:Promise.reject(error)),[]);
 for(const directory of ['check-context','checks'])await missing(path.join(f.root,recordFile(directory)));
 const {checkDiagnosticsReasons}=await import('../lib/check-diagnostics.mjs');assert.deepEqual(checkDiagnosticsReasons(receipt,{runId,phase:'initial',expectedSha256:diagnosticEnv.EXPECTED_CHECK_DIAGNOSTICS_SHA,research:f.research,draft:f.draft,selection:f.selection,expectedResearchSha256:f.pins.researchSha,expectedDraftSha256:f.pins.draftSha,expectedSelectionSha256:f.pins.selectionSha}),[]);
});

test('missing or tampered diagnostics under a trusted hash remain unverified without embedding bad evidence or rewards',async t=>{
 for(const mode of ['missing','tampered']){
  const f=await fixture(t),prepared=f.invoke('prepare-check');assert.equal(prepared.status,1,prepared.stderr);
  const receipt=await readRecord(f.root,'check-diagnostics'),expectedSha=sha256(stableJSON(receipt));
  if(mode==='missing')await rm(path.join(f.root,receiptFile));
  else {const tampered=structuredClone(receipt);tampered.failures[0].httpStatus=403;await put(f.root,receiptFile,tampered);}
  const jobs={writer:{result:'success',outputs:{model_attempted:'true',model_completed:'true'}},checker:{result:'success',outputs:{verified:'false',model_attempted:'false',model_completed:'false',unverified_code:'checker_preparation_failed',unverified_reason:'Synthetic guarded preparation did not complete.'}},repair:{result:'skipped'},final_check:{result:'skipped'}};
  const env={EXPECTED_CHECK_DIAGNOSTICS_SHA:expectedSha,EXPECTED_DIAGNOSTIC_PHASE:'initial',EXPECTED_DIAGNOSTIC_DRAFT_SHA:f.pins.draftSha,MODEL_JOB_RESULTS:JSON.stringify(jobs)};
  const finalized=f.invoke('finalize-run',{env});assert.equal(finalized.status,0,finalized.stderr);
  const run=await readRecord(f.root,'runs');assert.equal(run.status,'no_post_unverified');assert.equal(run.assessmentOutcome,'unverified');assert.deepEqual(run.published,[]);assert.equal(run.checkedAssessment,undefined);assert.equal(run.checkPreparationDiagnostics,undefined);assert.ok(run.operationalFailures.some(failure=>failure.code==='check_diagnostics_unverified'));
  const learned=f.invoke('record-learning',{env});assert.equal(learned.status,0,learned.stderr);const learning=await readRecord(f.root,'learning');assert.equal(learning.outcome,'unverified');assert.equal(learning.samples.length,4);assert.ok(learning.samples.every(sample=>sample.status==='unknown'&&sample.reward===null));
  assert.deepEqual(await readRecord(f.root,'drafts'),f.draft);for(const directory of ['check-context','checks'])await missing(path.join(f.root,recordFile(directory)));await missing(path.join(f.root,'.run/checker-response.json'));
  assert.deepEqual(await readdir(path.join(f.root,'data/posts')).catch(error=>error.code==='ENOENT'?[]:Promise.reject(error)),[]);
 }
});

test('diagnostic artifacts cross separate fingerprinted workflow and commit boundaries without model or approval authority',async()=>{
 const workflow=await readFile(new URL('../.github/workflows/loop.yml',import.meta.url),'utf8');
 const checker=workflow.slice(workflow.indexOf('\n  checker:'),workflow.indexOf('\n  repair:'));
 const finalCheck=workflow.slice(workflow.indexOf('\n  final_check:'),workflow.indexOf('\n  record:'));
 for(const [phase,job] of [['initial',checker],['final',finalCheck]]){
  assert.match(job,/check_diagnostics_sha256: \$\{\{ steps\.prepare\.outputs\.check_diagnostics_sha256 \}\}/);
  assert.match(job,/check_diagnostics_draft_sha256: \$\{\{ steps\.prepare\.outputs\.check_diagnostics_draft_sha256 \}\}/);
  assert.ok(job.includes('name: check-diagnostics-'+phase+'-${{ env.RUN_ID }}'));
  assert.match(job,/if: always\(\) && steps\.privacy\.outputs\.safe == 'true' && steps\.prepare\.outputs\.check_diagnostics_sha256 != ''/);
  assert.match(job,/path: data\/check-diagnostics\/\$\{\{ env.RUN_ID \}\}\.json/);
  assert.match(job,/- id: fingerprint\s+if: steps\.prepare\.outcome == 'success'/);
  const model=job.slice(job.indexOf('id: model'));assert.match(model,/if: steps\.fingerprint\.outcome == 'success'/);
 }
 const record=workflow.slice(workflow.indexOf('\n  record:'),workflow.indexOf('\n  pages:'));
 const diagnosticImport=record.slice(record.indexOf('- name: Import diagnostic-only'),record.indexOf('- name: Finalize checked'));
 assert.match(diagnosticImport,/run: node scripts\/import-check-diagnostics\.mjs \.staging\/check-diagnostics "\$RUN_ID"/);
 for(const pin of ['EXPECTED_CHECK_DIAGNOSTICS_SHA','EXPECTED_DIAGNOSTIC_PHASE','EXPECTED_DIAGNOSTIC_DRAFT_SHA','EXPECTED_RESEARCH_SHA','EXPECTED_LEARNING_SELECTION_SHA'])assert.ok(diagnosticImport.includes(pin+':'));
 assert.ok(record.indexOf('path: .staging/check-diagnostics/')<record.indexOf('node scripts/import-check-diagnostics.mjs'));
 assert.ok(record.indexOf('node scripts/import-check-diagnostics.mjs')<record.indexOf('id: finalize'));
 const importer=await readFile(new URL('../scripts/import-artifact.mjs',import.meta.url),'utf8');assert.match(importer,/const allowed=new Set\(\['research','drafts','checks','check-context'\]\)/);assert.equal(importer.includes("'check-diagnostics'"),false,'Diagnostics cannot enter through the model-content importer.');
 const commit=await readFile(new URL('../scripts/commit-records.mjs',import.meta.url),'utf8');
 assert.match(commit,/commit\(\(await files\('data\/check-diagnostics'\)\)\.filter\(file=>file===`data\/check-diagnostics\/\$\{runId\}\.json`\),`check diagnostics:/);
 assert.ok(commit.indexOf("files('data/check-diagnostics')")<commit.indexOf("for(const p of ['data/drafts'"),'Diagnostics are a separately named commit, outside checks or publication records.');
});
