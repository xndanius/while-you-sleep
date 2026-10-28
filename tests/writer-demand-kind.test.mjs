import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {sealedWriterCoverage} from '../lib/writer-coverage.mjs';

const runId='loop-40636986208-1',sourceId='bc3afc6e8c2a63bbd4b7ae01';
async function fixture(){
 const [draft,research,selection]=await Promise.all(['drafts','research','learning-selection'].map(directory=>readFile(new URL(`../data/${directory}/${runId}.json`,import.meta.url),'utf8').then(JSON.parse)));
 return {draft,research,selection};
}
const inspect=f=>sealedWriterCoverage(f.draft,{runId,research:f.research,selection:f.selection,expectedResearchSha256:sha256(stableJSON(f.research)),expectedSelectionSha256:sha256(stableJSON(f.selection))});
const candidate=f=>f.draft.candidates.find(row=>row.demandEvidence.sourceIds.includes(sourceId));

test('frozen 40636986208 reports the manual-service relabel before checker access without rewriting history',async()=>{
 const f=await fixture(),before=stableJSON(f),row=candidate(f);
 assert.equal(row.demandEvidence.kind,'manual_service');
 assert.equal(f.research.sources.find(source=>source.id===sourceId).demandKind,'community_request');
 const report=inspect(f);
 assert.equal(report.valid,false);assert.equal(report.assignedCount,8);assert.equal(report.coveredAssignedCount,8);
 assert.deepEqual(report.missing,[]);
 assert.deepEqual(report.bindingMismatches,[{list:'candidates',index:f.draft.candidates.indexOf(row),productUrl:row.productUrl,field:'demandEvidence.kind'}]);
 assert.equal(report.coverageOnly,true);assert.equal(stableJSON(f),before);
 assert.match(report.reasons.join(' '),/signal kind/);
});

test('request and complaint source kinds are copied exactly, and missing or swapped kinds are refused',async()=>{
 for(const kind of ['community_request','community_complaint']){
  const f=await fixture(),row=candidate(f),source=f.research.sources.find(value=>value.id===sourceId);
  // Synthetic metadata variants exercise the binding; real source records are
  // never modified and the kind supplies no new demand, score or approval.
  source.demandKind=kind;source.demandEvidence.kind=kind;row.demandEvidence.kind=kind;
  assert.equal(inspect(f).valid,true);
  for(const invalid of [undefined,'manual_service',kind==='community_request'?'community_complaint':'community_request']){
   const changed=structuredClone(f),item=candidate(changed);
   if(invalid===undefined)delete item.demandEvidence.kind;else item.demandEvidence.kind=invalid;
   const before=stableJSON(changed),report=inspect(changed);
   assert.equal(report.valid,false);assert.ok(report.bindingMismatches.some(value=>value.field==='demandEvidence.kind'));
   assert.equal(stableJSON(changed),before,'The read-only check never normalizes or auto-corrects evidence.');
  }
  const missing=structuredClone(f);delete candidate(missing).demandEvidence;
  assert.equal(inspect(missing).valid,false);
 }
});

test('writer prompt treats signal kind as source identity instead of proposed service type',async()=>{
 const prompt=await readFile(new URL('../.github/codex/prompts/writer.md',import.meta.url),'utf8');
 assert.match(prompt,/Copy demandEvidence\.kind from the exact attached demand source's demandKind/);
 assert.match(prompt,/community_request remains community_request even if you propose manual work/);
 assert.match(prompt,/binding \(including demandEvidence\.kind\)/);
});
