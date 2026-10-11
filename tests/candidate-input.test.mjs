import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {candidateHistory,writerResearchView} from '../lib/candidate-input.mjs';
import {sha256,stableJSON} from '../lib/storage.mjs';

test('writer view keeps selected discovery and primary evidence without rewriting the immutable snapshot',()=>{
 const snapshot={sources:[{id:'discovery',text:'Launch title'},{id:'primary',text:'Documented operation'},{id:'unrelated',text:'Irrelevant news'}],enrichment:{status:'completed',observations:[{productUrl:'https://example.com/tool',originSourceIds:['discovery'],evidenceIds:['primary']}]}};
 const before=stableJSON(snapshot),view=writerResearchView(snapshot);assert.deepEqual(view.sources.map(row=>row.id),['discovery','primary']);assert.equal(stableJSON(snapshot),before);assert.equal(view.enrichment,snapshot.enrichment);assert.equal(view.writerView.originalSourceCount,3);assert.equal(writerResearchView({...snapshot,enrichment:{status:'not_requested'}}).sources.length,3);
});
test('recent writer memory distinguishes provisional ratings and refuses an altered draft',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'wys-candidate-memory-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const runId='loop-999-1',draft={runId,candidates:[{title:'A documented task',productUrl:'https://example.com/tool',reason:'Unproved demand.',scoring:{criteria:{profit:{value:4,reason:'Hypothesis: demand unproved.'}}}}],posts:[]},run={id:runId,assessmentOutcome:'completed',operationalFailures:[],checkedAssessment:{completed:true,completedAt:'2026-10-11T16:00:00.000Z',draftSha256:sha256(stableJSON(draft))}};
 for(const [directory,record] of [['runs',run],['drafts',draft]]){await fs.mkdir(path.join(root,'data',directory),{recursive:true});await fs.writeFile(path.join(root,'data',directory,runId+'.json'),JSON.stringify(record));}
 let history=await candidateHistory(root,'2026-10-11T17:00:00.000Z');assert.equal(history.rejections.length,1);assert.match(history.rejections[0].ratingStatus,/provisional/);assert.equal(history.rejections[0].primaryEvidenceFetched,false);assert.deepEqual(history.recentAssessments,[]);
 draft.candidates[0].reason='Altered';await fs.writeFile(path.join(root,'data','drafts',runId+'.json'),JSON.stringify(draft));assert.equal((await candidateHistory(root,'2026-10-11T17:00:00.000Z')).rejections.length,0);assert.equal((await candidateHistory(root,'2026-10-12T17:00:00.000Z')).rejections.length,0);
});
