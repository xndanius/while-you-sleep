import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {prepareContinuationIntent,startContinuation,sealContinuationResult,continuationResultReasons,verifyContinuationIntent} from '../lib/research-continuation.mjs';
import {importResearchContinuation} from '../scripts/import-research-continuation.mjs';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {selectProductLeads} from '../lib/product-evidence.mjs';
import {selectDiscussionImplementationReferences} from '../lib/discussion-implementation.mjs';
const dirs={run:'runs',draft:'drafts',context:'check-context',manifest:'checks',research:'research',scan:'source-scans',learning:'learning'};
const now='2026-10-28T20:30:00.000Z',head='a'.repeat(40);
async function setup(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-continuation-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const bundle={};for(const [key,dir] of Object.entries(dirs)){bundle[key]=JSON.parse(await readFile(new URL(`../data/${dir}/loop-40734809732-1.json`,import.meta.url)));await mkdir(path.join(root,'data',dir),{recursive:true});await writeFile(path.join(root,'data',dir,bundle.run?.id||'loop-40734809732-1')+'.json',JSON.stringify(bundle[key]));}
 const runId='loop-999900001-1',producer={repository:'xndanius/while-you-sleep',runId:'999900001',runAttempt:1,workflow:'loop.yml',stage:'pre_model',headSha:head};
 const intent=await prepareContinuationIntent({root,runId,bundles:[bundle],producer,now});
 const scan=structuredClone(bundle.scan);Object.assign(scan,{id:runId,runId,createdAt:now,producer});
 const selection=structuredClone(bundle.research.learningSelection);Object.assign(selection,{id:runId,runId,seed:runId,createdAt:now,producer});
 const sources=bundle.context.sources.filter(row=>row.role==='demand').map(row=>structuredClone(row));
 const selectionInput={sources,originMap:scan.originMap,demandDefinitions:scan.definitions,learningSelection:selection,previous:[],recentAssessments:[],now:Date.parse(now),cooldownHours:3};
 for(const [dir,value] of [['source-scans',scan],['learning-selection',selection]]){await mkdir(path.join(root,'data',dir),{recursive:true});await writeFile(path.join(root,'data',dir,runId+'.json'),JSON.stringify(value));}
 return {root,bundle,intent,scan,selection,selectionInput,runId,producer};
}
const terminal=(lead,source,status='fetched')=>({phase:'finished',lead,source:status==='fetched'?source:null,observation:{status,requests:1,code:status==='failed'?'source_http_error':undefined}});
async function primary(f,j){const lead={productUrl:f.intent.dossier.source.url};await j.onLeadEvent({phase:'started',lead});await j.onLeadEvent(terminal(lead,f.intent.dossier.source));}

test('intent is persisted before attempts, and interrupted/missing results park the same gap',async t=>{
 const f=await setup(t);assert.ok(f.intent);assert.equal(f.intent.dossier.referenceRequests.length,2);
 assert.equal(await prepareContinuationIntent({root:f.root,runId:'loop-999900002-1',bundles:[f.bundle],producer:{...f.producer,runId:'999900002'},now}),null,'An unresolved sealed intent cannot be silently retried.');
 const result=await sealContinuationResult({root:f.root,intent:f.intent,clock:()=>now});assert.equal(result.outcome,'unknown');assert.deepEqual(result.events,[]);
 assert.deepEqual(continuationResultReasons(result,f.intent,{sealed:true}),[]);
});

test('primary and two reference terminal events retain success hashes, not model approvals',async t=>{
 const f=await setup(t),j=await startContinuation({...f,clock:()=>now});await primary(f,j);
 assert.equal(j.referencePriority().priorityDemandSourceId,f.intent.dossier.source.id);
 for(const ref of f.intent.dossier.referenceRequests){const lead={productUrl:ref.url};await j.onReferenceEvent({phase:'started',lead});await j.onReferenceEvent(terminal(lead,{...ref,text:'Synthetic capability section.'}));}
 const result=await sealContinuationResult({root:f.root,intent:f.intent,clock:()=>now});assert.equal(result.outcome,'completed');assert.equal(result.events.length,6);assert.equal(result.events.filter(e=>e.status==='fetched').length,3);assert.equal(result.approved,undefined);
 const review=await prepareContinuationIntent({root:f.root,runId:'loop-999900002-1',bundles:[f.bundle],producer:{...f.producer,runId:'999900002'},now});assert.equal(review.purpose,'review_evidence');assert.deepEqual(review.referenceIds,[]);assert.equal(review.refreshReferenceIds.length,2);
 const scan={...f.scan,id:review.runId,runId:review.runId,producer:review.producer},selection={...f.selection,id:review.runId,runId:review.runId,seed:review.runId,producer:review.producer};
 const revisit=await startContinuation({...f,intent:review,scan,selection,selectionInput:{...f.selectionInput,learningSelection:selection},clock:()=>now});await primary({...f,intent:review},revisit);
 for(const ref of review.dossier.referenceRequests){const lead={productUrl:ref.url};await revisit.onReferenceEvent({phase:'started',lead});await revisit.onReferenceEvent(terminal(lead,{...ref,text:'Synthetic refreshed capability.'}));}
 await sealContinuationResult({root:f.root,intent:review,clock:()=>now});
 assert.equal(await prepareContinuationIntent({root:f.root,runId:'loop-999900008-1',bundles:[f.bundle],producer:{...f.producer,runId:'999900008'},now}),null,'A missing evaluation cannot cause unbounded repeat refreshes.');
});

test('reference HTTP failure and mid-request interruption stay traceable and never become success',async t=>{
 const f=await setup(t),j=await startContinuation({...f,clock:()=>now});await primary(f,j);
 const first={productUrl:f.intent.dossier.referenceRequests[0].url};await j.onReferenceEvent({phase:'started',lead:first});await j.onReferenceEvent(terminal(first,null,'failed'));
 const second={productUrl:f.intent.dossier.referenceRequests[1].url};await j.onReferenceEvent({phase:'started',lead:second});
 const result=await sealContinuationResult({root:f.root,intent:f.intent,clock:()=>now});assert.equal(result.outcome,'interrupted');assert.equal(result.events.filter(e=>e.status==='failed').length,1);assert.equal(result.events.filter(e=>e.status==='started').length,3);assert.equal(result.events.some(e=>e.key===f.intent.dossier.referenceRequests[1].implementationReferenceId&&e.status==='fetched'),false);
});

test('changed primary body disables documentation priority; a planned-but-ineligible task is not an attempt',async t=>{
 const f=await setup(t),j=await startContinuation({...f,clock:()=>now}),lead={productUrl:f.intent.dossier.source.url};
 await j.onLeadEvent({phase:'started',lead});const changed=structuredClone(f.intent.dossier.source);changed.nativeReadingContext.normalizedSha256='f'.repeat(64);await j.onLeadEvent(terminal(lead,changed));assert.equal(j.referencePriority(),null);
 assert.equal((await sealContinuationResult({root:f.root,intent:f.intent,clock:()=>now})).outcome,'changed_source');
 const nextId='loop-999900003-1',next={...f.intent,runId:nextId,producer:{...f.producer,runId:'999900003'}};
 const scan={...f.scan,id:nextId,runId:nextId,producer:next.producer},selection={...f.selection,id:nextId,runId:nextId,seed:nextId,producer:next.producer};
 const blocked=await startContinuation({...f,intent:next,scan,selection,selectionInput:{...f.selectionInput,learningSelection:selection,previous:[{productUrl:lead.productUrl}]},clock:()=>now});
 assert.equal(blocked.priorityProductUrl,null);const result=await sealContinuationResult({root:f.root,intent:next,clock:()=>now});assert.equal(result.outcome,'not_eligible');assert.deepEqual(result.events,[]);
});

test('original discovery fingerprint can plan a refetch but changed discovery cannot use the old task',async t=>{
 const f=await setup(t),input=structuredClone(f.selectionInput),source=input.sources.find(x=>x.id===f.intent.dossier.source.id);delete source.nativeReadingContext;
 const j=await startContinuation({...f,selectionInput:input,clock:()=>now});assert.equal(j.priorityProductUrl,source.url);assert.equal(j.referencePriority(),null,'Only a matching fresh primary response unlocks reference priority.');
 source.text+=' Changed request.';source.taskExcerpts=[source.text];const another={...f.intent,runId:'loop-999900004-1',producer:{...f.producer,runId:'999900004'}};
 const blocked=await startContinuation({...f,intent:another,scan:{...f.scan,id:another.runId,runId:another.runId,producer:another.producer},selection:{...f.selection,id:another.runId,runId:another.runId,seed:another.runId,producer:another.producer},selectionInput:{...input,learningSelection:{...f.selection,id:another.runId,runId:another.runId,seed:another.runId,producer:another.producer}},clock:()=>now});assert.equal(blocked.priorityProductUrl,null);
});

test('priority preserves the ten-lead/three-per-feed and two-reference budgets',async t=>{
 const f=await setup(t),j=await startContinuation({...f,clock:()=>now});
 const leads=selectProductLeads(f.selectionInput.sources,{...f.selectionInput,priorityProductUrl:j.priorityProductUrl});assert.equal(leads[0].productUrl,f.intent.dossier.source.url);assert.ok(leads.length<=10);
 const counts={};for(const lead of leads)counts[lead.demandDefinition.id]=(counts[lead.demandDefinition.id]||0)+1;assert.ok(Object.values(counts).every(n=>n<=3));
 await primary(f,j);const refs=selectDiscussionImplementationReferences(f.selectionInput.sources,{...j.referencePriority()});assert.equal(refs.length,2);assert.ok(refs.every(x=>x.supportsDemandSourceIds.includes(f.intent.dossier.source.id)));
});

test('dedicated import requires trusted hashes, producer, exact path and current input bindings',async t=>{
 const f=await setup(t),j=await startContinuation({...f,clock:()=>now});await primary(f,j);const result=await sealContinuationResult({root:f.root,intent:f.intent,clock:()=>now});assert.equal(result.outcome,'partial');
 const staging=path.join(f.root,'staging');await mkdir(staging);await writeFile(path.join(staging,f.runId+'.json'),JSON.stringify(f.intent));
 const args={directory:staging,kind:'intent',root:f.root,runId:f.runId,expectedSha256:sha256(stableJSON(f.intent)),headSha:head,env:{GITHUB_RUN_ID:f.producer.runId,GITHUB_RUN_ATTEMPT:'1'}};
 await importResearchContinuation(args);await importResearchContinuation(args);
 await assert.rejects(importResearchContinuation({...args,expectedSha256:'0'.repeat(64)}));await assert.rejects(importResearchContinuation({...args,headSha:'b'.repeat(40)}));await assert.rejects(importResearchContinuation({...args,env:{GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1'}}));
 await writeFile(path.join(staging,f.runId+'.json'),JSON.stringify(result));await importResearchContinuation({...args,kind:'result',expectedSha256:sha256(stableJSON(result))});
 const forged={...result,sourceScanSha256:'f'.repeat(64)};await writeFile(path.join(staging,f.runId+'.json'),JSON.stringify(forged));await assert.rejects(importResearchContinuation({...args,kind:'result',expectedSha256:sha256(stableJSON(forged))}));
 const fakeIntent=structuredClone(f.intent);fakeIntent.dossier.referenceRequests[0].url='https://example.com/unsupported';await assert.rejects(verifyContinuationIntent(f.root,fakeIntent));
});

test('workflow archives intent before scan, seals results before model, and imports outside model files',async()=>{
 const workflow=await readFile(new URL('../.github/workflows/loop.yml',import.meta.url),'utf8');
 assert.ok(workflow.indexOf('name: research-intent-${{ env.RUN_ID }}')<workflow.indexOf('run: node scripts/research-snapshot.mjs'));
 assert.ok(workflow.indexOf('run: node scripts/seal-research-continuation.mjs')<workflow.indexOf('name: Codex picks and writes'));
 assert.match(workflow,/import-research-continuation\.mjs \.staging\/research-intent intent/);assert.match(workflow,/import-research-continuation\.mjs \.staging\/research-result result/);
});

test('an unattempted saved dossier survives the ordinary 24-hour writer-history window',async t=>{
 const f=await setup(t),input={...f.selectionInput,previous:[{productUrl:f.intent.dossier.source.url}]};
 await startContinuation({...f,selectionInput:input,clock:()=>now});await sealContinuationResult({root:f.root,intent:f.intent,clock:()=>now});
 const saved=await prepareContinuationIntent({root:f.root,runId:'loop-999900005-1',bundles:[],producer:{...f.producer,runId:'999900005'},now:'2026-10-30T20:30:00.000Z'});
 assert.ok(saved);assert.equal(saved.dossier.gapId,f.intent.dossier.gapId);assert.deepEqual(saved.dossier.candidate.experimentPlan,f.intent.dossier.candidate.experimentPlan);
});

test('partial acquisition parks only the attempted route and keeps the other gap queued',async t=>{
 const f=await setup(t),j=await startContinuation({...f,clock:()=>now});await primary(f,j);
 const first=f.intent.dossier.referenceRequests[0],lead={productUrl:first.url};await j.onReferenceEvent({phase:'started',lead});await j.onReferenceEvent(terminal(lead,null,'failed'));
 assert.equal((await sealContinuationResult({root:f.root,intent:f.intent,clock:()=>now})).outcome,'failed');
 const next=await prepareContinuationIntent({root:f.root,runId:'loop-999900006-1',bundles:[f.bundle],producer:{...f.producer,runId:'999900006'},now});
 assert.ok(next);assert.deepEqual(next.referenceIds,[f.intent.dossier.referenceRequests[1].implementationReferenceId]);
});

test('version1 intent remains readable and unrelated catalog hash changes do not alter its source proof',async t=>{
 const f=await setup(t),legacy=structuredClone(f.intent);legacy.schema=1;delete legacy.referenceIds;delete legacy.refreshReferenceIds;delete legacy.purpose;await verifyContinuationIntent(f.root,legacy);
 legacy.dossier.catalogSha256='f'.repeat(64);legacy.dossier.gapId=sha256(stableJSON({productUrl:legacy.dossier.source.url,sourceSha256:legacy.dossier.sourceSha256,catalogSha256:legacy.dossier.catalogSha256,referenceIds:legacy.dossier.referenceRequests.map(r=>r.implementationReferenceId).sort()}));
 await verifyContinuationIntent(f.root,legacy);
});

test('a later pending capability is combined with a fresh read of previously successful evidence',async t=>{
 const f=await setup(t),j=await startContinuation({...f,clock:()=>now});await primary(f,j);
 const first=f.intent.dossier.referenceRequests[0],lead={productUrl:first.url};await j.onReferenceEvent({phase:'started',lead});await j.onReferenceEvent(terminal(lead,{...first,text:'Synthetic prior capability.'}));
 assert.equal((await sealContinuationResult({root:f.root,intent:f.intent,clock:()=>now})).outcome,'partial');
 const intent=await prepareContinuationIntent({root:f.root,runId:'loop-999900007-1',bundles:[f.bundle],producer:{...f.producer,runId:'999900007'},now});
 assert.deepEqual(intent.referenceIds,[f.intent.dossier.referenceRequests[1].implementationReferenceId]);assert.deepEqual(intent.refreshReferenceIds,[first.implementationReferenceId]);
 const scan={...f.scan,id:intent.runId,runId:intent.runId,producer:intent.producer},selection={...f.selection,id:intent.runId,runId:intent.runId,seed:intent.runId,producer:intent.producer};
 const next=await startContinuation({...f,intent,scan,selection,selectionInput:{...f.selectionInput,learningSelection:selection},clock:()=>now});await primary({...f,intent},next);
 const refs=selectDiscussionImplementationReferences(f.selectionInput.sources,next.referencePriority());assert.equal(refs.length,2);assert.deepEqual(refs.map(r=>r.implementationReferenceId),[...intent.referenceIds,...intent.refreshReferenceIds]);
 for(const ref of refs){const lead={productUrl:ref.url};await next.onReferenceEvent({phase:'started',lead});await next.onReferenceEvent(terminal(lead,{...ref,text:'Synthetic fresh capability.'}));}
 const result=await sealContinuationResult({root:f.root,intent,clock:()=>now});assert.equal(result.outcome,'completed');assert.equal(result.events.filter(e=>e.status==='fetched').length,3);
});

test('retired segments/feeds cannot reserve research and an unavailable case does not monopolize the queue',async t=>{
 const f=await setup(t),invoice={};
 for(const [key,dir] of Object.entries(dirs)){invoice[key]=JSON.parse(await readFile(new URL(`../data/${dir}/loop-40549856676-1.json`,import.meta.url)));await writeFile(path.join(f.root,'data',dir,'loop-40549856676-1.json'),JSON.stringify(invoice[key]));}
 await startContinuation({...f,selectionInput:{...f.selectionInput,sources:[]},clock:()=>now});await sealContinuationResult({root:f.root,intent:f.intent,clock:()=>now});
 const params={root:f.root,runId:'loop-999900009-1',bundles:[f.bundle,invoice],producer:{...f.producer,runId:'999900009'},now};
 assert.equal(await prepareContinuationIntent({...params,allowedRegistryIds:[]}),null);assert.equal(await prepareContinuationIntent({...params,allowedSegments:[]}),null);
 const next=await prepareContinuationIntent(params);assert.ok(next.dossier.source.url.endsWith('/118145'));
});
