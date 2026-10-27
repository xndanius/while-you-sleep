import {canonicalURL,hash,sha256,stableJSON} from './storage.mjs';
import {privateArtifactReasons} from './privacy.mjs';
import {DISCUSSION_SOURCE_CATALOG,DISCUSSION_PROVIDER_CATALOG,discussionSourceDefinition,discussionPostURL,validProviderPoolProof,validDiscussionTaskExample} from './discussion-sources.mjs';
import {demandContextReasons} from './demand.mjs';

const date=value=>typeof value==='string'?Date.parse(value):NaN;
const sameURL=(a,b)=>{try{return canonicalURL(a)===canonicalURL(b);}catch{return false;}};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

// Short excerpts are a property of the admitted discussion adapter, never a
// writer-controlled exception to the generic implementation evidence minimum.
export function discussionEvidenceReasons(source,{definition,asOf}={}){
 const known=discussionSourceDefinition(definition),at=date(asOf),verified=date(source?.verifiedAt),captured=date(source?.fetchedAt),posted=date(source?.postedAt);
 if(!known||source?.registrySourceId!==known.id||typeof source.url!=='string'||source.id!==hash(source.url)||discussionPostURL(known,source.url)!==source.url||source.productUrl!==source.url||source.discussionMetadataVersion!==1||source.demandMetadataVersion!==1||source.role!=='demand'||source.demand!==true||source.demandKind!=='community_request'||source.enriched!==true||!['discussion-post','demand-notice'].includes(source.evidenceKind)||typeof source.text!=='string'||source.text.trim().length<25||source.text.length>200||source.text!==source.text.trim()||!Array.isArray(source.taskExcerpts)||source.taskExcerpts.length!==1||source.taskExcerpts[0]!==source.text||source.taskExcerptVersion!==2||privateArtifactReasons(source).length)return ['Discussion evidence lacks its exact fixed adapter identity, bounded literal excerpt or privacy-safe source stamp.'];
 if(!validDiscussionTaskExample(source)||source.taskExample!==undefined&&known.kind!=='discourse-discussion')return ['Discussion input example lacks its exact native first-post shape, literal hash or shared 200-character budget.'];
 if(!Number.isFinite(at)||!Number.isFinite(verified)||!Number.isFinite(captured)||!Number.isFinite(posted)||verified>at||at-verified>3*3600000||captured>verified||posted>captured+86400000||captured-posted>45*86400000)return ['Discussion evidence has missing, future or stale independent retrieval timestamps.'];
 const fetch=source.evidenceFetch;
 if(known.kind==='provider-discussion'){
  const evidence=source.providerEvidence,proof=evidence&&Object.fromEntries(['provider','platform','definitionId','receiptId','poolHash','postHash'].map(key=>[key,evidence[key]]));
  if(!evidence||!exact(evidence,['provider','platform','definitionId','receiptId','poolHash','postHash','capturedAt'])||!validProviderPoolProof(proof,known)||source.providerProofVerified!==true||source.livePostRefetched!==false||evidence.capturedAt!==source.fetchedAt||at-captured>8*3600000||!exact(fetch,['provider','complete'])||fetch.provider!==true||fetch.complete!==true)return ['Discussion provider evidence lacks its independently validated unexpired immutable capture proof.'];
 }else if(source.providerEvidence||source.providerProofVerified||source.livePostRefetched===false||verified!==captured||!exact(fetch,['maxBytes','complete'])||fetch.maxBytes!==2000000||fetch.complete!==true)return ['Native discussion evidence lacks its exact independent guarded public-fetch stamp.'];
 return [];
}

// Each quote must occur wholly inside one retained literal span. The task-only
// demand and omission gates intentionally do not use this helper. Fresh native
// reconstruction and the enclosing frozen snapshot bind the optional example.
export function sourceQuoteOccurs(source,quote,{normalize=value=>value}={}){
 if(typeof quote!=='string'||!quote.length)return false;
 const spans=typeof source?.text==='string'?[source.text]:[];
 const definition=DISCUSSION_SOURCE_CATALOG.find(row=>row.id===source?.registrySourceId);
 if(source?.taskExample!==undefined&&discussionEvidenceReasons(source,{definition,asOf:source.verifiedAt}).length===0)spans.push(source.taskExample.text);
 const expected=normalize(quote);return !!expected&&spans.some(text=>normalize(text).includes(expected));
}

export function assessmentEvidenceReasons(context){
 const sources=Array.isArray(context?.sources)?context.sources:[];
 if(!sources.length)return ['Completed assessment needs available freshly fetched public evidence.'];
 const failures=[];
 for(const source of sources){
  const assigned=context?.demandContext?.discussionBatchPolicy?.leadAssignments?.some(row=>row.demandSourceId===source?.id||sameURL(row.productUrl,source?.url));
  const registered=context?.demandContext?.authorizedSources?.find(row=>row.sourceId===source?.id)?.registrySourceId;
  const fixedDiscussion=[...DISCUSSION_SOURCE_CATALOG,...DISCUSSION_PROVIDER_CATALOG].some(def=>def.id===source?.registrySourceId||def.id===registered||context?.demandContext?.discussionBatchPolicy&&discussionPostURL(def,source?.url));
  if(source?.discussionMetadataVersion===1||source?.evidenceKind==='discussion-post'||source?.providerEvidence||assigned||fixedDiscussion){
   const authority=context.demandContext?.authorizedSources?.find(row=>row.sourceId===source.id),definition=context.demandContext?.registrySources?.find(row=>row.id===authority?.registrySourceId),assignment=context.demandContext?.discussionBatchPolicy?.leadAssignments?.find(row=>row.demandSourceId===source.id);
   if(context.demandContractVersion!==1||demandContextReasons(context).length||sha256(stableJSON(sources))!==context.sourceSnapshotSha256||!authority||authority.role!=='demand'||authority.demandKind!==source.demandKind||!authority.segments?.includes(source.segment)||!sameURL(authority.url,source.url)||!assignment||assignment.kind!=='discussion'||assignment.registrySourceId!==source.registrySourceId||assignment.segment!==source.segment||!sameURL(assignment.productUrl,source.url))failures.push('Short discussion evidence is not bound to its sealed registry authority and exact per-post assignment.');
   else failures.push(...discussionEvidenceReasons(source,{definition,asOf:context.createdAt}));
  }else if(typeof source?.text!=='string'||source.text.length<100||!Number.isFinite(date(source.verifiedAt||source.fetchedAt)))failures.push('Completed assessment needs available freshly fetched public evidence.');
 }
 return [...new Set(failures)];
}
