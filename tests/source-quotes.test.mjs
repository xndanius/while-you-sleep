import test from 'node:test';
import assert from 'node:assert/strict';
import {plainText} from '../lib/research.mjs';
import {checkApproval} from '../lib/validation.mjs';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {repairFeedback} from '../scripts/save-first-check.mjs';

function paganelFixture(){
  // Short spans from the public HN snapshot in loop-38032602041-1.
  const source={id:'hn-paganel',text:"where it&#x27;s going complete &#x27;migration receipt.&#x27; the root doesn&#x27;t match Right now, Paganel only natively supports MySQL and PostgreSQL."};
  const draft={runId:'quote-regression',posts:[{id:'paganel',sourceIds:[source.id]}]};
  const context={runId:draft.runId,draftSha256:sha256(stableJSON(draft)),sourceSnapshotSha256:sha256(stableJSON([source])),sources:[source],deterministicResults:[{postId:'paganel',pass:true,reasons:[]}]};
  const manifest={runId:draft.runId,draftSha256:context.draftSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,checks:[{postId:'paganel',pass:true,reasons:[],claimChecks:[
    {claim:'The migration config specifies a destination.',supported:true,sourceId:source.id,evidenceQuote:"where it's going"},
    {claim:'The migration produces a receipt.',supported:true,sourceId:source.id,evidenceQuote:"complete 'migration receipt.'"},
    {claim:'Verification compares the root.',supported:true,sourceId:source.id,evidenceQuote:"the root doesn't match"},
  ]}]};
  return {draft,context,manifest};
}

test('numeric HTML entities decode hexadecimal and decimal Unicode without changing visible text',()=>{
  assert.equal(plainText('<p>it&#x27;s and doesn&#39;t &#X1F680; &#128640; &#160; done</p>'),"it's and doesn't 🚀 🚀 done");
  assert.equal(plainText('&#xD800; &#55296; &#x110000; &#1114112; &#0; &#x0; &#999999999999999999999999;'),'&#xD800; &#55296; &#x110000; &#1114112; &#0; &#x0; &#999999999999999999999999;');
  assert.equal(plainText('&#xZZ; &#12oops; &unknown;'),'&#xZZ; &#12oops; &unknown;');
  assert.equal(plainText('<script>hidden</script><style>hidden</style><p>&quot;A&quot;&nbsp;&amp;&nbsp;&apos;B&apos; &#10; C</p>'),"\"A\" & 'B' C");
});

test('actual HN apostrophe entities match literal evidence while the paraphrased database heading stays rejected',()=>{
  const {draft,context,manifest}=paganelFixture();
  assert.equal(checkApproval(draft,context,manifest)[0].pass,true);
  manifest.checks[0].claimChecks.push({claim:'Supported database engines.',supported:true,sourceId:'hn-paganel',evidenceQuote:'Right now, it only natively supports MySQL and PostgreSQL.'});
  const result=checkApproval(draft,context,manifest)[0];
  assert.equal(result.pass,false);
  assert.ok(result.reasons.some(reason=>reason.includes('not present')));
  manifest.checks[0].claimChecks[3].evidenceQuote='Right now, Paganel only natively supports MySQL and PostgreSQL.';
  assert.equal(checkApproval(draft,context,manifest)[0].pass,true);
});

test('repair retains actual approvals and exposes quote failures despite raw checker pass:true',()=>{
  const {draft,context,manifest}=paganelFixture();
  assert.deepEqual(repairFeedback(draft,context,manifest).approvedPostIds,['paganel']);
  manifest.checks[0].claimChecks[0].evidenceQuote='where it will eventually go';
  const feedback=repairFeedback(draft,context,manifest);
  assert.deepEqual(feedback.approvedPostIds,[]);
  assert.deepEqual(feedback.repairPostIds,['paganel']);
  assert.equal(feedback.decisions[0].checkerPass,true);
  assert.equal(feedback.decisions[0].passed,false);
  assert.equal(feedback.decisions[0].quoteIssues[0].evidenceQuote,'where it will eventually go');
});

test('repair does not retain a raw approval with stale bindings or a deterministic rejection',()=>{
  const {draft,context,manifest}=paganelFixture();
  const stale={...manifest,draftSha256:'stale'};
  assert.deepEqual(repairFeedback(draft,context,stale).approvedPostIds,[]);
  context.deterministicResults[0]={postId:'paganel',pass:false,reasons:['Attached evidence source could not be re-fetched.']};
  const feedback=repairFeedback(draft,context,manifest);
  assert.deepEqual(feedback.approvedPostIds,[]);
  assert.ok(feedback.decisions[0].reasons.includes('Attached evidence source could not be re-fetched.'));
});
