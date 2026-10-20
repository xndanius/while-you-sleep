import {canonicalURL,hash,sha256,stableJSON} from './storage.mjs';
import {SEGMENTS} from './demand.mjs';
import {validateLearningSelection} from './learning.mjs';
import {DISCUSSION_SOURCE_CATALOG,DISCUSSION_PROVIDER_CATALOG,discussionPostURL,discussionEvidenceURL} from './discussion-sources.mjs';

// This protocol authenticates preparation diagnostics only. It supplies no
// fresh source authority, completed assessment, score, approval or reward.
export const CHECK_DIAGNOSTICS_MAX_BYTES=64*1024;
export const CHECK_DIAGNOSTIC_STAGES=Object.freeze(['parse','fetch','robots','body','url','dns','validation','provider']);
export const CHECK_DIAGNOSTIC_CODES_BY_STAGE=Object.freeze({
 parse:Object.freeze(['invalid_demand_source','invalid_discussion_source','no_eligible_demand_tasks','source_api_backoff','evidence_unavailable']),
 fetch:Object.freeze(['source_http_error','unreadable_type','source_redirect_limit','source_unavailable','evidence_unavailable']),
 robots:Object.freeze(['robots_unavailable','robots_invalid','robots_redirect_limit','robots_disallowed','evidence_unavailable']),
 body:Object.freeze(['empty_body','body_oversized','invalid_limit','evidence_unavailable']),
 url:Object.freeze(['invalid_url','nonpublic_url','evidence_unavailable']),
 dns:Object.freeze(['private_address','evidence_unavailable']),
 validation:Object.freeze(['evidence_unavailable']),
 provider:Object.freeze(['provider_unavailable','evidence_unavailable']),
});
export const CHECK_DIAGNOSTIC_CODES=Object.freeze([...new Set(Object.values(CHECK_DIAGNOSTIC_CODES_BY_STAGE).flat())]);
const catalog=[...DISCUSSION_SOURCE_CATALOG,...DISCUSSION_PROVIDER_CATALOG];
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sourceId=value=>typeof value==='string'&&/^[a-f0-9]{24}$/.test(value);
const runPattern=/^loop-[1-9]\d{0,15}-[1-9]\d{0,3}$/;
const phases=['initial','final'];
const iso=value=>typeof value==='string'&&value.length===24&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const tupleKeys=['productUrl','segment','kind','demandSourceId','registrySourceId'];
const receiptKeys=['schema','kind','runId','phase','draftSha256','researchSha256','selectionSha256','assignments','successfulSourceIds','failures'];
const failureKeys=['sourceId','productUrl','registrySourceId','adapterUrl','robotsUrl','stage','code','httpStatus','observedAt'];
const same=(a,b)=>stableJSON(a)===stableJSON(b);

export function sealedDiscussionAssignmentReasons({research,selection,runId,expectedResearchSha256,expectedSelectionSha256}={}){
 try{
  if(!runPattern.test(runId||'')||!hex(expectedResearchSha256)||!hex(expectedSelectionSha256)||!research||research.runId!==runId||sha256(stableJSON(research))!==expectedResearchSha256||!selection||validateLearningSelection(selection,{runId,expectedSha256:expectedSelectionSha256}).length||selection.selectionStrategy!=='discussion-first-v1'||!same(research.learningSelection,selection))return ['Check diagnostics lack the exact original sealed discussion research and selection.'];
  const batch=research.enrichment?.discussionBatch;
  if(!exact(batch,['version','maxLeads','maxPerDemandSource','postIsDemand','leadAssignments'])||batch.version!==1||batch.maxLeads!==10||batch.maxPerDemandSource!==3||batch.postIsDemand!==true||!Array.isArray(batch.leadAssignments)||batch.leadAssignments.length<1||batch.leadAssignments.length>10||!Array.isArray(research.sources))return ['Check diagnostics require the original bounded discussion assignment contract.'];
  const urls=new Set(),ids=new Set(),counts=new Map();
  for(const tuple of batch.leadAssignments){
   if(!exact(tuple,tupleKeys)||tuple.kind!=='discussion'||!SEGMENTS.includes(tuple.segment)||!selection.eligibleSegments.includes(tuple.segment)||!sourceId(tuple.demandSourceId)||!sourceId(tuple.registrySourceId)||!selection.demandSourceIds.includes(tuple.registrySourceId))return ['Check diagnostics contain an invalid or unselected sealed discussion tuple.'];
   const definition=catalog.find(row=>row.id===tuple.registrySourceId),sources=research.sources.filter(row=>row.id===tuple.demandSourceId),source=sources[0];
   if(!definition||!definition.segments.includes(tuple.segment)||typeof tuple.productUrl!=='string'||tuple.productUrl.length>2048||discussionPostURL(definition,tuple.productUrl)!==tuple.productUrl||tuple.demandSourceId!==hash(tuple.productUrl)||sources.length!==1||source.url!==tuple.productUrl||source.productUrl!==tuple.productUrl||source.registrySourceId!==tuple.registrySourceId||source.segment!==tuple.segment||source.role!=='demand'||source.demand!==true||source.discussionMetadataVersion!==1||source.demandMetadataVersion!==1||!['community_request','community_complaint'].includes(source.demandKind))return ['Check diagnostics substituted an original post identity, fixed adapter or source assignment.'];
   if(urls.has(tuple.productUrl)||ids.has(tuple.demandSourceId))return ['Check diagnostics cannot repeat a sealed discussion identity.'];
   urls.add(tuple.productUrl);ids.add(tuple.demandSourceId);counts.set(tuple.registrySourceId,(counts.get(tuple.registrySourceId)||0)+1);
  }
  return [...counts.values()].some(count=>count>3)?['Check diagnostics exceed three original assignments per discussion source.']:[];
 }catch{return ['Check diagnostics have malformed sealed discussion identities.'];}
}

export function checkDiagnosticsReasons(receipt,{runId,phase,expectedSha256,research,draft,selection,expectedResearchSha256,expectedDraftSha256,expectedSelectionSha256}={}){
 try{
  if(!exact(receipt,receiptKeys)||receipt.schema!==1||receipt.kind!=='check_preparation_diagnostics'||!runPattern.test(runId||'')||receipt.runId!==runId||!phases.includes(phase)||receipt.phase!==phase||!hex(expectedSha256)||sha256(stableJSON(receipt))!==expectedSha256||Buffer.byteLength(JSON.stringify(receipt),'utf8')>CHECK_DIAGNOSTICS_MAX_BYTES)return ['Trusted check preparation diagnostics are missing, malformed or changed.'];
  const sealed=sealedDiscussionAssignmentReasons({research,selection,runId,expectedResearchSha256,expectedSelectionSha256});if(sealed.length)return sealed;
  if(!hex(expectedDraftSha256)||!draft||draft.runId!==runId||sha256(stableJSON(draft))!==expectedDraftSha256||receipt.draftSha256!==expectedDraftSha256||receipt.researchSha256!==expectedResearchSha256||receipt.selectionSha256!==expectedSelectionSha256)return ['Check diagnostics do not bind the exact original research, selection and prepared draft fingerprints.'];
  const assignments=research.enrichment.discussionBatch.leadAssignments;
  if(!Array.isArray(receipt.assignments)||!same(receipt.assignments,assignments))return ['Check diagnostics must retain every original sealed discussion tuple in its exact order.'];
  if(!Array.isArray(receipt.successfulSourceIds)||receipt.successfulSourceIds.length>10||new Set(receipt.successfulSourceIds).size!==receipt.successfulSourceIds.length||!Array.isArray(receipt.failures)||!receipt.failures.length||receipt.failures.length>10)return ['Check diagnostics require bounded distinct successes and at least one typed failure.'];
  const outcomes=new Set();
  for(const id of receipt.successfulSourceIds){if(!sourceId(id)||!assignments.some(row=>row.demandSourceId===id)||outcomes.has(id))return ['Check diagnostics contain a duplicate or foreign successful source identity.'];outcomes.add(id);}
  for(const failure of receipt.failures){
   if(!exact(failure,failureKeys)||!sourceId(failure.sourceId)||outcomes.has(failure.sourceId)||!CHECK_DIAGNOSTIC_STAGES.includes(failure.stage)||!CHECK_DIAGNOSTIC_CODES_BY_STAGE[failure.stage].includes(failure.code)||failure.httpStatus!==null&&(!Number.isInteger(failure.httpStatus)||failure.httpStatus<100||failure.httpStatus>599)||!iso(failure.observedAt))return ['Check diagnostics contain a malformed, duplicate or untyped source failure.'];
   const tuple=assignments.find(row=>row.demandSourceId===failure.sourceId),definition=tuple&&catalog.find(row=>row.id===tuple.registrySourceId);
   if(!tuple||failure.productUrl!==tuple.productUrl||failure.registrySourceId!==tuple.registrySourceId)return ['Check diagnostics failure does not match an exact original discussion tuple.'];
   const adapter=discussionEvidenceURL(definition,{id:tuple.demandSourceId,registrySourceId:tuple.registrySourceId,url:tuple.productUrl}),robots=adapter?new URL('/robots.txt',adapter).toString():null;
   if(failure.adapterUrl!==null&&failure.adapterUrl!==adapter||failure.robotsUrl!==null&&failure.robotsUrl!==robots||failure.adapterUrl===null&&failure.robotsUrl!==null||definition.kind==='provider-discussion'&&(failure.adapterUrl!==null||failure.robotsUrl!==null))return ['Check diagnostics failure contains a foreign or noncanonical adapter or robots URL.'];
   if(failure.code==='source_http_error'&&(failure.httpStatus===null||failure.httpStatus>=200&&failure.httpStatus<300)||failure.code==='robots_unavailable'&&(failure.httpStatus===null||failure.httpStatus>=200&&failure.httpStatus<300||[404,410].includes(failure.httpStatus)))return ['Check diagnostics HTTP failure has a contradictory response status.'];
   outcomes.add(failure.sourceId);
  }
  if(outcomes.size!==assignments.length||assignments.some(row=>!outcomes.has(row.demandSourceId)))return ['Check diagnostics must account exactly once for every sealed assignment without omitting an unavailable item.'];
  return [];
 }catch{return ['Check diagnostics have malformed bounded source outcomes.'];}
}

export function createCheckDiagnostics({runId,phase,draft,research,selection,successfulSourceIds=[],failures=[],expectedResearchSha256,expectedDraftSha256,expectedSelectionSha256}={}){
 const sealed=sealedDiscussionAssignmentReasons({research,selection,runId,expectedResearchSha256,expectedSelectionSha256});if(sealed.length)throw new Error(sealed.join(' '));
 const receipt={schema:1,kind:'check_preparation_diagnostics',runId,phase,draftSha256:expectedDraftSha256,researchSha256:expectedResearchSha256,selectionSha256:expectedSelectionSha256,assignments:structuredClone(research.enrichment.discussionBatch.leadAssignments),successfulSourceIds:[...successfulSourceIds],failures:structuredClone(failures)};
 const reasons=checkDiagnosticsReasons(receipt,{runId,phase,expectedSha256:sha256(stableJSON(receipt)),research,draft,selection,expectedResearchSha256,expectedDraftSha256,expectedSelectionSha256});if(reasons.length)throw new Error(reasons.join(' '));return receipt;
}
