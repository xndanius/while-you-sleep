export const ROBOTS_PRODUCT_TOKEN='WhileYouSleep';
export const ROBOTS_MAX_BYTES=524288;
export const ROBOTS_MAX_REDIRECTS=5;
export const ROBOTS_CACHE_MS=6*3600000;

export function parseRobots(text,productToken=ROBOTS_PRODUCT_TOKEN){
 const groups=[];let group=null;
 for(const raw of String(text).replace(/^\uFEFF/,'').split(/\r\n|\r|\n/)){
  const match=raw.split('#',1)[0].trim().match(/^([^:]+):\s*(.*)$/);if(!match)continue;
  const directive=match[1].trim().toLowerCase(),value=match[2].trim();
  if(directive==='user-agent'){
   if(!/^(?:[a-z_-]+|\*)$/i.test(value))continue;
   if(!group||group.hasRules){group={agents:[],rules:[],hasRules:false};groups.push(group);}
   group.agents.push(value.toLowerCase());
  }else if(['allow','disallow'].includes(directive)&&group){
   // Even an empty rule ends the consecutive user-agent section. Unknown
   // records, including Sitemap, never split an otherwise valid group.
   group.hasRules=true;
   if(value.startsWith('/')||value.startsWith('*'))group.rules.push({type:directive,path:value});
  }
 }
 const token=productToken.toLowerCase(),matching=groups.filter(group=>group.agents.includes(token));
 const selected=matching.length?matching:groups.filter(group=>group.agents.includes('*'));
 return {agents:[...new Set(selected.flatMap(group=>group.agents))],rules:selected.flatMap(group=>group.rules)};
}

function normalize(value,{pattern=false}={}){
 return [...value].map(character=>character.codePointAt(0)>127?encodeURIComponent(character):!pattern&&['*','$'].includes(character)?encodeURIComponent(character).replace('*','%2A'):character).join('').replace(/%([0-9a-f]{2})/gi,(_,hex)=>{
  const character=String.fromCharCode(Number.parseInt(hex,16));return /^[a-z0-9._~-]$/i.test(character)?character:'%'+hex.toUpperCase();
 });
}
function globMatch(pattern,target,end,budget){
 const charge=amount=>{
  budget.remaining-=amount;
  if(budget.remaining<0)throw Object.assign(new Error('Robots matching exceeded its bounded comparison budget; access is refused.'),{code:'robots_match_budget',stage:'robots'});
 };
 const chunks=pattern.split('*'),first=chunks[0];charge(first.length);
 if(!target.startsWith(first))return false;
 let offset=first.length;
 if(chunks.length===1)return !end||offset===target.length;
 for(let index=1;index<chunks.length;index++){
  const chunk=chunks[index];if(!chunk)continue;
  if(end&&index===chunks.length-1){charge(chunk.length);return target.length-chunk.length>=offset&&target.endsWith(chunk);}
  // The earliest non-overlapping literal match leaves the most space for
  // following chunks. Native substring search avoids regex backtracking.
  charge(target.length-offset+chunk.length);
  const found=target.indexOf(chunk,offset);if(found<0)return false;
  offset=found+chunk.length;
 }
 return true;
}
export function robotsDecision(text,raw,productToken=ROBOTS_PRODUCT_TOKEN){
 if(Buffer.byteLength(String(text))>ROBOTS_MAX_BYTES)throw Object.assign(new Error('Robots rules exceed their bounded response limit; access is refused.'),{code:'robots_body_oversized',stage:'robots'});
 const url=new URL(raw),parsed=parseRobots(text,productToken),target=normalize(url.pathname+url.search),budget={remaining:1000000};let matchedRule=null;
 for(const rule of parsed.rules){
  const normalized=normalize(rule.path,{pattern:true}),end=normalized.endsWith('$'),pattern=end?normalized.slice(0,-1):normalized;
  if(!globMatch(pattern,target,end,budget))continue;
  // A retained percent triplet represents one comparison octet, rather than
  // three characters. Counting its spelling could wrongly prefer an Allow.
  const specificity=Buffer.byteLength(pattern.replace(/\*/g,'').replace(/%[0-9A-F]{2}/g,'x'));
  if(!matchedRule||specificity>matchedRule.specificity||specificity===matchedRule.specificity&&rule.type==='allow')matchedRule={...rule,specificity};
 }
 return {allowed:!matchedRule||matchedRule.type==='allow',matchedRule,selectedUserAgents:parsed.agents};
}
