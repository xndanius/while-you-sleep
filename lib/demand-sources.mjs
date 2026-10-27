import {hash,canonicalURL,sha256} from './storage.mjs';
import {fetchPublic} from './source-fetch.mjs';
import {PUBLIC_DEMAND_FEEDS,PUBLIC_DEMAND_DISCOVERY_FEEDS,PUBLIC_DEMAND_SOURCE_KINDS,parsePublicDemandPage,publicDemandFetchOptions,publicDemandNoticeId,publicDemandTaskExcerpts} from './public-demand-feeds.mjs';
import {DISCUSSION_SOURCE_KINDS,DISCUSSION_SOURCE_CATALOG,DISCUSSION_PROVIDER_CATALOG,isDiscussionSourceDefinition,parseDiscussionSourcePage,discussionEvidenceURL,makeDiscussionSource,validProviderPoolProof} from './discussion-sources.mjs';
import {nativeReadingContextReasons} from './native-reading-context.mjs';
export {DISCUSSION_SOURCE_KINDS,DISCUSSION_SOURCE_CATALOG,DISCUSSION_PROVIDER_CATALOG,isDiscussionSourceDefinition,isCurrentResearchSource,isJobOrTenderSource} from './discussion-sources.mjs';

const UK_TERMS='https://www.contractsfinder.service.gov.uk/Home/TermsAndConditions';
const JOB_TERMS='https://data.arbetsformedlingen.se/dataservice/jobsearch/';
export const DEMAND_SOURCE_KINDS=Object.freeze(['uk-contracts-demand','uk-tenders-demand','jobtech-demand',...PUBLIC_DEMAND_SOURCE_KINDS,...DISCUSSION_SOURCE_KINDS]);
export const DEMAND_SOURCE_CATALOG=Object.freeze([
 {name:'Contracts Finder · public service tenders',kind:'uk-contracts-demand',url:'https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search?stages=tender&limit=20',segments:['public_sector'],demandKind:'public_tender',termsUrl:UK_TERMS,license:'Open Government Licence',reason:'Official public procurement notices show a requested paid service, not demand inferred from an AI tool. Contact, buyer and supplier fields are excluded.'},
 {name:'Find a Tender · public service tenders',kind:'uk-tenders-demand',url:'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?stages=tender&limit=20',segments:['public_sector'],demandKind:'public_tender',termsUrl:UK_TERMS,license:'Open Government Licence',reason:'Official public notices requesting administrative and professional services; no contact, buyer or supplier personal data is retained.'},
 {name:'JobSearch · paid administration roles',kind:'jobtech-demand',url:'https://jobsearch.api.jobtechdev.se/search?q=administrat%C3%B6r&limit=20',segments:['professional_services'],demandKind:'paid_job',termsUrl:JOB_TERMS,license:'CC0',reason:'Official Swedish public employment API, no key or registration; paid nontechnical administration roles with contact and employer profiles excluded.'},
 {name:'JobSearch · paid medical secretary roles',kind:'jobtech-demand',url:'https://jobsearch.api.jobtechdev.se/search?q=medicinsk%20sekreterare&limit=20',segments:['health_admin'],demandKind:'paid_job',termsUrl:JOB_TERMS,license:'CC0',reason:'Paid medical administration chores, excluding clinical decisions, patient data, contact and employer profiles.'},
 {name:'JobSearch · paid school administration roles',kind:'jobtech-demand',url:'https://jobsearch.api.jobtechdev.se/search?q=skoladministrat%C3%B6r&limit=20',segments:['education'],demandKind:'paid_job',termsUrl:JOB_TERMS,license:'CC0',reason:'Paid school administration roles, excluding pupil data, contact and employer profiles.'},
 ...PUBLIC_DEMAND_FEEDS,
].map(value=>Object.freeze({...value,url:canonicalURL(value.url),id:hash(canonicalURL(value.url)),role:'demand',metadataVersion:1})));
export const DEMAND_DISCOVERY_CATALOG=Object.freeze([...DISCUSSION_SOURCE_CATALOG,...DISCUSSION_PROVIDER_CATALOG,...PUBLIC_DEMAND_DISCOVERY_FEEDS.map(value=>Object.freeze({...value,url:canonicalURL(value.url),id:hash(canonicalURL(value.url)),role:'demand',metadataVersion:1}))]);
const knownDefinition=source=>[...DEMAND_SOURCE_CATALOG,...DEMAND_DISCOVERY_CATALOG].find(value=>{try{return value.kind===source?.kind&&value.url===canonicalURL(source.url)&&(!source.id||source.id===value.id);}catch{return false;}});
export const sourceRole=source=>knownDefinition(source)?'demand':'building';
export const sourceSegments=source=>knownDefinition(source)?.segments.slice()||[];
export const sourceDemandKind=source=>knownDefinition(source)?.demandKind||null;
export const demandSourceMetadata=source=>{const known=knownDefinition(source);return known?{metadataVersion:1,role:'demand',segments:known.segments.slice(),demandKind:known.demandKind,termsUrl:known.termsUrl,license:known.license}: {metadataVersion:1,role:'building',segments:[],demandKind:null};};
export const isDemandSourceDefinition=source=>!!knownDefinition(source);
export function demandSourceFetchOptions(source,options={}){const known=knownDefinition(source);return known?publicDemandFetchOptions(known,options):options;}
const fail=message=>Object.assign(new Error(message),{code:'invalid_demand_source',stage:'parse'});
const text=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();

// No arbitrary tender description, job headline, buyer name, applicant data or
// contact object is copied. These category names are fixed public taxonomies.
const CPV=Object.freeze({
 '79500000':'Office-support services','79510000':'Telephone-answering services','79520000':'Reprographic services','79530000':'Translation services','79540000':'Interpretation services','79550000':'Typing, word-processing and desktop publishing services','79560000':'Filing services','79570000':'Mailing-list compilation and mailing services','79571000':'Mailing services','79580000':'Office management services',
 '79950000':'Exhibition, fair and congress organisation services','79951000':'Seminar organisation services','79952000':'Event services','79960000':'Photographic and ancillary services','79970000':'Publishing services','79990000':'Miscellaneous business-related services','79991000':'Stock-control services','79994000':'Contract administration services','79995000':'Library management services','79995100':'Archiving services','79995200':'Cataloguing services','79996000':'Business organisation services',
 '79340000':'Advertising and marketing services','79410000':'Business and management consultancy services','79411000':'General management consultancy services','79419000':'Evaluation consultancy services','79420000':'Management-related services',
 '71530000':'Construction consultancy services','71321000':'Engineering design services for mechanical and electrical installations for buildings',
});
function finiteDate(value){return typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;}
export const DEMAND_TASK_EXTRACTOR_VERSION=2;
// Fixed task vocabulary, not a score or proof of a viable AI business. Inflected
// Swedish verbs and common task bullets must survive just like infinitives.
const taskVerbs=String.raw`(?:registrera(?:r|s)?|registrering|fakturera(?:r|s)?|fakturering|hantera(?:r|s)?|hantering|bokför(?:a|er|ing)|skapa(?:r|s)?|koordinera(?:r|s)?|uppdatera(?:r|s)?|sammanställ(?:a|er|ning)|kontrollera(?:r|s)?|planera(?:r|s)?|följa upp|följer upp|bevaka(?:r|s)?|arkivera(?:r|s)?|arkivering|bearbeta(?:r|s)?|bereda|bereder|förbereda|förbereder|granska(?:r|s)?|upprätta(?:r|s)?|säkerställ(?:a|er)|kvalitetssäkra(?:r|s)?|utföra|utför|föra in|för in|ta fram|tar fram|administrera(?:r|s)?|boka(?:r|s)?|diarieföra|diarieför|record|register|invoice|reconcile|compile|process|prepare|extract|check|update|file|schedule|organize|track)`;
const taskStart=new RegExp('^'+taskVerbs+'\\b','i'),taskAction=new RegExp('\\b'+taskVerbs+'\\b','i');
const taskSubject=/administr|registr|bok|faktur|schem|dokument|rapport|journal|arkiv|koordin|handlägg|order|tidrapport|beställ|underlag|post|record|invoice|document|schedule|report|filing/i;
const recruitment=/belastningsregist|misstankeregist|erfarenhet|utbild(?:ad|ning)|meriterande|vi söker|söker dig|god(?:a)? (?:kunskap|förmåga)|servicekänsla/i;
const safeProducts=new Set(['Excel','Word','Microsoft','Office','PowerPoint','Outlook','Google','Sheets','Visma','Fortnox','SAP']);
const hasUnknownName=value=>[...value.matchAll(/\s([A-ZÅÄÖ][A-Za-zÅÄÖåäö]{2,})\b/g)].some(match=>!safeProducts.has(match[1]));
const taskRank=value=>!recruitment.test(value)&&taskSubject.test(value)?taskStart.test(value)?2:taskAction.test(value)?1:0:0;
export function demandTaskCount(source){
 if(source?.discussionMetadataVersion===1&&DEMAND_DISCOVERY_CATALOG.some(definition=>definition.id===source.registrySourceId&&isDiscussionSourceDefinition(definition)))return Array.isArray(source.taskExcerpts)?source.taskExcerpts.filter(value=>typeof value==='string'&&value.length>=25&&value.length<=200&&source.text===value).length:0;
 const publicFeed=[...DEMAND_SOURCE_CATALOG,...DEMAND_DISCOVERY_CATALOG].some(definition=>definition.id===source?.registrySourceId&&PUBLIC_DEMAND_SOURCE_KINDS.includes(definition.kind));
 return Array.isArray(source?.taskExcerpts)?source.taskExcerpts.filter(value=>typeof value==='string'&&source.text?.includes(value)&&(publicFeed?publicDemandTaskExcerpts(value,{request:true}).length>0:taskRank(value)>0)).length:0;
}
export function demandEvidenceFingerprint(source){
 if(source?.role!=='demand'||source.demand!==true||typeof source.text!=='string'||!source.demandEvidence)return null;
 // Match the exact sanitized-text hash already sealed in source-scan receipts.
 return sha256(source.text);
}
export function unchangedDemandEvidence(prior,currentFingerprint){
 // Compare discovery with discovery when a verified historical scan exists.
 // A feed summary and the freshly fetched primary excerpt may differ even
 // though neither changed between runs. Retrieval timestamps are not evidence.
 return !prior?.demandEvidenceSha256||!currentFingerprint||prior.demandEvidenceSha256===currentFingerprint||/^[a-f0-9]{64}$/.test(prior.discoveryEvidenceSha256||'')&&prior.discoveryEvidenceSha256===currentFingerprint;
}
function safeTaskSentences(raw){
 if(typeof raw!=='string')return [];
 // Copy complete literal lines only. Fixed software names can occur in task
 // instructions; other internal names, contact markers, digits and patient data
 // still exclude the whole line. No redaction can become a literal quote.
 return raw.slice(0,25000).replace(/<[^>]*>/g,' ').split(/(?:[.!?]\s+|[\r\n]+)/).map(value=>text(value.replace(/^[\s•*–—-]+/,''))).filter(value=>value.length>=30&&value.length<=350&&(/^(?:du|vi|i rollen|i ditt arbete|i uppdraget|i tjänsten|rollen|arbetet|arbetsuppgift(?:er|erna)|dina|ditt|som|huvudsakliga|tjänsten|det ingår|en del av arbetet|utöver|in this role|you|the role|duties|responsibilities)\b/i.test(value)||taskStart.test(value))&&!/[@\d]|https?:|www\.|kontakt|contact|telefon|phone|ansök|apply|namn|name|personnummer|patient/i.test(value)&&!hasUnknownName(value)&&taskSubject.test(value)&&!recruitment.test(value)).map((value,index)=>({value,index,priority:taskRank(value)})).sort((a,b)=>b.priority-a.priority||a.index-b.index).slice(0,3).map(item=>item.value);
}
function makeSource(definition,page,{url,title,segment,kind,postedAt,evidence,taskLines=[]}){
 const note=kind==='paid_job'?'A paid staff vacancy is demand for human work; it does not prove anyone buys an AI tool.':'A published procurement request is demand for a service; it does not prove a completed payment or demand for an AI tool.';
 const taskExcerpts=[];for(const line of taskLines)if([title,...taskExcerpts,line,`Published ${postedAt}.`,note].join(' ').length<=1200)taskExcerpts.push(line);
 const body=[title,...taskExcerpts,`Published ${postedAt}.`,note].join(' ');
 return {id:hash(canonicalURL(url)),url:canonicalURL(url),title:title.slice(0,200),publisher:definition.name,text:body,taskExcerpts,taskExcerptVersion:DEMAND_TASK_EXTRACTOR_VERSION,fetchedAt:page.fetchedAt,role:'demand',demand:true,demandMetadataVersion:1,registrySourceId:definition.id,segment,demandKind:kind,postedAt,demandEvidence:evidence,privacy:'Whitelisted non-personal task excerpts and role/category/date/status fields; contact and employer/buyer profiles omitted.'};
}
export function parseDemandSourcePage(definition,page,{expectedUrl}={}){
 const known=knownDefinition(definition);if(!known)throw fail('Demand adapters require an exact vetted public feed definition.');
 if(page.truncated!==false||new URL(page.url).origin!==new URL(known.url).origin)throw fail('Demand response must be complete and remain on its official origin.');
 if(isDiscussionSourceDefinition(known))return parseDiscussionSourcePage(known,page,{expectedUrl});
 if(PUBLIC_DEMAND_SOURCE_KINDS.includes(known.kind))return parsePublicDemandPage(known,page,{expectedUrl});
 let data;try{data=JSON.parse(page.text);}catch{throw fail('Official demand response is not valid complete JSON.');}
 const items=[];
 if(known.kind==='jobtech-demand'){
  const rows=Array.isArray(data.hits)?data.hits:expectedUrl?[data]:[];
  for(const row of rows.slice(0,20)){
   if(!/^\d{1,12}$/.test(String(row.id))||row.removed===true||row.salary_type?.concept_id!=='oG8G_9cW_nRf')continue;
   const occupation=text(row.occupation?.label),headline=text(row.headline),segment=known.segments[0];
   if(/system|software|programmer|utvecklare|developer|data(?:base|bas)|it[- ]/i.test(occupation+' '+headline))continue;
   const eligible=segment==='health_admin'?/medicinsk sekreterare|läkarsekreterare|vårdadmin/i.test(occupation):segment==='education'?/skolassistent|skoladministratör|studieadministratör/i.test(occupation+' '+headline):/administratör|administrativ assistent|kontorsassistent|sekreterare/i.test(occupation);
   // The feed's local publication timestamps omit an offset. Keep their public
   // calendar date rather than inventing a UTC time from the runner timezone.
   const postedAt=finiteDate(row.publication_date)?row.publication_date.slice(0,10):null;if(!eligible||!postedAt)continue;
   if(typeof row.application_deadline==='string'&&/^\d{4}-\d{2}-\d{2}/.test(row.application_deadline)&&row.application_deadline.slice(0,10)<page.fetchedAt.slice(0,10))continue;
   const role=segment==='health_admin'?'medical secretary':segment==='education'?'school administrator':'administrator',url=`https://jobsearch.api.jobtechdev.se/ad/${row.id}`;
   if(expectedUrl&&canonicalURL(expectedUrl)!==url)continue;
   items.push(makeSource(known,page,{url,title:`Paid ${role} role`,segment,kind:'paid_job',postedAt,taskLines:safeTaskSentences(row.description?.text),evidence:{kind:'paid_job',noticeId:String(row.id),paid:true,paymentBasis:'fixed monthly, weekly or hourly salary',role,status:'open',postedAt}}));
  }
 }else{
  if(!Array.isArray(data.releases))throw fail('Official tender response has no release array.');
  for(const row of data.releases.slice(0,100)){
   const classification=row.tender?.classification,code=String(classification?.id||'').split('-')[0];
   if(classification?.scheme!=='CPV'||!CPV[code]||row.tender?.status!=='active'||!Array.isArray(row.tag)||!row.tag.some(tag=>tag==='tender'||tag==='tenderAmendment'))continue;
   const postedAt=finiteDate(row.date);if(!postedAt)continue;
   let url;if(known.kind==='uk-contracts-demand'&&/^[a-f0-9-]{36}-\d{1,12}$/i.test(row.id))url=`https://www.contractsfinder.service.gov.uk/Published/OCDS/Release/${row.id}`;
   else if(known.kind==='uk-tenders-demand'&&/^\d{6}-\d{4}$/.test(row.id))url=`https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages/${row.id}`;
   else continue;
   if(expectedUrl&&canonicalURL(expectedUrl)!==url)continue;
   items.push(makeSource(known,page,{url,title:`Public tender: ${CPV[code]}`,segment:'public_sector',kind:'public_tender',postedAt,evidence:{kind:'public_tender',noticeId:row.id,status:'active',category:CPV[code],classificationScheme:'CPV',classificationCode:code,postedAt}}));
  }
 }
 const unique=[...new Map(items.map(item=>[item.id,item])).values()].slice(0,20);if(!unique.length)throw fail('No current paid nontechnical demand items passed the privacy-safe adapter.');return unique;
}

export async function fetchDemandEvidence(source,{definition,fetchPage=fetchPublic,providerFetch,includeNativeReadingContext=source?.nativeReadingContext?.version===2}={}){
 const known=knownDefinition(definition);if(!known)throw fail('Fresh demand evidence needs an exact trusted admitted feed definition.');
 if(typeof includeNativeReadingContext!=='boolean')throw fail('Native reading-context selection must be an explicit boolean.');
 if(source.discussionBodyVersion!==undefined&&source.discussionBodyVersion!==1)throw fail('Discussion body contract version is invalid.');
 if(source.registrySourceId!==known.id)throw fail('Demand evidence origin does not match its trusted feed.');
 if(source.nativeReadingContext!==undefined){const reasons=nativeReadingContextReasons(source);if(reasons.length)throw fail(reasons.join(' '));}
 if(isDiscussionSourceDefinition(known)){
  const url=discussionEvidenceURL(known,source);
  if(known.kind==='provider-discussion'){
   if(typeof providerFetch!=='function')throw fail('Fresh provider discussion evidence requires a trusted immutable pool and independent provider reader.');
   const result=await providerFetch(source,{definition:known});
   const fresh=makeDiscussionSource(known,result?.post||result,{fetchedAt:result?.capturedAt});
   if(!fresh||fresh.id!==source.id||!result?.capturedAt||!Number.isFinite(Date.parse(result?.independentlyReadAt))||result.independentlyReread!==true||!validProviderPoolProof(result.proof,known))throw fail('Independent provider evidence did not verify the exact stored public post and its original capture time.');
   return {...fresh,verifiedAt:result.independentlyReadAt,enriched:true,evidenceKind:'discussion-post',providerEvidence:{...result.proof,capturedAt:result.capturedAt},providerProofVerified:result.independentlyReread===true,livePostRefetched:false,evidenceFetch:{provider:true,complete:true}};
  }
  const page=await fetchPage(url,{maxBytes:2000000,complete:true});
  if(!page.robots?.length||page.robots.some(record=>record.allowed!==true)||page.status<200||page.status>=300)throw fail('Fresh discussion evidence lacks successful public guards.');
  const fresh=parseDiscussionSourcePage(known,page,{expectedUrl:source.url,includeNativeReadingContext,requireBody:source.discussionBodyVersion===1}).find(item=>item.id===source.id);if(!fresh)throw fail('The exact public discussion post is no longer independently verifiable.');
  return {...fresh,verifiedAt:page.fetchedAt,enriched:true,evidenceKind:'discussion-post',evidenceFetch:{maxBytes:2000000,complete:true}};
 }
 if(PUBLIC_DEMAND_SOURCE_KINDS.includes(known.kind)){
  const noticeId=publicDemandNoticeId(known,source.url);if(!noticeId||source.id!==hash(canonicalURL(source.url)))throw fail('Demand evidence URL is outside its fixed public item scope.');
  // Refresh the exact item through its explicitly public feed/API. No HTML
  // scraping, author fields, personal contacts or alternate mirror is used.
  const page=await fetchPage(known.url,publicDemandFetchOptions(known,{maxBytes:2000000,complete:true},known.kind==='ted-service-demand'?noticeId:null));
  if(!page.robots?.length||page.robots.some(record=>record.allowed!==true)||page.status<200||page.status>=300)throw fail('Fresh demand evidence lacks successful public guards.');
  const fresh=parseDemandSourcePage(known,page,{expectedUrl:source.url}).find(item=>item.id===source.id);if(!fresh)throw fail('The exact public demand item is no longer verifiable in its authorized feed.');
  return {...fresh,productUrl:fresh.url,verifiedAt:page.fetchedAt,enriched:true,evidenceKind:'demand-notice',evidenceFetch:{maxBytes:2000000,complete:true}};
 }
 const url=new URL(source.url),allowed=known.kind==='jobtech-demand'?url.origin==='https://jobsearch.api.jobtechdev.se'&&/^\/ad\/\d{1,12}$/.test(url.pathname):known.kind==='uk-contracts-demand'?url.origin==='https://www.contractsfinder.service.gov.uk'&&/^\/Published\/OCDS\/Release\/[a-f0-9-]{36}-\d{1,12}$/i.test(url.pathname):url.origin==='https://www.find-tender.service.gov.uk'&&/^\/api\/1\.0\/ocdsReleasePackages\/\d{6}-\d{4}$/.test(url.pathname);
 if(!allowed||url.search||url.hash||url.username||url.password||source.id!==hash(canonicalURL(url)))throw fail('Demand evidence URL is outside its fixed official notice scope.');
 const page=await fetchPage(url.toString(),{maxBytes:2000000,complete:true});
 if(!page.robots?.length||page.robots.some(record=>record.allowed!==true)||page.status<200||page.status>=300)throw fail('Fresh demand evidence lacks successful public guards.');
 const fresh=parseDemandSourcePage(known,page,{expectedUrl:url.toString()}).find(item=>item.id===source.id);if(!fresh)throw fail('The exact demand notice is no longer verifiable.');
 return {...fresh,productUrl:fresh.url,verifiedAt:page.fetchedAt,enriched:true,evidenceKind:'demand-notice',evidenceFetch:{maxBytes:2000000,complete:true}};
}
