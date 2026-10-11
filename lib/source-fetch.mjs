import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {safeError} from './storage.mjs';
import {robotsDecision,ROBOTS_MAX_BYTES,ROBOTS_MAX_REDIRECTS,ROBOTS_CACHE_MS} from './robots.mjs';

export const SOURCE_USER_AGENT='WhileYouSleep/1.0 (public research; evidence-only; https://xndanius.github.io/while-you-sleep/method/)';
export const EVIDENCE_MAX_BYTES=350000;
export const FEED_MAX_BYTES=2000000;
const robotsCache=new Map();
const failure=(message,code,stage,validation)=>Object.assign(new Error(message),{code,stage,...(validation?{validation}:{})});

function privateAddress(raw){
 let address=String(raw).toLowerCase();
 if(isIP(address)===6){
  address=new URL(`https://[${address}]/`).hostname.slice(1,-1);
  if(address.startsWith('::ffff:')){
   const tail=address.slice(7);if(tail.includes('.'))return privateAddress(tail);
   const [high,low]=tail.split(':').map(value=>Number.parseInt(value,16));return privateAddress(`${high>>8}.${high&255}.${low>>8}.${low&255}`);
  }
  return /^(::|fc|fd|fe[89ab]|ff)/i.test(address);
 }
 if(isIP(address)!==4)return true;
 const [a,b]=address.split('.').map(Number);
 return a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&[0,168].includes(b)||a===100&&b>=64&&b<=127||a===198&&[18,19].includes(b)||a>=224;
}
export async function validateURL(raw,{lookupHost=lookup}={}){
 if(String(raw).length>4096)throw failure('Source URL exceeds its bounded length.','invalid_url','url');
 let url;try{url=new URL(raw);}catch{throw failure('Source URL is invalid.','invalid_url','url');}
 if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||/(^|\.)(localhost|local|internal|test|invalid)$/i.test(url.hostname))throw failure('Source URL must be a public HTTPS page without credentials.','nonpublic_url','url');
 const host=url.hostname.replace(/^\[|\]$/g,'');
 const addresses=await lookupHost(host,{all:true});
 if(!addresses.length||addresses.some(value=>privateAddress(value.address)))throw failure('Source URL resolves to a private address.','private_address','dns');
 return url;
}

async function bodyText(response,maxBytes,{complete=false}={}){
 if(!response.body)throw failure('Public source has no readable response body.','empty_body','body');
 const reader=response.body.getReader(),chunks=[];let size=0,truncated=false;
 try{
  while(true){
   const {value,done}=await reader.read();if(done)break;
   const remaining=maxBytes-size;
   if(value.length>remaining){if(remaining)chunks.push(value.slice(0,remaining));size+=Math.max(0,remaining);truncated=true;await reader.cancel();break;}
   chunks.push(value);size+=value.length;
  }
 }catch(error){await reader.cancel().catch(()=>{});throw error;}
 if(truncated&&complete)throw failure(`Public source exceeded the complete ${maxBytes}-byte response limit.`,'body_oversized','body');
 return {text:new TextDecoder().decode(Buffer.concat(chunks.map(value=>Buffer.from(value)))),bytes:size,truncated};
}

async function retrieveRobots(origin,{fetchImpl,lookupHost,now}){
 const redirects=[];let raw=new URL('/robots.txt',origin).toString();
 for(let depth=0;depth<=ROBOTS_MAX_REDIRECTS;depth++){
  const url=await validateURL(raw,{lookupHost});
  const response=await fetchImpl(url,{redirect:'manual',headers:{'user-agent':SOURCE_USER_AGENT,accept:'text/plain'},signal:AbortSignal.timeout(14000)});
  const status=response.status,contentType=response.headers.get('content-type')||'',fetchedAt=new Date(now()).toISOString();
  if(status>=300&&status<400&&response.headers.get('location')){
   await response.body?.cancel();raw=new URL(response.headers.get('location'),url).toString();redirects.push({url:url.toString(),status,next:raw});continue;
  }
  if([404,410].includes(status)){await response.body?.cancel();return {origin,robotsUrl:url.toString(),status,contentType,fetchedAt,redirects,state:'missing',text:''};}
  if(status<200||status>=300){await response.body?.cancel();throw failure(`robots.txt returned HTTP ${status}; access is refused.`,'robots_unavailable','robots',{origin,robotsUrl:url.toString(),status,contentType,fetchedAt,redirects,allowed:false,state:'unreachable'});}
  if(!/^text\/plain\b/i.test(contentType)){await response.body?.cancel();throw failure('robots.txt is not a readable text/plain response.','robots_invalid','robots',{origin,robotsUrl:url.toString(),status,contentType,fetchedAt,redirects,allowed:false,state:'invalid'});}
  const body=await bodyText(response,ROBOTS_MAX_BYTES,{complete:true});
  if(/<\s*(?:!doctype\s+html|html|body)\b/i.test(body.text))throw failure('robots.txt contains an HTML challenge rather than rules.','robots_invalid','robots');
  return {origin,robotsUrl:url.toString(),status,contentType,fetchedAt,redirects,state:'available',...body};
 }
 throw failure('robots.txt exceeded five guarded HTTPS redirects.','robots_redirect_limit','robots');
}

async function permission(url,options){
 const key=url.origin,cache=options.robotsCache||robotsCache,current=options.now();let entry=cache.get(key);
 if(!entry||entry.expiresAt<=current){
  entry={expiresAt:current+ROBOTS_CACHE_MS,promise:retrieveRobots(key,options)};cache.set(key,entry);
  entry.promise.catch(()=>{if(cache.get(key)===entry)cache.delete(key);});
 }
 const result=await entry.promise,decision=result.state==='missing'?{allowed:true,matchedRule:null,selectedUserAgents:[]}:robotsDecision(result.text,url);
 const {text,...metadata}=result;
 const record={...metadata,...decision,evaluatedUrl:url.toString(),reason:result.state==='missing'?'robots.txt is missing (404/410); project policy permits access.':decision.allowed?'No matching robots Disallow rule.':'Matching robots Disallow rule.'};
 if(!record.allowed)throw failure('Robots rules refuse this public source.','robots_disallowed','robots',record);
 return record;
}

export async function fetchPublic(raw,options={}){
 if(typeof options==='number')options={};
 const maxBytes=options.maxBytes??EVIDENCE_MAX_BYTES,complete=options.complete??false;
 if(!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>FEED_MAX_BYTES)throw failure('Invalid public response limit.','invalid_limit','body');
 const settings={fetchImpl:options.fetchImpl||globalThis.fetch,lookupHost:options.lookupHost||lookup,now:options.now||Date.now,robotsCache:options.robotsCache};
 const redirects=[],robots=[];let current=raw;
 try{
  for(let depth=0;depth<=3;depth++){
   const url=await validateURL(current,settings);robots.push(await permission(url,settings));
   const response=await settings.fetchImpl(url,{redirect:'manual',headers:{'user-agent':SOURCE_USER_AGENT,accept:'text/html, application/json, application/rss+xml, application/atom+xml, text/xml;q=0.9'},signal:AbortSignal.timeout(14000)});
   const contentType=response.headers.get('content-type')||'',validation={publicHttps:true,robots,redirects,resolvedUrl:url.toString(),httpStatus:response.status,contentType,maxBytes};
   if(response.status>=300&&response.status<400&&response.headers.get('location')){await response.body?.cancel();current=new URL(response.headers.get('location'),url).toString();redirects.push({url:url.toString(),status:response.status,next:current});continue;}
   if(!response.ok){await response.body?.cancel();throw failure(`Public source returned HTTP ${response.status}.`,'source_http_error','fetch',validation);}
   if(!/^(?:text\/[a-z0-9.+-]+|application\/(?:[a-z0-9.+-]*\+)?(?:json|xml)|application\/(?:rss|atom)\+xml)\b/i.test(contentType)){await response.body?.cancel();throw failure('Source is not readable text.','unreadable_type','fetch',validation);}
   let body;try{body=await bodyText(response,maxBytes,{complete});}catch(error){error.validation=validation;throw error;}
   return {url:url.toString(),...body,fetchedAt:new Date(settings.now()).toISOString(),status:response.status,contentType,robots,redirects,maxBytes};
  }
  throw failure('Source redirected too many times.','source_redirect_limit','fetch');
 }catch(error){if(!error.code)error.code='source_unavailable';if(!error.stage)error.stage='fetch';error.message=safeError(error);throw error;}
}
