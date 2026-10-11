import {fetchPublic,plainText} from './research.mjs';
import {canonicalURL,hash,safeError} from './storage.mjs';

export const PRODUCT_EVIDENCE_POLICY=Object.freeze({maxLeads:12,concurrency:3,maxPageBytes:2000000,maxREADMEBytes:350000,maxMetadataBytes:350000,maxTextCharacters:8000,timeBudgetMs:90000,maxRequestsPerLead:3});
const fail=(message,code='product_evidence_unavailable')=>Object.assign(new Error(message),{code,stage:'product-evidence'});
export function sourceEvidenceFetchOptions(source){
 if(source?.enriched!==true)return {};
 const maxBytes=source.evidenceKind==='github-readme'?PRODUCT_EVIDENCE_POLICY.maxREADMEBytes:source.evidenceKind==='product-page'?PRODUCT_EVIDENCE_POLICY.maxPageBytes:null;
 if(maxBytes===null||!source.evidenceFetch||Object.keys(source.evidenceFetch).length!==2||source.evidenceFetch.maxBytes!==maxBytes||source.evidenceFetch.complete!==true)throw fail('Enriched evidence has an invalid fixed fetch policy.','invalid_product_evidence_policy');
 return {maxBytes,complete:true};
}
const stamp=now=>new Date(typeof now==='function'?now():now).toISOString();
function publicURL(raw){try{if(typeof raw!=='string'||raw.length>4096) return null;const url=new URL(raw);if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||/(^|\.)(localhost|local|internal|test|invalid)$/i.test(url.hostname))return null;return canonicalURL(raw);}catch{return null;}}
function repository(raw){try{const url=new URL(raw),match=url.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/)?$/);return url.hostname==='github.com'&&match&&!['features','topics','collections','marketplace','orgs','users','settings'].includes(match[1])?{owner:match[1],name:match[2]}:null;}catch{return null;}}
const listingHosts=new Set(['news.ycombinator.com','hn.algolia.com','betalist.com','www.ycombinator.com']);
const editorialHosts=new Set(['techcrunch.com','simonwillison.net','www.latent.space','latent.space','www.bensbites.com','bensbites.com']);
function priority(productUrl,source){const url=new URL(productUrl);if(repository(productUrl))return 0;if(source.productUrl&&canonicalURL(source.productUrl)!==canonicalURL(source.url)&&!listingHosts.has(url.hostname))return 1;if(listingHosts.has(url.hostname))return 3;if(editorialHosts.has(url.hostname))return 4;return 2;}
export function selectProductLeads(sources,{originMap=[],previous=[],limit=PRODUCT_EVIDENCE_POLICY.maxLeads}={}){
 if(!Array.isArray(sources)||sources.length>800||!Number.isInteger(limit)||limit<0||limit>PRODUCT_EVIDENCE_POLICY.maxLeads)throw fail('Product lead selection exceeds its bounded input.','invalid_product_leads');
 const existing=new Set(previous.map(post=>publicURL(post?.productUrl)).filter(Boolean)),leads=new Map();
 for(let index=0;index<sources.length;index++){
  const source=sources[index];if(!source?.id||!publicURL(source.url))continue;
  const origins=originMap.filter(origin=>origin.sourceId===source.id&&origin.url===source.url),products=origins.length?origins.map(origin=>origin.productUrl||origin.url):[source.productUrl||source.url];
  for(const raw of products){const productUrl=publicURL(raw);if(!productUrl||existing.has(productUrl))continue;
   const matching=origins.filter(origin=>[origin.url,origin.productUrl].filter(Boolean).some(url=>canonicalURL(url)===productUrl)),feedIds=[...new Set(matching.flatMap(origin=>origin.feedIds||[]))];
   if(!leads.has(productUrl))leads.set(productUrl,{productUrl,title:String(source.title||'Public product documentation').slice(0,200),originSourceIds:[],originFeedIds:[],priority:priority(productUrl,source),index});
   const lead=leads.get(productUrl);lead.priority=Math.min(lead.priority,priority(productUrl,source));lead.originSourceIds=[...new Set([...lead.originSourceIds,source.id])].sort();lead.originFeedIds=[...new Set([...lead.originFeedIds,...feedIds])].sort();
  }
 }
 const ordered=[...leads.values()].sort((a,b)=>a.priority-b.priority||a.index-b.index||a.productUrl.localeCompare(b.productUrl)),selected=[],feedCounts=new Map();
 // First pass keeps one prolific listing from consuming the entire fetch budget.
 for(const lead of ordered){if(selected.length===limit)break;if(lead.originFeedIds.length&&lead.originFeedIds.every(id=>(feedCounts.get(id)||0)>=4))continue;selected.push(lead);for(const id of lead.originFeedIds)feedCounts.set(id,(feedCounts.get(id)||0)+1);}
 for(const lead of ordered){if(selected.length===limit)break;if(!selected.includes(lead))selected.push(lead);}
 return selected.map(({priority,index,...lead})=>lead);
}
function checkedPage(page,{requestedURL,maxBytes}={}){
 if(!page||!Number.isInteger(page.status)||page.status<200||page.status>=300||page.truncated!==false||!publicURL(page.url)||typeof page.text!=='string'||!Number.isFinite(Date.parse(page.fetchedAt))||!Array.isArray(page.robots)||!page.robots.length||page.robots.some(robot=>robot.allowed!==true))throw fail('Product evidence lacks a complete guarded public response.','incomplete_product_evidence');
 if(maxBytes!==undefined&&(!Number.isInteger(page.bytes)||page.bytes<1||page.bytes>maxBytes||page.maxBytes!==maxBytes))throw fail('Product evidence exceeds or omits its complete response budget.','incomplete_product_evidence');
 if(requestedURL){const redirects=page.redirects||[],serialize=url=>new URL(url).toString(),hops=[serialize(requestedURL),...redirects.map(redirect=>serialize(redirect.next))];if(!Array.isArray(redirects)||redirects.length>3||page.robots.length!==hops.length||redirects.some((redirect,index)=>!Number.isInteger(redirect.status)||redirect.status<300||redirect.status>=400||serialize(redirect.url)!==hops[index]||!publicURL(redirect.next))||page.robots.some((robot,index)=>serialize(robot.evaluatedUrl)!==hops[index]||robot.origin!==new URL(hops[index]).origin)||serialize(page.url)!==hops.at(-1))throw fail('Product evidence does not bind the guarded requested and redirected URLs.','incomplete_product_evidence');}
 if(!/^(?:text\/|application\/(?:[a-z0-9.+-]*\+)?(?:json|xml))/i.test(page.contentType||''))throw fail('Product evidence is not a readable public text response.','unreadable_product_evidence');
 return page;
}
function excerpt(text){if(text.length<=PRODUCT_EVIDENCE_POLICY.maxTextCharacters)return text;const prefix=text.slice(0,PRODUCT_EVIDENCE_POLICY.maxTextCharacters);return prefix.slice(0,prefix.lastIndexOf(' '));}
function sourceRecord(page,lead,kind){
 checkedPage(page);
 if(/<\s*(?:title|h1)[^>]*>\s*(?:sign\s*in|log\s*in|access denied|just a moment|attention required)|<input\b[^>]*type\s*=\s*["']?password/i.test(page.text))throw fail('Product page presents a login or access challenge.','product_login_or_challenge');
 if(kind==='product-page'&&/^application\/json\b/i.test(page.contentType))throw fail('An arbitrary JSON API is not product documentation.','unreadable_product_evidence');
 const text=plainText(page.text);if(text.length<300)throw fail('Product evidence contains too little readable capability text.','insufficient_product_evidence');
 const url=canonicalURL(page.url),publisher=new URL(url).hostname;
 return {id:hash(url),url,title:`${lead.title} · ${kind==='github-readme'?'public README':'product evidence'}`.slice(0,200),publisher,text:excerpt(text),fetchedAt:page.fetchedAt,productUrl:lead.productUrl,originSourceIds:lead.originSourceIds,evidenceKind:kind,evidenceFetch:{maxBytes:kind==='github-readme'?PRODUCT_EVIDENCE_POLICY.maxREADMEBytes:PRODUCT_EVIDENCE_POLICY.maxPageBytes,complete:true},enriched:true,evidenceExcerpted:text.length>PRODUCT_EVIDENCE_POLICY.maxTextCharacters,evidenceNote:'First-party documentation was fetched; it does not establish a deployed runtime, customers, revenue or full autonomy.',evidenceValidation:{robots:page.robots,redirects:page.redirects||[],httpStatus:page.status,contentType:page.contentType,resolvedUrl:page.url,maxBytes:page.maxBytes,truncated:false}};
}
async function leadEvidence(lead,fetchPage,signal,requestCount){
 const request=async(url,maxBytes)=>{if(signal.aborted)throw fail('Product enrichment reached its time budget.','product_evidence_timeout');requestCount.count++;if(requestCount.count>PRODUCT_EVIDENCE_POLICY.maxRequestsPerLead)throw fail('Product enrichment exceeded its request budget.','product_evidence_request_limit');let onAbort;try{const timeout=new Promise((resolve,reject)=>{onAbort=()=>reject(fail('Product enrichment reached its time budget.','product_evidence_timeout'));signal.addEventListener('abort',onAbort,{once:true});});const page=await Promise.race([fetchPage(url,{maxBytes,complete:true,signal,fetchImpl:(input,options)=>globalThis.fetch(input,{...options,signal:AbortSignal.any([options.signal,signal].filter(Boolean))})}),timeout]);return checkedPage(page,{requestedURL:url,maxBytes});}finally{signal.removeEventListener('abort',onAbort);}};
 const repo=repository(lead.productUrl);
 if(repo){
  const metadata=JSON.parse((await request(`https://api.github.com/repos/${repo.owner}/${repo.name}`,PRODUCT_EVIDENCE_POLICY.maxMetadataBytes)).text);
  if(metadata.private!==false||typeof metadata.full_name!=='string'||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(metadata.full_name)||metadata.full_name.toLowerCase()!==`${repo.owner}/${repo.name}`.toLowerCase())throw fail('GitHub metadata does not describe the selected public repository.','github_repository_unavailable');
  const readme=JSON.parse((await request(`https://api.github.com/repos/${metadata.full_name}/readme`,PRODUCT_EVIDENCE_POLICY.maxMetadataBytes)).text),raw=publicURL(readme.download_url);
  if(!raw||new URL(raw).hostname!=='raw.githubusercontent.com'||!new URL(raw).pathname.startsWith('/'+metadata.full_name+'/')||readme.type!=='file')throw fail('GitHub did not supply an exact public repository README URL.','github_readme_unavailable');
  return sourceRecord(await request(raw,PRODUCT_EVIDENCE_POLICY.maxREADMEBytes),lead,'github-readme');
 }
 return sourceRecord(await request(lead.productUrl,PRODUCT_EVIDENCE_POLICY.maxPageBytes),lead,'product-page');
}
export async function enrichProductLeads({sources,originMap=[],previous=[],fetchPage=fetchPublic,now=Date.now,limit=PRODUCT_EVIDENCE_POLICY.maxLeads,timeBudgetMs=PRODUCT_EVIDENCE_POLICY.timeBudgetMs}={}){
 if(!Number.isInteger(timeBudgetMs)||timeBudgetMs<1||timeBudgetMs>PRODUCT_EVIDENCE_POLICY.timeBudgetMs)throw fail('Invalid product enrichment time budget.','invalid_product_evidence_budget');
 const leads=selectProductLeads(sources,{originMap,previous,limit}),startedAt=stamp(now),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeBudgetMs),observations=Array(leads.length),evidence=Array(leads.length);let next=0;
 try{await Promise.all(Array.from({length:Math.min(PRODUCT_EVIDENCE_POLICY.concurrency,leads.length)},async()=>{
  while(next<leads.length){const index=next++,lead=leads[index],requestCount={count:0};try{const record=await leadEvidence(lead,fetchPage,controller.signal,requestCount);if(controller.signal.aborted)throw fail('Product enrichment reached its time budget.','product_evidence_timeout');evidence[index]=record;observations[index]={productUrl:lead.productUrl,originSourceIds:lead.originSourceIds,status:'fetched',evidenceIds:[record.id],evidenceUrls:[record.url],requests:requestCount.count,fetchedAt:record.fetchedAt,reason:record.evidenceNote};}catch(error){observations[index]={productUrl:lead.productUrl,originSourceIds:lead.originSourceIds,status:'failed',evidenceIds:[],evidenceUrls:[],requests:requestCount.count,completedAt:stamp(now),stage:error.stage||'product-evidence',code:error.code||'product_evidence_unavailable',reason:safeError(error)};}}
 }));}finally{clearTimeout(timer);}
 const merged=new Map(sources.map(source=>[source.id,{...source}]));
 for(const record of evidence.filter(Boolean)){const old=merged.get(record.id);if(old&&old.url!==record.url)throw fail('Product evidence ID conflicts with an original public source.','product_evidence_identity_conflict');merged.set(record.id,old?{...old,...record,feedExcerpt:old.text,originFeedIds:old.originFeedIds||[]}:record);}
 const fetched=observations.filter(item=>item.status==='fetched').length,failed=observations.filter(item=>item.status==='failed').length;
 return {sources:[...merged.values()],enrichment:{schema:1,status:leads.length?fetched?'completed':'failed':'no_new_leads',startedAt,completedAt:stamp(now),selected:leads.length,attempted:observations.filter(item=>item.requests>0).length,fetched,failed,requests:observations.reduce((sum,item)=>sum+item.requests,0),policy:PRODUCT_EVIDENCE_POLICY,observations}};
}
