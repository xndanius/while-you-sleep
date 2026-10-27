import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {hash,canonicalURL,safeError} from './storage.mjs';
import {fetchPublic,FEED_MAX_BYTES} from './source-fetch.mjs';
import {sourceDefinitions} from './source-catalog.mjs';
import {DEMAND_SOURCE_KINDS,isDemandSourceDefinition,parseDemandSourcePage,demandSourceFetchOptions} from './demand-sources.mjs';
import {retainSafeBuildingScan} from './research-privacy.mjs';
import {privateArtifactReasons} from './privacy.mjs';
import {discussionScanItemLimit} from './discussion-sources.mjs';
export {sourceRole,sourceSegments,sourceDemandKind,demandSourceMetadata,fetchDemandEvidence} from './demand-sources.mjs';
export {fetchPublic,validateURL} from './source-fetch.mjs';
export {sourceDefinitions,sourceSeedCatalog} from './source-catalog.mjs';

export const SOURCE_PARSER_VERSION='public-sources-v2';
export const SOURCE_KINDS=Object.freeze(['hn','rss','html','json-feed','github-trending','hf-spaces','hn-launches','yc-directory','betalist','yc-launches','n8n-workflows','unparsed-listing',...DEMAND_SOURCE_KINDS]);
const list=value=>Array.isArray(value)?value:value?[value]:[];
const fail=(message,code='parse_failed')=>Object.assign(new Error(message),{code,stage:'parse'});

export function plainText(html){
 return String(html||'').replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(?:x([0-9a-f]+)|(\d+));/gi,(entity,hex,decimal)=>{
  const point=Number.parseInt(hex||decimal,hex?16:10);return Number.isInteger(point)&&point>0&&point<=0x10ffff&&!(point>=0xd800&&point<=0xdfff)?String.fromCodePoint(point):entity;
 }).replace(/\s+/g,' ').trim();
}
function publicSyntax(raw,base){
 if(typeof raw!=='string'||!raw.trim()||raw.length>4096)return null;
 try{const url=new URL(raw,base);if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||/(^|\.)(localhost|local|internal|test|invalid)$/i.test(url.hostname))return null;return canonicalURL(url.toString());}catch{return null;}
}
function source(title,raw,publisher,text,fetchedAt,extras={}){
 const url=publicSyntax(raw);if(!url)return null;
 return {id:hash(url),title:plainText(title).slice(0,200),url,publisher,text:plainText(text).slice(0,1200),fetchedAt,...extras};
}
function attribute(tag,name){return tag.match(new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i'))?.slice(1).find(value=>value!==undefined);}
function anchors(html){return [...html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi,'').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(match=>{const href=attribute(match[1],'href');return {href:typeof href==='string'&&href.length<=4096?href:null,text:plainText(match[2]),html:match[0]};});}
function xmlURLText(value){
 if(typeof value!=='string'||value.length>4096)return null;
 // DTDs are prohibited above. Decode only XML's predefined and numeric
 // references, once, without treating a URL as HTML or expanding entities.
 const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
 return value.replace(/&(?:amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#\d+);/g,entity=>{
  const key=entity.slice(1,-1);if(key[0]!=='#')return named[key];
  const point=Number.parseInt(key.startsWith('#x')?key.slice(2):key.slice(1),key.startsWith('#x')?16:10);
  return Number.isInteger(point)&&point>0&&point<=0x10ffff&&!(point>=0xd800&&point<=0xdfff)?String.fromCodePoint(point):entity;
 });
}

export function normalizeSourceDefinition(value){
 const url=publicSyntax(value?.url);
 if(!url||typeof value?.name!=='string'||!value.name.trim()||value.name.length>160||!SOURCE_KINDS.includes(value.kind))throw fail('Source definition needs a public HTTPS URL, bounded name and a fixed supported adapter.','invalid_definition');
 if(value.kind==='n8n-workflows'&&(new URL(url).hostname!=='n8n.io'||!/^\/workflows\/categories\/[a-z0-9-]+\/?$/.test(new URL(url).pathname)))throw fail('The workflow listing adapter accepts only public n8n category pages.','invalid_definition');
 if(DEMAND_SOURCE_KINDS.includes(value.kind)&&!isDemandSourceDefinition({...value,url}))throw fail('Demand feeds require an exact vetted official definition.','invalid_definition');
 const id=hash(url);if(value.id!==undefined&&value.id!==id)throw fail('Source definition ID does not match its canonical URL.','invalid_definition');
 return {id,name:value.name,url,kind:value.kind};
}

export function parseSourcePage(definition,page){
 const feed=normalizeSourceDefinition(definition),base=page.url||feed.url;
 if(page.truncated)throw fail('A complete response is required before source items can be parsed.','incomplete_body');
 let items=[];
 if(DEMAND_SOURCE_KINDS.includes(feed.kind)){
  items=parseDemandSourcePage(feed,page);
 }else if(feed.kind==='hn'){
  const parsed=JSON.parse(page.text);if(!Array.isArray(parsed.hits))throw fail('Hacker News response has no public hits array.');
  items=parsed.hits.slice(0,20).filter(value=>typeof value.title==='string'&&/^\d+$/.test(String(value.objectID))).map(value=>source(value.title,`https://news.ycombinator.com/item?id=${value.objectID}`,feed.name,[value.title,value.story_text||'',value.url?`Product URL: ${value.url}`:''].join('\n'),page.fetchedAt,{productUrl:publicSyntax(value.url),discoveredAt:value.created_at||null}));
 }else if(feed.kind==='rss'){
  if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(page.text))throw fail('Feed DTD or entity declarations are not accepted.','unsafe_xml');
  const valid=XMLValidator.validate(page.text);if(valid!==true)throw fail('RSS/Atom is not complete valid XML.','invalid_xml');
  const parsed=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,processEntities:false,parseTagValue:false,parseAttributeValue:false}).parse(page.text);
  const entries=list(parsed.rss?.channel?.item||parsed.feed?.entry).slice(0,20);
  items=entries.map(value=>{
   const links=list(value.link),link=links.find(link=>typeof link==='string'||!link?.['@_rel']||link?.['@_rel']==='alternate');
   const rawLink=typeof link==='string'?link:link?.['@_href'];
   const url=publicSyntax(xmlURLText(rawLink),base),body=typeof value.content==='object'?value.content?.['#text']:value.content;
   return url?source(value.title?.['#text']||value.title||feed.name,url,feed.name,body||value.encoded||value.description||value.summary?.['#text']||value.summary||'',page.fetchedAt,{discoveredAt:value.published||value.pubDate||value.updated||null}):null;
  });
 }else if(feed.kind==='json-feed'){
  const parsed=JSON.parse(page.text);if(!/^https:\/\/jsonfeed\.org\/version\//.test(parsed.version||'')||!Array.isArray(parsed.items))throw fail('JSON is not a supported public JSON Feed.');
  items=parsed.items.slice(0,20).map(value=>source(value.title||feed.name,publicSyntax(value.url||value.external_url,base),feed.name,value.content_text||value.content_html||value.summary||'',page.fetchedAt,{discoveredAt:value.date_published||null}));
 }else if(feed.kind==='hf-spaces'){
  const parsed=JSON.parse(page.text);if(!Array.isArray(parsed))throw fail('Hugging Face Spaces must be a compact public list.');
  items=parsed.slice(0,20).filter(value=>value.private===false&&typeof value.id==='string'&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.id)).map(value=>{
   const url=`https://huggingface.co/spaces/${value.id}`;
   return source(value.id,url,feed.name,`Public Hugging Face Space listing: ${value.id}. SDK: ${String(value.sdk||'unspecified')}. Tags: ${list(value.tags).filter(tag=>typeof tag==='string').slice(0,15).join(', ')}. Listing alone does not establish working runtime, customers or revenue.`,page.fetchedAt,{productUrl:url,discoveredAt:value.createdAt||null});
  });
 }else if(feed.kind==='github-trending'){
  const rows=[...page.text.matchAll(/<article\b[^>]*class\s*=\s*["'][^"']*\bBox-row\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi)];
  items=rows.slice(0,20).map(row=>{
   const heading=row[1].match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1]||'',link=anchors(heading).find(link=>/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(link.href||''));
   if(!link)return null;const url=publicSyntax(link.href,'https://github.com'),description=row[1].match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1]||'';
   return source(link.text||link.href.slice(1),url,feed.name,`${link.text}. ${plainText(description)} This is a public repository listing, not proof of users, revenue or a running service.`,page.fetchedAt,{productUrl:url});
  });
 }else if(feed.kind==='n8n-workflows'){
  if(new URL(base).hostname!=='n8n.io'||!/^text\/html\b/i.test(page.contentType||''))throw fail('A workflow category must remain on the public n8n HTML origin.','invalid_workflow_listing');
  const rows=anchors(page.text).filter(link=>{
   if(!attribute(link.html.match(/^<a\b([^>]*)>/i)?.[1]||'','class')?.split(/\s+/).includes('workflow-result-item'))return false;
   try{const url=new URL(link.href,base);return url.origin==='https://n8n.io'&&/^\/workflows\/[1-9]\d{0,9}-[a-z0-9]+(?:-[a-z0-9]+)*\/?$/.test(url.pathname)&&!url.search&&!url.hash;}catch{return false;}
  }).slice(0,20);
  items=rows.map(link=>{
   const heading=link.html.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1],title=plainText(heading||''),url=publicSyntax(link.href,base);
   if(!title||!url)return null;
   // Listing authors, avatars and profile badges are separate from the public
   // capability description. Keep only a complete literal safe paragraph from
   // the named description block; an unknown card shape supplies its title only.
   const body=link.html.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bworkflow-desc\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]||'';
   const description=body.replace(/<\/p>|<br\s*\/?\s*>/gi,'\n\n').split(/\r?\n\s*\r?\n/).map(plainText).find(text=>text.length>=40&&text.length<=1000&&/[.!?]$/.test(text)&&!/(?:\.{3}|…)\s*$/.test(text)&&privateArtifactReasons(text).length===0)||'';
   return source(title,url,feed.name,[title,description].filter(Boolean).join(' '),page.fetchedAt,{productUrl:url,discoveryKind:'public-workflow-template',evidenceNote:'A public user-contributed workflow template listing, not proof of a running business, customers or revenue. Its detail documentation needs a fresh independent check.'});
  });
 }else if(feed.kind==='hn-launches'){
  const rows=[...page.text.matchAll(/<tr\b([^>]*class\s*=\s*["'][^"']*\bathing\b[^"']*["'][^>]*)>([\s\S]*?)<\/tr>/gi)];
  items=rows.slice(0,20).map(row=>{
   const id=attribute(row[1],'id'),title=row[2].match(/<span\b[^>]*class\s*=\s*["'][^"']*\btitleline\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1],link=anchors(title||'')[0];
   if(!/^\d+$/.test(id||'')||!link)return null;
   return source(link.text,`https://news.ycombinator.com/item?id=${id}`,feed.name,`Launch HN discussion title: ${link.text}. Product URL: ${publicSyntax(link.href,base)||'unavailable'}. Discussion listing alone does not establish users or revenue.`,page.fetchedAt,{productUrl:publicSyntax(link.href,base)});
  });
 }else if(['betalist','yc-directory','yc-launches'].includes(feed.kind)){
  const pattern=feed.kind==='betalist'?/^\/startups\/[A-Za-z0-9_-]+$/:feed.kind==='yc-directory'?/^\/companies\/[A-Za-z0-9_-]+$/:/^\/launches\/[A-Za-z0-9_-]+$/;
  if(feed.kind==='betalist'){
   const html=page.text.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi,''),rows=[...html.matchAll(/<div\b([^>]*)>/gi)].filter(match=>attribute(match[1],'class')?.split(/\s+/).includes('startup-row'));
   items=rows.slice(0,20).map((row,index)=>{
    const body=html.slice(row.index+row[0].length,Math.min(rows[index+1]?.index??html.length,row.index+20000)),link=anchors(body).find(value=>{try{const url=new URL(value.href,base);return pattern.test(url.pathname)&&url.origin===new URL(base).origin;}catch{return false;}});
    const spans=[...body.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi)],heading=spans.find(value=>attribute(value[1],'class')?.split(/\s+/).includes('font-medium'));
    if(!link||!heading)return null;
    const title=plainText(heading[2]),description=spans.find(value=>value.index>heading.index&&attribute(value[1],'class')?.split(/\s+/).includes('text-gray-500'))?.[2]||'',url=publicSyntax(link.href,base);
    return source(title,url,feed.name,`${title}. ${plainText(description)} Public startup listing; maker evidence requires a fresh independent check.`,page.fetchedAt,{productUrl:url});
   });
  }
  const links=anchors(page.text).filter(link=>{try{return pattern.test(new URL(link.href,base).pathname)&&new URL(link.href,base).origin===new URL(base).origin;}catch{return false;}});
  items.push(...links.filter(link=>link.text.length>=2).slice(0,40).map(link=>{const url=publicSyntax(link.href,base);return source(link.text,url,feed.name,`${link.text}. Public ${feed.kind==='betalist'?'startup listing':feed.kind==='yc-directory'?'company directory entry':'launch listing'}; maker evidence requires a fresh independent check.`,page.fetchedAt,{productUrl:url});}));
 }else if(feed.kind==='unparsed-listing'){
  throw fail('This public listing has no verified bounded product adapter and remains unadmitted.','unparsed_listing');
 }else{
  const title=page.text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const readable=plainText(page.text);
  if(!title||readable.length<300||/<(?:input\b[^>]*type\s*=\s*["']?password|title[^>]*>\s*(?:sign\s*in|log\s*in|access denied|just a moment))/i.test(page.text))throw fail('HTML does not contain a readable public evidence page, or presents a login/challenge.','unreadable_html');
  items=[source(title,base,feed.name,page.text,page.fetchedAt)];
 }
 const unique=new Map();for(const value of items)if(value&&value.title&&value.text&&!unique.has(value.id))unique.set(value.id,value);
 const result=[...unique.values()].slice(0,20);
 if(!result.length)throw fail('Source parser found no readable public item records.','no_public_items');
 return result;
}

function validationMetadata(page,itemCount,emptyFeed=null){
 return {publicHttps:!!publicSyntax(page.url),robots:page.robots||[],robotsAllowed:Array.isArray(page.robots)&&page.robots.length>0&&page.robots.every(record=>record.allowed===true),redirects:page.redirects||[],httpStatus:page.status??null,contentType:page.contentType??null,resolvedUrl:page.url,fetchedAt:page.fetchedAt,maxBytes:page.maxBytes??FEED_MAX_BYTES,truncated:page.truncated===true,readable:itemCount>0||!!emptyFeed,parserVersion:SOURCE_PARSER_VERSION,itemCount,...(emptyFeed?{emptyFeed}:{})};
}
export async function validateSource(raw,{fetchPage=fetchPublic,now=Date.now,allowEmpty=false}={}){
 const checkedAt=new Date(typeof now==='function'?now():now).toISOString();let definition,page;
 try{
  definition=normalizeSourceDefinition(raw);if(definition.kind==='provider-discussion')throw fail('The public discussion provider is disabled or its immutable pool is unavailable; own HTTP fetch is forbidden.','provider_unavailable');page=await fetchPage(definition.url,demandSourceFetchOptions(definition,{maxBytes:FEED_MAX_BYTES,complete:true}));
  if(!Array.isArray(page.robots)||!page.robots.length||page.robots.some(record=>record.allowed!==true)||page.status<200||page.status>=300)throw fail('Admission needs explicit successful public fetch and robots decisions.','missing_admission_evidence');
  const items=parseSourcePage(definition,page);
  return {schema:1,sourceId:definition.id,definition,checkedAt,eligible:true,reason:'Public HTTPS, robots access and bounded item parser passed.',validation:validationMetadata(page,items.length),sampleItems:items};
 }catch(error){
  const empty=error.code==='no_eligible_demand_tasks'&&definition&&isDemandSourceDefinition(definition)&&page&&error.emptyFeed?.schema===1&&['rss','atom','json'].includes(error.emptyFeed.format)&&Object.keys(error.emptyFeed).length===4&&Number.isInteger(error.emptyFeed.examinedItems)&&error.emptyFeed.examinedItems>=0&&error.emptyFeed.examinedItems<=discussionScanItemLimit(definition,error.emptyFeed.format)&&error.emptyFeed.eligibleItems===0?error.emptyFeed:null;
  if(empty)return {schema:1,sourceId:definition.id,definition,checkedAt,eligible:false,scanReadableEmpty:allowEmpty,stage:'parse',code:'no_eligible_demand_tasks',reason:'The guarded readable demand feed has no eligible current nontechnical task records.',validation:validationMetadata(page,0,empty),sampleItems:[]};
  return {schema:1,sourceId:definition?.id||raw?.id||null,definition:definition||null,checkedAt,eligible:false,stage:error.stage||'parse',code:error.code||'source_unavailable',reason:safeError(error),validation:{...(page?validationMetadata(page,0):error.validation||{}),parserVersion:SOURCE_PARSER_VERSION,itemCount:0},sampleItems:[]};
 }
}

export async function scanSourceDefinitions(definitions,{onHealth=async()=>{},fetchPage=fetchPublic,now=Date.now}={}){
 if(!Array.isArray(definitions)||definitions.length>40)throw new Error('A scan requires at most 40 fixed source definitions.');
 const observations=[],all=[];let next=0;
 const timestamp=()=>new Date(typeof now==='function'?now():now).toISOString();
 await Promise.all(Array.from({length:Math.min(4,definitions.length)},async()=>{
  while(next<definitions.length){
   const index=next++,raw=definitions[index],startedAt=timestamp(),result=await validateSource(raw,{fetchPage,now,allowEmpty:true});
   const observation={feedId:result.sourceId,name:raw?.name||'Invalid source',url:result.definition?.url||raw?.url||null,status:result.eligible?'ok':result.scanReadableEmpty?'empty':'failed',startedAt,fetchedAt:result.validation.fetchedAt||timestamp(),items:result.sampleItems.length,itemCount:result.sampleItems.length,message:result.reason,...(!result.eligible?{stage:result.stage,code:result.code}:{}),validation:result.validation};
   observations[index]=observation;all[index]=result.sampleItems;await onHealth(observation);
  }
 }));
 const merged=new Map(),origins=new Map();
 for(let index=0;index<definitions.length;index++)for(const item of all[index]){
  const key=item.id,originKey=JSON.stringify([item.id,item.url,item.productUrl||null]),feedId=observations[index].feedId;
  if(!merged.has(key))merged.set(key,{...item,originFeedIds:[]});
  if(!origins.has(originKey))origins.set(originKey,{sourceId:item.id,url:item.url,productUrl:item.productUrl||null,feedIds:[]});
  if(!origins.get(originKey).feedIds.includes(feedId))origins.get(originKey).feedIds.push(feedId);
  if((merged.get(key).productUrl||null)===(item.productUrl||null)&&!merged.get(key).originFeedIds.includes(feedId))merged.get(key).originFeedIds.push(feedId);
 }
 return retainSafeBuildingScan({sources:[...merged.values()],observations,originMap:[...origins.values()]},definitions);
}
export async function scanSources(onHealth=async()=>{},options={}){
 if(typeof onHealth==='object'){options=onHealth;onHealth=options.onHealth||(async()=>{});}
 return (await scanSourceDefinitions(options.definitions||sourceDefinitions,{...options,onHealth})).sources;
}

export function inferSourceKind(raw,contentType=''){
 const url=new URL(raw),host=url.hostname,path=url.pathname;
 if(host==='hn.algolia.com'&&path.startsWith('/api/'))return 'hn';
 if(host==='github.com'&&path==='/trending')return 'github-trending';
 if(host==='huggingface.co'&&path==='/api/spaces')return 'hf-spaces';
 if(host==='news.ycombinator.com'&&path==='/launches')return 'hn-launches';
 if(host==='n8n.io'&&/^\/workflows\/categories\/[a-z0-9-]+\/?$/.test(path))return 'n8n-workflows';
 if(/(^|\.)ycombinator\.com$/.test(host)&&path.startsWith('/companies/industry/'))return 'yc-directory';
 if(/(^|\.)ycombinator\.com$/.test(host)&&path==='/launches')return 'yc-launches';
 if(host==='betalist.com')return 'betalist';
 if(host==='microlaunch.net')return 'unparsed-listing';
 if(/json/i.test(contentType)||/\.json$/i.test(path))return 'json-feed';
 if(/xml|rss|atom/i.test(contentType)||/\.rss|\.atom|\/(?:feed|atom)(?:\/|$)/i.test(path))return 'rss';
 return 'html';
}
export function extractPublicFeedLinks(page){
 const base=new URL(page.url),links=[];
 for(const match of page.text.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi,'').matchAll(/<link\b([^>]*)>/gi)){
  const rel=attribute(match[1],'rel'),type=attribute(match[1],'type'),href=attribute(match[1],'href');
  if(!rel?.split(/\s+/).includes('alternate')||!/^application\/(?:rss\+xml|atom\+xml|feed\+json)$/i.test(type||''))continue;
  const url=publicSyntax(href,base);if(!url||new URL(url).origin!==base.origin||links.some(value=>value.url===url))continue;
  links.push({url,kind:type==='application/feed+json'?'json-feed':'rss'});if(links.length===3)break;
 }
 return links;
}
export async function verifySources(candidate){
 const verified=[];
 for(const item of candidate.sources.slice(0,3)){
  const page=await fetchPublic(item.url),text=plainText(page.text).slice(0,12000);
  if(text.length<100)throw new Error('Source page contained too little evidence to check.');
  verified.push({...item,text,resolvedUrl:page.url,fetchedAt:page.fetchedAt,verifiedAt:page.fetchedAt});
 }
 return verified;
}
