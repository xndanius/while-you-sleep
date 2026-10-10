import test from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { candidateIdentity, sha256, stableJSON, dataPath } from '../lib/storage.mjs';
import { deterministicCheck, checkApproval, contentHash, verifyPublishedPost } from '../lib/validation.mjs';
import { renderCard } from '../lib/card.mjs';
import { validateURL } from '../lib/research.mjs';
import { localParts, schedule } from '../lib/config.mjs';

const source={id:'source-1',url:'https://example.com/product',text:'The product reads uploaded receipts and extracts structured fields for review. It can export the parsed fields as CSV. Human approval is required before records are sent.'};
const post={id:candidateIdentity({productUrl:source.url}),candidateId:candidateIdentity({productUrl:source.url}),title:'A receipt review assistant',promise:'Turn receipts into a draft for human review.',whatItIs:'An example of receipt extraction, with a proposed small service.',whoPays:'Customer hypothesis: small teams with receipt admin.',loop:['Upload a receipt','Extract a draft','Ask a human to approve','Export reviewed fields'],evidence:'The source describes extraction and CSV export.',uncertainty:'The source does not prove customers or revenue. Human review remains.',first24Hours:['Choose one receipt format.','Extract sample fields.','Build a review screen.'],sourceIds:['source-1'],productUrl:source.url};
function approvalFixtures(){
  const draft={runId:'test-run',posts:[structuredClone(post)]};
  const context={runId:'test-run',draftSha256:sha256(stableJSON(draft)),sourceSnapshotSha256:sha256(stableJSON([source])),sources:[source],deterministicResults:[{postId:post.id,pass:true,reasons:[]}]};
  const checks=[{postId:post.id,pass:true,reasons:[],claimChecks:[{claim:'Receipt extraction exists.',supported:true,sourceId:source.id,evidenceQuote:'reads uploaded receipts and extracts structured fields'},{claim:'CSV export exists.',supported:true,sourceId:source.id,evidenceQuote:'export the parsed fields as CSV'},{claim:'Review remains manual.',supported:true,sourceId:source.id,evidenceQuote:'Human approval is required before records are sent'}]}];
  return {draft,context,manifest:{runId:'test-run',draftSha256:context.draftSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,checks}};
}

test('valid post passes; duplicate product and unknown source fail',()=>{
  assert.deepEqual(deterministicCheck(post,[source]),[]);
  assert.ok(deterministicCheck(post,[source],[post]).some(x=>x.includes('already published')));
  assert.ok(deterministicCheck({...post,sourceIds:['invented']},[source]).some(x=>x.includes('unknown')));
  assert.ok(deterministicCheck({...post,productUrl:'https://example.org/invented'},[source]).some(x=>x.includes('not present')));
});
test('approval binds exact draft and verified snapshot; unsupported quotes cannot publish',()=>{
  const {draft,context,manifest}=approvalFixtures();assert.equal(checkApproval(draft,context,manifest)[0].pass,true);
  const stale=structuredClone(manifest);stale.draftSha256='tampered';assert.equal(checkApproval(draft,context,stale)[0].pass,false);
  const wrongSource=structuredClone(manifest);wrongSource.sourceSnapshotSha256='tampered';assert.equal(checkApproval(draft,context,wrongSource)[0].pass,false);
  const fabricated=structuredClone(manifest);fabricated.checks[0].claimChecks[0].evidenceQuote='It has a thousand paying customers';assert.equal(checkApproval(draft,context,fabricated)[0].pass,false);
  const unsupported=structuredClone(manifest);unsupported.checks[0].claimChecks[0].supported=false;assert.equal(checkApproval(draft,context,unsupported)[0].pass,false);
});
test('published hash catches content tampering and missing checker provenance',()=>{
  const record={...post,publishedAt:new Date().toISOString(),checker:{passed:true,checkerRunId:'independent'}};record.contentSha256=contentHash(record);
  assert.equal(verifyPublishedPost(record),true);
  assert.equal(verifyPublishedPost({...record,title:'Changed after approval'}),false);
  assert.equal(verifyPublishedPost({...record,checker:{passed:false}}),false);
});
test('public source fetch rejects private addresses and non-HTTPS before any fetch',async()=>{
  await assert.rejects(validateURL('http://example.com'));
  await assert.rejects(validateURL('https://127.0.0.1'));
  await assert.rejects(validateURL('https://169.254.169.254/latest/meta-data'));
  await assert.rejects(validateURL('https://10.0.0.1'));
  await assert.rejects(validateURL('https://localhost'));
});
test('card is real JPEG with required image dimensions',()=>{
  const data=renderCard(post);assert.equal(data[0],0xff);assert.equal(data[1],0xd8);
  const decoded=jpeg.decode(data);assert.equal(decoded.width,1080);assert.equal(decoded.height,1350);
});
test('cadence remains in Vilnius across winter and summer offsets',()=>{
  assert.equal(localParts(new Date('2026-10-10T05:00:00Z')).hour,8);
  assert.equal(localParts(new Date('2026-11-10T06:00:00Z')).hour,8);
  assert.equal(schedule(new Date('2026-10-10T04:59:00Z')).nextPublicationAt,'2026-10-10T05:07:00.000Z');
  assert.equal(schedule(new Date('2026-11-10T05:59:00Z')).nextPublicationAt,'2026-11-10T06:07:00.000Z');
});
test('record paths cannot escape public history directories',()=>{
  assert.throws(()=>dataPath('posts','../../secret'));
  assert.throws(()=>dataPath('../secrets','record'));
});
