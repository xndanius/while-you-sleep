import {sha256,stableJSON} from './storage.mjs';
import {privateArtifactReasons} from './privacy.mjs';

export const NATIVE_READING_LIMIT=1200;
export const NATIVE_READING_NORMALIZATION='discourse-visible-text-v2';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function untrustedContainers(raw){
 const html=String(raw||'').replace(/<!--[\s\S]*?-->/g,' '),stack=[],parts=[];
 const tags=/<(?:[^<>"']|"[^"]*"|'[^']*')*>/g;let cursor=0;
 const hidden=()=>stack.some(item=>item.hidden);
 for(const match of html.matchAll(tags)){
  if(!hidden())parts.push(html.slice(cursor,match.index));cursor=match.index+match[0].length;
  const tag=match[0].match(/^<\s*(\/?)\s*([a-z][a-z0-9:-]*)\b([\s\S]*?)>$/i);
  if(!tag)continue;
  const [,closing,rawName,attributes]=tag,name=rawName.toLowerCase(),block=/^(?:p|div|li|h[1-6]|pre|br)$/.test(name);
  const rawText=stack.findLastIndex(item=>/^(?:script|style|noscript)$/.test(item.name));
  if(rawText>=0&&(!closing||name!==stack[rawText].name))continue;
  if(closing){const index=stack.map(item=>item.name).lastIndexOf(name),excluded=stack.findLastIndex(item=>item.hidden);if(index>=0&&index>=excluded)stack.splice(index);}
  else{
   const style=attributes.match(/(?:^|\s)style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.slice(1).find(value=>value!==undefined)||'';
   const excluded=/^(?:script|style|noscript|blockquote|aside|nav|figure)$/.test(name)||/(?:^|\s)class\s*=\s*["'][^"']*\b(?:lightbox|lightbox-wrapper)\b/i.test(attributes)||/(?:^|\s)hidden(?:\s|=|\/|$)/i.test(attributes)||/(?:^|\s)aria-hidden\s*=\s*(?:"true"|'true'|true)(?:\s|\/|$)/i.test(attributes)||/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(style);
   if(!/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(name))stack.push({name,hidden:excluded});
  }
  if(!hidden())parts.push(block?'\n':' ');
 }
 if(!hidden())parts.push(html.slice(cursor));return parts.join('');
}
export function normalizeNativePost(raw){
 const entities={nbsp:' ',amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'};
 return untrustedContainers(raw).replace(/&(nbsp|amp|quot|apos|lt|gt|#x[0-9a-f]+|#\d+);/gi,(_,entity)=>{const key=entity.toLowerCase();if(Object.hasOwn(entities,key))return entities[key];const hex=key.startsWith('#x'),point=Number.parseInt(key.slice(hex?2:1),hex?16:10);return point>0&&point<=0x10ffff?String.fromCodePoint(point):' ';}).replace(/\s+/g,' ').trim();
}
const sensitiveLabel=value=>/(?:account|address|apikey|author|birthdate|buyer|client|contact|cookie|credential|creditcard|customer|email|employee|handle|iban|name|owner|passport|password|patient|person|phone|profile|recipient|secret|session|ssn|student|supplier|token|user)/.test(value.replace(/[^a-z0-9]/gi,'').toLowerCase());
function unsafe(text){
 const labels=[...text.matchAll(/["'“`]([^"'“”`]{1,100})["'”`]\s*:/g),...text.matchAll(/(?:^|[\s{,])([A-Za-z_$\\][A-Za-z0-9_$\\]*)\s*:/g)];
 const identityLine=text.replace(/^[—–-]\s*/,'').split('|')[0].trim().replace(/[.!]$/,'');
 const nameLine=/^\p{Lu}\p{Ll}{1,35}(?:[ '-]\p{Lu}\p{Ll}{1,35}){0,2}$/u.test(identityLine)||/^[A-Z]{2,35}(?: [A-Z]{2,35}){1,2}$/.test(identityLine)||/^[a-z]{2,35} [a-z]{2,35}$/.test(identityLine)&&!/(?:input|output|data|invoice|row|field|value|amount|workflow|error)/i.test(identityLine);
 return privateArtifactReasons(text).length>0||/https?:\/\/|www\.|\bu\/[a-z0-9_-]+\b|\b(?:posted by|written by|username|profile|my name is|thanks|thank you|regards|cheers|sincerely|best wishes)\b|\bbest\s*[,!]|^(?:hi|hello|dear)[,\s]/i.test(text)||nameLine||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)||labels.some(match=>match[1].includes('\\')||sensitiveLabel(match[1]));
}
function balancedExamples(text){
 const ranges=[],stack=[];let quote=null,escaped=false;
 for(let position=0;position<text.length;position++){
  const c=text[position];
  if(quote){if(escaped){escaped=false;continue;}if(c==='\\'&&quote!=='”'){escaped=true;continue;}if(c===quote)quote=null;continue;}
  if(c==='"'||c==='“'||c==="'"&&stack.length){quote=c==='“'?'”':c;continue;}
  if(c==='{'||c==='['){
   let start=position;
   if(c==='['){const prefix=text.slice(Math.max(0,position-110),position),label=prefix.match(/["“][^"“”]{1,100}["”]\s*:\s*$/);if(label)start=position-prefix.length+label.index;}
   stack.push({token:c,start});
  }else if(c==='}'||c===']'){
   const open=stack.pop();if(!open||open.token!==(c==='}'?'{':'[')){stack.length=0;continue;}
   ranges.push({start:open.start,end:position+1,kind:'example'});
  }
 }
 const complete=[];for(const range of ranges.sort((a,b)=>a.start-b.start||b.end-a.end))if(!complete.length||range.start>=complete.at(-1).end)complete.push(range);
 return [...complete.filter(range=>/\d/.test(text.slice(range.start,range.end))),...(stack.length?[{start:stack[0].start,end:text.length,kind:'incomplete',invalid:true}]:[])];
}
function bounds(source,meta){
 let url;try{url=new URL(source.url);}catch{return false;}
 return /^\/t\/\d+$/.test(url.pathname)&&Number(url.pathname.slice(3))===meta.topicId&&Number.isSafeInteger(meta.postId)&&meta.postId>0&&meta.postNumber===1&&iso(meta.postCreatedAt)&&(meta.postUpdatedAt===null||iso(meta.postUpdatedAt)&&Date.parse(meta.postUpdatedAt)>=Date.parse(meta.postCreatedAt))&&iso(meta.fetchedAt)&&Date.parse(meta.postCreatedAt)<=Date.parse(meta.fetchedAt)&&Date.parse(meta.fetchedAt)-Date.parse(meta.postCreatedAt)<=45*86400000&&(meta.postUpdatedAt===null||Date.parse(meta.postUpdatedAt)<=Date.parse(meta.fetchedAt))&&meta.responseUrl===source.url+'.json';
}
export function buildNativeReadingContext(meta){
 const {source,raw,responseText}=meta;
 if(!source||typeof raw!=='string'||raw.length>80000||typeof responseText!=='string'||Buffer.byteLength(responseText)>2000000||!bounds(source,meta))return null;
 let response;try{response=JSON.parse(responseText);}catch{return null;}
 const originals=Array.isArray(response?.post_stream?.posts)?response.post_stream.posts.filter(post=>post?.post_number===1):[],post=originals[0];
 const stamp=value=>iso(value)?value:typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
 if(response.id!==meta.topicId||originals.length!==1||post.id!==meta.postId||post.topic_id!==undefined&&post.topic_id!==meta.topicId||post.cooked!==raw||stamp(post.created_at)!==meta.postCreatedAt||(stamp(post.updated_at)||null)!==(meta.postUpdatedAt||null))return null;
 const body=normalizeNativePost(raw),anchor=body.indexOf(source.text),parts=untrustedContainers(raw).split(/\n+/).map(normalizeNativePost).filter(Boolean);
 if(parts.length>400)return null;
 if(anchor<0||!source.text||unsafe(source.text))return null;
 const examples=balancedExamples(body),blocks=[];let cursor=0;
 const contextWords=/\b(?:crm|airtable|invoic\w*|orders?|input|output|api|rows?|fields?|values?|amounts?|data|map|mapping|module|daily|weekly|every|workflow|process|report|export|import|error|tried|problem|goal)\b/i;
 for(const text of parts){
  const start=body.indexOf(text,cursor);if(start<0)continue;cursor=start+text.length;
  const eligible=!unsafe(text);
  blocks.push({start,end:cursor,text,eligible});
 }
 let selected=[];
 if(body.length<=NATIVE_READING_LIMIT&&!unsafe(body)&&blocks.every(block=>block.eligible))selected=[{start:0,end:body.length,kind:'context'}];
 else{
  const runs=[];let run=null;
  for(const block of blocks){
   if(!block.eligible){if(run)runs.push(run);run=null;continue;}
   if(!run)run={start:block.start,end:block.end};else run.end=block.end;
  }
  if(run)runs.push(run);
  const anchorRun=runs.find(row=>row.start<=anchor&&row.end>=anchor+source.text.length&&row.end-row.start<=NATIVE_READING_LIMIT);
  const candidates=[{...(anchorRun||{start:anchor,end:anchor+source.text.length}),kind:anchorRun?'context':'task',priority:100},...runs.filter(row=>row!==anchorRun&&row.end-row.start<=NATIVE_READING_LIMIT).map(row=>({...row,kind:'context',priority:95})),...examples.filter(row=>!row.invalid).map(row=>({...row,priority:90}))];
  for(const {text,start,end,eligible} of blocks){
   if(!eligible||text.length<25||examples.some(row=>start<row.end&&end>row.start))continue;
   candidates.push({start,end,kind:'context',priority:(contextWords.test(text)?50:10)-Math.min(20,Math.abs(start-anchor)/1000)});
  }
  let total=0;
  for(const row of candidates.sort((a,b)=>b.priority-a.priority||a.start-b.start)){
   const text=body.slice(row.start,row.end);
   if(selected.length>=4||total+text.length>NATIVE_READING_LIMIT||unsafe(text)||selected.some(other=>row.start<other.end&&row.end>other.start))continue;
   selected.push(row);total+=text.length;
  }
 }
 const spans=selected.sort((a,b)=>a.start-b.start).map(({start,end,kind})=>({kind,start,end,text:body.slice(start,end),sha256:sha256(body.slice(start,end))}));
 if(!spans.some(span=>span.text.includes(source.text)))return null;
 const retainedCharacters=spans.reduce((n,row)=>n+row.text.length,0);
 const packet={version:2,normalizationVersion:NATIVE_READING_NORMALIZATION,topicUrl:source.url,topicId:meta.topicId,postId:meta.postId,postNumber:1,postUrl:source.url+'/1',postCreatedAt:meta.postCreatedAt,postUpdatedAt:meta.postUpdatedAt||null,fetchedAt:meta.fetchedAt,responseUrl:meta.responseUrl,responseSha256:sha256(responseText),normalizedSha256:sha256(body),normalizedLength:body.length,retainedCharacters,omittedCharacters:body.length-retainedCharacters,spans};
 return {...packet,packetSha256:sha256(stableJSON(packet))};
}
export function nativeReadingContextReasons(source){
 const p=source?.nativeReadingContext;if(p===undefined)return [];
 const keys=['version','normalizationVersion','topicUrl','topicId','postId','postNumber','postUrl','postCreatedAt','postUpdatedAt','fetchedAt','responseUrl','responseSha256','normalizedSha256','normalizedLength','retainedCharacters','omittedCharacters','spans','packetSha256'];
 if(!exact(p,keys)||p.version!==2||p.normalizationVersion!==NATIVE_READING_NORMALIZATION||p.topicUrl!==source.url||p.postUrl!==source.url+'/1'||!bounds(source,p)||p.fetchedAt!==source.fetchedAt||p.fetchedAt!==source.verifiedAt||!hex(p.responseSha256)||!hex(p.normalizedSha256)||!hex(p.packetSha256)||sha256(stableJSON(Object.fromEntries(Object.entries(p).filter(([key])=>key!=='packetSha256'))))!==p.packetSha256)return ['Native reading context has invalid version, origin, timestamps or packet fingerprint.'];
 if(source.taskExample!==undefined||source.feedExcerpt!==undefined||!Number.isInteger(p.normalizedLength)||p.normalizedLength<25||p.normalizedLength>80000||!Array.isArray(p.spans)||!p.spans.length||p.spans.length>4)return ['Native reading context exceeds its fixed shape or mixes evidence versions.'];
 let total=0,end=0;
 for(const span of p.spans){
  if(!exact(span,['kind','start','end','text','sha256'])||!['task','context','example'].includes(span.kind)||!Number.isInteger(span.start)||!Number.isInteger(span.end)||span.start<end||span.end>p.normalizedLength||span.end<=span.start||typeof span.text!=='string'||span.text.length!==span.end-span.start||span.text!==span.text.replace(/\s+/g,' ').trim()||unsafe(span.text)||sha256(span.text)!==span.sha256)return ['Native reading context has a corrupted, overlapping or unsafe literal span.'];
  total+=span.text.length;end=span.end;
 }
 if(total>NATIVE_READING_LIMIT||total!==p.retainedCharacters||p.omittedCharacters!==p.normalizedLength-total||!p.spans.some(span=>span.text.includes(source.text))||privateArtifactReasons(p).length)return ['Native reading context lacks its original task or exceeds its aggregate retention limit.'];
 return [];
}
