import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {researchDossiers,planResearchContinuation,researchSourceFingerprint} from '../lib/candidate-research.mjs';
import {DISCUSSION_SOURCE_CATALOG} from '../lib/discussion-sources.mjs';
import {candidateEvidenceTasks,candidateEvidenceTaskReasons} from '../lib/candidate-evidence-tasks.mjs';
import {deriveCandidateDevelopment} from '../lib/candidate-development.mjs';
import {prepareContinuationIntent,verifyContinuationIntent} from '../lib/research-continuation.mjs';
import {selectDiscussionImplementationReferences,extractDiscussionImplementationEvidence} from '../lib/discussion-implementation.mjs';
import {stableJSON} from '../lib/storage.mjs';

const dirs={run:'runs',draft:'drafts',context:'check-context',manifest:'checks',research:'research',scan:'source-scans',learning:'learning'};
const load=async id=>Object.fromEntries(await Promise.all(Object.entries(dirs).map(async([k,d])=>[k,JSON.parse(await readFile(new URL(`../data/${d}/loop-${id}-1.json`,import.meta.url)))])));
const csv=b=>b.context.sources.find(s=>s.url.endsWith('/325109'));

test('exact completed CSV cycle requests the remaining Drive route after excluding both acquired references',async()=>{
 const b=await load('40769477977'),before=stableJSON(b),d=researchDossiers(b).find(d=>d.source.url.endsWith('/325109'));
 assert.deepEqual(d.referenceRequests.map(r=>r.implementationReferenceId),['n8n-drive-trigger-v1']);
 assert.equal(d.coverage,'missing_capability_evidence');assert.deepEqual(d.unresolved,b.draft.candidates[0].experimentPlan.unverified);
 const sources=b.context.sources.filter(s=>s.role==='demand'),selectionInput={sources,originMap:sources.map(s=>({sourceId:s.id,url:s.url,productUrl:s.url,feedIds:[s.registrySourceId]})),demandDefinitions:DISCUSSION_SOURCE_CATALOG.filter(row=>b.research.learningSelection.demandSourceIds.includes(row.id)),learningSelection:b.research.learningSelection,previous:[],now:Date.parse(b.run.checkedAssessment.completedAt)+3*3600000+1,cooldownHours:3};
 const plan=planResearchContinuation(d,b,{selectionInput});
 assert.equal(plan.status,'ready_for_scheduled_research','The unchanged primary must permit the newly requested third catalog route after the first two were acquired.');
 assert.deepEqual(plan.referenceRequests.map(r=>r.implementationReferenceId),['n8n-drive-trigger-v1']);
 const old=researchDossiers(await load('40734809732')).find(d=>d.source.url.endsWith('/325109'));
 assert.deepEqual(old.referenceRequests.map(r=>r.implementationReferenceId),['n8n-csv-extraction-v1','n8n-persistent-deduplication-v1']);
 assert.equal(stableJSON(b),before);
});

test('next tasks distinguish a public read, synthetic key test, and real integration without claiming execution',async()=>{
 const b=await load('40769477977'),candidate=b.draft.candidates[0],source=csv(b),tasks=candidateEvidenceTasks({candidate,source,capabilitySources:b.context.sources.filter(s=>s.role==='building')});
 assert.deepEqual(tasks.map(t=>t.kind),['documentation','local_fixture','existing_access']);assert.ok(tasks.every(t=>t.status==='pending'));
 assert.match(tasks[1].acceptanceCheck,/distinct identical|distinct.*survive/);assert.match(tasks[2].scopeLimit,/cannot close/);
 assert.deepEqual(candidateEvidenceTaskReasons(tasks,candidate.productUrl),[]);
 const forged=structuredClone(tasks);forged[1].status='completed';assert.ok(candidateEvidenceTaskReasons(forged,candidate.productUrl).length);
 const foreign=structuredClone(tasks);foreign[0].referenceId='unapproved-url';assert.ok(candidateEvidenceTaskReasons(foreign,candidate.productUrl).length);
 const record=deriveCandidateDevelopment({run:b.run,bundle:b});
 assert.deepEqual(record.events.find(e=>e.productUrl===candidate.productUrl).details.evidenceTasks,tasks);
 assert.deepEqual(b.run.published,[]);assert.equal(candidate.experimentPlan.status,'proposed');
});

test('the real01UTC changed-source refusal cannot recur when its fresh primary is identical and the requested route still matches',async()=>{
 const b=await load('40799759234'),prior=await load('40769477977'),d=researchDossiers(prior).find(d=>d.source.url.endsWith('/325109'));
 const receipt=JSON.parse(await readFile(new URL('../data/research-results/loop-40799759234-1.json',import.meta.url))),intent=JSON.parse(await readFile(new URL('../data/research-intents/loop-40799759234-1.json',import.meta.url)));
 assert.equal(receipt.outcome,'changed_source');assert.deepEqual(receipt.events,[],'Keep the original incident receipt unchanged.');
 const source=b.research.sources.find(s=>s.id===d.source.id);assert.equal(source.enriched,true);assert.equal(researchSourceFingerprint(source),d.sourceSha256);
 const sources=b.research.sources.filter(s=>s.role==='demand'),selectionInput={sources,originMap:sources.map(s=>({sourceId:s.id,url:s.url,productUrl:s.url,feedIds:[s.registrySourceId]})),demandDefinitions:DISCUSSION_SOURCE_CATALOG.filter(row=>b.research.learningSelection.demandSourceIds.includes(row.id)),learningSelection:b.research.learningSelection,previous:[],now:Date.parse(intent.createdAt),cooldownHours:3};
 const plan=planResearchContinuation(d,prior,{selectionInput});assert.equal(plan.status,'ready_for_scheduled_research');assert.deepEqual(plan.referenceRequests.map(r=>r.implementationReferenceId),['n8n-drive-trigger-v1']);
});

test('Drive read requires task prose and its exact manual-versus-active semantics',async()=>{
 const b=await load('40769477977'),source=csv(b);
 const ref=selectDiscussionImplementationReferences([source],{priorityDemandSourceId:source.id,priorityReferenceIds:['n8n-drive-trigger-v1']})[0];assert.equal(ref.implementationReferenceId,'n8n-drive-trigger-v1');
 const text='On manual executions this node will return the last event matching its search criteria. Once saved and published, the node will regularly check for any matching events and will trigger your workflow for each event found.';
 assert.ok(extractDiscussionImplementationEvidence(ref,`<article><p>${text}</p></article>`,{demandSources:[source]}));
 assert.equal(extractDiscussionImplementationEvidence(ref,`<article><p>${text} Contact person@example.invalid.</p></article>`,{demandSources:[source]}),null);
 assert.equal(extractDiscussionImplementationEvidence(ref,'<p>Google Drive Trigger watches files. This unrelated introduction contains no activation or manual-execution semantics and establishes no reliable runtime.</p>',{demandSources:[source]}),null);
 const plain=structuredClone(source);delete plain.nativeReadingContext;
 for(const body of ['We export CSV files into Google Drive for review.','Our phone trigger retries twice, but this is unrelated to any Drive file.']){
  plain.text=body;plain.title='Google Drive Trigger for new uploads';
  assert.equal(selectDiscussionImplementationReferences([plain]).some(r=>r.implementationReferenceId==='n8n-drive-trigger-v1'),false);
 }
});

test('existing successful route receipts permit only the new Drive request after normal cooldown',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-next-route-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const previous=await load('40734809732'),current=await load('40769477977');
 for(const b of [previous,current])for(const [key,dir] of Object.entries(dirs)){await mkdir(path.join(root,'data',dir),{recursive:true});await writeFile(path.join(root,'data',dir,b.run.id+'.json'),JSON.stringify(b[key]));}
 for(const dir of ['research-intents','research-results']){await mkdir(path.join(root,'data',dir),{recursive:true});await writeFile(path.join(root,'data',dir,current.run.id+'.json'),await readFile(new URL(`../data/${dir}/${current.run.id}.json`,import.meta.url)));}
 const saved=JSON.parse(await readFile(path.join(root,'data/research-intents',current.run.id+'.json')));await verifyContinuationIntent(root,saved);
 const runId='loop-999900099-1',producer={repository:'xndanius/while-you-sleep',runId:'999900099',runAttempt:1,workflow:'loop.yml',stage:'pre_model',headSha:'a'.repeat(40)};
 const intent=await prepareContinuationIntent({root,runId,producer,bundles:[current],allowedRegistryIds:[csv(current).registrySourceId],now:new Date('2026-10-29T00:20:00.000Z')});
 assert.equal(intent.dossier.source.url,csv(current).url);assert.deepEqual(intent.referenceIds,['n8n-drive-trigger-v1']);assert.deepEqual(intent.refreshReferenceIds,[]);
});
