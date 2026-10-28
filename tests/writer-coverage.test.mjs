import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {writerCoverage,sealedWriterCoverage} from '../lib/writer-coverage.mjs';
import {checkWriterCoverage} from '../scripts/check-writer-coverage.mjs';

const runId='loop-39605344833-1',missingURL='https://news.ycombinator.com/item?id=50175857',overlapURL='https://community.n8n.io/t/323472';
const load=async name=>JSON.parse(await readFile(new URL(`../data/${name}/${runId}.json`,import.meta.url),'utf8'));
async function fixture(){
 const [research,selection,historicalDraft]=await Promise.all(['research','learning-selection','drafts'].map(load));
 const assignments=research.enrichment.discussionBatch.leadAssignments;
 const draft={runId,posts:[],candidates:[],rejected:assignments.map(row=>({title:'Synthetic coverage decision',productUrl:row.productUrl,segment:row.segment,reason:'Synthetic structural fixture; no factual assessment or approval is made.'}))};
 return {research,selection,historicalDraft,assignments,draft,options:{runId,research,selection,expectedResearchSha256:sha256(stableJSON(research)),expectedSelectionSha256:sha256(stableJSON(selection))}};
}

test('the immutable ten-row nine-identity failure reports its missing HN assignment without rejecting a legitimate cross-list reference',async()=>{
 const f=await fixture(),before=stableJSON(f),report=sealedWriterCoverage(f.historicalDraft,f.options);
 assert.equal(report.valid,false);assert.equal(report.coverageOnly,true);assert.equal(report.assignedCount,10);assert.equal(report.consideredUniqueCount,9);assert.equal(report.coveredAssignedCount,9);
 assert.deepEqual(report.missing,[f.assignments.find(row=>row.productUrl===missingURL)]);assert.deepEqual(report.foreign,[]);assert.deepEqual(report.duplicates,[]);assert.deepEqual(report.bindingMismatches,[]);
 assert.ok(f.historicalDraft.candidates.some(row=>row.productUrl===overlapURL));assert.ok(f.historicalDraft.rejected.some(row=>row.productUrl===overlapURL));
 assert.equal(stableJSON(f),before,'A diagnostic cannot fill an omitted exclusion or rewrite any historical decision.');
 const historical=await load('runs');assert.equal(historical.status,'no_post_unverified');assert.deepEqual(historical.published,[]);
 const learning=await load('learning');assert.ok(learning.samples.every(row=>row.reward===null));
});

test('exact canonical union coverage allows candidate/rejection and candidate/post references without implying score approval',async()=>{
 const f=await fixture(),source=f.assignments.find(row=>row.productUrl===overlapURL),candidate={productUrl:source.productUrl,segment:source.segment,demandEvidence:{kind:f.research.sources.find(row=>row.id===source.demandSourceId).demandKind,sourceIds:[source.demandSourceId]}};
 f.draft.candidates.push(candidate);f.draft.posts.push({...candidate});const before=stableJSON(f),report=sealedWriterCoverage(f.draft,f.options);
 assert.equal(report.valid,true);assert.equal(report.assignedCount,10);assert.equal(report.consideredUniqueCount,10);assert.deepEqual(report.duplicates,[]);assert.deepEqual(report.missing,[]);
 assert.equal(report.coverageOnly,true);for(const field of ['checks','completedAssessment','scoring','reward','approved'])assert.equal(report[field],undefined);
 assert.equal(stableJSON(f),before);assert.ok(f.research.sources.every(source=>!JSON.stringify(report).includes(source.text)));
});

test('within-list aliases, missing and foreign identities fail even when prose claims all ten were considered',async()=>{
 const f=await fixture();f.draft.summary='All ten assigned discussions were considered.';
 f.draft.rejected[f.draft.rejected.length-1]={...f.draft.rejected[6],productUrl:overlapURL+'/?utm_source=duplicate#ignored'};
 const report=writerCoverage(f.draft,{runId,assignments:f.assignments});assert.equal(report.valid,false);assert.equal(report.consideredUniqueCount,9);assert.equal(report.missing[0].productUrl,missingURL);
 assert.deepEqual(report.duplicates,[{list:'rejected',productUrl:overlapURL,indexes:[6,9]}]);
 const foreign=await fixture();foreign.draft.rejected[0].productUrl='https://news.ycombinator.com/item?id=99999999';const outside=writerCoverage(foreign.draft,{runId,assignments:foreign.assignments});assert.equal(outside.valid,false);assert.equal(outside.foreign.length,1);assert.equal(outside.missing.length,1);assert.equal(outside.consideredUniqueCount,10);assert.equal(outside.coveredAssignedCount,9,'A foreign replacement cannot claim ten assigned discussions were covered.');
 const malformed=await fixture();malformed.draft.rejected[0].productUrl='https://example.com/person@example.com';const safe=writerCoverage(malformed.draft,{runId,assignments:malformed.assignments});assert.equal(safe.valid,false);assert.equal(safe.malformed.length,1);assert.equal(JSON.stringify(safe).includes('person@example.com'),false);
 const profile=await fixture();profile.draft.rejected[0].productUrl='https://example.com/profile/synthetic-handle';const noProfile=writerCoverage(profile.draft,{runId,assignments:profile.assignments});assert.equal(noProfile.valid,false);assert.deepEqual(noProfile.foreign,[{list:'rejected',index:0,productUrl:null}]);assert.equal(JSON.stringify(noProfile).includes('synthetic-handle'),false);
});

test('coverage retains exact optional segment and demand bindings and refuses malformed draft lists',async()=>{
 for(const change of [item=>item.segment='households',item=>item.demandSourceId='a'.repeat(24),item=>item.registrySourceId='a'.repeat(24),item=>item.demandEvidence={sourceIds:['a'.repeat(24)]},item=>item.demandEvidence={sourceIds:[]},item=>item.demandEvidence=null,item=>{delete item.segment;item.demandEvidence={sourceIds:['a'.repeat(24)]};}]){
  const f=await fixture();change(f.draft.rejected[0]);const report=writerCoverage(f.draft,{runId,assignments:f.assignments});assert.equal(report.valid,false);assert.ok(report.bindingMismatches.length,change.toString());
 }
 const f=await fixture();for(const draft of [{...f.draft,runId:'loop-1-1'},{...f.draft,posts:undefined},{...f.draft,candidates:{}},{...f.draft,rejected:[...f.draft.rejected,f.draft.rejected[0]]}])assert.equal(writerCoverage(draft,{runId,assignments:f.assignments}).valid,false);
 const excluded=structuredClone(f.draft);for(const row of excluded.rejected)delete row.segment;assert.equal(writerCoverage(excluded,{runId,assignments:f.assignments}).valid,true,'An explicit unscored exclusion may omit score/demand fields.');
});

test('the trusted gate requires unchanged sealed research and selection rather than model-supplied work-list counts',async()=>{
 const f=await fixture();assert.equal(sealedWriterCoverage(f.draft,f.options).valid,true);
 for(const field of ['expectedResearchSha256','expectedSelectionSha256'])assert.equal(sealedWriterCoverage(f.draft,{...f.options,[field]:'0'.repeat(64)}).valid,false);
 const changed=structuredClone(f.research);changed.enrichment.discussionBatch.leadAssignments.pop();assert.equal(sealedWriterCoverage(f.draft,{...f.options,research:changed}).valid,false);
 for(const assignments of [[],[...f.assignments,f.assignments[0]],f.assignments.map((row,index)=>index?row:{...row,extra:true}),f.assignments.map((row,index)=>index?row:{...row,productUrl:row.productUrl+'/'})])assert.equal(writerCoverage(f.draft,{runId,assignments}).valid,false);
});

async function sandbox(t,f){
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-writer-coverage-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const [directory,record] of [['research',f.research],['learning-selection',f.selection],['drafts',f.draft]]){await mkdir(path.join(root,'data',directory),{recursive:true});await writeFile(path.join(root,'data',directory,runId+'.json'),JSON.stringify(record));}
 await mkdir(path.join(root,'.run'));const context={runId,role:'writer',researchPolicy:{mode:'repair'},writerCoverage:{researchSha256:f.options.expectedResearchSha256,selectionSha256:f.options.expectedSelectionSha256,assignmentCount:10,ledgerPath:'.run/writer-assignments.json',command:'node scripts/check-writer-coverage.mjs '+runId}};
 await writeFile(path.join(root,'.run','context.json'),JSON.stringify(context));
 return {root,context,env:{EXPECTED_RESEARCH_SHA:f.options.expectedResearchSha256,EXPECTED_LEARNING_SELECTION_SHA:f.options.expectedSelectionSha256}};
}

test('the read-only advisory command validates original files and environment pins override its advisory context',async t=>{
 const f=await fixture(),s=await sandbox(t,f),paths=[...['research','learning-selection','drafts'].map(name=>path.join(s.root,'data',name,runId+'.json')),path.join(s.root,'.run','context.json')],before=await Promise.all(paths.map(file=>readFile(file,'utf8')));
 const envReport=await checkWriterCoverage({runId,root:s.root,env:s.env});assert.equal(envReport.valid,true);assert.equal(envReport.pinSource,'environment');
 const advisory=await checkWriterCoverage({runId,root:s.root,env:{}});assert.equal(advisory.valid,true);assert.equal(advisory.pinSource,'advisory_context');
 assert.deepEqual(await Promise.all(paths.map(file=>readFile(file,'utf8'))),before);
 await writeFile(path.join(s.root,'.run','context.json'),JSON.stringify({...s.context,writerCoverage:{...s.context.writerCoverage,researchSha256:'0'.repeat(64)}}));
 assert.equal((await checkWriterCoverage({runId,root:s.root,env:s.env})).valid,true,'Independent environment pins cannot be replaced by advisory context.');assert.equal((await checkWriterCoverage({runId,root:s.root,env:{}})).valid,false);
 await assert.rejects(checkWriterCoverage({runId,root:s.root,env:{EXPECTED_RESEARCH_SHA:''}}));
 await assert.rejects(checkWriterCoverage({runId:'../escape',root:s.root,env:s.env}));
 const draftPath=path.join(s.root,'data','drafts',runId+'.json');await rm(draftPath);await symlink(paths[0],draftPath);await assert.rejects(checkWriterCoverage({runId,root:s.root,env:s.env}));
});

test('the real writer command exits on exact missing coverage and never writes or calls a source/model service',async t=>{
 const f=await fixture(),s=await sandbox(t,f);
 for(const directory of ['lib','scripts'])await cp(new URL('../'+directory,import.meta.url),path.join(s.root,directory),{recursive:true});
 await mkdir(path.join(s.root,'public'));for(const name of ['schedule.js','cadence-config.js'])await cp(new URL('../public/'+name,import.meta.url),path.join(s.root,'public',name));await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),path.join(s.root,'node_modules'),'dir');await writeFile(path.join(s.root,'package.json'),'{"type":"module"}');
 await writeFile(path.join(s.root,'offline.mjs'),"globalThis.fetch=async()=>{throw new Error('No source or provider calls are permitted.');};");
 const env={PATH:process.env.PATH,NODE_OPTIONS:'--import='+path.join(s.root,'offline.mjs'),...s.env};
 const invoke=extra=>spawnSync(process.execPath,['scripts/check-writer-coverage.mjs',runId],{cwd:s.root,env:{...env,...extra},encoding:'utf8'});
 const good=invoke();assert.equal(good.status,0,good.stderr);assert.equal(JSON.parse(good.stdout).valid,true);
 const draftPath=path.join(s.root,'data','drafts',runId+'.json');await writeFile(draftPath,JSON.stringify(f.historicalDraft));const before=await readFile(draftPath,'utf8'),failed=invoke();assert.equal(failed.status,1);const report=JSON.parse(failed.stdout);assert.equal(report.consideredUniqueCount,9);assert.equal(report.missing[0].productUrl,missingURL);assert.equal(await readFile(draftPath,'utf8'),before);
 const badPins=invoke({EXPECTED_RESEARCH_SHA:'0'.repeat(64)});assert.equal(badPins.status,1);assert.equal(JSON.parse(badPins.stdout).valid,false);assert.equal(JSON.stringify(JSON.parse(failed.stdout)).includes('all ten'),false);
});

test('the real independently pinned checker preparation rejects the immutable missing assignment before DNS, HTTP or checker context',async t=>{
 const f=await fixture(),s=await sandbox(t,f);
 for(const directory of ['lib','scripts'])await cp(new URL('../'+directory,import.meta.url),path.join(s.root,directory),{recursive:true});
 await mkdir(path.join(s.root,'public'));for(const name of ['schedule.js','cadence-config.js'])await cp(new URL('../public/'+name,import.meta.url),path.join(s.root,'public',name));await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),path.join(s.root,'node_modules'),'dir');await writeFile(path.join(s.root,'package.json'),'{"type":"module"}');
 await cp(new URL('../RULES.md',import.meta.url),path.join(s.root,'RULES.md'));
 await mkdir(path.join(s.root,'data','sources'));await cp(new URL('../data/sources/registry.json',import.meta.url),path.join(s.root,'data','sources','registry.json'));
 await mkdir(path.join(s.root,'data','scheduling'));const schedulingPath=path.join(s.root,'data','scheduling',runId+'.json');await cp(new URL('../data/scheduling/'+runId+'.json',import.meta.url),schedulingPath);
 // Use the exact historical draft/research/selection/scheduling. This is an
 // isolated read-only regression, not a retry or reclassification of that run.
 const draftPath=path.join(s.root,'data','drafts',runId+'.json');await cp(new URL('../data/drafts/'+runId+'.json',import.meta.url),draftPath);
 for(const directory of ['research','learning-selection'])await cp(new URL('../data/'+directory+'/'+runId+'.json',import.meta.url),path.join(s.root,'data',directory,runId+'.json'));
 const inputs=['RULES.md','data/sources/registry.json',...['research','learning-selection','drafts','scheduling'].map(directory=>'data/'+directory+'/'+runId+'.json')],before=await Promise.all(inputs.map(async name=>[name,await readFile(path.join(s.root,name),'utf8')]));
 const counters=path.join(s.root,'blocked-network-counts.json'),preload=path.join(s.root,'blocked-network.mjs');
 await writeFile(preload,`import dns from 'node:dns/promises';import {syncBuiltinESMExports} from 'node:module';import {writeFileSync} from 'node:fs';const counts={dns:0,http:0};dns.lookup=async()=>{counts.dns++;throw new Error('Offline regression blocked DNS.');};syncBuiltinESMExports();globalThis.fetch=async()=>{counts.http++;throw new Error('Offline regression blocked HTTP.');};process.on('exit',()=>writeFileSync(${JSON.stringify(counters)},JSON.stringify(counts)));`);
 const scheduling=JSON.parse(await readFile(schedulingPath,'utf8')),outputPath=path.join(s.root,'gate-output'),env={PATH:process.env.PATH,NODE_OPTIONS:'--import='+preload,GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',DEMAND_CONTRACT_VERSION:'1',LOOP_SCHEDULING_SHA:sha256(stableJSON(scheduling)),EXPECTED_RESEARCH_SHA:f.options.expectedResearchSha256,EXPECTED_LEARNING_SELECTION_SHA:f.options.expectedSelectionSha256,GITHUB_OUTPUT:outputPath};
 const result=spawnSync(process.execPath,['scripts/prepare-check.mjs',runId],{cwd:s.root,env,encoding:'utf8'});
 assert.equal(result.status,1);const output=await readFile(outputPath,'utf8');assert.match(output,/verified=false/);assert.match(output,/unverified_code=checker_preparation_failed/);assert.ok(output.includes(missingURL));assert.ok(output.includes(f.assignments.find(row=>row.productUrl===missingURL).demandSourceId));assert.match(output,/9 of 10 unique assigned discussions considered/);
 assert.deepEqual(JSON.parse(await readFile(counters,'utf8')),{dns:0,http:0});
 for(const [name,bytes] of before)assert.equal(await readFile(path.join(s.root,name),'utf8'),bytes,'Preparation cannot mutate original '+name);
 for(const name of ['data/check-context/'+runId+'.json','data/checks/'+runId+'.json','data/check-diagnostics/'+runId+'.json','.run/checker-response.json','.run/checker-output-schema.json'])await assert.rejects(readFile(path.join(s.root,name)),error=>error.code==='ENOENT');
});
