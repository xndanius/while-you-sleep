import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemandContext,demandContextHash,demandContextReasons,demandEvidenceReasons,demandApprovalReasons} from '../lib/demand.mjs';

const at='2026-10-19T10:00:00.000Z';
function fixture(){
 const definitions=[['a','public_sector','public_tender'],['b','professional_services','paid_job'],['c','local_services','community_request']];
 const registrySources=definitions.map(([id,segment,kind])=>({id:'feed-'+id,url:`https://public.example.org/${id}/feed`,kind:'official',role:'demand',demandKind:kind,segments:[segment]}));
 const sources=definitions.map(([id,segment,kind])=>({id:'demand-'+id,url:`https://public.example.org/${id}/notice`,text:'The requested service includes organizing and cataloguing existing office records.',role:'demand',registrySourceId:'feed-'+id,segment,demandKind:kind,demandMetadataVersion:1,verifiedAt:at,demandEvidence:{status:'active',paid:true}}));
 const builders=Array.from({length:3},(_,i)=>({id:'builder-'+i,url:`https://builder.example.org/tool-${i}`,text:'This documented implementation extracts fields from a public example and prepares a structured draft for a human to review.',role:'building',verifiedAt:at}));
 const authorizedSources=sources.map(source=>({sourceId:source.id,registrySourceId:source.registrySourceId,url:source.url,role:'demand',demandKind:source.demandKind,segments:[source.segment]}));
 const recoveryBatchPolicy={version:1,mode:'repair',widened:true,researchSha256:'a'.repeat(64),maxLeads:10,maxPerDemandSource:3,minBuilderLeads:3,leadAssignments:[...builders.map(builder=>({productUrl:builder.url,segment:'public_sector',demandSourceId:'demand-a',registrySourceId:'feed-a',kind:'builder'})),...sources.slice(1).map(source=>({productUrl:source.url,segment:source.segment,demandSourceId:source.id,registrySourceId:source.registrySourceId,kind:'demand'}))]};
 const demandContext=createDemandContext({registrySources,authorizedSources,recoveryBatchPolicy});
 const context={createdAt:at,demandContractVersion:1,demandContext,demandContextSha256:demandContextHash(demandContext),sources:[...sources,...builders]};
 const candidate={id:'new',title:'Organize public office records',productUrl:builders[0].url,segment:'public_sector',whoPays:'Hypothesis: public office administrators who organise paper records.',sourceIds:['demand-a','builder-0'],demandEvidence:{kind:'public_tender',sourceIds:['demand-a'],chore:'Organize and catalogue existing office records.',evidenceQuote:'organizing and cataloguing existing office records'}};
 const check={demandCheck:{demandContextSha256:context.demandContextSha256,supported:true,segment:candidate.segment,sourceId:'demand-a',kind:'public_tender',chore:candidate.demandEvidence.chore,evidenceQuote:candidate.demandEvidence.evidenceQuote,reason:'The active public notice asks for the stated chore. The proposed AI service and payer remain hypotheses.',noPersonalData:true}};
 return{registrySources,authorizedSources,sources,builders,context,candidate,check};
}
function rehash(context){context.demandContextSha256=demandContextHash(context.demandContext);return context;}

test('a sealed mixed context can contain several exact segments and three corroborated builder leads',()=>{
 const {context,candidate,check}=fixture();assert.equal(context.demandContext.selectedSegment,null);assert.deepEqual(demandContextReasons(context),[]);assert.deepEqual(demandEvidenceReasons(candidate,context.sources,{required:true,context}),[]);assert.deepEqual(demandApprovalReasons(check,candidate,context),[]);
 const source=context.sources.find(source=>source.id==='demand-b'),direct={...candidate,productUrl:source.url,segment:source.segment,sourceIds:[source.id],demandEvidence:{...candidate.demandEvidence,kind:source.demandKind,sourceIds:[source.id]}};
 assert.deepEqual(demandEvidenceReasons(direct,context.sources,{required:true,context}),[]);
});
test('mixed policy cannot change its constants, feed cap, builder minimum, authority or unique identities',()=>{
 const changes=[
  p=>p.version=2,p=>p.mode='normal',p=>p.widened=false,p=>p.researchSha256='missing',p=>p.maxLeads=11,p=>p.maxPerDemandSource=4,p=>p.minBuilderLeads=2,p=>p.extra=true,
  p=>p.leadAssignments=p.leadAssignments.slice(1),p=>p.leadAssignments.push({...p.leadAssignments[0]}),p=>p.leadAssignments[0].registrySourceId='feed-b',p=>p.leadAssignments[0].demandSourceId='demand-b',p=>p.leadAssignments[0].segment='ai_software_builders',p=>p.leadAssignments[3].productUrl='https://unassigned.example.org/',
  p=>p.leadAssignments.push({productUrl:'https://public.example.org/a/notice',segment:'public_sector',demandSourceId:'demand-a',registrySourceId:'feed-a',kind:'demand'}),
 ];
 for(const change of changes){const {context}=fixture();change(context.demandContext.recoveryBatchPolicy);rehash(context);assert.ok(demandContextReasons(context).some(reason=>reason.includes('Mixed recovery')));}
 const {context}=fixture();context.demandContext.selectedSegment='public_sector';rehash(context);assert.ok(demandContextReasons(context).length);
});
test('writer cannot add a lead, relabel a segment, substitute a demand signal or omit the builder payer',()=>{
 const {context,candidate}=fixture();
 for(const change of [{productUrl:'https://unselected.example.org/tool'},{productUrl:'https://public.example.org/a/notice'},{segment:'professional_services'},{whoPays:undefined},{whoPays:'Public office administrators will pay for this service.'},{demandEvidence:{...candidate.demandEvidence,sourceIds:['demand-b'],kind:'paid_job'}}])assert.ok(demandEvidenceReasons({...candidate,...change},context.sources,{required:true,context}).length);
 assert.deepEqual(demandEvidenceReasons({...candidate,whoPays:'Hypothesis: small businesses providing bookkeeping services.'},context.sources,{required:true,context}),[],'The independent checker, not a broad payer-word blacklist, decides whether the customer hypothesis fits the assigned demand.');
 const ordinary=createDemandContext({registrySources:context.demandContext.registrySources,authorizedSources:context.demandContext.authorizedSources});const normal={...context,demandContext:ordinary,demandContextSha256:demandContextHash(ordinary)};
 assert.ok(demandEvidenceReasons(candidate,normal.sources,{required:true,context:normal}).some(reason=>reason.includes('identity')));
 const tampered=fixture();tampered.context.demandContext.recoveryBatchPolicy.leadAssignments[0].productUrl='https://unselected.example.org/tool';assert.ok(demandContextReasons(tampered.context).length);
});
test('a builder still needs its exact fresh independent implementation page and literal fresh demand',()=>{
 for(const mode of ['builder-old','builder-detached','builder-missing','demand-old','demand-unquoted','checker-refuses']){
  const {context,candidate,check}=fixture();if(mode==='builder-old')context.sources.find(source=>source.id==='builder-0').verifiedAt='2020-01-01T00:00:00Z';
  if(mode==='builder-detached')candidate.sourceIds=['demand-a'];if(mode==='builder-missing')context.sources=context.sources.filter(source=>source.id!=='builder-0');if(mode==='demand-old')context.sources.find(source=>source.id==='demand-a').verifiedAt='2020-01-01T00:00:00Z';if(mode==='demand-unquoted')candidate.demandEvidence.evidenceQuote='A fictional source establishes paying AI customers.';if(mode==='checker-refuses')check.demandCheck.supported=false;
  assert.ok(demandApprovalReasons(check,candidate,context).length,mode);
 }
});
test('a fresh demand row at the builder URL cannot impersonate independent implementation evidence',()=>{
 for(const mode of ['demand-role','demand-flag','demand-notice','demand-authority','no-implementation-role']){
  const {context,candidate,check}=fixture(),builder=context.sources.find(source=>source.id==='builder-0');
  if(mode==='demand-role')builder.role='demand';if(mode==='demand-flag')builder.demand=true;if(mode==='demand-notice')builder.evidenceKind='demand-notice';if(mode==='demand-authority')context.demandContext.authorizedSources.push({sourceId:builder.id,registrySourceId:'feed-a',url:builder.url,role:'demand',demandKind:'public_tender',segments:['public_sector']});if(mode==='no-implementation-role')delete builder.role;
  rehash(context);check.demandCheck.demandContextSha256=context.demandContextSha256;assert.ok(demandApprovalReasons(check,candidate,context).some(reason=>reason.includes('implementation evidence')),mode);
 }
 const {context,candidate,check}=fixture(),builder=context.sources.find(source=>source.id==='builder-0');delete builder.role;builder.enriched=true;builder.evidenceKind='github-readme';assert.deepEqual(demandApprovalReasons(check,candidate,context),[]);
});
test('mixed recovery retains the normal fixed publication mix limits',()=>{
 const {context,candidate,check}=fixture();context.demandContext.posts=Array.from({length:6},(_,i)=>({id:'old-'+i,publishedAt:at,segment:'public_sector',classification:'verified_demand',demandVerified:true}));rehash(context);check.demandCheck.demandContextSha256=context.demandContextSha256;
 assert.deepEqual(demandContextReasons(context),[]);assert.ok(demandApprovalReasons(check,candidate,context).some(reason=>reason.includes('Segment diversity held')));
});
