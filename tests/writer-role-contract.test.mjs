import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {DISCUSSION_SOURCE_CATALOG,makeDiscussionSource} from '../lib/discussion-sources.mjs';
import {selectLearningTargets,validateLearningSelection} from '../lib/learning.mjs';
import {loopDecision} from '../lib/loop-schedule.mjs';
import {SOURCE_PARSER_VERSION} from '../lib/research.mjs';

const runId='loop-246810-1',now='2026-10-21T13:00:00.000Z';
const rules='# Synthetic offline role fixture\n<!-- scoring-policy:start -->\n```json\n{"weights":{"ease":1,"profit":1,"feasibility":1,"autonomy":1,"evidence":1},"publishThreshold":6}\n```\n<!-- scoring-policy:end -->\n';
const policy=mode=>({mode,widened:mode!=='normal',fallbackEnabled:['fallback','repair'].includes(mode),maxLeads:10,cooldownHours:mode==='normal'?24:3});
const relativeRecord=directory=>`data/${directory}/${runId}.json`;

async function put(root,file,value){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),JSON.stringify(value));}
async function fixture(t,mode,{strayFeedback=true}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-writer-role-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const directory of ['lib','scripts'])await cp(new URL('../'+directory,import.meta.url),path.join(root,directory),{recursive:true});
 await mkdir(path.join(root,'public'));for(const name of ['schedule.js','cadence-config.js'])await cp(new URL('../public/'+name,import.meta.url),path.join(root,'public',name));
 await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),path.join(root,'node_modules'),'dir');
 await writeFile(path.join(root,'package.json'),'{"type":"module"}');await writeFile(path.join(root,'RULES.md'),rules);
 const definition=DISCUSSION_SOURCE_CATALOG.find(source=>source.community==='Make community');
 const source=makeDiscussionSource(definition,{url:'https://community.make.com/t/12345',title:'How can our team prepare invoice records for review?',excerpt:'Every morning our team manually reviews invoice records and prepares a report for human approval.',date:'2026-10-21T12:00:00.000Z'},{fetchedAt:now});assert.ok(source);
 Object.assign(source,{enriched:true,verifiedAt:now,evidenceKind:'discussion-post',evidenceFetch:{maxBytes:2000000,complete:true}});
 const validation={publicHttps:true,robotsAllowed:true,readable:true,robots:[{origin:new URL(definition.url).origin,evaluatedUrl:definition.url,robotsUrl:new URL('/robots.txt',definition.url).toString(),status:404,state:'missing',allowed:true,contentType:'text/plain',fetchedAt:now}],redirects:[],httpStatus:200,contentType:'application/rss+xml',resolvedUrl:definition.url,fetchedAt:now,maxBytes:2000000,truncated:false,parserVersion:SOURCE_PARSER_VERSION,itemCount:1};
 const registry={sources:[{...definition,status:'active',validation}]},selection=selectLearningTargets({runId,registry,scoreboard:{segments:[],sources:[]},discussionOnly:true,researchPolicy:policy(mode),now,producer:{repository:'xndanius/while-you-sleep',runId:'246810',runAttempt:1,workflow:'loop.yml',stage:'pre_model',headSha:'a'.repeat(40)}});assert.deepEqual(validateLearningSelection(selection),[]);
 const assignments=[{productUrl:source.url,segment:source.segment,kind:'discussion',demandSourceId:source.id,registrySourceId:definition.id}];
 const research={id:runId,runId,createdAt:now,sources:[source],health:[],learningSelection:selection,researchPolicy:policy(mode),enrichment:{schema:1,status:'completed',selected:1,attempted:1,fetched:1,failed:0,observations:[{productUrl:source.url,status:'fetched',originSourceIds:[source.id],evidenceIds:[source.id],fetchedAt:now}],discussionBatch:{version:1,maxLeads:10,maxPerDemandSource:3,postIsDemand:true,leadAssignments:assignments}}};
 const cadence={schema:1,mode:'hourly',activatedAt:'2026-10-20T00:00:00.000Z',relayConfirmedAt:'2026-10-19T23:00:00.000Z'},scheduling=loopDecision({runId,eventName:'workflow_dispatch',githubRunId:'246810',githubRunUrl:'https://github.com/xndanius/while-you-sleep/actions/runs/246810',now:new Date(now),cadence});assert.equal(scheduling.decision,'run');
 const draft={runId,targetCount:scheduling.targetCount,posts:[],candidates:[],rejected:[{title:source.title,productUrl:source.url,reason:'Synthetic existing draft; preparation must not edit its assessment.'}]};
 for(const [directory,value] of [['research',research],['learning-selection',selection],['scheduling',scheduling],['drafts',draft],['check-context',{runId,demandContext:{selectedSegment:null}}]])await put(root,relativeRecord(directory),value);
 await put(root,'data/sources/registry.json',registry);
 // A stale, irrelevant file cannot select the model role or become a writer
 // precondition. It is neither a check manifest nor approved repair feedback.
 const feedback={kind:'irrelevant_fixture_file',role:'repair',reason:'An existing file cannot change the trusted CLI execution role.'};
 await mkdir(path.join(root,'.run'),{recursive:true});if(strayFeedback)await put(root,'.run/repair-feedback.json',feedback);
 const preload=`import {writeFileSync} from 'node:fs';const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[${JSON.stringify(now)}]));}static now(){return NativeDate.parse(${JSON.stringify(now)});}};let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('No network or model calls are permitted in the role fixture.');};process.on('exit',()=>writeFileSync(${JSON.stringify(path.join(root,'network-calls.json'))},JSON.stringify(calls)));`;
 await writeFile(path.join(root,'offline.mjs'),preload);
 const researchSha256=sha256(stableJSON(research)),selectionSha256=sha256(stableJSON(selection));
 const env={PATH:process.env.PATH,NODE_OPTIONS:'--import='+path.join(root,'offline.mjs'),RUN_ID:runId,GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',DEMAND_CONTRACT_VERSION:'1',LOOP_SCHEDULING_SHA:sha256(stableJSON(scheduling)),EXPECTED_RESEARCH_SHA:researchSha256,EXPECTED_LEARNING_SELECTION_SHA:selectionSha256,GITHUB_OUTPUT:path.join(root,'outputs')};
 const protectedFiles=['RULES.md','data/sources/registry.json',...(strayFeedback?['.run/repair-feedback.json']:[]),...['research','learning-selection','scheduling','drafts','check-context'].map(relativeRecord)],originalBytes=new Map(await Promise.all(protectedFiles.map(async file=>[file,await readFile(path.join(root,file),'utf8')])));
 const invoke=(role,override={})=>spawnSync(process.execPath,['scripts/prepare-run.mjs',role],{cwd:root,env:{...env,...override},encoding:'utf8'});
 const unchanged=async()=>{for(const [file,bytes] of originalBytes)assert.equal(await readFile(path.join(root,file),'utf8'),bytes,'Preparation cannot rewrite '+file);assert.equal(JSON.parse(await readFile(path.join(root,'network-calls.json'),'utf8')),0);};
 return {root,env,research,selection,assignments,researchSha256,selectionSha256,invoke,unchanged};
}

test('writer execution remains initial under every source-retrieval mode and retains its exact sealed worklist',async t=>{
 for(const [mode,strayFeedback] of [['normal',true],['widened',true],['fallback',true],['repair',true],['repair',false]]){
  const f=await fixture(t,mode,{strayFeedback}),prepared=f.invoke('writer');assert.equal(prepared.status,0,prepared.stderr);const context=JSON.parse(await readFile(path.join(f.root,'.run/context.json'),'utf8'));
  assert.equal(context.role,'writer');assert.equal(context.researchPolicy.mode,mode);assert.equal(Object.hasOwn(context,'repairFeedbackPath'),false,'A retrieval policy or existing feedback file cannot make an initial writer require repair feedback.');
  assert.deepEqual(context.executionPhase,{role:'writer',requiresRepairFeedback:false});assert.deepEqual(context.discussionBatch.leadAssignments,f.assignments);assert.equal(context.discussionFirst,true);
  assert.deepEqual(context.writerCoverage,{researchSha256:f.researchSha256,selectionSha256:f.selectionSha256,assignmentCount:f.assignments.length,ledgerPath:'.run/writer-assignments.json',command:'node scripts/check-writer-coverage.mjs '+runId});
  const ledger=JSON.parse(await readFile(path.join(f.root,context.writerCoverage.ledgerPath),'utf8'));assert.deepEqual(ledger,{schema:1,runId,researchSha256:f.researchSha256,selectionSha256:f.selectionSha256,assignments:f.assignments});
  await f.unchanged();
 }
});

test('writer preparation cannot seal a worklist against changed trusted research or selection pins',async t=>{
 for(const key of ['EXPECTED_RESEARCH_SHA','EXPECTED_LEARNING_SELECTION_SHA']){
  const f=await fixture(t,'repair'),prepared=f.invoke('writer',{[key]:'b'.repeat(64)});assert.notEqual(prepared.status,0,'Changed original fingerprints cannot become a model-facing assignment contract.');
  await assert.rejects(readFile(path.join(f.root,'.run/context.json')),{code:'ENOENT'});await f.unchanged();
 }
});

test('only the actual repair execution role receives the feedback path regardless of retrieval mode',async t=>{
 for(const mode of ['normal','repair']){
  const f=await fixture(t,mode),prepared=f.invoke('repair');assert.equal(prepared.status,0,prepared.stderr);const context=JSON.parse(await readFile(path.join(f.root,'.run/context.json'),'utf8'));
  assert.equal(context.role,'repair');assert.deepEqual(context.executionPhase,{role:'repair',requiresRepairFeedback:true});assert.equal(context.repairFeedbackPath,'.run/repair-feedback.json');assert.equal(context.researchPolicy.mode,mode);
  assert.deepEqual(context.discussionBatch.leadAssignments,f.assignments);assert.equal(context.writerCoverage.researchSha256,f.researchSha256);assert.equal(context.writerCoverage.selectionSha256,f.selectionSha256);await f.unchanged();
 }
});

test('an unknown execution role is refused before generating context or changing any artifact directory',async t=>{
 const f=await fixture(t,'repair'),runBefore=await readdir(path.join(f.root,'.run')),dataBefore=await readdir(path.join(f.root,'data'));
 for(const role of ['recovery','repair-mode','unknown']){
  const prepared=f.invoke(role);assert.notEqual(prepared.status,0,'An unknown role cannot prepare any model task.');assert.match(prepared.stderr,/role/i);
  assert.deepEqual(await readdir(path.join(f.root,'.run')),runBefore);assert.deepEqual(await readdir(path.join(f.root,'data')),dataBefore);await assert.rejects(readFile(path.join(f.root,'.run/context.json')),{code:'ENOENT'});await f.unchanged();
 }
});

test('writer instructions distinguish execution authority from retrieval repair and require the full discussion ledger',async()=>{
 const prompt=await readFile(new URL('../.github/codex/prompts/writer.md',import.meta.url),'utf8'),paragraphs=prompt.split(/\n\s*\n/);
 const role=paragraphs.find(value=>value.includes('First read context.role'));
 assert.ok(role,'The execution role must be explained before the research-specific instructions.');assert.ok(prompt.indexOf(role)<prompt.indexOf('When research.enrichment'));
 assert.match(role,/role writer.*initial assessment.*repair feedback is not required/s);assert.match(role,/role repair.*single repair.*repairFeedbackPath/s);
 assert.match(role,/researchPolicy\.mode.*source retrieval.*never changes your execution role/s);assert.match(role,/stale feedback file.*cannot change a writer/s);
 const coverage=paragraphs.find(value=>value.includes('context.writerCoverage.ledgerPath'));assert.ok(coverage);assert.match(coverage,/every identity.*ten/s);assert.match(coverage,/canonical productUrl union across posts, candidates and rejected/);assert.match(coverage,/cross-list references count as one identity/);assert.match(coverage,/individual list free of repeated identities/);assert.match(coverage,/Generic candidate-count guidance.*does not permit omitting/s);
 const generic=paragraphs.find(value=>/at least 8 candidates/i.test(value));assert.match(generic,/assigned discussion batch.*entire sealed assignment ledger.*For other research/s);
 const localCheck=paragraphs.find(value=>value.includes('context.writerCoverage.command'));assert.match(localCheck,/read-only command.*before finishing this same invocation/s);assert.match(localCheck,/identities, required plan structure and criterion\/source bindings only.*no score, semantic assessment or approval/s);assert.match(localCheck,/no model call or repair round/);
});

test('writer and checker use the native task-quote contract without turning missing references or old refusals into an exclusion rule',async()=>{
 const [writer,checker]=await Promise.all(['writer','checker'].map(name=>readFile(new URL(`../.github/codex/prompts/${name}.md`,import.meta.url),'utf8')));
 for(const prompt of [writer,checker]){
  assert.match(prompt,/demandQuoteOccurs from lib\/demand-quotes\.mjs/);
  assert.match(prompt,/one validated nativeReadingContext task\/context span/);
  assert.doesNotMatch(prompt,/Demand and omitted-task quotes must still come from source\.text|quotes continue to require source\.text\.includes/);
  assert.match(prompt,/never join spans/);
 }
 assert.match(writer,/currently assigned discussion has already passed.*cooldown gate/);
 assert.match(writer,/missing implementation references or an earlier below-threshold assessment alone do not justify skipping.*five provisional scores/s);
 assert.match(writer,/resulting scores can remain low/);
 assert.match(checker,/schema 2.*quoteSpanSha256.*same validated native task\/context span/s);
 assert.match(checker,/final checker cannot issue omission feedback or request another round/);
});
