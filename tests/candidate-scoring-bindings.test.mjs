import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {sealedWriterCoverage} from '../lib/writer-coverage.mjs';
import {completedAssessmentReasons} from '../lib/validation.mjs';
import {checkWriterCoverage} from '../scripts/check-writer-coverage.mjs';
import {acceptCheckerOutput} from '../lib/checker-output.mjs';

const runId='loop-40865264413-1';
const load=async directory=>JSON.parse(await readFile(new URL(`../data/${directory}/${runId}.json`,import.meta.url),'utf8'));
async function fixture({strict=true}={}){
 const [draft,context,manifest,research,selection]=await Promise.all(['drafts','check-context','checks','research','learning-selection'].map(load));
 if(strict){context.candidateScoringVersion=1;manifest.completedAssessment.contextSha256=sha256(stableJSON(context));}
 return {draft,context,manifest,research,selection,options:{runId,research,selection,expectedResearchSha256:sha256(stableJSON(research)),expectedSelectionSha256:sha256(stableJSON(selection))}};
}
function bind(f){
 f.context.draftSha256=sha256(stableJSON(f.draft));f.manifest.draftSha256=f.context.draftSha256;
 f.manifest.completedAssessment.draftSha256=f.context.draftSha256;f.manifest.completedAssessment.contextSha256=sha256(stableJSON(f.context));
}
function correctedTestCopy(f){
 // Synthetic schema control only. This neither rescores nor repairs history.
 for(const candidate of f.draft.candidates)for(const rating of Object.values(candidate.scoring.criteria))rating.sourceIds=[...candidate.sourceIds];
 bind(f);return f;
}

test('the exact frozen 35-null case fails coverage and completed no-post acceptance without rewriting its record',async()=>{
 const f=await fixture(),before=stableJSON(f);
 assert.equal(f.context.draftSha256,'d4e1735b06c2fbbb45c10074064ec349121690960c023d3e7b609cd9b6cc1c93');
 assert.equal(sha256(stableJSON(f.draft)),f.context.draftSha256);assert.equal(f.draft.posts.length,0);assert.equal(f.draft.candidates.length,7);
 assert.equal(f.draft.candidates.flatMap(c=>Object.values(c.scoring.criteria)).filter(r=>r.sourceIds.length===1&&r.sourceIds[0]===null).length,35);
 const coverage=sealedWriterCoverage(f.draft,f.options);
 assert.equal(coverage.valid,false);assert.ok(coverage.reasons.some(r=>/candidate.*source IDs/i.test(r)));
 assert.ok(completedAssessmentReasons(f.draft,f.context,f.manifest).some(r=>/candidate.*source IDs/i.test(r)));
 assert.throws(()=>acceptCheckerOutput({outcome:'completed',reason:'Synthetic replay of the frozen malformed no-post envelope.',manifest:f.manifest},f.draft,f.context,{expectedDraftSha256:f.context.draftSha256,expectedContextSha256:sha256(stableJSON(f.context))}));
 assert.equal(stableJSON(f),before);
});

test('traceable synthetic binding corrections preserve the same below-threshold no-post result',async()=>{
 const original=await fixture(),f=correctedTestCopy(structuredClone(original));
 assert.equal(sealedWriterCoverage(f.draft,f.options).valid,true);
 assert.deepEqual(completedAssessmentReasons(f.draft,f.context,f.manifest),[]);
 assert.equal(acceptCheckerOutput({outcome:'completed',reason:'Synthetic valid no-post binding control.',manifest:f.manifest},f.draft,f.context,{expectedDraftSha256:f.context.draftSha256,expectedContextSha256:sha256(stableJSON(f.context))}),f.manifest);
 assert.deepEqual(f.draft.candidates.map(c=>Object.values(c.scoring.criteria).map(r=>r.value)),original.draft.candidates.map(c=>Object.values(c.scoring.criteria).map(r=>r.value)));
 assert.deepEqual(f.draft.posts,[]);assert.equal(f.manifest.completedAssessment.decision,'no_supported_candidate');
});

test('historical receipts retain their old meaning while new sealed contexts cannot be downgraded',async()=>{
 const old=await fixture({strict:false}),before=stableJSON(old);
 assert.deepEqual(completedAssessmentReasons(old.draft,old.context,old.manifest),[]);
 assert.equal(stableJSON(old),before);
 for(const version of [null,0,2,'1']){
  const f=correctedTestCopy(await fixture());f.context.candidateScoringVersion=version;bind(f);
  assert.ok(completedAssessmentReasons(f.draft,f.context,f.manifest).some(r=>/version is unsupported/.test(r)));
 }
 const f=correctedTestCopy(await fixture()),contextHash=sha256(stableJSON(f.context));delete f.context.candidateScoringVersion;
 assert.throws(()=>acceptCheckerOutput({outcome:'completed',reason:'Synthetic downgrade attempt.',manifest:f.manifest},f.draft,f.context,{expectedDraftSha256:f.context.draftSha256,expectedContextSha256:contextHash}),/changed.*frozen/);
});

test('null, missing, duplicate, unknown and other-candidate criterion references all fail closed',async()=>{
 for(const kind of ['null','missing','duplicate','unknown','other-candidate','missing-attachments']){
  const f=correctedTestCopy(await fixture()),candidate=f.draft.candidates[0],rating=candidate.scoring.criteria.ease;
  if(kind==='null')rating.sourceIds=[null];
  if(kind==='missing')delete rating.sourceIds;
  if(kind==='duplicate')rating.sourceIds=[candidate.sourceIds[0],candidate.sourceIds[0]];
  if(kind==='unknown')rating.sourceIds=['unattached-source'];
  if(kind==='other-candidate')rating.sourceIds=[f.context.sources.find(s=>!candidate.sourceIds.includes(s.id)).id];
  if(kind==='missing-attachments')delete candidate.sourceIds;
  bind(f);
  assert.equal(sealedWriterCoverage(f.draft,f.options).valid,false,kind);
  assert.ok(completedAssessmentReasons(f.draft,f.context,f.manifest).length,kind);
 }
});

test('the writer advisory reports invalid bindings and accepts explicit attached IDs without changing files',async t=>{
 const f=await fixture(),root=await mkdtemp(path.join(os.tmpdir(),'wys-score-binding-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const paths=[];
 for(const [directory,record] of [['research',f.research],['learning-selection',f.selection],['drafts',f.draft]]){
  await mkdir(path.join(root,'data',directory),{recursive:true});const file=path.join(root,'data',directory,runId+'.json');paths.push(file);await writeFile(file,stableJSON(record));
 }
 const before=await Promise.all(paths.map(file=>readFile(file,'utf8'))),env={EXPECTED_RESEARCH_SHA:f.options.expectedResearchSha256,EXPECTED_LEARNING_SELECTION_SHA:f.options.expectedSelectionSha256};
 assert.equal((await checkWriterCoverage({runId,root,env})).valid,false);
 assert.deepEqual(await Promise.all(paths.map(file=>readFile(file,'utf8'))),before);
 correctedTestCopy(f);await writeFile(paths[2],stableJSON(f.draft));
 assert.equal((await checkWriterCoverage({runId,root,env})).valid,true);
});
