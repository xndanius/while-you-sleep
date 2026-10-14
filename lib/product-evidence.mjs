import {fetchPublic,plainText} from './research.mjs';
import {canonicalURL,hash,safeError,sha256,stableJSON} from './storage.mjs';
import {fetchDemandEvidence,sourceRole,demandTaskCount,demandEvidenceFingerprint} from './demand-sources.mjs';

export const PRODUCT_EVIDENCE_POLICY=Object.freeze({maxLeads:12,concurrency:3,maxPageBytes:2000000,maxREADMEBytes:350000,maxMetadataBytes:350000,maxTextCharacters:8000,timeBudgetMs:90000,maxRequestsPerLead:3});
export const PRODUCT_SELECTION_POLICY=Object.freeze({version:2,cooldownHours:24,maxHistoryRuns:96,maxHistoryRecords:288,familyBudgets:Object.freeze({primary:5,repository:3,directory:2,editorial:1,'model-demo':1}),maxFeedLeads:3,maxHostLeads:2});
const fail=(message,code='product_evidence_unavailable')=>Object.assign(new Error(message),{code,stage:'product-evidence'});
export function sourceEvidenceFetchOptions(source){
 if(source?.enriched!==true)return {};
 const maxBytes=source.evidenceKind==='github-readme'?PRODUCT_EVIDENCE_POLICY.maxREADMEBytes:['product-page','demand-notice'].includes(source.evidenceKind)?PRODUCT_EVIDENCE_POLICY.maxPageBytes:null;
 if(maxBytes===null||!source.evidenceFetch||Object.keys(source.evidenceFetch).length!==2||source.evidenceFetch.maxBytes!==maxBytes||source.evidenceFetch.complete!==true)throw fail('Enriched evidence has an invalid fixed fetch policy.','invalid_product_evidence_policy');
 return {maxBytes,complete:true};
}
const stamp=now=>new Date(typeof now==='function'?now():now).toISOString();
function publicURL(raw){try{if(typeof raw!=='string'||raw.length>4096) return null;const url=new URL(raw);if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||/(^|\.)(localhost|local|internal|test|invalid)$/i.test(url.hostname))return null;return canonicalURL(raw);}catch{return null;}}
function repository(raw){try{const url=new URL(raw),match=url.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/)?$/);return url.hostname==='github.com'&&match&&!['features','topics','collections','marketplace','orgs','users','settings'].includes(match[1])?{owner:match[1],name:match[2]}:null;}catch{return null;}}
const listingHosts=new Set(['news.ycombinator.com','hn.algolia.com','betalist.com','www.ycombinator.com']);
const editorialHosts=new Set(['techcrunch.com','simonwillison.net','www.latent.space','latent.space','www.bensbites.com','bensbites.com']);
function leadPriority(productUrl,source){
 const host=new URL(productUrl).hostname,text=plainText(`${source.title||''} ${source.feedExcerpt||source.text||''}`).slice(0,1600),signals=[];
 if(/\b(?:automat(?:e|es|ed|ion|ic|ically)|workflow|scheduled|monitor(?:s|ing)?|follow[- ]?ups?|extract(?:s|ion)?|ingest(?:s|ion)?|replay|recurring|agents? (?:finish|complete|run)|run an agent)\b/i.test(text))signals.push('repeatable-workflow');
 if(/\b(?:invoice|receipt|email|vendor|customer|support|sales|report|document|business|leads?|alert|review|csv|browser|task)\b/i.test(text))signals.push('concrete-task');
 if(/\b(?:ai|llm|agent|agents|mcp)\b/i.test(text))signals.push('ai-tool');
 const family=repository(productUrl)?'repository':host==='huggingface.co'?'model-demo':listingHosts.has(host)?'directory':editorialHosts.has(host)?'editorial':'primary';
 // These lexical hints allocate retrieval work; they establish no fact, rating,
 // autonomy, customer, revenue or checker approval.
 if(family==='primary'&&canonicalURL(source.url)===productUrl&&plainText(source.feedExcerpt||source.text||'').length>=500)signals.push('readable-first-party-page');
 const priority=(signals.includes('repeatable-workflow')?4:0)+(signals.includes('concrete-task')?3:0)+(signals.includes('ai-tool')?1:0)+(signals.includes('readable-first-party-page')?2:0)+(family==='primary'?1:0);
 return {priority,family,host,signals};
}
function demandPriority(productUrl,source){
 const count=demandTaskCount(source);
 return {priority:count,family:'primary',host:new URL(productUrl).hostname,signals:count?['explicit-task-excerpt']:[]};
}
export function recentProductAssessments({runs=[],drafts=[],research=[],contexts=[],now=Date.now}={}){
 if([runs,drafts,research,contexts].some(records=>!Array.isArray(records)||records.length>PRODUCT_SELECTION_POLICY.maxHistoryRecords))throw fail('Recent assessment history exceeds its fixed bound.','invalid_assessment_history');
 const current=typeof now==='function'?now():new Date(now).getTime(),cutoff=current-PRODUCT_SELECTION_POLICY.cooldownHours*3600000,result=new Map();if(!Number.isFinite(current))throw fail('Recent assessment time is invalid.','invalid_assessment_history');
 const ordered=runs.slice().sort((a,b)=>String(b?.checkedAssessment?.completedAt||'').localeCompare(String(a?.checkedAssessment?.completedAt||''))).slice(0,PRODUCT_SELECTION_POLICY.maxHistoryRuns);
 for(const run of ordered){const proof=run?.checkedAssessment,at=Date.parse(proof?.completedAt);if(!/^loop-\d+-\d+$/.test(run?.id||'')||run.type!=='loop'||run.assessmentOutcome!=='completed'||!Array.isArray(run.operationalFailures)||run.operationalFailures.length||proof?.schema!==1||proof.contractVersion!==1||proof.completed!==true||proof.runId!==run.id||proof.checkerRunId!==`${run.id}-independent-check`||!['assessed','no_supported_candidate'].includes(proof.decision)||!Number.isFinite(at)||at>current||at<=cutoff||!['draftSha256','contextSha256','rulesSha256','sourceSnapshotSha256','policySha256'].every(key=>/^[a-f0-9]{64}$/.test(proof[key]||'')))continue;
  const matching=drafts.filter(draft=>draft?.runId===run.id&&sha256(stableJSON(draft))===proof.draftSha256),context=contexts.find(record=>record?.runId===run.id&&sha256(stableJSON(record))===proof.contextSha256),snapshot=research.find(record=>record?.id===run.id&&record.runId===run.id);if(matching.length!==1||!context||context.draftSha256!==proof.draftSha256||context.rulesSha256!==proof.rulesSha256||context.sourceSnapshotSha256!==proof.sourceSnapshotSha256||context.scoringPolicy?.policySha256!==proof.policySha256||!Array.isArray(context.sources)||sha256(stableJSON(context.sources))!==proof.sourceSnapshotSha256||snapshot?.enrichment?.status!=='completed'||!Array.isArray(snapshot.enrichment.observations)||snapshot.enrichment.observations.length>12)continue;
  const primary=new Set(context.sources.filter(source=>{try{sourceEvidenceFetchOptions(source);return source.enriched===true&&publicURL(source.url)&&source.id===hash(publicURL(source.url))&&typeof source.text==='string'&&source.text.length>=(source.evidenceKind==='demand-notice'?100:300)&&source.verifiedAt===source.fetchedAt&&Number.isFinite(Date.parse(source.verifiedAt))&&Date.parse(source.verifiedAt)<=at;}catch{return false;}}).map(source=>publicURL(source.productUrl)).filter(Boolean));
  const fetched=new Set(snapshot.enrichment.observations.filter(item=>item.status==='fetched'&&Number.isFinite(Date.parse(item.fetchedAt))&&Date.parse(item.fetchedAt)<=at&&primary.has(publicURL(item.productUrl))).map(item=>publicURL(item.productUrl)).filter(Boolean)),draft=matching[0];
  const products=[...(Array.isArray(draft.candidates)?draft.candidates:[]),...(Array.isArray(draft.posts)?draft.posts:[]),...(Array.isArray(draft.rejected)?draft.rejected:[])].slice(0,36);
  for(const item of products){const productUrl=publicURL(item?.productUrl);if(productUrl&&fetched.has(productUrl)&&!result.has(productUrl)){const demandEvidenceSha256=demandEvidenceFingerprint(context.sources.find(source=>publicURL(source.productUrl)===productUrl&&source.evidenceKind==='demand-notice'));result.set(productUrl,{productUrl,assessedAt:proof.completedAt,runId:run.id,...(demandEvidenceSha256?{demandEvidenceSha256}: {})});}}
 }
 return [...result.values()];
}
export function selectProductLeads(sources,{originMap=[],previous=[],recentAssessments=[],learningSelection,demandDefinitions=[],now=Date.now,limit=PRODUCT_EVIDENCE_POLICY.maxLeads}={}){
 if(!Array.isArray(sources)||sources.length>800||!Number.isInteger(limit)||limit<0||limit>PRODUCT_EVIDENCE_POLICY.maxLeads)throw fail('Product lead selection exceeds its bounded input.','invalid_product_leads');
 if(!Array.isArray(recentAssessments)||recentAssessments.length>PRODUCT_SELECTION_POLICY.maxHistoryRuns*12)throw fail('Recent assessment selection exceeds its fixed bound.','invalid_assessment_history');
 const current=typeof now==='function'?now():new Date(now).getTime(),cutoff=current-PRODUCT_SELECTION_POLICY.cooldownHours*3600000;
 const existing=new Set(previous.map(post=>publicURL(post?.productUrl)).filter(Boolean)),cooled=new Map(recentAssessments.filter(item=>Number.isFinite(Date.parse(item?.assessedAt))&&Date.parse(item.assessedAt)>cutoff&&Date.parse(item.assessedAt)<=current).map(item=>[publicURL(item.productUrl),item]).filter(([url])=>url)),leads=new Map();
 for(let index=0;index<sources.length;index++){
  const source=sources[index];if(!source?.id||!publicURL(source.url))continue;
  const origins=originMap.filter(origin=>origin.sourceId===source.id&&origin.url===source.url),definition=learningSelection?demandDefinitions.find(definition=>sourceRole(definition)==='demand'&&learningSelection.demandSourceIds.includes(definition.id)&&source.registrySourceId===definition.id&&origins.some(origin=>origin.feedIds.includes(definition.id))):null;
  if(learningSelection&&(!definition||source.segment!==learningSelection.selectedSegment))continue;
  const products=learningSelection?[source.url]:origins.length?origins.map(origin=>origin.productUrl||origin.url):[source.productUrl||source.url];
  for(const raw of products){const productUrl=publicURL(raw);if(!productUrl||existing.has(productUrl))continue;
   const prior=cooled.get(productUrl),currentEvidence=demandEvidenceFingerprint(source);if(prior&&(!prior.demandEvidenceSha256||!currentEvidence||prior.demandEvidenceSha256===currentEvidence))continue;
   const matching=origins.filter(origin=>[origin.url,origin.productUrl].filter(Boolean).some(url=>canonicalURL(url)===productUrl)),feedIds=[...new Set(matching.flatMap(origin=>origin.feedIds||[]))];
   const rank=definition?demandPriority(productUrl,source):leadPriority(productUrl,source);if(!leads.has(productUrl))leads.set(productUrl,{productUrl,title:String(source.title||'Public product documentation').slice(0,200),originSourceIds:[],originFeedIds:[],...rank,index,...(definition?{demandSource:source,demandDefinition:definition}: {})});
   const lead=leads.get(productUrl);lead.priority=Math.max(lead.priority,rank.priority);lead.signals=[...new Set([...lead.signals,...rank.signals])].sort();lead.originSourceIds=[...new Set([...lead.originSourceIds,source.id])].sort();lead.originFeedIds=[...new Set([...lead.originFeedIds,...feedIds])].sort();
  }
 }
 const ordered=[...leads.values()].sort((a,b)=>b.priority-a.priority||a.index-b.index||a.productUrl.localeCompare(b.productUrl)),selected=[],feedCounts=new Map(),familyCounts=new Map(),hostCounts=new Map();
 const add=lead=>{selected.push(lead);familyCounts.set(lead.family,(familyCounts.get(lead.family)||0)+1);hostCounts.set(lead.host,(hostCounts.get(lead.host)||0)+1);for(const id of lead.originFeedIds)feedCounts.set(id,(feedCounts.get(id)||0)+1);};
 // Reserve a first look across families, then preserve feed/host diversity.
 for(const lead of ordered){if(selected.length===limit)break;if(!familyCounts.has(lead.family))add(lead);}
 for(const lead of ordered){if(selected.length===limit)break;if(selected.includes(lead)||(familyCounts.get(lead.family)||0)>=PRODUCT_SELECTION_POLICY.familyBudgets[lead.family]||(hostCounts.get(lead.host)||0)>=(lead.family==='repository'?3:PRODUCT_SELECTION_POLICY.maxHostLeads)||lead.originFeedIds.length&&lead.originFeedIds.every(id=>(feedCounts.get(id)||0)>=PRODUCT_SELECTION_POLICY.maxFeedLeads))continue;add(lead);}
 // Scarce families must not reduce the bounded batch. Relax caps fairly rather
 // than returning to repository-first input order.
 while(selected.length<limit){const remaining=ordered.filter(lead=>!selected.includes(lead));if(!remaining.length)break;remaining.sort((a,b)=>(familyCounts.get(a.family)||0)-(familyCounts.get(b.family)||0)||(hostCounts.get(a.host)||0)-(hostCounts.get(b.host)||0)||b.priority-a.priority||a.index-b.index);add(remaining[0]);}
 return selected.map(({priority,index,family,host,signals,...lead})=>({...lead,selection:{version:PRODUCT_SELECTION_POLICY.version,family,signals,reason:'Retrieval priority and diversity only; independent evidence and scoring remain required.'}}));
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
 if(lead.demandDefinition){const fresh=await fetchDemandEvidence(lead.demandSource,{definition:lead.demandDefinition,fetchPage:(url,options)=>request(url,options.maxBytes)});return {...fresh,originSourceIds:lead.originSourceIds,evidenceKind:'demand-notice',evidenceFetch:{maxBytes:2000000,complete:true},enriched:true,evidenceNote:'Fresh official paid-work evidence; demand for an AI service and a feasible small version still require independent checking.'};}
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
export async function enrichProductLeads({sources,originMap=[],previous=[],recentAssessments=[],learningSelection,demandDefinitions=[],fetchPage=fetchPublic,now=Date.now,limit=PRODUCT_EVIDENCE_POLICY.maxLeads,timeBudgetMs=PRODUCT_EVIDENCE_POLICY.timeBudgetMs}={}){
 if(!Number.isInteger(timeBudgetMs)||timeBudgetMs<1||timeBudgetMs>PRODUCT_EVIDENCE_POLICY.timeBudgetMs)throw fail('Invalid product enrichment time budget.','invalid_product_evidence_budget');
 const leads=selectProductLeads(sources,{originMap,previous,recentAssessments,learningSelection,demandDefinitions,now,limit}),startedAt=stamp(now),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeBudgetMs),observations=Array(leads.length),evidence=Array(leads.length);let next=0;
 try{await Promise.all(Array.from({length:Math.min(PRODUCT_EVIDENCE_POLICY.concurrency,leads.length)},async()=>{
  while(next<leads.length){const index=next++,lead=leads[index],requestCount={count:0};try{const record=await leadEvidence(lead,fetchPage,controller.signal,requestCount);if(controller.signal.aborted)throw fail('Product enrichment reached its time budget.','product_evidence_timeout');evidence[index]=record;observations[index]={productUrl:lead.productUrl,originSourceIds:lead.originSourceIds,selection:lead.selection,status:'fetched',evidenceIds:[record.id],evidenceUrls:[record.url],requests:requestCount.count,fetchedAt:record.fetchedAt,reason:record.evidenceNote};}catch(error){observations[index]={productUrl:lead.productUrl,originSourceIds:lead.originSourceIds,selection:lead.selection,status:'failed',evidenceIds:[],evidenceUrls:[],requests:requestCount.count,completedAt:stamp(now),stage:error.stage||'product-evidence',code:error.code||'product_evidence_unavailable',reason:safeError(error)};}}
 }));}finally{clearTimeout(timer);}
 const merged=new Map(sources.map(source=>[source.id,{...source}]));
 for(const record of evidence.filter(Boolean)){const old=merged.get(record.id);if(old&&old.url!==record.url)throw fail('Product evidence ID conflicts with an original public source.','product_evidence_identity_conflict');merged.set(record.id,old?{...old,...record,feedExcerpt:old.text,originFeedIds:old.originFeedIds||[]}:record);}
 const fetched=observations.filter(item=>item.status==='fetched').length,failed=observations.filter(item=>item.status==='failed').length;
 return {sources:[...merged.values()],enrichment:{schema:1,status:leads.length?fetched?'completed':'failed':'no_new_leads',startedAt,completedAt:stamp(now),selected:leads.length,attempted:observations.filter(item=>item.requests>0).length,fetched,failed,requests:observations.reduce((sum,item)=>sum+item.requests,0),policy:PRODUCT_EVIDENCE_POLICY,observations}};
}
