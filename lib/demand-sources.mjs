import {hash,canonicalURL} from './storage.mjs';
import {fetchPublic} from './source-fetch.mjs';

const UK_TERMS='https://www.contractsfinder.service.gov.uk/Home/TermsAndConditions';
const JOB_TERMS='https://data.arbetsformedlingen.se/dataservice/jobsearch/';
export const DEMAND_SOURCE_KINDS=Object.freeze(['uk-contracts-demand','uk-tenders-demand','jobtech-demand']);
export const DEMAND_SOURCE_CATALOG=Object.freeze([
 {name:'Contracts Finder · public service tenders',kind:'uk-contracts-demand',url:'https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search?stages=tender&limit=20',segments:['public_sector'],demandKind:'public_tender',termsUrl:UK_TERMS,license:'Open Government Licence',reason:'Official public procurement notices show a requested paid service, not demand inferred from an AI tool. Contact, buyer and supplier fields are excluded.'},
 {name:'Find a Tender · public service tenders',kind:'uk-tenders-demand',url:'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?stages=tender&limit=20',segments:['public_sector'],demandKind:'public_tender',termsUrl:UK_TERMS,license:'Open Government Licence',reason:'Official public notices requesting administrative and professional services; no contact, buyer or supplier personal data is retained.'},
 {name:'JobSearch · paid administration roles',kind:'jobtech-demand',url:'https://jobsearch.api.jobtechdev.se/search?q=administrat%C3%B6r&limit=20',segments:['professional_services'],demandKind:'paid_job',termsUrl:JOB_TERMS,license:'CC0',reason:'Official Swedish public employment API, no key or registration; paid nontechnical administration roles with contact and employer profiles excluded.'},
 {name:'JobSearch · paid medical secretary roles',kind:'jobtech-demand',url:'https://jobsearch.api.jobtechdev.se/search?q=medicinsk%20sekreterare&limit=20',segments:['health_admin'],demandKind:'paid_job',termsUrl:JOB_TERMS,license:'CC0',reason:'Paid medical administration chores, excluding clinical decisions, patient data, contact and employer profiles.'},
 {name:'JobSearch · paid school administration roles',kind:'jobtech-demand',url:'https://jobsearch.api.jobtechdev.se/search?q=skoladministrat%C3%B6r&limit=20',segments:['education'],demandKind:'paid_job',termsUrl:JOB_TERMS,license:'CC0',reason:'Paid school administration roles, excluding pupil data, contact and employer profiles.'},
].map(value=>Object.freeze({...value,url:canonicalURL(value.url),id:hash(canonicalURL(value.url)),role:'demand',metadataVersion:1})));
const knownDefinition=source=>DEMAND_SOURCE_CATALOG.find(value=>{try{return value.kind===source?.kind&&value.url===canonicalURL(source.url)&&(!source.id||source.id===value.id);}catch{return false;}});
export const sourceRole=source=>knownDefinition(source)?'demand':'building';
export const sourceSegments=source=>knownDefinition(source)?.segments.slice()||[];
export const sourceDemandKind=source=>knownDefinition(source)?.demandKind||null;
export const demandSourceMetadata=source=>{const known=knownDefinition(source);return known?{metadataVersion:1,role:'demand',segments:known.segments.slice(),demandKind:known.demandKind,termsUrl:known.termsUrl,license:known.license}: {metadataVersion:1,role:'building',segments:[],demandKind:null};};
export const isDemandSourceDefinition=source=>!!knownDefinition(source);
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
function safeTaskSentences(raw){
 if(typeof raw!=='string')return [];
 // Only task sentences with generic beginnings survive. Any contact marker,
 // digit, URL or internal capitalized name makes a sentence ineligible.
 return raw.slice(0,25000).replace(/<[^>]*>/g,' ').split(/(?:[.!?]\s+|[\r\n]+)/).map(value=>text(value)).filter(value=>value.length>=30&&value.length<=350&&/^(?:du|vi|i rollen|rollen|arbetet|arbetsuppgifter|dina|ditt|som|huvudsakliga|tjänsten|det ingår|in this role|you|the role|duties|responsibilities)\b/i.test(value)&&!/[@\d]|https?:|www\.|kontakt|contact|telefon|phone|ansök|apply|namn|name|personnummer|patient(?:er)?(?:s? (?:name|namn))?/i.test(value)&&!/\s[A-ZÅÄÖ][a-zåäö]{2,}\b/.test(value)&&/administr|registr|bok|faktur|schem|dokument|rapport|journal|arkiv|koordin|handlägg|order|record|invoice|document|schedule|report|filing/i.test(value)).slice(0,3);
}
function makeSource(definition,page,{url,title,segment,kind,postedAt,evidence,taskLines=[]}){
 const note=kind==='paid_job'?'A paid staff vacancy is demand for human work; it does not prove anyone buys an AI tool.':'A published procurement request is demand for a service; it does not prove a completed payment or demand for an AI tool.';
 const body=[title,...taskLines,`Published ${postedAt}.`,note].join(' ').slice(0,1200);
 return {id:hash(canonicalURL(url)),url:canonicalURL(url),title:title.slice(0,200),publisher:definition.name,text:body,fetchedAt:page.fetchedAt,role:'demand',demand:true,demandMetadataVersion:1,registrySourceId:definition.id,segment,demandKind:kind,postedAt,demandEvidence:evidence,privacy:'Whitelisted non-personal role/category/date/status fields; contact and employer/buyer profiles omitted.'};
}
export function parseDemandSourcePage(definition,page,{expectedUrl}={}){
 const known=knownDefinition(definition);if(!known)throw fail('Demand adapters require an exact vetted public feed definition.');
 if(page.truncated!==false||new URL(page.url).origin!==new URL(known.url).origin)throw fail('Demand response must be complete and remain on its official origin.');
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

export async function fetchDemandEvidence(source,{definition,fetchPage=fetchPublic}={}){
 const known=knownDefinition(definition);if(!known)throw fail('Fresh demand evidence needs an exact trusted admitted feed definition.');
 if(source.registrySourceId!==known.id)throw fail('Demand evidence origin does not match its trusted feed.');
 const url=new URL(source.url),allowed=known.kind==='jobtech-demand'?url.origin==='https://jobsearch.api.jobtechdev.se'&&/^\/ad\/\d{1,12}$/.test(url.pathname):known.kind==='uk-contracts-demand'?url.origin==='https://www.contractsfinder.service.gov.uk'&&/^\/Published\/OCDS\/Release\/[a-f0-9-]{36}-\d{1,12}$/i.test(url.pathname):url.origin==='https://www.find-tender.service.gov.uk'&&/^\/api\/1\.0\/ocdsReleasePackages\/\d{6}-\d{4}$/.test(url.pathname);
 if(!allowed||url.search||url.hash||url.username||url.password||source.id!==hash(canonicalURL(url)))throw fail('Demand evidence URL is outside its fixed official notice scope.');
 const page=await fetchPage(url.toString(),{maxBytes:2000000,complete:true});
 if(!page.robots?.length||page.robots.some(record=>record.allowed!==true)||page.status<200||page.status>=300)throw fail('Fresh demand evidence lacks successful public guards.');
 const fresh=parseDemandSourcePage(known,page,{expectedUrl:url.toString()}).find(item=>item.id===source.id);if(!fresh)throw fail('The exact demand notice is no longer verifiable.');
 return {...fresh,verifiedAt:page.fetchedAt};
}
