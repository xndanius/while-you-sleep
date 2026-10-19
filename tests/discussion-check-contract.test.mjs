import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemandContext,demandContextHash,demandContextReasons,demandEvidenceReasons,demandApprovalReasons} from '../lib/demand.mjs';

function fixture(){
 const at='2026-10-19T12:00:00.000Z',source={id:'post-one',url:'https://forum.example.org/t/task/1',text:'Each week we manually compare supplier invoices with delivery records. Is there a tool to help?',role:'demand',registrySourceId:'forum-one',demandKind:'community_request',demandMetadataVersion:1,verifiedAt:at};
 const registrySources=[{id:'forum-one',url:'https://forum.example.org/latest.rss',kind:'discourse-discussion',role:'demand',demandKind:'community_request',segments:['ecommerce']}],authorizedSources=[{sourceId:source.id,registrySourceId:source.registrySourceId,url:source.url,role:'demand',demandKind:source.demandKind,segments:['ecommerce']}];
 const discussionBatchPolicy={version:1,maxLeads:10,maxPerDemandSource:3,postIsDemand:true,researchSha256:'a'.repeat(64),leadAssignments:[{productUrl:source.url,segment:'ecommerce',kind:'discussion',demandSourceId:source.id,registrySourceId:source.registrySourceId}]};
 const demandContext=createDemandContext({registrySources,authorizedSources,discussionBatchPolicy}),context={createdAt:at,demandContractVersion:1,demandContext,demandContextSha256:demandContextHash(demandContext),sources:[source]};
 const candidate={title:'Compare supplier invoices',productUrl:source.url,segment:'ecommerce',sourceIds:[source.id],demandEvidence:{kind:'community_request',sourceIds:[source.id],chore:'Compare invoices with delivery records.',evidenceQuote:'Each week we manually compare supplier invoices with delivery records.'}};
 const check={demandCheck:{demandContextSha256:context.demandContextSha256,supported:true,segment:candidate.segment,sourceId:source.id,kind:source.demandKind,chore:candidate.demandEvidence.chore,evidenceQuote:candidate.demandEvidence.evidenceQuote,reason:'The discussion establishes the recurring chore; the payer and student service remain hypotheses.',noPersonalData:true}};
 return {source,context,candidate,check};
}
test('one sealed discussion post is sufficient demand authority without job or builder corroboration',()=>{
 const {context,candidate,check}=fixture();assert.deepEqual(demandContextReasons(context),[]);assert.deepEqual(demandEvidenceReasons(candidate,context.sources,{required:true,context}),[]);assert.deepEqual(demandApprovalReasons(check,candidate,context),[]);
 for(const mutation of [{productUrl:'https://tool.example.org/'},{segment:'education'},{demandEvidence:{...candidate.demandEvidence,evidenceQuote:'Everyone has already bought the AI service.'}}])assert.ok(demandEvidenceReasons({...candidate,...mutation},context.sources,{required:true,context}).length);
});
test('discussion source cap, exact post and exclusive policy stay fail closed',()=>{
 for(const change of [p=>p.maxPerDemandSource=4,p=>p.postIsDemand=false,p=>p.leadAssignments[0].kind='builder',p=>p.leadAssignments[0].productUrl='https://other.example.org/']){
  const {context}=fixture();change(context.demandContext.discussionBatchPolicy);context.demandContextSha256=demandContextHash(context.demandContext);assert.ok(demandContextReasons(context).length);
 }
});
test('provider evidence needs an independently verified original capture within eight hours',()=>{
 const {source,context,candidate,check}=fixture();source.providerEvidence={provider:'apify',platform:'reddit',definitionId:source.registrySourceId,receiptId:'capture-one',poolHash:'b'.repeat(64),postHash:'c'.repeat(64),capturedAt:'2026-10-19T05:00:00Z'};source.providerProofVerified=true;source.livePostRefetched=false;
 assert.deepEqual(demandApprovalReasons(check,candidate,context),[]);
 source.providerProofVerified=false;assert.ok(demandApprovalReasons(check,candidate,context).length);source.providerProofVerified=true;source.providerEvidence.capturedAt='2026-10-19T03:00:00Z';assert.ok(demandApprovalReasons(check,candidate,context).length);
 source.providerEvidence.capturedAt='2026-10-19T13:00:00Z';assert.ok(demandApprovalReasons(check,candidate,context).length);
});
