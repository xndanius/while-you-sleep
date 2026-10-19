import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {completedAssessmentReasons} from '../lib/validation.mjs';
import {assessmentEvidenceReasons} from '../lib/evidence-contract.mjs';
import {acceptCheckerOutput} from '../lib/checker-output.mjs';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {createDemandContext,demandContextHash} from '../lib/demand.mjs';
import {DISCUSSION_PROVIDER_CATALOG,makeDiscussionSource} from '../lib/discussion-sources.mjs';
const read=async file=>JSON.parse(await readFile(new URL('../'+file,import.meta.url),'utf8'));
async function fixture(){const id='loop-39266657537-1';return {draft:await read(`data/drafts/${id}.json`),context:await read(`data/check-context/${id}.json`),response:await read('tests/fixtures/discussion-39266657537-checker-response.json')};}
function rebind(context,response){
 if(context.demandContext){context.demandContext.registrySha256=sha256(stableJSON(context.demandContext.registrySources));context.demandContextSha256=demandContextHash(context.demandContext);}
 context.sourceSnapshotSha256=sha256(stableJSON(context.sources));response.manifest.sourceSnapshotSha256=context.sourceSnapshotSha256;
 Object.assign(response.manifest.completedAssessment,{contextSha256:sha256(stableJSON(context)),sourceSnapshotSha256:context.sourceSnapshotSha256});
}
test('the actual ten-post discussion refusal accepts short authenticated evidence without publishing or rewriting history',async()=>{
 const {draft,context,response}=await fixture();assert.equal(draft.posts.length,0);assert.equal(context.sources.length,10);assert.equal(Math.min(...context.sources.map(s=>s.text.length)),45);assert.equal(context.sources.filter(s=>s.text.length<100).length,6);
 assert.deepEqual(assessmentEvidenceReasons(context),[]);assert.deepEqual(completedAssessmentReasons(draft,context,response.manifest),[]);
 const accepted=acceptCheckerOutput(response,draft,context,{expectedDraftSha256:sha256(stableJSON(draft)),expectedContextSha256:sha256(stableJSON(context))});assert.deepEqual(accepted.checks,[]);assert.equal(accepted.completedAssessment.decision,'no_supported_candidate');
 const original=await read('data/runs/loop-39266657537-1.json');assert.equal(original.assessmentOutcome,'unverified');assert.equal(original.status,'no_post_unverified');assert.deepEqual(original.published,[]);
});
test('missing, stale, forged or private discussion evidence cannot gain the short-excerpt exception even after fixture rebinding',async()=>{
 const changes=[
  c=>c.sources=[],c=>c.sources[0].text='',c=>{c.sources[0].text='short';c.sources[0].taskExcerpts=['short'];},c=>{c.sources[0].text='x'.repeat(201);c.sources[0].taskExcerpts=[c.sources[0].text];},
  c=>delete c.sources[0].verifiedAt,c=>{c.sources[0].verifiedAt=c.sources[0].fetchedAt=new Date(Date.parse(c.createdAt)-4*3600000).toISOString();},c=>{c.sources[0].verifiedAt=c.sources[0].fetchedAt=new Date(Date.parse(c.createdAt)+60000).toISOString();},
  c=>c.sources[0].id='forged-id',c=>c.sources[0].url='https://unadmitted.example.org/post',c=>delete c.demandContext.discussionBatchPolicy,
  c=>c.demandContext.authorizedSources=c.demandContext.authorizedSources.filter(row=>row.sourceId!==c.sources[0].id),c=>c.demandContext.discussionBatchPolicy.leadAssignments[0].segment='education',
  c=>{const s=c.sources.find(s=>s.text.length>=100);delete s.discussionMetadataVersion;delete s.demandMetadataVersion;delete s.evidenceKind;},
  c=>{c.sources[0].text='Contact person@example.invalid to discuss the customer invoice tool.';c.sources[0].taskExcerpts=[c.sources[0].text];},
  c=>{c.sources[0].providerEvidence={provider:'apify',platform:'reddit',definitionId:c.sources[0].registrySourceId,receiptId:'forged',poolHash:'a'.repeat(64),postHash:'b'.repeat(64),capturedAt:c.sources[0].fetchedAt};c.sources[0].providerProofVerified=true;c.sources[0].livePostRefetched=false;},
 ];
 for(const mutate of changes){const {draft,context,response}=await fixture();mutate(context);rebind(context,response);assert.ok(assessmentEvidenceReasons(context).length,mutate.toString());assert.throws(()=>acceptCheckerOutput(response,draft,context),undefined,mutate.toString());}
 const {draft,context,response}=await fixture(),pinned=sha256(stableJSON(context));context.sources[0].text+=' Invented source claim.';assert.throws(()=>acceptCheckerOutput(response,draft,context,{expectedContextSha256:pinned}),/trusted frozen/);
 assert.ok(assessmentEvidenceReasons({sources:[{text:'x'.repeat(99),verifiedAt:context.createdAt}]}).length);assert.deepEqual(assessmentEvidenceReasons({sources:[{text:'x'.repeat(100),verifiedAt:context.createdAt}]}),[]);
});
test('exact historical generic HN and mixed recovery assessments retain their original evidence contract',async()=>{
 for(const id of ['loop-38163159638-1','loop-39229018061-1']){const [draft,context,manifest]=await Promise.all(['drafts','check-context','checks'].map(folder=>read(`data/${folder}/${id}.json`)));assert.deepEqual(completedAssessmentReasons(draft,context,manifest),[],id);}
});
test('short provider evidence requires exact receipt-read metadata and its original eight-hour capture bound',()=>{
 const definition=DISCUSSION_PROVIDER_CATALOG.find(row=>row.platform==='reddit'),captured='2026-10-19T08:00:00.000Z',checked='2026-10-19T14:00:00.000Z';
 const source={...makeDiscussionSource(definition,{url:'https://www.reddit.com/comments/abc123',community:'Reddit r/smallbusiness',title:'A tool for daily invoice matching?',excerpt:'I need a tool to match customer invoices daily.',date:captured},{fetchedAt:captured}),verifiedAt:checked,enriched:true,evidenceKind:'discussion-post',evidenceFetch:{provider:true,complete:true},providerProofVerified:true,livePostRefetched:false,providerEvidence:{provider:'apify',platform:'reddit',definitionId:definition.id,receiptId:'apify-reddit-fixture',poolHash:'a'.repeat(64),postHash:'b'.repeat(64),capturedAt:captured}};
 const demandContext=createDemandContext({registrySources:[definition],authorizedSources:[{sourceId:source.id,registrySourceId:definition.id,url:source.url,role:'demand',demandKind:'community_request',segments:[source.segment]}],discussionBatchPolicy:{version:1,maxLeads:10,maxPerDemandSource:3,postIsDemand:true,researchSha256:'c'.repeat(64),leadAssignments:[{productUrl:source.url,segment:source.segment,kind:'discussion',demandSourceId:source.id,registrySourceId:definition.id}]}});
 const context={createdAt:checked,demandContractVersion:1,demandContext,demandContextSha256:demandContextHash(demandContext),sources:[source],sourceSnapshotSha256:sha256(stableJSON([source]))};assert.deepEqual(assessmentEvidenceReasons(context),[]);
 for(const change of [s=>s.providerProofVerified=false,s=>s.livePostRefetched=true,s=>s.providerEvidence.poolHash='not-a-proof',s=>s.evidenceFetch={maxBytes:2000000,complete:true},s=>{s.fetchedAt=s.providerEvidence.capturedAt='2026-10-19T05:00:00.000Z';}]){const changed=structuredClone(context);change(changed.sources[0]);changed.sourceSnapshotSha256=sha256(stableJSON(changed.sources));assert.ok(assessmentEvidenceReasons(changed).length);}
});
