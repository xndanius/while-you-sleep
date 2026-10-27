import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {canonicalURL,hash} from './storage.mjs';
import {privateArtifactReasons} from './privacy.mjs';
import {SEGMENTS} from './demand.mjs';

export const DISCUSSION_SOURCE_KINDS=Object.freeze(['hn-discussion','discourse-discussion','stackexchange-discussion','wordpress-discussion','provider-discussion']);
const fixed=values=>Object.freeze(values.map(value=>Object.freeze({...value,url:canonicalURL(value.url),id:hash(canonicalURL(value.url)),segments:[...SEGMENTS],role:'demand',metadataVersion:1,demandKind:'community_request',license:'Short attributed public discussion excerpts; payment remains a hypothesis'})));
export const DISCUSSION_SOURCE_CATALOG=fixed([
 {name:'Hacker News · Ask HN discussions',kind:'hn-discussion',url:'https://hn.algolia.com/api/v1/search_by_date?tags=ask_hn&hitsPerPage=40',community:'Hacker News Ask HN',termsUrl:'https://news.ycombinator.com/newsguidelines.html'},
 {name:'Hacker News · Show HN discussions',kind:'hn-discussion',url:'https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=40',community:'Hacker News Show HN',termsUrl:'https://news.ycombinator.com/showhn.html'},
 ...[['n8n','community.n8n.io'],['Make','community.make.com'],['Shopify','community.shopify.com'],['Activepieces','community.activepieces.com'],['Metabase','discourse.metabase.com']].map(([name,host])=>({name:`${name} · public discussions`,kind:'discourse-discussion',url:`https://${host}/latest.rss`,community:`${name} community`,termsUrl:`https://${host}/tos`})),
 {name:'Software Recommendations · public questions',kind:'stackexchange-discussion',url:'https://softwarerecs.stackexchange.com/feeds',community:'Stack Exchange Software Recommendations',termsUrl:'https://stackoverflow.com/legal/terms-of-service/public'},
 {name:'Software Recommendations · official public API',kind:'stackexchange-discussion',url:'https://api.stackexchange.com/2.3/questions?site=softwarerecs&sort=creation&order=desc&filter=withbody&pagesize=20',community:'Stack Exchange Software Recommendations',termsUrl:'https://api.stackexchange.com/docs/terms-of-use'},
 {name:'WordPress · public requests and feedback',kind:'wordpress-discussion',url:'https://wordpress.org/support/forum/requests-and-feedback/feed/',community:'WordPress requests and feedback',termsUrl:'https://wordpress.org/about/terms/'},
]);
export const DISCUSSION_PROVIDER_CATALOG=fixed([
 {name:'Reddit · public business discussions',kind:'provider-discussion',url:'https://www.reddit.com/',platform:'reddit',community:'Reddit',termsUrl:'https://redditinc.com/policies/data-api-terms'},
 {name:'X · public business discussions',kind:'provider-discussion',url:'https://x.com/',platform:'x',community:'X',termsUrl:'https://x.com/en/tos'},
 {name:'Indie Hackers · public discussions',kind:'provider-discussion',url:'https://www.indiehackers.com/post',platform:'indiehackers',community:'Indie Hackers',termsUrl:'https://www.indiehackers.com/terms'},
 {name:'Product Hunt · public discussions',kind:'provider-discussion',url:'https://www.producthunt.com/',platform:'producthunt',community:'Product Hunt',termsUrl:'https://www.producthunt.com/legal'},
]);
export function discussionSourceDefinition(source){try{return [...DISCUSSION_SOURCE_CATALOG,...DISCUSSION_PROVIDER_CATALOG].find(value=>value.kind===source?.kind&&value.url===canonicalURL(source.url)&&(!source.id||source.id===value.id))||null;}catch{return null;}}
// HN already returns forty requested hits. Examine that bounded response before
// admission; retain at most twenty safe records just like every other adapter.
export const discussionScanItemLimit=(source,format='json')=>format==='json'&&discussionSourceDefinition(source)?.kind==='hn-discussion'?40:20;
export const isDiscussionSourceDefinition=source=>!!discussionSourceDefinition(source);
export const isCurrentResearchSource=source=>isDiscussionSourceDefinition(source);
export const isJobOrTenderSource=source=>['jobtech-demand','uk-contracts-demand','uk-tenders-demand','ted-service-demand','wwr-demand'].includes(source?.kind);
const fail=(message,code='invalid_discussion_source')=>Object.assign(new Error(message),{code,stage:'parse'});
const list=value=>Array.isArray(value)?value:value===undefined||value===null?[]:[value];
const plain=value=>String(value||'').replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(?:x([0-9a-f]+)|(\d+));/gi,(_,hex,decimal)=>{const point=Number.parseInt(hex||decimal,hex?16:10);return point>0&&point<=0x10ffff?String.fromCodePoint(point):' ';}).replace(/\s+/g,' ').trim();
const unsafe=value=>privateArtifactReasons(value).length>0||/https?:\/\/|www\.|\bu\/[a-z0-9_-]+\b|\b(?:posted by|written by|username|profile)\b/i.test(value);
const intent=/\b(?:need|want|looking for|tool|service|software|business|workflow|manual|daily|weekly|monthly|every|repetitive|automate|automation|invoice|customer|order|inventory|schedule|appointment|report|spreadsheet|problem|how|help|show hn|ask hn)\b/i;
const advertTitle=/^(?:(?:ask|show) hn:\s*)?(?:who is hiring\b|who wants to be hired\b|(?:we are|we're|we’re|now) hiring\b|hiring\s*[:–—-]|for hire\b|join our team\b|(?:new )?job (?:openings?|vacanc(?:y|ies)|opportunit(?:y|ies))\b|career opportunit(?:y|ies)\b|(?:invitation|invite) to tender\b|tender (?:notice|opportunity|invitation)\b|request for (?:proposals?|quotations?|bids)\b|(?:rfp|rfq)\s*:)|^\[(?:hiring|for hire|job offer|job opening)\]/i;
const toolRequest=/\b(?:need|want|looking for|seeking|request|recommend(?:ation)?|is there|does anyone know)\b.{0,150}\b(?:tool|service|plugin|software|app|automation)\b|\b(?:tool|service|plugin|software|automation) (?:request|recommendation)\b/i;
const workContext=/\b(?:business|customer|client|order|invoic\w*|inventory|stock|shipping|bookkeep\w*|accounting|document|report|spreadsheet|csv|record|email|inbox|ticket|support|appointment|booking|schedule|payroll|receipt|recruit\w*|candidate|hiring paperwork|interview|workflow|tool|software|service|app)\b/i;
const workAction=/\b(?:copy|enter|process|reconcile|extract|generate|draft|export|import|manage|track|automate|schedule|organize|organise|summari\w*|classify|collect|match|catch(?:es)?|review|prepare|handle)\b/i;
// These integration verbs rank literal excerpts only; admission stays unchanged.
const excerptWorkAction=/\b(?:map(?:s|ped|ping)?|connect(?:s|ed|ing)?)\b/i;
const repetition=/\b(?:daily|weekly|monthly|every (?:day|week|month|morning|order)|repeat(?:ed|ing|itive)?|recurring|manually|manual|bulk|batch|time.consuming)\b/i;
const choreContext=/\b(?:customer|client|orders?|invoic\w*|inventory|stock|shipping|bookkeep\w*|accounting|documents?|reports?|spreadsheets?|csv|records?|emails?|inbox|tickets?|appointment|booking|schedule|payroll|receipt|recruit\w*|candidate|paperwork|interview)\b/i;
const bugReport=/\b(?:bugs?|crash(?:es|ing|ed)?|fatal error|exception|stack trace|errors?|http\s*[45]\d\d|not working|stopped working|does not work|broken|fails? (?:to|when))\b/i;
function discussionAdmissible(title,excerpt){
 if(advertTitle.test(title))return false;
 const value=title+' '+excerpt,request=toolRequest.test(value),recurring=repetition.test(value)&&choreContext.test(value)&&workAction.test(value);
 if(bugReport.test(value)&&!request&&!recurring)return false;
 const problem=/\b(?:problem|struggl\w*|pain point|challenge|frustrat\w*|tired of|cannot|can't|unable|how (?:do|can|to|does|would)|looking for|need|want|recommend(?:ation)?|is there|help (?:me|us|with))\b/i.test(value)&&workContext.test(value);
 const idea=/\b(?:business idea|idea for|built|building|made|launched|show hn)\b/i.test(value)&&(workContext.test(value)||workAction.test(value));
 return request||recurring||problem||idea;
}
export function discussionExcerpt(value){
 const raw=String(value||'').slice(0,80000).replace(/<\/(?:p|div|li|h[1-6])>|<br\s*\/?\s*>/gi,'\n');
 const blocks=raw.split(/\n+|(?<=[.!?])\s+/).map(plain).filter(value=>value.length>=25&&!unsafe(value));
 // Rank only the exact bounded text that can be retained. A generic opening
 // must not hide a later stated task; these hints make no editorial judgment.
 const candidates=blocks.map((block,index)=>{
  const excerpt=block.length<=200?block:block.slice(0,201).replace(/\s+\S*$/,'').trim();
  if(excerpt.length<25||excerpt.length>200||unsafe(excerpt))return null;
  const concrete=(workAction.test(excerpt)||excerptWorkAction.test(excerpt))&&choreContext.test(excerpt);
  const priority=(concrete?8:0)+(concrete&&repetition.test(excerpt)?4:0)+(toolRequest.test(excerpt)&&choreContext.test(excerpt)?2:0)+(intent.test(excerpt)?1:0);
  return {excerpt,index,priority};
 }).filter(Boolean).sort((a,b)=>b.priority-a.priority||a.index-b.index);
 // Copy one literal contiguous excerpt. Do not join blocks or redact a speaker.
 return candidates[0]?.excerpt||null;
}
export function discussionSegment(value){const text=String(value||'');return /\b(?:shop|store|merchant|ecommerce|e-commerce|order|inventory|shipping|woocommerce)\b/i.test(text)?'ecommerce':/\b(?:school|teacher|student|classroom|education|course)\b/i.test(text)?'education':/\b(?:clinic|medical|health|appointment|patient)\b/i.test(text)?'health_admin':/\b(?:property|rental|landlord|construction|building maintenance)\b/i.test(text)?'construction_property':/\b(?:council|municipal|government|public sector)\b/i.test(text)?'public_sector':/\b(?:household|home chores|family|personal finance)\b/i.test(text)?'households':/\b(?:cleaning|salon|plumber|repair service|local service)\b/i.test(text)?'local_services':/\b(?:developer|programmer|api|code|github|software engineer)\b/i.test(text)?'ai_software_builders':'professional_services';}
export function discussionPostURL(definition,raw){
 const known=discussionSourceDefinition(definition);if(!known)return null;
 try{const url=new URL(raw);if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443')return null;url.hash='';
  if(known.kind==='hn-discussion')return url.origin==='https://news.ycombinator.com'&&url.pathname==='/item'&&/^\d{1,14}$/.test(url.searchParams.get('id')||'')&&[...url.searchParams.keys()].length===1?canonicalURL(url):null;
  if(known.kind==='provider-discussion'){
   const valid=known.platform==='reddit'?(url.hostname==='www.reddit.com'||url.hostname==='reddit.com')&&/^\/(?:r\/[A-Za-z0-9_]+\/)?comments\/[a-z0-9]+(?:\/[^/]*)?\/?$/i.test(url.pathname):known.platform==='x'?['x.com','www.x.com','twitter.com','www.twitter.com'].includes(url.hostname)&&/^\/[A-Za-z0-9_]+\/status\/\d{1,24}\/?$/.test(url.pathname):known.platform==='indiehackers'?['www.indiehackers.com','indiehackers.com'].includes(url.hostname)&&/^\/post\/[^\s]+$/.test(url.pathname):['www.producthunt.com','producthunt.com'].includes(url.hostname)&&/^\/(?:posts|products|discussions|p)\/[^\s]+$/.test(url.pathname);
   if(!valid)return null;
   // X's canonical status URL can omit the handle entirely.
   if(known.platform==='x')return `https://x.com/i/status/${url.pathname.match(/\/status\/(\d+)/)[1]}`;
   if(known.platform==='reddit')return `https://www.reddit.com/comments/${url.pathname.match(/\/comments\/([a-z0-9]+)/i)[1].toLowerCase()}`;
   const comment=known.platform==='producthunt'?url.searchParams.get('comment'):null;if(url.search&&(!comment||!/^\d{1,24}$/.test(comment)||[...url.searchParams.keys()].length!==1))return null;
   url.search='';if(comment)url.searchParams.set('comment',comment);return canonicalURL(url);
  }
  if(known.kind==='stackexchange-discussion')return url.origin==='https://softwarerecs.stackexchange.com'&&/^\/questions\/\d+(?:\/[^/]+)?\/?$/.test(url.pathname)&&!url.search?canonicalURL(url):null;
  if(url.origin!==new URL(known.url).origin||url.search)return null;
  const valid=known.kind==='discourse-discussion'?/^\/t\/(?:[^/]+\/)?\d+(?:\/\d+)?\/?$/.test(url.pathname):known.kind==='stackexchange-discussion'?/^\/questions\/\d+(?:\/[^/]+)?\/?$/.test(url.pathname):/^\/support\/topic\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
  if(valid&&known.kind==='discourse-discussion'){const id=url.pathname.match(/^\/t\/(?:[^/]+\/)?(\d+)(?:\/\d+)?\/?$/)?.[1];return id?url.origin+'/t/'+id:null;}
  return valid?canonicalURL(url):null;
 }catch{return null;}
}
const finiteDate=value=>typeof value==='string'&&value.length<=80&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
export function makeDiscussionSource(definition,item,{fetchedAt=new Date().toISOString()}={}){
 const known=discussionSourceDefinition(definition),url=discussionPostURL(known,item?.url),title=plain(item?.title),postedAt=finiteDate(item?.date||item?.postedAt),text=discussionExcerpt(item?.excerpt||item?.text||title);
 if(!known||!url||!title||title.length>200||unsafe(title)||!text||!discussionAdmissible(title,text)||!postedAt||!Number.isFinite(Date.parse(fetchedAt))||Date.parse(postedAt)>Date.parse(fetchedAt)+86400000||Date.parse(postedAt)<Date.parse(fetchedAt)-45*86400000)return null;
 const community=known.platform==='reddit'&&/^Reddit r\/[A-Za-z0-9_]+$/.test(item.community||'')?item.community:known.community;
 const record={id:hash(url),url,productUrl:url,title,text,community,postedAt,fetchedAt,role:'demand',demand:true,demandMetadataVersion:1,discussionMetadataVersion:1,registrySourceId:known.id,segment:discussionSegment(title+' '+text),demandKind:'community_request',taskExcerpts:[text],taskExcerptVersion:2,demandEvidence:{kind:'community_request',noticeId:hash(url),status:'active',postedAt}};
 return privateArtifactReasons(record).length?null:record;
}
export function parseDiscussionSourcePage(definition,page,{expectedUrl}={}){
 const known=discussionSourceDefinition(definition);if(!known||known.kind==='provider-discussion')throw fail('Public adapters cannot own-fetch provider sources.');
 if(page.truncated!==false||new URL(page.url).origin!==new URL(known.url).origin)throw fail('A complete guarded response on the fixed discussion origin is required.');
 let rows=[],format='rss';
 if(known.kind==='stackexchange-discussion'&&new URL(known.url).hostname==='api.stackexchange.com'){
  let data;try{data=JSON.parse(page.text);}catch{throw fail('Official discussion API JSON is invalid.');}format='json';
  if(data.backoff!==undefined||data.quota_remaining===0)throw fail('Official discussion API requests a backoff or has no anonymous quota.','source_api_backoff');
  if(!Array.isArray(data.items)||data.error_id)throw fail('Official discussion API returned no valid public question list.');
  rows=data.items.slice(0,20).map(row=>({url:row.link,title:row.title,text:row.body,date:Number.isInteger(row.creation_date)?new Date(row.creation_date*1000).toISOString():null}));
 }else if(known.kind==='hn-discussion'){
  let data;try{data=JSON.parse(page.text);}catch{throw fail('Discussion JSON is invalid.');}format='json';
  if(Array.isArray(data.hits))rows=data.hits.slice(0,discussionScanItemLimit(known)).map(row=>({url:`https://news.ycombinator.com/item?id=${row.objectID}`,title:row.title,text:row.story_text||row.title,date:row.created_at}));
  else if(/^\d{1,14}$/.test(String(data.id))&&typeof data.title==='string')rows=[{url:`https://news.ycombinator.com/item?id=${data.id}`,title:data.title,text:data.text||data.title,date:data.created_at}];
  else throw fail('Discussion JSON has no bounded public item shape.');
 }else if(known.kind==='discourse-discussion'&&/\.json(?:$|\?)/.test(page.url)){
  let data;try{data=JSON.parse(page.text);}catch{throw fail('Discussion JSON is invalid.');}format='json';const first=data.post_stream?.posts?.find(row=>row.post_number===1);if(!first||!Number.isInteger(data.id))throw fail('Discussion JSON has no public first post.');rows=[{url:`${new URL(known.url).origin}/t/${data.slug||'topic'}/${data.id}`,title:data.title,text:first.cooked,date:data.created_at}];
 }else{
  if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(page.text)||XMLValidator.validate(page.text)!==true)throw fail('Discussion feed must be complete safe XML.');
  const data=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,processEntities:true,htmlEntities:true,parseTagValue:false}).parse(page.text);
  if(data.rss?.channel&&typeof data.rss.channel==='object')rows=list(data.rss.channel.item).slice(0,20).map(row=>({url:typeof row.link==='string'?row.link:row.link?.['#text'],title:row.title,text:row.encoded||row.description,date:row.pubDate}));
  else if(data.feed&&typeof data.feed==='object'){format='atom';rows=list(data.feed.entry).slice(0,20).map(row=>({url:list(row.link).find(value=>value?.['@_rel']==='alternate'||!value?.['@_rel'])?.['@_href'],title:row.title?.['#text']||row.title,text:row.content?.['#text']||row.content||row.summary?.['#text']||row.summary,date:row.published||row.updated}));}
  else throw fail('Discussion feed has neither RSS nor Atom structure.');
 }
 const items=[...new Map(rows.map(row=>makeDiscussionSource(known,row,{fetchedAt:page.fetchedAt})).filter(item=>item&&(!expectedUrl||canonicalURL(expectedUrl)===item.url)).map(item=>[item.id,item])).values()].slice(0,20);
 if(!items.length)throw Object.assign(fail('The guarded discussion feed has no current privacy-safe public problem or idea excerpts.','no_eligible_demand_tasks'),{emptyFeed:{schema:1,format,examinedItems:rows.length,eligibleItems:0}});
 return items;
}
export function discussionEvidenceURL(definition,source){const known=discussionSourceDefinition(definition),url=discussionPostURL(known,source?.url);if(!known||!url||source.id!==hash(url)||source.registrySourceId!==known.id)throw fail('Discussion evidence does not match its fixed registry origin.');if(known.kind==='provider-discussion')return null;if(known.kind==='hn-discussion')return `https://hn.algolia.com/api/v1/items/${new URL(url).searchParams.get('id')}`;if(known.kind==='discourse-discussion')return url+'.json';if(known.kind==='stackexchange-discussion'&&new URL(known.url).hostname==='api.stackexchange.com')return `https://api.stackexchange.com/2.3/questions/${new URL(url).pathname.match(/^\/questions\/(\d+)/)[1]}?site=softwarerecs&filter=withbody`;return known.url;}

const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),boundedId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(value);
export function validProviderPoolProof(proof,definition){const known=discussionSourceDefinition(definition);return !!known&&known.kind==='provider-discussion'&&!!proof&&Object.keys(proof).length===6&&proof.provider==='apify'&&proof.platform===known.platform&&proof.definitionId===known.id&&boundedId(proof.receiptId)&&hex(proof.poolHash)&&hex(proof.postHash);}
export function validProviderSourceValidation(validation,definition=null){
 try{const v=validation,known=definition?discussionSourceDefinition(definition):DISCUSSION_PROVIDER_CATALOG.find(source=>source.id===v?.definitionId);return !!known&&known.kind==='provider-discussion'&&!!v&&Object.keys(v).length===9&&v.schema===1&&v.type==='provider-pool-validation'&&v.provider==='apify'&&v.definitionId===known.id&&v.platform===known.platform&&Number.isFinite(Date.parse(v.fetchedAt))&&v.parserVersion==='provider-discussions-v1'&&Number.isInteger(v.itemCount)&&v.itemCount>=1&&v.itemCount<=20&&Array.isArray(v.items)&&v.items.length===v.itemCount&&new Set(v.items.map(item=>item.sourceId)).size===v.itemCount&&v.items.every(item=>Object.keys(item).length===3&&discussionPostURL(known,item.url)===item.url&&item.sourceId===hash(item.url)&&validProviderPoolProof(item.proof,known));}catch{return false;}
}
// The caller must first validate every proof against its immutable receipt and
// stored pool. This factory only seals the already verified control metadata.
export function createProviderSourceValidation(definition,entries,{fetchedAt=new Date().toISOString()}={}){
 const known=discussionSourceDefinition(definition);if(!known||known.kind!=='provider-discussion')throw fail('Provider validation requires an exact fixed provider scope.');
 const items=entries.map(entry=>{const source=entry.source||makeDiscussionSource(known,entry.post,{fetchedAt});if(!source||source.registrySourceId!==known.id||!validProviderPoolProof(entry.proof,known))throw fail('Provider proof or sanitized source does not match its fixed scope.');return {sourceId:source.id,url:source.url,proof:entry.proof};});
 const validation={schema:1,type:'provider-pool-validation',provider:'apify',definitionId:known.id,platform:known.platform,fetchedAt,itemCount:items.length,parserVersion:'provider-discussions-v1',items};if(!validProviderSourceValidation(validation,known))throw fail('Provider pool validation is empty, duplicate or malformed.');return validation;
}
