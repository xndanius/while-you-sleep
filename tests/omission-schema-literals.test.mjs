import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {checkerOutputSchema,acceptCheckerOutput} from '../lib/checker-output.mjs';
import {validateOmittedCandidateRepair} from '../lib/omitted-candidate-repair.mjs';
import {completedAssessmentReasons} from '../lib/validation.mjs';

async function fixture(number){
 const runId=`loop-${number}-1`;
 const [draft,context]=await Promise.all(['drafts','check-context'].map(folder=>readFile(new URL(`../data/${folder}/${runId}.json`,import.meta.url),'utf8').then(JSON.parse)));
 const source=context.sources.find(row=>row.id==='fb490f8a02d216cea38fd638');
 const assignment=context.demandContext.discussionBatchPolicy.leadAssignments.find(row=>row.demandSourceId===source.id);
 const record={schema:3,kind:'omitted_candidate',runId,contextSha256:sha256(stableJSON(context)),rulesSha256:context.rulesSha256,draftSha256:context.draftSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,policySha256:context.scoringPolicy.policySha256,demandContextSha256:context.demandContextSha256,omission:{...assignment,chore:'Inspect the supplied bounded research-tool description.',evidenceQuote:source.text,reason:'Synthetic contract test only; this is not an assertion that the exclusion was wrong.',quoteAnchorSha256:sha256(source.text)}};
 return {draft,context,source,record};
}
function assertPortableLiterals(node){
 if(!node||typeof node!=='object')return;
 if(Array.isArray(node.enum))for(const value of node.enum)if(typeof value==='string')assert.doesNotMatch(value,/["\\\x00-\x1f]/,'Untrusted quoted prose cannot become a strict schema literal.');
 if(typeof node.const==='string')assert.doesNotMatch(node.const,/["\\\x00-\x1f]/);
 for(const child of Object.values(node))if(Array.isArray(child))child.forEach(assertPortableLiterals);else assertPortableLiterals(child);
}

test('both exact failed checker inputs produce portable schemas without editing the quoted source',async()=>{
 for(const run of ['40713778803','40722846454']){
  const f=await fixture(run),before=stableJSON({draft:f.draft,context:f.context});
  assert.match(f.source.text,/"git for Law"/);
  const schema=checkerOutputSchema(f.draft,f.context,{allowOmittedCandidateRepair:true});
  assert.ok(schema.properties.outcome.enum.includes('needs_repair'));
  assertPortableLiterals(schema);
  assert.equal(JSON.stringify(schema).includes('git for Law'),false);
  assert.ok(JSON.stringify(schema).includes(sha256(f.source.text)));
  assert.equal(stableJSON({draft:f.draft,context:f.context}),before);
 }
});

test('schema 3 accepts an exact hash-bound quoted anchor without granting a completed assessment',async()=>{
 const f=await fixture('40722846454'),record=JSON.parse(JSON.stringify(f.record));
 const response={outcome:'needs_repair',reason:'Synthetic validation of a quoted anchor.',manifest:null,repairFeedback:record};
 assert.equal(validateOmittedCandidateRepair(record,f.draft,f.context,{allowInitial:true}),record);
 assert.equal(acceptCheckerOutput(response,f.draft,f.context,{allowOmittedCandidateRepair:true}),record);
 assert.ok(completedAssessmentReasons(f.draft,f.context,record).length);
 assert.equal(record.completedAssessment,undefined);assert.equal(record.checks,undefined);
 assert.throws(()=>validateOmittedCandidateRepair(record,f.draft,f.context),/initial checker phase/);
});

test('anchor text, hash, identity and phase remain strict; partial or escaped substitutes are refused',async()=>{
 const f=await fixture('40722846454');
 for(const change of [
  row=>row.omission.evidenceQuote=row.omission.evidenceQuote.replaceAll('"',''),
  row=>row.omission.evidenceQuote=row.omission.evidenceQuote.replaceAll('"','\\"'),
  row=>row.omission.evidenceQuote='This is similar in spirit to "git for Law"',
  row=>row.omission.quoteAnchorSha256='0'.repeat(64),
  row=>row.omission.demandSourceId='forged',
  row=>row.contextSha256='0'.repeat(64),
  row=>delete row.omission.quoteAnchorSha256,
 ]){
  const record=structuredClone(f.record);change(record);
  assert.throws(()=>validateOmittedCandidateRepair(record,f.draft,f.context,{allowInitial:true}));
 }
 const legacy=structuredClone(f.record);legacy.schema=1;delete legacy.omission.quoteAnchorSha256;
 assert.equal(validateOmittedCandidateRepair(legacy,f.draft,f.context,{allowInitial:true}),legacy,'Historical schema 1 remains verifiable.');
});

test('literal compiler safety covers quotes, backslashes and Unicode without rewriting source evidence',async()=>{
 const f=await fixture('40722846454');
 f.source.text='The proposed tool compares "draft" and "final" using a literal \\ marker for naïve review.';
 f.source.taskExcerpts=[f.source.text];
 f.context.sourceSnapshotSha256=sha256(stableJSON(f.context.sources));
 const schema=checkerOutputSchema(f.draft,f.context,{allowOmittedCandidateRepair:true});
 assertPortableLiterals(schema);
 assert.ok(JSON.stringify(schema).includes(sha256(f.source.text)));
 assert.equal(f.source.text.includes('"draft"'),true);
 assert.equal(f.source.text.includes('\\'),true);
});
