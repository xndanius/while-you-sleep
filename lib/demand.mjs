import {sha256,stableJSON,canonicalURL,validId} from './storage.mjs';
import {demandQuoteOccurs} from './demand-quotes.mjs';

export const SEGMENTS=Object.freeze(['local_services','professional_services','ecommerce','education','health_admin','construction_property','public_sector','households','ai_software_builders']);
export const SEGMENT_LABELS=Object.freeze({local_services:'Local services',professional_services:'Professional services',ecommerce:'E-commerce',education:'Education',health_admin:'Health administration',construction_property:'Construction and property',public_sector:'Public sector',households:'Households',ai_software_builders:'AI and software builders'});
export const DEMAND_KINDS=Object.freeze(['paid_job','public_tender','community_request','community_complaint','manual_service']);
export const DEMAND_MIX_POLICY=Object.freeze({aiWindow:10,aiMaximum:1,segmentWindow:20,segmentMaximum:6,warmup:'Fixed window capacities apply while fewer posts exist; short-sample percentages are not claimed.',unknown:'Unknown legacy buyers consume the AI-risk allowance until displaced by newer known segments.'});
const legacy=Object.freeze({'1b30245f8580f86bcc4685c8':'ai_software_builders','f8fa768c80d28297a81242e1':'ai_software_builders','b97635582c646fbff97c7e77':'ai_software_builders','0d455200b5ff2b5b39d4eac6':'ai_software_builders','b89af4e5c65cc81c424c080b':'ai_software_builders','e20bcacf021524725d3fc275':'ecommerce','98b4f6281cc3de4ecdfa95f6':'ecommerce'});
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const bounded=(value,min=1,max=500)=>typeof value==='string'&&value.trim().length>=min&&value.length<=max&&!/[\r\n\x00-\x1f\x7f]/.test(value);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const publicURL=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};

// These are transparent classifications of old buyer hypotheses, never a
// retrospective assertion that those posts had independently verified demand.
export function classifyLegacySegment(post){return legacy[post?.id]||null;}
export function classifyPublishedSegment(post){
 if(post?.demandContractVersion===1&&SEGMENTS.includes(post.segment)&&post.checker?.demandCheck?.supported===true)return {segment:post.segment,classification:'verified_demand',demandVerified:true};
 const segment=classifyLegacySegment(post);return {segment,classification:segment?'legacy_buyer_hypothesis':'unknown',demandVerified:false};
}
const recent=posts=>posts.filter(post=>Number.isFinite(Date.parse(post?.publishedAt))).slice().sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)||String(a.id).localeCompare(String(b.id)));
const mixClassification=post=>['verified_demand','legacy_buyer_hypothesis','unknown'].includes(post?.classification)&&typeof post.demandVerified==='boolean'?{segment:SEGMENTS.includes(post.segment)?post.segment:null}:classifyPublishedSegment(post);
export function publicationMixReasons(segment,posts=[]){
 if(!SEGMENTS.includes(segment))return ['Candidate has no valid fixed customer segment.'];
 const previous=recent(posts),reasons=[];
 if(segment==='ai_software_builders'){
  const risky=previous.slice(0,9).filter(post=>{const c=mixClassification(post);return !c.segment||c.segment==='ai_software_builders';}).length;
  if(risky+1>1)reasons.push('AI/software mix held: candidate plus the latest nine publications would exceed one AI/software idea in ten; unknown legacy buyers conservatively count as AI-risk.');
 }
 const count=previous.slice(0,19).filter(post=>mixClassification(post).segment===segment).length;
 if(count+1>6)reasons.push(`Segment diversity held: candidate plus the latest nineteen publications would exceed six ${segment} ideas in the twenty-post window.`);
 return reasons;
}
export const eligibleSegments=(posts=[])=>SEGMENTS.filter(segment=>publicationMixReasons(segment,posts).length===0);

export function personalDataReasons(value){
 const text=typeof value==='string'?value:JSON.stringify(value||{}),reasons=[];
 if(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text))reasons.push('Personal contact details must not be stored.');
 if(/(?:\+\d{1,3}[\s().-]*)?(?:\(?\d{2,4}\)?[\s.-]+){2,}\d{3,4}\b|\+\d{9,15}\b/.test(text))reasons.push('Possible personal telephone details must not be stored.');
 if(/\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){0,4}(?:Street|Road|Avenue|Lane|Drive|Close|Terrace|Boulevard)\b/.test(text))reasons.push('Personal street addresses must not be stored.');
 if(/(?:^|\s)@[a-zA-Z0-9_]{2,30}\b/.test(text))reasons.push('Personal usernames must not be stored.');
 return [...new Set(reasons)];
}

// Authority rows are constructed by trusted code from the fixed registry and
// guarded demand adapters, not copied from the writer's source-role assertions.
export function createDemandContext({registrySources=[],authorizedSources=[],posts=[],selectedSegment=null,fallbackPolicy=null,recoveryBatchPolicy=null,discussionBatchPolicy=null}={}){
 const authority=registrySources.map(source=>({id:source.id,url:source.url,kind:source.kind,role:source.role,demandKind:source.demandKind||null,segments:[...(source.segments||[])]})).sort((a,b)=>a.id.localeCompare(b.id));
 const memory=recent(posts).slice(0,19).map(post=>({id:post.id,publishedAt:post.publishedAt,...classifyPublishedSegment(post)}));
 return {version:1,registrySha256:sha256(stableJSON(authority)),registrySources:authority,authorizedSources:authorizedSources.map(source=>({sourceId:source.sourceId,registrySourceId:source.registrySourceId,url:source.url,role:source.role,demandKind:source.demandKind||null,segments:[...(source.segments||[])]})).sort((a,b)=>a.sourceId.localeCompare(b.sourceId)),selectedSegment,mixPolicy:DEMAND_MIX_POLICY,posts:memory,...(fallbackPolicy?{fallbackPolicy}:{}),...(recoveryBatchPolicy?{recoveryBatchPolicy}:{}),...(discussionBatchPolicy?{discussionBatchPolicy}:{})};
}
export const demandContextHash=context=>sha256(stableJSON(context));
function recoveryAssignment(policy,productUrl){try{const key=canonicalURL(productUrl);return policy?.leadAssignments?.find(row=>canonicalURL(row.productUrl)===key)||null;}catch{return null;}}
function mixedPayerHypothesis(value){
 // Whether the named payer is concrete and nontechnical is an independent
 // semantic check; broad lexical labels cannot establish or disprove that.
 return bounded(value,5,700)&&/\b(?:hypothesis|hypothetical)\b/i.test(value);
}
function recoveryBatchReasons(c){
 const p=c.recoveryBatchPolicy,reason='Mixed recovery lacks its exact sealed bounded lead assignments and fresh public-demand authority.';
 if(!exact(p,['version','mode','widened','researchSha256','maxLeads','maxPerDemandSource','minBuilderLeads','leadAssignments'])||p.version!==1||!['widened','fallback','repair'].includes(p.mode)||p.widened!==true||!hex(p.researchSha256)||p.maxLeads!==10||p.maxPerDemandSource!==3||p.minBuilderLeads!==3||c.selectedSegment!==null||c.fallbackPolicy||!Array.isArray(p.leadAssignments)||p.leadAssignments.length<3||p.leadAssignments.length>10)return [reason];
 const urls=new Set(),counts=new Map();let builders=0;
 for(const row of p.leadAssignments){
  if(!exact(row,['productUrl','segment','demandSourceId','registrySourceId','kind'])||!publicURL(row.productUrl)||!SEGMENTS.includes(row.segment)||!validId(row.demandSourceId)||!validId(row.registrySourceId)||!['demand','builder'].includes(row.kind))return [reason];
  const source=c.authorizedSources.find(source=>source.sourceId===row.demandSourceId),registry=c.registrySources.find(source=>source.id===row.registrySourceId);
  if(!source||source.role!=='demand'||source.registrySourceId!==row.registrySourceId||!source.segments?.includes(row.segment)||!registry||registry.role!=='demand'||!registry.segments?.includes(row.segment)||row.kind==='builder'&&row.segment==='ai_software_builders')return [reason];
  try{const key=canonicalURL(row.productUrl);if(urls.has(key)||row.kind==='demand'&&key!==canonicalURL(source.url)||row.kind==='builder'&&key===canonicalURL(source.url))return [reason];urls.add(key);}catch{return [reason];}
  counts.set(row.registrySourceId,(counts.get(row.registrySourceId)||0)+1);if(row.kind==='builder')builders++;
 }
 return builders<3||[...counts.values()].some(count=>count>3)?[reason]:[];
}
function discussionBatchReasons(c){
 const p=c.discussionBatchPolicy,reason='Discussion research lacks its exact sealed post identities, eligible segments and bounded source assignments.';
 if(!exact(p,['version','maxLeads','maxPerDemandSource','postIsDemand','leadAssignments','researchSha256'])||p.version!==1||p.maxLeads!==10||p.maxPerDemandSource!==3||p.postIsDemand!==true||!hex(p.researchSha256)||c.selectedSegment!==null||c.fallbackPolicy||c.recoveryBatchPolicy||!Array.isArray(p.leadAssignments)||!p.leadAssignments.length||p.leadAssignments.length>10)return [reason];
 const urls=new Set(),counts=new Map();
 for(const row of p.leadAssignments){
  if(!exact(row,['productUrl','segment','kind','demandSourceId','registrySourceId'])||row.kind!=='discussion'||!publicURL(row.productUrl)||!SEGMENTS.includes(row.segment)||!validId(row.demandSourceId)||!validId(row.registrySourceId))return [reason];
  const source=c.authorizedSources.find(source=>source.sourceId===row.demandSourceId),registry=c.registrySources.find(source=>source.id===row.registrySourceId);
  if(!source||source.role!=='demand'||source.registrySourceId!==row.registrySourceId||!['community_request','community_complaint'].includes(source.demandKind)||!source.segments.includes(row.segment)||!registry||registry.role!=='demand'||!registry.segments.includes(row.segment))return [reason];
  try{const key=canonicalURL(row.productUrl);if(urls.has(key)||key!==canonicalURL(source.url))return [reason];urls.add(key);}catch{return [reason];}
  counts.set(row.registrySourceId,(counts.get(row.registrySourceId)||0)+1);
 }
 return [...counts.values()].some(count=>count>3)?[reason]:[];
}
export function demandContextReasons(context){
 if(context?.demandContractVersion!==1)return [];
 const c=context.demandContext,reasons=[];
 if(!c||c.version!==1||!Array.isArray(c.registrySources)||!Array.isArray(c.authorizedSources)||!Array.isArray(c.posts)||c.posts.length>19||!hex(c.registrySha256)||c.registrySha256!==sha256(stableJSON(c.registrySources))||context.demandContextSha256!==demandContextHash(c)||stableJSON(c.mixPolicy)!==stableJSON(DEMAND_MIX_POLICY)||c.selectedSegment!==null&&!SEGMENTS.includes(c.selectedSegment))return ['Trusted fixed-registry demand context is missing or changed.'];
 if(new Set(c.registrySources.map(s=>s.id)).size!==c.registrySources.length||new Set(c.authorizedSources.map(s=>s.sourceId)).size!==c.authorizedSources.length)reasons.push('Demand authority contains duplicate source identities.');
 if(c.recoveryBatchPolicy)reasons.push(...recoveryBatchReasons(c));
 if(c.discussionBatchPolicy)reasons.push(...discussionBatchReasons(c));
 if(c.fallbackPolicy){const f=c.fallbackPolicy;if(!exact(f,['version','enabled','mode','reason','researchSha256','allowedBuilderUrls','demandSourceIds'])||f.version!==1||f.enabled!==true||!['fallback','repair'].includes(f.mode)||f.reason!=='no_fresh_demand_lead'||!hex(f.researchSha256)||!Array.isArray(f.allowedBuilderUrls)||!f.allowedBuilderUrls.length||f.allowedBuilderUrls.length>10||new Set(f.allowedBuilderUrls).size!==f.allowedBuilderUrls.length||f.allowedBuilderUrls.some(url=>!publicURL(url))||!Array.isArray(f.demandSourceIds)||!f.demandSourceIds.length||f.demandSourceIds.length>2||new Set(f.demandSourceIds).size!==f.demandSourceIds.length||f.demandSourceIds.some(id=>!c.authorizedSources.some(source=>source.sourceId===id&&source.role==='demand')))reasons.push('Builder fallback lacks the bounded, pre-model research and fresh public-demand authority.');}
 if(!c.authorizedSources.some(source=>source.role==='demand'))reasons.push('An independently completed demand-first assessment needs at least one available fresh authorized demand item; building media cannot prove its absence.');
 if(c.posts.some(post=>!validId(post.id)||!Number.isFinite(Date.parse(post.publishedAt))||!['verified_demand','legacy_buyer_hypothesis','unknown'].includes(post.classification)||typeof post.demandVerified!=='boolean'||post.segment!==null&&!SEGMENTS.includes(post.segment)))reasons.push('Demand mix memory contains an invalid published segment classification.');
 for(const source of c.authorizedSources){
  const authority=c.registrySources.find(entry=>entry.id===source.registrySourceId);
  if(!validId(source.sourceId)||!authority||!publicURL(source.url)||!['demand','building'].includes(source.role)||source.role!==authority.role||source.role==='demand'&&(!DEMAND_KINDS.includes(source.demandKind)||source.demandKind!==authority.demandKind||!source.segments.length||source.segments.some(segment=>!SEGMENTS.includes(segment)||!authority.segments.includes(segment))))reasons.push('A demand source is not authorized by its frozen fixed-registry role and segment scope.');
 }
 return [...new Set(reasons)];
}
export function demandEvidenceReasons(candidate,sources,{required=false,context}={}){
 if(!required&&candidate?.segment===undefined&&candidate?.demandEvidence===undefined)return [];
 const reasons=[];if(!SEGMENTS.includes(candidate?.segment))reasons.push('Candidate must identify exactly one of the nine fixed customer segments.');
 const evidence=candidate?.demandEvidence;
 if(!exact(evidence,['kind','sourceIds','chore','evidenceQuote'])||!DEMAND_KINDS.includes(evidence?.kind)||!Array.isArray(evidence?.sourceIds)||evidence.sourceIds.length!==1||!bounded(evidence.chore,1,280)||!bounded(evidence.evidenceQuote,12,500))return [...reasons,'Candidate must contain one precise public real-demand signal and a literal privacy-safe chore quote.'];
 reasons.push(...personalDataReasons(evidence),...personalDataReasons({title:candidate.title,whoPays:candidate.whoPays,whatItIs:candidate.whatItIs,promise:candidate.promise,loop:candidate.loop,evidence:candidate.evidence,first24Hours:candidate.first24Hours}));
 const id=evidence.sourceIds[0],source=sources.find(source=>source.id===id),authority=context?.demandContext?.authorizedSources?.find(row=>row.sourceId===id);
 if(!source||!candidate.sourceIds?.includes(id))reasons.push('Demand evidence references a missing or unattached public source.');
 if(!authority||authority.role!=='demand'||authority.demandKind!==evidence.kind||!authority.segments.includes(candidate.segment))reasons.push('Customer demand must come from an authorized demand-role source and matching signal kind/segment; building media cannot substitute.');
 if(source&&authority&&source.registrySourceId!==authority.registrySourceId)reasons.push('Demand source does not match its exact frozen registry authority.');
 if(context?.demandContext?.selectedSegment&&candidate.segment!==context.demandContext.selectedSegment)reasons.push('Candidate segment differs from the trusted learning selection.');
 const mixed=context?.demandContext?.recoveryBatchPolicy,assignment=recoveryAssignment(mixed,candidate.productUrl);
 if(mixed&&(!assignment||assignment.segment!==candidate.segment||assignment.demandSourceId!==id||assignment.registrySourceId!==authority?.registrySourceId))reasons.push('Candidate must match its exact sealed recovery lead, segment and public-demand signal; models cannot select or relabel another assignment.');
 const discussion=context?.demandContext?.discussionBatchPolicy,discussionAssignment=recoveryAssignment(discussion,candidate.productUrl);
 if(discussion&&(!discussionAssignment||discussionAssignment.kind!=='discussion'||discussionAssignment.segment!==candidate.segment||discussionAssignment.demandSourceId!==id||discussionAssignment.registrySourceId!==authority?.registrySourceId))reasons.push('Candidate must match its exact sealed discussion post and eligible customer segment. The post itself is the demand signal.');
 if(!demandQuoteOccurs(source,evidence.evidenceQuote,{asOf:context?.createdAt||source?.verifiedAt}))reasons.push('Demand quote is not a literal substring of the available public demand evidence.');
 try{const fallback=context?.demandContext?.fallbackPolicy,mixedBuilder=assignment?.kind==='builder'&&assignment.segment===candidate.segment&&assignment.demandSourceId===id&&assignment.registrySourceId===authority?.registrySourceId,builder=mixedBuilder||fallback?.enabled===true&&fallback.allowedBuilderUrls?.some(url=>canonicalURL(url)===canonicalURL(candidate.productUrl))&&fallback.demandSourceIds?.includes(id);if(!authority||!source||canonicalURL(source.url)!==canonicalURL(authority.url)||canonicalURL(candidate.productUrl)!==canonicalURL(authority.url)&&!builder)reasons.push('Candidate identity must start from its exact authorized public demand item, or an explicitly enabled bounded builder fallback with that fresh signal.');if(builder&&(candidate.segment==='ai_software_builders'||mixedBuilder&&!mixedPayerHypothesis(candidate.whoPays)||!mixedBuilder&&candidate.promise!==undefined&&!bounded(candidate.whoPays,5,700)))reasons.push('Builder fallback must name a nontechnical paying-customer hypothesis in a permitted segment.');}catch{reasons.push('Demand identity URL is invalid.');}
 return [...new Set(reasons)];
}
export function demandAssessmentReasons(check,post,context){
 if(context?.demandContractVersion!==1)return [];
 const failures=demandContextReasons(context);if(failures.length)return failures;
 const decision=check?.demandCheck,keys=['demandContextSha256','supported','segment','sourceId','kind','chore','evidenceQuote','reason','noPersonalData'];
 if(!exact(decision,keys)||decision.demandContextSha256!==context.demandContextSha256||typeof decision.supported!=='boolean'||decision.segment!==post.segment||!bounded(decision.reason,1,500)||typeof decision.noPersonalData!=='boolean')return ['Independent demand decision is missing, malformed or not bound to the frozen registry/demand context.'];
 if(decision.sourceId!==post.demandEvidence?.sourceIds?.[0]||decision.kind!==post.demandEvidence?.kind||decision.chore!==post.demandEvidence?.chore||!bounded(decision.evidenceQuote,12,500))failures.push('Independent demand decision does not examine the exact candidate chore and attached signal.');
 const source=context.sources?.find(source=>source.id===decision.sourceId),authority=context.demandContext.authorizedSources.find(row=>row.sourceId===decision.sourceId);
 if(!authority||authority.role!=='demand'||authority.demandKind!==decision.kind||!authority.segments.includes(decision.segment)||!demandQuoteOccurs(source,decision.evidenceQuote,{asOf:context.createdAt}))failures.push('Independent demand decision lacks an authorized fresh literal public demand signal.');
 const provider=source?.providerEvidence,providerCaptured=Date.parse(provider?.capturedAt),checkedAt=Date.parse(context.createdAt),providerValid=provider?.provider==='apify'&&provider.definitionId===source.registrySourceId&&['reddit','x','indiehackers','producthunt'].includes(provider.platform)&&typeof provider.receiptId==='string'&&hex(provider.poolHash)&&hex(provider.postHash)&&source.providerProofVerified===true&&source.livePostRefetched===false&&Number.isFinite(providerCaptured)&&providerCaptured<=checkedAt&&checkedAt-providerCaptured<=8*3600000;
 if(!Number.isFinite(Date.parse(source?.verifiedAt))||!Number.isFinite(checkedAt)||Math.abs(Date.parse(source.verifiedAt)-checkedAt)>3*3600000||source.role!=='demand'||source.registrySourceId!==authority?.registrySourceId||source.demandKind!==decision.kind||source.demandMetadataVersion!==1||provider&&!providerValid)failures.push('Independent demand source does not carry the fresh guarded adapter stamp or an independently verified unexpired public-provider receipt.');
 const assignment=recoveryAssignment(context.demandContext.recoveryBatchPolicy,post.productUrl);
 if(assignment?.kind==='builder'){
  const fresh=context.sources?.some(item=>item.role!=='demand'&&item.demand!==true&&item.evidenceKind!=='demand-notice'&&!context.demandContext.authorizedSources.some(source=>source.sourceId===item.id&&source.role==='demand')&&(item.role==='building'||item.enriched===true&&['product-page','github-readme'].includes(item.evidenceKind))&&post.sourceIds?.includes(item.id)&&[item.url,item.productUrl].filter(Boolean).some(value=>{try{return canonicalURL(value)===canonicalURL(assignment.productUrl);}catch{return false;}})&&Number.isFinite(Date.parse(item.verifiedAt))&&Number.isFinite(Date.parse(context.createdAt))&&Math.abs(Date.parse(item.verifiedAt)-Date.parse(context.createdAt))<=3*3600000);
  if(!fresh)failures.push('A recovery builder needs its exact independently re-fetched public implementation evidence as well as the separate demand signal.');
 }
 if(decision.kind==='paid_job'&&source?.demandEvidence?.paid!==true||decision.kind==='public_tender'&&source?.demandEvidence?.status!=='active')failures.push('The guarded source does not establish a current paid vacancy or active public procurement request.');
 if(personalDataReasons(decision).length)failures.push('Independent demand decision contains possible personal details.');
 return [...new Set(failures)];
}
export function demandApprovalReasons(check,post,context){
 const reasons=demandAssessmentReasons(check,post,context);if(context?.demandContractVersion!==1||reasons.length)return reasons;
 reasons.push(...demandEvidenceReasons(post,context.sources,{required:true,context}));
 if(check.demandCheck.supported!==true)reasons.push('Independent checker did not establish an existing real-demand signal for this chore.');
 if(check.demandCheck.noPersonalData!==true)reasons.push('Independent checker did not confirm privacy-safe demand evidence.');
 reasons.push(...publicationMixReasons(post.segment,context.demandContext.posts));
 return [...new Set(reasons)];
}
