import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {canonicalURL,hash} from './storage.mjs';
import {privateArtifactReasons} from './privacy.mjs';

export const PUBLIC_DEMAND_SOURCE_KINDS=Object.freeze(['ted-service-demand','wwr-demand','woocommerce-demand','wordpress-request-demand']);
export const PUBLIC_DEMAND_FEEDS=Object.freeze([
 {name:'EU TED · English business-service tenders',kind:'ted-service-demand',url:'https://api.ted.europa.eu/v3/notices/search',segments:['public_sector'],demandKind:'public_tender',termsUrl:'https://docs.ted.europa.eu/api/latest/search.html',license:'EU public procurement reuse',reason:'Anonymous official TED search of English competition notices for business services; only public non-personal task excerpts are retained.'},
 {name:'We Work Remotely · customer support requests',kind:'wwr-demand',url:'https://weworkremotely.com/categories/remote-customer-support-jobs.rss',segments:['professional_services'],demandKind:'paid_job',termsUrl:'https://weworkremotely.com/remote-job-rss-feed',license:'Public RSS with source attribution',reason:'Official public RSS explicitly offered for reuse with canonical links; nontechnical support duties are evidence of requested human work, not AI revenue.'},
 {name:'We Work Remotely · finance and administration requests',kind:'wwr-demand',url:'https://weworkremotely.com/categories/remote-management-and-finance-jobs.rss',segments:['professional_services'],demandKind:'paid_job',termsUrl:'https://weworkremotely.com/remote-job-rss-feed',license:'Public RSS with source attribution',reason:'Public English finance and administration vacancies with concrete recurring duties, preserving We Work Remotely attribution and links.'},
 {name:'We Work Remotely · sales and marketing requests',kind:'wwr-demand',url:'https://weworkremotely.com/categories/remote-sales-and-marketing-jobs.rss',segments:['professional_services'],demandKind:'paid_job',termsUrl:'https://weworkremotely.com/remote-job-rss-feed',license:'Public RSS with source attribution',reason:'Public English requests for nontechnical marketing, reporting and administrative work; source terms require canonical attribution.'},
 {name:'WooCommerce · public merchant tool requests',kind:'woocommerce-demand',url:'https://wordpress.org/support/plugin/woocommerce/feed/',segments:['ecommerce'],demandKind:'community_request',termsUrl:'https://wordpress.org/about/terms/',license:'Public support feed; short attributed task evidence only',reason:'Public merchant questions and complaints about repeated order, invoice, inventory and reporting chores; no author, profile, email or contact data is retained.'},
]);
// Discovery candidates are deliberately separate from operator bootstrap.
// These fixed scopes acquire no admission until a real quota-counted probe.
export const PUBLIC_DEMAND_DISCOVERY_FEEDS=Object.freeze([
 {name:'We Work Remotely · other nontechnical operations',kind:'wwr-demand',url:'https://weworkremotely.com/categories/all-other-remote-jobs.rss',segments:['professional_services'],demandKind:'paid_job',termsUrl:'https://weworkremotely.com/remote-job-rss-feed',license:'Public RSS with source attribution'},
 {name:'We Work Remotely · creative operations requests',kind:'wwr-demand',url:'https://weworkremotely.com/categories/remote-design-jobs.rss',segments:['professional_services'],demandKind:'paid_job',termsUrl:'https://weworkremotely.com/remote-job-rss-feed',license:'Public RSS with source attribution'},
 ...[
  ['WooCommerce PDF invoices','woocommerce-pdf-invoices-packing-slips','ecommerce'],
  ['WooCommerce order exports','woo-order-export-lite','ecommerce'],
  ['WooCommerce shipment tracking','woo-advanced-shipment-tracking','ecommerce'],
  ['WPForms administration','wpforms-lite','professional_services'],
  ['Bookly appointment administration','bookly-responsive-appointment-booking-tool','local_services'],
  ['Contact Form administration','contact-form-7','professional_services'],
  ['Mailchimp merchant newsletters','mailchimp-for-wp','ecommerce'],
  ['Job Manager administration','wp-job-manager','professional_services'],
 ].map(([name,slug,segment])=>({name:`Public tool requests · ${name}`,kind:'wordpress-request-demand',url:`https://wordpress.org/support/plugin/${slug}/feed/`,segments:[segment],demandKind:'community_request',termsUrl:'https://wordpress.org/about/terms/',license:'Public support feed; short attributed task evidence only'})),
].map(source=>Object.freeze({...source,reason:'An untried fixed public demand feed candidate; requires successful robots, readable task and privacy checks before probation admission.'})));

const values=value=>Array.isArray(value)?value:value===undefined||value===null?[]:[value];
const error=message=>Object.assign(new Error(message),{code:'invalid_demand_source',stage:'parse'});
const unhtml=value=>String(value||'').replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(?:x([0-9a-f]+)|(\d+));/gi,(_,hex,decimal)=>{const n=Number.parseInt(hex||decimal,hex?16:10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):' ';}).replace(/\s+/g,' ').trim();
const taskWords=/order|invoic|bookkeep|reconcil|payroll|account(?:ing|s payable|s receivable)|expense|receipt|inventory|stock|shipping|shipment|fulfil|fulfill|customer|support|ticket|refund|return|report|spreadsheet|\bcsv\b|document|data entry|schedul|appointment|booking|email|inbox|catalog|catalogue|product|recruit|candidate|marketing|campaign|content|social media|translation|translat|archive|archiv|record|compliance|audit|administrat|procurement|tender|business|management|service|print|publish/i;
const actionWords=/\b(?:need|want|looking|request|require|manage|monitor|maintain|review|reconcile|process|prepare|record|coordinate|organize|organise|track|update|create|generate|export|import|categorize|categorise|classify|respond|answer|resolve|send|draft|write|schedule|book|assist|support|provide|deliver|administrat\w*|automate|automatic|manually|manual|repeated|daily|weekly|monthly|every|can|how|help|unable|issue|problem)\b/i;
const technicalRole=/\b(?:software engineer|developer|programmer|devops|machine learning engineer|data scientist|systems engineer|full.stack|back.end|front.end|penetration tester)\b/i;
const allowedNames=new Set(['Excel','Word','Microsoft','Office','PowerPoint','Outlook','Google','Sheets','Visma','Fortnox','SAP','Shopify','WooCommerce','WordPress','Stripe','PayPal','QuickBooks','Xero','Salesforce','HubSpot','Zendesk','Intercom','Gorgias','Notion','Slack','CSV','PDF','CRM','SEO','UK','US','EU','English','French','German','Spanish','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']);
function likelyPersonalName(value){return [...value.matchAll(/\s([A-Z][a-zA-Z]{2,})\b/g)].some(match=>!allowedNames.has(match[1]));}
export function publicDemandTaskExcerpts(raw,{request=false}={}){
 if(typeof raw!=='string')return [];
 const blocks=raw.slice(0,80000).replace(/<\/(?:p|div|li|h[1-6]|ul|ol)>|<br\s*\/?\s*>/gi,'\n').split(/\n+|(?:[.!?]\s+)/).map(value=>unhtml(value).replace(/^[\s•*–—-]+/,''));
 return [...new Set(blocks)].filter(value=>value.length>=30&&value.length<=500&&taskWords.test(value)&&(actionWords.test(value)||request)&&!privateArtifactReasons(value).length&&!/https?:|www\.|\b(?:apply now|send your|contact us|resume|résumé|cover letter|interview|hiring process|salary range|years of experience|bachelor|master.s degree|equal opportunity|disability|sexual orientation|ethnic|veteran)\b/i.test(value)&&!likelyPersonalName(value)).slice(0,3);
}
const date=value=>{const raw=String(value||'');const day=raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0];if(day&&Number.isFinite(Date.parse(day)))return day;return Number.isFinite(Date.parse(raw))?new Date(raw).toISOString():null;};
const inDateWindow=(value,at)=>Date.parse(value)<=Date.parse(at)+86400000&&Date.parse(value)>=Date.parse(at)-45*86400000;
function makeItem(definition,page,{url,kind,postedAt,excerpts,noticeId}){
 const title=kind==='public_tender'?'Public EU business-service tender':kind==='community_request'?'Merchant workflow request':'Paid nontechnical operations role';
 const note=kind==='paid_job'?'A public vacancy requests human work; it establishes neither payment to an AI service nor demand for the proposed AI service.':kind==='public_tender'?'A competition notice requests a service; it does not establish a completed contract or payment to an AI service.':'A public merchant request documents a problem; willingness to pay and demand for the proposed AI service remain hypotheses.';
 const kept=[];for(const quote of excerpts)if([title,...kept,quote,`Published ${postedAt}.`,note].join(' ').length<=1200)kept.push(quote);
 if(!kept.length)return null;
 const record={id:hash(canonicalURL(url)),url:canonicalURL(url),title,publisher:definition.name,text:[title,...kept,`Published ${postedAt}.`,note].join(' '),taskExcerpts:kept,taskExcerptVersion:2,fetchedAt:page.fetchedAt,role:'demand',demand:true,demandMetadataVersion:1,registrySourceId:definition.id,segment:definition.segments[0],demandKind:kind,postedAt,demandEvidence:{kind,noticeId,status:'active',postedAt,...(kind==='paid_job'?{paid:true,paymentBasis:'public paid staff vacancy'}:{})},privacy:'Only literal non-personal task excerpts and public notice identity/date/status; no author, company, contact or profile objects.'};
 return privateArtifactReasons(record).length?null:record;
}
export const TED_SEARCH_FIELDS=Object.freeze(['publication-number','notice-title','title-proc','description-proc','description-lot','classification-cpv','publication-date','notice-type','deadline-date-lot','deadline-receipt-tender-date-lot','deadline-receipt-request-date-lot','deadline-receipt-expressions-date-lot']);
export function tedSearchBody(noticeId){return {query:noticeId?`publication-number=${noticeId}`:'classification-cpv=79* AND form-type=competition AND official-language=ENG SORT BY PD DESC',fields:[...TED_SEARCH_FIELDS],limit:noticeId?1:20,scope:'ACTIVE',checkQuerySyntax:false,paginationMode:'PAGE_NUMBER'};}
// The only POST is this official anonymous search. Robots/DNS/redirect/body
// checks remain inside fetchPublic; no credentials or arbitrary body are accepted.
export function publicDemandFetchOptions(definition,options={},noticeId=null){
 if(definition.kind!=='ted-service-demand')return options;
 if(definition.url!=='https://api.ted.europa.eu/v3/notices/search'||noticeId!==null&&!/^\d{1,7}-\d{4}$/.test(noticeId))throw error('TED requests require the exact public search endpoint and notice identity.');
 const fetchImpl=options.fetchImpl||globalThis.fetch;
 return {...options,fetchImpl:(url,init)=>String(url)==='https://api.ted.europa.eu/v3/notices/search'?fetchImpl(url,{...init,method:'POST',headers:{...init.headers,'content-type':'application/json'},body:JSON.stringify(tedSearchBody(noticeId))}):fetchImpl(url,init)};
}
export function parsePublicDemandPage(definition,page,{expectedUrl}={}){
 const items=[];
 if(definition.kind==='ted-service-demand'){
  let data;try{data=JSON.parse(page.text);}catch{throw error('TED returned invalid complete JSON.');}
  if(!Array.isArray(data.notices)||data.timedOut===true)throw error('TED search did not complete a bounded notice result.');
  for(const row of data.notices.slice(0,20)){
   const id=String(row['publication-number']||''),postedAt=date(row['publication-date']),types=values(row['notice-type']);
   if(!/^\d{1,7}-\d{4}$/.test(id)||!postedAt||!inDateWindow(postedAt,page.fetchedAt)||!types.some(type=>/^cn-|^pin-cfc/.test(type)))continue;
   const deadlines=['deadline-date-lot','deadline-receipt-tender-date-lot','deadline-receipt-request-date-lot','deadline-receipt-expressions-date-lot'].flatMap(field=>values(row[field])).map(date).filter(Boolean);
   // TED's ACTIVE scope does not itself prove that bidding is still open.
   // Keep a competition only when an explicit public deadline has not elapsed.
   if(!deadlines.some(value=>Date.parse(value)>=Date.parse(page.fetchedAt.slice(0,10))))continue;
   const url=`https://ted.europa.eu/en/notice/-/detail/${id}`;if(expectedUrl&&canonicalURL(expectedUrl)!==url)continue;
   const texts=[row['description-proc']?.eng,...values(row['description-lot']?.eng),row['title-proc']?.eng,row['notice-title']?.eng].flat().filter(value=>typeof value==='string');
   const excerpts=publicDemandTaskExcerpts(texts.join('\n'),{request:true});const item=makeItem(definition,page,{url,kind:'public_tender',postedAt,excerpts,noticeId:id});if(item)items.push(item);
  }
 }else{
  if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(page.text)||XMLValidator.validate(page.text)!==true)throw error('Demand RSS must be complete safe XML.');
  const data=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,processEntities:true,htmlEntities:true,parseTagValue:false}).parse(page.text);
  for(const row of values(data.rss?.channel?.item).slice(0,30)){
   const raw=typeof row.link==='string'?row.link:row.link?.['#text'];let url;try{url=canonicalURL(raw);}catch{continue;}
   const hostname=new URL(url).hostname,path=new URL(url).pathname,merchant=['woocommerce-demand','wordpress-request-demand'].includes(definition.kind);
   if(merchant?hostname!=='wordpress.org'||!/^\/support\/topic\/[a-zA-Z0-9_-]+\/?$/.test(path):hostname!=='weworkremotely.com'||!/^\/remote-jobs\/[a-zA-Z0-9_-]+\/?$/.test(path))continue;
   if(expectedUrl&&canonicalURL(expectedUrl)!==url)continue;
   const postedAt=date(row.pubDate);if(!postedAt||!inDateWindow(postedAt,page.fetchedAt)||row.expires_at&&Date.parse(row.expires_at)<Date.parse(page.fetchedAt))continue;
   if(!merchant&&(technicalRole.test(unhtml(row.title))||/\b(?:unpaid|volunteer|voluntary|equity.only|commission.only)\b/i.test(unhtml(row.title))||/\b(?:unpaid (?:position|role|internship)|volunteer (?:position|role)|equity.only|commission.only)\b/i.test(unhtml(row.description))))continue;
   const excerpts=publicDemandTaskExcerpts(row.description||row.encoded||'',{request:merchant});const item=makeItem(definition,page,{url,kind:merchant?'community_request':'paid_job',postedAt,excerpts,noticeId:hash(url)});if(item)items.push(item);
  }
 }
 const result=[...new Map(items.map(item=>[item.id,item])).values()].slice(0,20);if(!result.length)throw error('No current concrete privacy-safe task requests passed the public demand adapter.');return result;
}
export function publicDemandNoticeId(definition,raw){
 let url;try{url=new URL(raw);}catch{return null;}
 if(url.username||url.password||url.search||url.hash)return null;
 if(definition.kind==='ted-service-demand')return url.origin==='https://ted.europa.eu'?url.pathname.match(/^\/en\/notice\/-\/detail\/(\d{1,7}-\d{4})$/)?.[1]||null:null;
 if(definition.kind==='wwr-demand')return url.origin==='https://weworkremotely.com'&&/^\/remote-jobs\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname)?hash(canonicalURL(url)):null;
 if(['woocommerce-demand','wordpress-request-demand'].includes(definition.kind))return url.origin==='https://wordpress.org'&&/^\/support\/topic\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname)?hash(canonicalURL(url)):null;
 return null;
}
