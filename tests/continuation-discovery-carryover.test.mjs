import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startContinuation,sealContinuationResult} from '../lib/research-continuation.mjs';
import {planResearchContinuation} from '../lib/candidate-research.mjs';

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-continuation-carryover-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const original=JSON.parse(await readFile(new URL('../data/research-intents/loop-40779144019-1.json',import.meta.url)));
 const snapshot=JSON.parse(await readFile(new URL('../data/research/loop-40779144019-1.json',import.meta.url)));
 const discovery=snapshot.discoveryCarryover.records.find(row=>row.sourceId===original.dossier.source.id);
 for(const dir of ['runs','drafts','check-context','checks','research','source-scans','learning','research-results'])await mkdir(path.join(root,'data',dir),{recursive:true});
 const files=[...['runs','drafts','check-context','checks','research','source-scans','learning'].map(dir=>[dir,original.dossier.provenance.runId]),...['research','source-scans'].map(dir=>[dir,discovery.sourceRunId])];
 for(const [dir,id] of files)await writeFile(path.join(root,'data',dir,id+'.json'),await readFile(new URL(`../data/${dir}/${id}.json`,import.meta.url)));
 const runId='loop-999955551-1',producer={...original.producer,runId:'999955551'},now=original.createdAt,intent={...original,runId,producer};
 const scan=JSON.parse(await readFile(new URL('../data/source-scans/loop-40779144019-1.json',import.meta.url))),selection=structuredClone(snapshot.learningSelection);
 Object.assign(scan,{id:runId,runId,producer});Object.assign(selection,{id:runId,runId,seed:runId,producer});
 const source=snapshot.sources.find(row=>row.id===original.dossier.source.id);
 const selectionInput={sources:[source],originMap:[{sourceId:source.id,url:source.url,productUrl:source.url,feedIds:discovery.feedIds}],discoveryCarryover:{version:1,records:[discovery]},demandDefinitions:scan.definitions,learningSelection:selection,previous:[],recentAssessments:[],now:Date.parse(now),cooldownHours:3};
 const origin=Object.fromEntries(await Promise.all(Object.entries({run:'runs',draft:'drafts',context:'check-context',manifest:'checks',research:'research',scan:'source-scans',learning:'learning'}).map(async([key,dir])=>[key,JSON.parse(await readFile(path.join(root,'data',dir,original.dossier.provenance.runId+'.json')))])));
 return {root,runId,intent,scan,selection,selectionInput,now,discovery,origin};
}

test('exact22UTC retained discovery can schedule one fresh primary read without a fresh-feed listing',async t=>{
 const f=await fixture(t);assert.equal(f.scan.sources.some(s=>s.id===f.intent.dossier.source.id),false);
 const plan=planResearchContinuation(f.intent.dossier,f.origin,{selectionInput:f.selectionInput});
 assert.equal(plan.status,'ready_for_scheduled_research');assert.equal(plan.requiresFreshPrimaryCheck,true,'Equal plain text is discovery evidence, not an already verified source.');
 const j=await startContinuation({...f,clock:()=>f.now});assert.equal(j.priorityProductUrl,f.intent.dossier.source.url);
 assert.equal(j.referencePriority(),null,'Historical discovery is not fresh primary evidence.');
 const lead={productUrl:f.intent.dossier.source.url};await j.onLeadEvent({phase:'started',lead});
 await j.onLeadEvent({phase:'finished',lead,source:f.intent.dossier.source,observation:{status:'fetched',requests:1}});
 assert.equal(j.referencePriority().priorityDemandSourceId,f.intent.dossier.source.id,'Only the matching fresh response unlocks documentation.');
 const receipt=await sealContinuationResult({root:f.root,intent:f.intent,clock:()=>f.now});assert.equal(receipt.outcome,'partial');
});

test('missing, forged, expired and wrong-feed carryover cannot enable continuation',async t=>{
 const f=await fixture(t),without=structuredClone(f.selectionInput);delete without.discoveryCarryover;
 assert.equal((await startContinuation({...f,selectionInput:without,clock:()=>f.now})).priorityProductUrl,null);
 for(const mutate of [input=>input.discoveryCarryover.records[0].sourceScanSha256='f'.repeat(64),input=>input.discoveryCarryover.records[0].observedAt='2020-01-01T00:00:00.000Z',input=>input.discoveryCarryover.records[0].feedIds=['f'.repeat(24)]]){
  const input=structuredClone(f.selectionInput);mutate(input);
  await assert.rejects(()=>startContinuation({...f,selectionInput:input,clock:()=>f.now}),/discovery/i);
 }
 const input=structuredClone(f.selectionInput);input.now=Date.parse(f.discovery.observedAt)+24*3600000+1;
 await assert.rejects(()=>startContinuation({...f,selectionInput:input,clock:()=>new Date(input.now).toISOString()}),/discovery/i);
 const cooled=structuredClone(f.selectionInput);cooled.recentAssessments=[{productUrl:f.intent.dossier.source.url,assessedAt:f.now,discoveryEvidenceSha256:f.discovery.textSha256}];
 assert.equal((await startContinuation({...f,selectionInput:cooled,clock:()=>f.now})).priorityProductUrl,null);
 const published={...f.selectionInput,previous:[{productUrl:f.intent.dossier.source.url}]};
 assert.equal((await startContinuation({...f,selectionInput:published,clock:()=>f.now})).priorityProductUrl,null);
});
