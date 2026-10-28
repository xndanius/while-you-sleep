import {fetchPublic,plainText} from './research.mjs';
import {canonicalURL,hash,safeError,sha256,stableJSON} from './storage.mjs';
import {fetchDemandEvidence,sourceRole,sourceSegments,demandTaskCount,demandEvidenceFingerprint,unchangedDemandEvidence,isDiscussionSourceDefinition} from './demand-sources.mjs';
import {selectBuildingReferences} from './building-references.mjs';
import {extractImplementationEvidence} from './implementation-evidence.mjs';
import {assessmentEvidenceReasons} from './evidence-contract.mjs';
import {selectDiscussionImplementationReferences,discussionImplementationReference,extractDiscussionImplementationEvidence,hasDiscussionImplementationReference} from './discussion-implementation.mjs';
import {validateSourceScanReceipt} from './source-registry.mjs';
import {discussionDiscoveryReasons} from './discussion-discovery.mjs';

export const PRODUCT_EVIDENCE_POLICY=Object.freeze({maxLeads:10,concurrency:3,maxPageBytes:2000000,maxREADMEBytes:350000,maxMetadataBytes:350000,maxTextCharacters:8000,timeBudgetMs:90000,maxRequestsPerLead:3});
export const PRODUCT_SELECTION_POLICY=Object.freeze({version:2,cooldownHours:24,maxHistoryRuns:96,maxHistoryRecords:288,familyBudgets:Object.freeze({primary:5,repository:3,directory:2,editorial:1,'model-demo':1}),maxFeedLeads:3,maxHostLeads:2});
const fail=(message,code='product_evidence_unavailable')=>Object.assign(new Error(message),{code,stage:'product-evidence'});
export function sourceEvidenceFetchOptions(source){
 if(hasDiscussionImplementationReference(source)&&!discussionImplementationReference(source))throw fail('Implementation documentation does not match its exact fixed catalog and demand binding.','invalid_product_evidence_policy');
 if(source?.enriched!==true)return {};
 if(source.evidenceKind==='discussion-post'&&source.providerEvidence){if(!source.evidenceFetch||Object.keys(source.evidenceFetch).length!==2||source.evidenceFetch.provider!==true||source.evidenceFetch.complete!==true||source.providerProofVerified!==true||source.livePostRefetched!==false)throw fail('Provider discussion evidence lacks its fixed independent receipt-read policy.','invalid_product_evidence_policy');return {provider:true,complete:true};}
 const maxBytes=source.evidenceKind==='github-readme'?PRODUCT_EVIDENCE_POLICY.maxREADMEBytes:['product-page','demand-notice','discussion-post'].includes(source.evidenceKind)?PRODUCT_EVIDENCE_POLICY.maxPageBytes:null;
 if(maxBytes===null||!source.evidenceFetch||Object.keys(source.evidenceFetch).length!==2||source.evidenceFetch.maxBytes!==maxBytes||source.evidenceFetch.complete!==true)throw fail('Enriched evidence has an invalid fixed fetch policy.','invalid_product_evidence_policy');
 return {maxBytes,complete:true};
}
const stamp=now=>new Date(typeof now==='function'?now():now).toISOString();
function mergeFreshEvidence(old,record){
 if(!old)return record;
 const previous={...old};
 // An absent optional example in a fresh first post is authoritative too.
 if(record.discussionMetadataVersion===1){delete previous.taskExample;delete previous.nativeReadingContext;}
 if(record.nativeReadingContext){delete previous.feedExcerpt;return {...previous,...record,originFeedIds:old.originFeedIds||[]};}
 return {...previous,...record,feedExcerpt:old.text,originFeedIds:old.originFeedIds||[]};
}
function publicURL(raw){try{if(typeof raw!=='string'||raw.length>4096) return null;const url=new URL(raw);if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||/(^|\.)(localhost|local|internal|test|invalid)$/i.test(url.hostname))return null;return canonicalURL(raw);}catch{return null;}}
function repository(raw){try{const url=new URL(raw),match=url.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/)?$/);return url.hostname==='github.com'&&match&&!['features','topics','collections','marketplace','orgs','users','settings'].includes(match[1])?{owner:match[1],name:match[2]}:null;}catch{return null;}}
const listingHosts=new Set(['news.ycombinator.com','hn.algolia.com','betalist.com','www.ycombinator.com']);
const editorialHosts=new Set(['techcrunch.com','simonwillison.net','www.latent.space','latent.space','www.bensbites.com','bensbites.com']);
const recoveryTopics=[/faktur|invoice|billing|payment|betalning/i,/dokument|document|\bpdf\b|arkiv|archiv|filing|registrering|\brecords?\b/i,/rapport|report|statistik/i,/schem|bokning|boka\b|calendar|appointment/i,/spreadsheet|\bcsv\b|sheets?\b|kalkyl/i,/bokför|accounting|reconcil|expense|receipt|kvitto/i,/support tickets?|customer support|helpdesk|ticket (?:triage|routing)/i,/order (?:processing|tracking|management|status)|inventory|stock control|shipping|delivery tracking/i,/marketing|campaign|crm|lead (?:generation|qualification|follow)/i];
const choreText=source=>source?.taskExcerpts?.join(' ')||source?.text||'';
const concreteOverlap=(text,source)=>recoveryTopics.some(pattern=>pattern.test(choreText(source))&&pattern.test(text||''));
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
export function recentProductAssessments({runs=[],drafts=[],research=[],contexts=[],scans=[],learning=[],checks=[],now=Date.now}={}){
 if([runs,drafts,research,contexts,scans,learning,checks].some(records=>!Array.isArray(records)||records.length>PRODUCT_SELECTION_POLICY.maxHistoryRecords))throw fail('Recent assessment history exceeds its fixed bound.','invalid_assessment_history');
 const current=typeof now==='function'?now():new Date(now).getTime(),cutoff=current-PRODUCT_SELECTION_POLICY.cooldownHours*3600000,result=new Map();if(!Number.isFinite(current))throw fail('Recent assessment time is invalid.','invalid_assessment_history');
 const ordered=runs.slice().sort((a,b)=>String(b?.checkedAssessment?.completedAt||'').localeCompare(String(a?.checkedAssessment?.completedAt||''))).slice(0,PRODUCT_SELECTION_POLICY.maxHistoryRuns);
 for(const run of ordered){const proof=run?.checkedAssessment,at=Date.parse(proof?.completedAt);if(!/^loop-\d+-\d+$/.test(run?.id||'')||run.type!=='loop'||run.assessmentOutcome!=='completed'||!Array.isArray(run.operationalFailures)||run.operationalFailures.length||proof?.schema!==1||proof.contractVersion!==1||proof.completed!==true||proof.runId!==run.id||proof.checkerRunId!==`${run.id}-independent-check`||!['assessed','no_supported_candidate'].includes(proof.decision)||!Number.isFinite(at)||at>current||at<=cutoff||!['draftSha256','contextSha256','rulesSha256','sourceSnapshotSha256','policySha256'].every(key=>/^[a-f0-9]{64}$/.test(proof[key]||'')))continue;
  const matching=drafts.filter(draft=>draft?.runId===run.id&&sha256(stableJSON(draft))===proof.draftSha256),context=contexts.find(record=>record?.runId===run.id&&sha256(stableJSON(record))===proof.contextSha256),snapshot=research.find(record=>record?.id===run.id&&record.runId===run.id);if(matching.length!==1||!context||context.draftSha256!==proof.draftSha256||context.rulesSha256!==proof.rulesSha256||context.sourceSnapshotSha256!==proof.sourceSnapshotSha256||context.scoringPolicy?.policySha256!==proof.policySha256||!Array.isArray(context.sources)||sha256(stableJSON(context.sources))!==proof.sourceSnapshotSha256||snapshot?.enrichment?.status!=='completed'||!Array.isArray(snapshot.enrichment.observations)||snapshot.enrichment.observations.length>12)continue;
  const validDiscussion=assessmentEvidenceReasons(context).length===0;
  if(context.demandContext?.discussionBatchPolicy&&!validDiscussion)continue;
  const manifest=checks.find(item=>item?.runId===run.id&&item.draftSha256===proof.draftSha256&&item.sourceSnapshotSha256===proof.sourceSnapshotSha256&&item.policySha256===proof.policySha256);
  const receipt=validDiscussion&&context.demandContext?.discussionBatchPolicy&&snapshot.learningSelection&&manifest&&learning.find(item=>item?.schema===1&&item.runId===run.id&&item.id===run.id&&item.type==='learning-run'&&item.outcome==='assessed'&&/^[a-f0-9]{64}$/.test(item.scanSha256||'')&&item.runSha256===sha256(stableJSON(run))&&item.checksSha256===sha256(stableJSON(manifest))&&item.draftSha256===proof.draftSha256&&item.contextSha256===proof.contextSha256&&item.selectionSha256===sha256(stableJSON(snapshot.learningSelection)));
  const discoveryScan=validDiscussion&&context.demandContext?.discussionBatchPolicy?.researchSha256===sha256(stableJSON(snapshot))&&receipt&&scans.find(scan=>scan?.runId===run.id&&validateSourceScanReceipt(scan,{runId:run.id,expectedSha256:receipt.scanSha256}).length===0&&scan.registrySha256===snapshot.learningSelection.registrySha256&&stableJSON(scan.producer)===stableJSON(snapshot.learningSelection.producer));
  const primary=new Set(context.sources.filter(source=>{try{sourceEvidenceFetchOptions(source);return source.enriched===true&&publicURL(source.url)&&source.id===hash(publicURL(source.url))&&typeof source.text==='string'&&source.text.length>=(source.discussionMetadataVersion===1&&validDiscussion?25:source.evidenceKind==='demand-notice'||source.evidenceExtraction?.version===1?100:300)&&(source.providerEvidence?source.providerProofVerified===true&&source.livePostRefetched===false&&source.providerEvidence.provider==='apify'&&source.providerEvidence.capturedAt===source.fetchedAt&&Number.isFinite(Date.parse(source.fetchedAt))&&Date.parse(source.fetchedAt)<=Date.parse(source.verifiedAt)&&Date.parse(source.verifiedAt)-Date.parse(source.fetchedAt)<=8*3600000:source.verifiedAt===source.fetchedAt)&&Number.isFinite(Date.parse(source.verifiedAt))&&Date.parse(source.verifiedAt)<=at;}catch{return false;}}).map(source=>publicURL(source.productUrl)).filter(Boolean));
  const fetched=new Set(snapshot.enrichment.observations.filter(item=>item.status==='fetched'&&Number.isFinite(Date.parse(item.fetchedAt))&&Date.parse(item.fetchedAt)<=at&&primary.has(publicURL(item.productUrl))).map(item=>publicURL(item.productUrl)).filter(Boolean)),draft=matching[0];
  const products=[...(Array.isArray(draft.candidates)?draft.candidates:[]),...(Array.isArray(draft.posts)?draft.posts:[]),...(Array.isArray(draft.rejected)?draft.rejected:[])].slice(0,36);
  for(const item of products){
   const productUrl=publicURL(item?.productUrl);if(!productUrl||!fetched.has(productUrl)||result.has(productUrl))continue;
   const demandSource=context.sources.find(source=>publicURL(source.productUrl)===productUrl&&(source.evidenceKind==='demand-notice'||source.evidenceKind==='discussion-post'&&validDiscussion)),demandEvidenceSha256=demandEvidenceFingerprint(demandSource);
   const discovery=discoveryScan?.sources?.find(source=>source.id===demandSource?.id&&publicURL(source.url)===productUrl&&discoveryScan.originMap.some(origin=>origin.sourceId===source.id&&origin.feedIds.includes(demandSource.registrySourceId)));
   const carryover=discoveryScan&&discussionDiscoveryReasons(snapshot.discoveryCarryover).length===0&&discussionDiscoveryReasons(context.discoveryCarryover).length===0&&context.discoveryCarryover.records.find(row=>row.sourceId===demandSource?.id&&row.url===productUrl&&row.feedIds.includes(demandSource.registrySourceId)&&Date.parse(row.observedAt)<=at&&snapshot.discoveryCarryover.records.some(original=>stableJSON(original)===stableJSON(row)));
   const discoveryEvidenceSha256=discovery?.textSha256||carryover?.textSha256;
   result.set(productUrl,{productUrl,assessedAt:proof.completedAt,runId:run.id,...(demandEvidenceSha256?{demandEvidenceSha256}:{}),...(discoveryEvidenceSha256?{discoveryEvidenceSha256}:{})});
  }
 }
 return [...result.values()];
}
export function selectProductLeads(sources,{originMap=[],previous=[],recentAssessments=[],learningSelection,demandDefinitions=[],now=Date.now,limit=PRODUCT_EVIDENCE_POLICY.maxLeads,cooldownHours=PRODUCT_SELECTION_POLICY.cooldownHours,priorityProductUrl=null}={}){
 if(!Array.isArray(sources)||sources.length>800||!Number.isInteger(limit)||limit<0||limit>PRODUCT_EVIDENCE_POLICY.maxLeads)throw fail('Product lead selection exceeds its bounded input.','invalid_product_leads');
 if(!Array.isArray(recentAssessments)||recentAssessments.length>PRODUCT_SELECTION_POLICY.maxHistoryRuns*12)throw fail('Recent assessment selection exceeds its fixed bound.','invalid_assessment_history');
 if(!Number.isFinite(cooldownHours)||cooldownHours<1||cooldownHours>PRODUCT_SELECTION_POLICY.cooldownHours)throw fail('Invalid bounded lead cooldown.','invalid_product_leads');
 const current=typeof now==='function'?now():new Date(now).getTime(),cutoff=current-cooldownHours*3600000;
 const existing=new Set(previous.map(post=>publicURL(post?.productUrl)).filter(Boolean)),cooled=new Map(recentAssessments.filter(item=>Number.isFinite(Date.parse(item?.assessedAt))&&Date.parse(item.assessedAt)>cutoff&&Date.parse(item.assessedAt)<=current).map(item=>[publicURL(item.productUrl),item]).filter(([url])=>url)),leads=new Map();
 for(let index=0;index<sources.length;index++){
  const source=sources[index];if(!source?.id||!publicURL(source.url))continue;
  const origins=originMap.filter(origin=>origin.sourceId===source.id&&origin.url===source.url),definition=learningSelection?demandDefinitions.find(definition=>sourceRole(definition)==='demand'&&learningSelection.demandSourceIds.includes(definition.id)&&source.registrySourceId===definition.id&&origins.some(origin=>origin.feedIds.includes(definition.id))):null;
  if(learningSelection&&(!definition||(['mixed-recovery-v1','discussion-first-v1'].includes(learningSelection.selectionStrategy)?!learningSelection.eligibleSegments.includes(source.segment)||!sourceSegments(definition).includes(source.segment):source.segment!==learningSelection.selectedSegment)))continue;
  if(learningSelection?.selectionStrategy==='discussion-first-v1'&&(!isDiscussionSourceDefinition(definition)||source.discussionMetadataVersion!==1))continue;
  const products=learningSelection?[source.url]:origins.length?origins.map(origin=>origin.productUrl||origin.url):[source.productUrl||source.url];
  for(const raw of products){const productUrl=publicURL(raw);if(!productUrl||existing.has(productUrl))continue;
   const prior=cooled.get(productUrl),currentEvidence=demandEvidenceFingerprint(source);if(prior&&unchangedDemandEvidence(prior,currentEvidence))continue;
   const matching=origins.filter(origin=>[origin.url,origin.productUrl].filter(Boolean).some(url=>canonicalURL(url)===productUrl)),feedIds=[...new Set(matching.flatMap(origin=>origin.feedIds||[]))];
   const rank=definition?demandPriority(productUrl,source):leadPriority(productUrl,source);if(!leads.has(productUrl))leads.set(productUrl,{productUrl,title:String(source.title||'Public product documentation').slice(0,200),originSourceIds:[],originFeedIds:[],...rank,index,...(definition?{demandSource:source,demandDefinition:definition}: {})});
   const lead=leads.get(productUrl);lead.priority=Math.max(lead.priority,rank.priority);lead.signals=[...new Set([...lead.signals,...rank.signals])].sort();lead.originSourceIds=[...new Set([...lead.originSourceIds,source.id])].sort();lead.originFeedIds=[...new Set([...lead.originFeedIds,...feedIds])].sort();
  }
 }
 const ordered=[...leads.values()].sort((a,b)=>b.priority-a.priority||a.index-b.index||a.productUrl.localeCompare(b.productUrl)),selected=[],feedCounts=new Map(),familyCounts=new Map(),hostCounts=new Map();
 const add=lead=>{selected.push(lead);familyCounts.set(lead.family,(familyCounts.get(lead.family)||0)+1);hostCounts.set(lead.host,(hostCounts.get(lead.host)||0)+1);for(const id of lead.originFeedIds)feedCounts.set(id,(feedCounts.get(id)||0)+1);};
 if(learningSelection?.selectionStrategy==='discussion-first-v1'){
  while(selected.length<limit){const remaining=ordered.filter(lead=>!selected.includes(lead)&&(feedCounts.get(lead.demandDefinition.id)||0)<3);if(!remaining.length)break;remaining.sort((a,b)=>(feedCounts.get(a.demandDefinition.id)||0)-(feedCounts.get(b.demandDefinition.id)||0)||b.priority-a.priority||a.index-b.index);add(!selected.length&&remaining.find(row=>row.productUrl===priorityProductUrl)||remaining[0]);}
  return selected.map(({priority,index,family,host,signals,...lead})=>({...lead,selection:{version:PRODUCT_SELECTION_POLICY.version,family,signals,reason:'At most ten public discussion posts, with at most three from any source. A post supplies its own demand signal; independent evidence and scoring remain required.'}}));
 }
 if(learningSelection?.selectionStrategy==='mixed-recovery-v1'){
  const take=lead=>{if(!lead||selected.includes(lead)||selected.length===limit||(feedCounts.get(lead.demandDefinition.id)||0)>=3)return;add(lead);};
  for(const kind of ['ted-service-demand','wwr-demand','jobtech-demand'])take(ordered.find(lead=>lead.demandDefinition?.kind===kind));
  while(selected.length<limit){const remaining=ordered.filter(lead=>!selected.includes(lead)&&(feedCounts.get(lead.demandDefinition.id)||0)<3);if(!remaining.length)break;remaining.sort((a,b)=>(feedCounts.get(a.demandDefinition.id)||0)-(feedCounts.get(b.demandDefinition.id)||0)||b.priority-a.priority||a.index-b.index);take(remaining[0]);}
  return selected.map(({priority,index,family,host,signals,...lead})=>({...lead,selection:{version:PRODUCT_SELECTION_POLICY.version,family,signals,reason:'Mixed recovery reserves eligible source families and at most three leads per demand feed; this is retrieval only, never approval.'}}));
 }
 if(learningSelection)return ordered.slice(0,Math.min(limit,3)).map(({priority,index,family,host,signals,...lead})=>({...lead,selection:{version:PRODUCT_SELECTION_POLICY.version,family,signals,reason:'The selected demand source supplies at most three leads; independent evidence and scoring remain required.'}}));
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
function sourceRecord(page,lead,kind,{demandSources}={}){
 checkedPage(page);
 if(/<\s*(?:title|h1)[^>]*>\s*(?:sign\s*in|log\s*in|access denied|just a moment|attention required)|<input\b[^>]*type\s*=\s*["']?password/i.test(page.text))throw fail('Product page presents a login or access challenge.','product_login_or_challenge');
 if(kind==='product-page'&&/^application\/json\b/i.test(page.contentType))throw fail('An arbitrary JSON API is not product documentation.','unreadable_product_evidence');
 const implementation=discussionImplementationReference(lead,{demandSources});
 if(hasDiscussionImplementationReference(lead)&&!implementation)throw fail('Implementation documentation does not match its exact fixed catalog and demand binding.','invalid_product_evidence_policy');
 const extracted=implementation?extractDiscussionImplementationEvidence(lead,page.text,{demandSources}):extractImplementationEvidence(page.text);if(!extracted)throw fail('Product evidence has no useful complete privacy-safe capability section.','insufficient_product_evidence');
 const {text,evidenceExtraction}=extracted;
 const url=canonicalURL(page.url),publisher=new URL(url).hostname;
 if(implementation&&url!==implementation.url)throw fail('Fixed implementation documentation resolved outside its exact catalog URL.','product_evidence_identity_conflict');
 return {id:hash(url),url,title:`${lead.title} · ${kind==='github-readme'?'public README':'product evidence'}`.slice(0,200),publisher,text,fetchedAt:page.fetchedAt,productUrl:lead.productUrl,originSourceIds:lead.originSourceIds,...(implementation?{role:'building',demand:false,implementationReferenceVersion:1,...(lead.implementationSelectionVersion===2?{implementationSelectionVersion:2}:{}),implementationReferenceId:implementation.id,supportsDemandSourceIds:lead.supportsDemandSourceIds}:{}),evidenceKind:kind,evidenceFetch:{maxBytes:kind==='github-readme'?PRODUCT_EVIDENCE_POLICY.maxREADMEBytes:PRODUCT_EVIDENCE_POLICY.maxPageBytes,complete:true},enriched:true,evidenceExcerpted:evidenceExtraction.omittedCharacters>0,evidenceExtraction,evidenceNote:'A literal capability section from first-party documentation was fetched; it does not establish a deployed runtime, customers, revenue or full autonomy.',evidenceValidation:{robots:page.robots,redirects:page.redirects||[],httpStatus:page.status,contentType:page.contentType,resolvedUrl:page.url,maxBytes:page.maxBytes,truncated:false}};
}
async function leadEvidence(lead,fetchPage,signal,requestCount,providerFetch,demandSources){
 const request=async(url,maxBytes,adapterFetch=globalThis.fetch)=>{if(signal.aborted)throw fail('Product enrichment reached its time budget.','product_evidence_timeout');requestCount.count++;if(requestCount.count>PRODUCT_EVIDENCE_POLICY.maxRequestsPerLead)throw fail('Product enrichment exceeded its request budget.','product_evidence_request_limit');let onAbort;try{const timeout=new Promise((resolve,reject)=>{onAbort=()=>reject(fail('Product enrichment reached its time budget.','product_evidence_timeout'));signal.addEventListener('abort',onAbort,{once:true});});const page=await Promise.race([fetchPage(url,{maxBytes,complete:true,signal,fetchImpl:(input,options)=>adapterFetch(input,{...options,signal:AbortSignal.any([options.signal,signal].filter(Boolean))})}),timeout]);return checkedPage(page,{requestedURL:url,maxBytes});}finally{signal.removeEventListener('abort',onAbort);}};
 // Keep the vetted adapter's transport (TED's anonymous POST) inside the same
 // request budget, abort signal and public response/robots checks.
 if(lead.demandDefinition){const fresh=await fetchDemandEvidence(lead.demandSource,{definition:lead.demandDefinition,includeNativeReadingContext:true,fetchPage:(url,options)=>request(url,options.maxBytes,options.fetchImpl),...(providerFetch?{providerFetch:async(source,options)=>{if(signal.aborted)throw fail('Discussion provider reread reached its time budget.','product_evidence_timeout');requestCount.count++;if(requestCount.count>PRODUCT_EVIDENCE_POLICY.maxRequestsPerLead)throw fail('Discussion provider reread exceeded its request budget.','product_evidence_request_limit');let onAbort;try{return await Promise.race([providerFetch(source,{...options,signal}),new Promise((resolve,reject)=>{onAbort=()=>reject(fail('Discussion provider reread reached its time budget.','product_evidence_timeout'));signal.addEventListener('abort',onAbort,{once:true});})]);}finally{signal.removeEventListener('abort',onAbort);}}}:{})});return {...fresh,originSourceIds:lead.originSourceIds,evidenceKind:fresh.providerEvidence?'discussion-post':'demand-notice',evidenceFetch:fresh.providerEvidence?fresh.evidenceFetch:{maxBytes:2000000,complete:true},enriched:true,evidenceNote:fresh.providerEvidence?'The captured public discussion was read from its verified immutable provider receipt, retaining its original capture time. This is not a live refetch; only its stated problem or request is evidence.':fresh.discussionMetadataVersion===1?'The exact public discussion was reread. Only its stated problem or request is evidence; a paying AI customer, implementation and all scores still require independent checking.':'Fresh official paid-work evidence; demand for an AI service and a feasible small version still require independent checking.'};}
 const repo=repository(lead.productUrl);
 if(repo){
  const metadata=JSON.parse((await request(`https://api.github.com/repos/${repo.owner}/${repo.name}`,PRODUCT_EVIDENCE_POLICY.maxMetadataBytes)).text);
  if(metadata.private!==false||typeof metadata.full_name!=='string'||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(metadata.full_name)||metadata.full_name.toLowerCase()!==`${repo.owner}/${repo.name}`.toLowerCase())throw fail('GitHub metadata does not describe the selected public repository.','github_repository_unavailable');
  const readme=JSON.parse((await request(`https://api.github.com/repos/${metadata.full_name}/readme`,PRODUCT_EVIDENCE_POLICY.maxMetadataBytes)).text),raw=publicURL(readme.download_url);
  if(!raw||new URL(raw).hostname!=='raw.githubusercontent.com'||!new URL(raw).pathname.startsWith('/'+metadata.full_name+'/')||readme.type!=='file')throw fail('GitHub did not supply an exact public repository README URL.','github_readme_unavailable');
  return sourceRecord(await request(raw,PRODUCT_EVIDENCE_POLICY.maxREADMEBytes),lead,'github-readme',{demandSources});
 }
 return sourceRecord(await request(lead.productUrl,PRODUCT_EVIDENCE_POLICY.maxPageBytes),lead,'product-page',{demandSources});
}
export async function enrichProductLeads({sources,originMap=[],previous=[],recentAssessments=[],learningSelection,demandDefinitions=[],fetchPage=fetchPublic,providerFetch=null,now=Date.now,limit=PRODUCT_EVIDENCE_POLICY.maxLeads,cooldownHours=PRODUCT_SELECTION_POLICY.cooldownHours,timeBudgetMs=PRODUCT_EVIDENCE_POLICY.timeBudgetMs,priorityProductUrl=null,onLeadEvent=null,onReferenceEvent=null,referencePriority=null}={}){
 if(!Number.isInteger(timeBudgetMs)||timeBudgetMs<1||timeBudgetMs>PRODUCT_EVIDENCE_POLICY.timeBudgetMs)throw fail('Invalid product enrichment time budget.','invalid_product_evidence_budget');
 const leads=selectProductLeads(sources,{originMap,previous,recentAssessments,learningSelection,demandDefinitions,now,limit,cooldownHours,priorityProductUrl}),startedAt=stamp(now),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeBudgetMs),observations=Array(leads.length),evidence=Array(leads.length),supportObservations=[],supportEvidence=[];let next=0;
 try{await Promise.all(Array.from({length:Math.min(PRODUCT_EVIDENCE_POLICY.concurrency,leads.length)},async()=>{
  while(next<leads.length){const index=next++,lead=leads[index],requestCount={count:0};await onLeadEvent?.({phase:'started',lead});try{const record=await leadEvidence(lead,fetchPage,controller.signal,requestCount,providerFetch);if(controller.signal.aborted)throw fail('Product enrichment reached its time budget.','product_evidence_timeout');evidence[index]=record;observations[index]={productUrl:lead.productUrl,originSourceIds:lead.originSourceIds,selection:lead.selection,status:'fetched',evidenceIds:[record.id],evidenceUrls:[record.url],requests:requestCount.count,fetchedAt:record.fetchedAt,reason:record.evidenceNote};}catch(error){observations[index]={productUrl:lead.productUrl,originSourceIds:lead.originSourceIds,selection:lead.selection,status:'failed',evidenceIds:[],evidenceUrls:[],requests:requestCount.count,completedAt:stamp(now),stage:error.stage||'product-evidence',code:error.code||'product_evidence_unavailable',reason:safeError(error)};}await onLeadEvent?.({phase:'finished',lead,observation:observations[index],source:evidence[index]||null});}
 }));
 if(learningSelection&&!controller.signal.aborted&&evidence.some(source=>source?.role==='demand'&&source.demand===true)){
  const priority=referencePriority?.()||{},priorityOptions=typeof priority==='string'?{priorityDemandSourceId:priority}:priority,priorityDemandSourceId=priorityOptions.priorityDemandSourceId||null,references=selectBuildingReferences(sources,evidence.filter(Boolean),{limit:2,matchedOnly:true}),existingSupport=selectProductLeads(references,{originMap,limit:2,now}),fixedSupport=learningSelection.selectionStrategy==='discussion-first-v1'?selectDiscussionImplementationReferences(evidence.filter(Boolean),{...priorityOptions,limit:2}):[],supportLeads=(priorityDemandSourceId?[...fixedSupport,...existingSupport]:[...existingSupport,...fixedSupport]).filter((lead,index,all)=>all.findIndex(item=>item.productUrl===lead.productUrl)===index).slice(0,2),requestLimit=PRODUCT_EVIDENCE_POLICY.maxLeads*PRODUCT_EVIDENCE_POLICY.maxRequestsPerLead;
  let used=observations.reduce((sum,item)=>sum+item.requests,0);
  for(const lead of supportLeads){
   if(controller.signal.aborted||used+PRODUCT_EVIDENCE_POLICY.maxRequestsPerLead>requestLimit)break;
   const requestCount={count:0};let source=null;await onReferenceEvent?.({phase:'started',lead});try{const record=await leadEvidence(lead,fetchPage,controller.signal,requestCount,providerFetch,evidence.filter(source=>source?.role==='demand'));if(controller.signal.aborted)throw fail('Product enrichment reached its time budget.','product_evidence_timeout');source=record;supportEvidence.push(record);supportObservations.push({productUrl:lead.productUrl,originSourceIds:lead.originSourceIds,status:'fetched',evidenceIds:[record.id],requests:requestCount.count,fetchedAt:record.fetchedAt});}catch(error){supportObservations.push({productUrl:lead.productUrl,originSourceIds:lead.originSourceIds,status:'failed',evidenceIds:[],requests:requestCount.count,code:error.code||'product_evidence_unavailable',reason:safeError(error)});}await onReferenceEvent?.({phase:'finished',lead,observation:supportObservations.at(-1),source});used+=requestCount.count;
  }
 }
 }finally{clearTimeout(timer);}
 const merged=new Map(sources.map(source=>[source.id,{...source}]));
 for(const record of [...evidence.filter(Boolean),...supportEvidence]){const old=merged.get(record.id);if(old&&old.url!==record.url)throw fail('Product evidence ID conflicts with an original public source.','product_evidence_identity_conflict');merged.set(record.id,mergeFreshEvidence(old,record));}
 const fetched=observations.filter(item=>item.status==='fetched').length,failed=observations.filter(item=>item.status==='failed').length;
 return {sources:[...merged.values()],enrichment:{schema:1,status:leads.length?fetched?'completed':'failed':'no_new_leads',startedAt,completedAt:stamp(now),selected:leads.length,attempted:observations.filter(item=>item.requests>0).length,fetched,failed,requests:observations.reduce((sum,item)=>sum+item.requests,0),policy:PRODUCT_EVIDENCE_POLICY,observations,...(supportObservations.length?{supportingReferences:{schema:1,maximum:2,requestLimit:PRODUCT_EVIDENCE_POLICY.maxLeads*PRODUCT_EVIDENCE_POLICY.maxRequestsPerLead,requests:supportObservations.reduce((sum,item)=>sum+item.requests,0),observations:supportObservations}}:{})}};
}


// Discussion posts are the candidate identities and the demand signals. Building
// documentation may support implementation, but never becomes a second lead.
export async function enrichDiscussionLeads(options={}){
 const selection=options.learningSelection;
 if(selection?.selectionStrategy!=='discussion-first-v1')throw fail('Discussion enrichment requires its sealed selection.','invalid_discussion_batch');
 const result=await enrichProductLeads(options),assignments=[];
 for(const row of result.enrichment.observations.filter(row=>row.status==='fetched')){
  const source=result.sources.find(source=>row.evidenceIds.includes(source.id)&&source.enriched===true&&source.discussionMetadataVersion===1&&source.role==='demand'&&source.demand===true&&publicURL(source.url)===row.productUrl),definition=source&&options.demandDefinitions?.find(definition=>definition.id===source.registrySourceId&&isDiscussionSourceDefinition(definition));
  if(!source||!definition||!selection.demandSourceIds.includes(definition.id)||!selection.eligibleSegments.includes(source.segment)||!sourceSegments(definition).includes(source.segment)){row.status='failed';row.code='discussion_assignment_unavailable';row.reason='Fresh discussion evidence did not retain its exact admitted origin and eligible customer segment.';continue;}
  assignments.push({productUrl:row.productUrl,segment:source.segment,kind:'discussion',demandSourceId:source.id,registrySourceId:definition.id});
 }
 const fetched=result.enrichment.observations.filter(row=>row.status==='fetched').length;
 result.enrichment={...result.enrichment,status:result.enrichment.selected?fetched?'completed':'failed':'no_new_leads',fetched,failed:result.enrichment.selected-fetched,discussionBatch:{version:1,maxLeads:10,maxPerDemandSource:3,postIsDemand:true,leadAssignments:assignments}};
 return result;
}

// Recovery changes the starting point, never the demand or independent-check
// requirement. A cooled notice may corroborate a different, genuinely new
// builder-led proposal only after its public task evidence is freshly fetched.
export async function enrichBuilderFallback({initial,sources,originMap=[],previous=[],recentAssessments=[],learningSelection,demandDefinitions=[],fetchPage=fetchPublic,now=Date.now,limit=10,cooldownHours=3}={}){
 if(learningSelection?.researchPolicy?.fallbackEnabled!==true||initial?.enrichment?.status!=='no_new_leads'||initial.enrichment.selected!==0||initial.enrichment.attempted!==0)return initial;
 const signals=sources.filter(source=>source.role==='demand'&&source.demand===true&&source.segment===learningSelection.selectedSegment&&learningSelection.demandSourceIds.includes(source.registrySourceId)).sort((a,b)=>demandTaskCount(b)-demandTaskCount(a)||a.id.localeCompare(b.id)).slice(0,2),fresh=[];
 for(const source of signals){const definition=demandDefinitions.find(item=>item.id===source.registrySourceId&&sourceRole(item)==='demand');if(!definition)continue;try{fresh.push(await fetchDemandEvidence(source,{definition,fetchPage}));}catch{/* Missing corroboration never becomes a demand claim. */}}
 if(!fresh.length)return initial;
 const builderSources=sources.filter(source=>source.role!=='demand'&&source.demand!==true),result=await enrichProductLeads({sources:builderSources,originMap,previous,recentAssessments,fetchPage,now,limit,cooldownHours});
 if(result.enrichment.status==='no_new_leads')return initial;
 const merged=new Map(sources.map(source=>[source.id,source]));for(const source of [...result.sources,...fresh])merged.set(source.id,source);
 const ids=fresh.map(source=>source.id);
 return {sources:[...merged.values()],enrichment:{...result.enrichment,fallback:true,fallbackFrom:{status:'no_new_leads',selected:0,attempted:0},demandSignalIds:ids,observations:result.enrichment.observations.map(item=>({...item,evidenceIds:item.status==='fetched'?[...item.evidenceIds,...ids]:item.evidenceIds,demandSignalIds:ids})),note:'Builder-led recovery requires a named nontechnical customer and a literal public demand signal. Neither a source pairing nor a cooled notice is an approval.'}};
}

// A separate versioned branch preserves every historical single-segment run.
// Corroboration is evidence, never an additional assessed lead or approval.
export async function enrichMixedRecoveryBatch({sources,originMap=[],previous=[],recentAssessments=[],learningSelection,demandDefinitions=[],fetchPage=fetchPublic,now=Date.now,limit=10,cooldownHours=3,timeBudgetMs=90000}={}){
 if(learningSelection?.selectionStrategy!=='mixed-recovery-v1'||!learningSelection.researchPolicy?.widened||limit!==10||timeBudgetMs<1||timeBudgetMs>90000)throw fail('Mixed recovery requires its sealed bounded policy.','invalid_recovery_batch');
 const options={originMap,previous,recentAssessments,learningSelection,demandDefinitions,now,limit:10,cooldownHours},directPool=selectProductLeads(sources,options),signalPool=selectProductLeads(sources,{...options,previous:[],recentAssessments:[]});
 const heading=source=>[source.title,source.productUrl,source.url].filter(Boolean).join(' '),taskMatched=sources.filter(source=>source.role!=='demand'&&!source.demand&&signalPool.some(signal=>concreteOverlap(heading(source),signal.demandSource))),documentationRank=source=>{try{const url=new URL(source.productUrl||source.url);return url.hostname==='n8n.io'&&/^\/workflows\/\d/.test(url.pathname)?0:repository(url.toString())?1:url.hostname==='huggingface.co'||listingHosts.has(url.hostname)?3:2;}catch{return 4;}};
 const specificity=source=>recoveryTopics.filter(pattern=>pattern.test(heading(source))&&signalPool.some(signal=>pattern.test(choreText(signal.demandSource)))).length;
 // Prefer a concrete business operation with a literal workflow description
 // over a broad PDF/tool heading. This ranks retrieval only; the fresh
 // capability paragraph must still match the exact paired public chore.
 const describedBusinessTask=source=>/invoice|billing|payment|receipt|accounting|support|order|inventory|campaign|marketing/i.test(heading(source))&&typeof source.text==='string'&&source.text.length>String(source.title||'').length+80&&/\b(?:every|daily|weekly|automatically|monitors?|tracks?|reconciles?|extracts?|reminders?)\b/i.test(source.text);
 const references=taskMatched.map((source,index)=>({source,index})).sort((a,b)=>documentationRank(a.source)-documentationRank(b.source)||Number(describedBusinessTask(b.source))-Number(describedBusinessTask(a.source))||specificity(b.source)-specificity(a.source)||a.index-b.index).slice(0,8).map(row=>row.source),builders=selectProductLeads(references,{originMap,previous,recentAssessments,now,limit:8,cooldownHours}).sort((a,b)=>references.findIndex(source=>a.originSourceIds.includes(source.id))-references.findIndex(source=>b.originSourceIds.includes(source.id))).slice(0,3),feedCounts=new Map(),familyCounts=new Map(),leads=[];
 const assignment=(lead,signal,kind)=>({productUrl:lead.productUrl,segment:signal.demandSource.segment,kind,demandSourceId:signal.demandSource.id,registrySourceId:signal.demandDefinition.id});
 const take=(lead,signal,kind)=>{const mapped=assignment(lead,signal,kind);leads.push({...lead,recoveryAssignment:mapped,recoverySignal:signal});feedCounts.set(mapped.registrySourceId,(feedCounts.get(mapped.registrySourceId)||0)+1);familyCounts.set(signal.demandDefinition.kind,(familyCounts.get(signal.demandDefinition.kind)||0)+1);};
 for(const builder of builders){const original=sources.find(source=>builder.originSourceIds.includes(source.id)),signals=signalPool.filter(signal=>(feedCounts.get(signal.demandDefinition.id)||0)<3&&concreteOverlap(heading(original||{}),signal.demandSource));signals.sort((a,b)=>(familyCounts.get(a.demandDefinition.kind)||0)-(familyCounts.get(b.demandDefinition.kind)||0)||(feedCounts.get(a.demandDefinition.id)||0)-(feedCounts.get(b.demandDefinition.id)||0));if(signals[0])take(builder,signals[0],'builder');}
 const takeDirect=lead=>{if(!lead||leads.length>=10||leads.some(item=>item.productUrl===lead.productUrl)||(feedCounts.get(lead.demandDefinition.id)||0)>=3)return false;take(lead,lead,'demand');return true;};
 for(const kind of ['ted-service-demand','wwr-demand','jobtech-demand'])takeDirect(directPool.find(lead=>lead.demandDefinition.kind===kind&&(feedCounts.get(lead.demandDefinition.id)||0)<3));
 while(leads.length<10){const remaining=directPool.filter(lead=>!leads.some(item=>item.productUrl===lead.productUrl)&&(feedCounts.get(lead.demandDefinition.id)||0)<3);if(!remaining.length)break;remaining.sort((a,b)=>(feedCounts.get(a.demandDefinition.id)||0)-(feedCounts.get(b.demandDefinition.id)||0));takeDirect(remaining[0]);}
 const corroboration=[...new Map(leads.filter(lead=>lead.recoveryAssignment.kind==='builder'&&!leads.some(item=>item.productUrl===lead.recoverySignal.productUrl)).map(lead=>[lead.recoverySignal.productUrl,lead.recoverySignal])).values()],jobs=[...leads,...corroboration],fetchedRecords=new Map(),observations=Array(jobs.length),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeBudgetMs),startedAt=stamp(now);let next=0,requests=0;
 const boundedFetch=(url,options)=>{if(requests>=30)throw fail('Mixed recovery exhausted its thirty-request budget.','product_evidence_request_limit');requests++;return fetchPage(url,options);};
 try{await Promise.all(Array.from({length:Math.min(3,jobs.length)},async()=>{while(next<jobs.length){const index=next++,lead=jobs[index],count={count:0};try{const record=await leadEvidence(lead,boundedFetch,controller.signal,count);fetchedRecords.set(lead.productUrl,record);observations[index]={productUrl:lead.productUrl,originSourceIds:lead.originSourceIds,selection:lead.selection,status:'fetched',evidenceIds:[record.id],evidenceUrls:[record.url],requests:count.count,fetchedAt:record.fetchedAt,reason:record.evidenceNote};}catch(error){observations[index]={productUrl:lead.productUrl,originSourceIds:lead.originSourceIds,status:'failed',evidenceIds:[],evidenceUrls:[],requests:count.count,code:error.code||'product_evidence_unavailable',reason:safeError(error)};}}}));}finally{clearTimeout(timer);}
 const leadAssignments=[];
 for(let index=0;index<leads.length;index++){const lead=leads[index],row=observations[index],signal=fetchedRecords.get(lead.recoverySignal.productUrl),demandAvailable=signal?.role==='demand'&&signal.demand===true,record=fetchedRecords.get(lead.productUrl),implementationFit=lead.recoveryAssignment.kind!=='builder'||concreteOverlap(record?.text,signal);if(row.status==='fetched'&&demandAvailable&&implementationFit){row.evidenceIds=[...new Set([...row.evidenceIds,signal.id])];row.demandSignalIds=[signal.id];leadAssignments.push(lead.recoveryAssignment);}else if(row.status==='fetched'){row.status='failed';row.code=demandAvailable?'fresh_implementation_task_mismatch':'fresh_demand_signal_unavailable';row.reason=demandAvailable?'Fresh capability text has no concrete task overlap with the paired public chore; this builder cannot fill the mandatory quota.':'The exact public demand signal could not be freshly verified; this lead cannot be assessed or approved.';}}
 const merged=new Map(sources.map(source=>[source.id,{...source}]));for(const record of fetchedRecords.values()){const old=merged.get(record.id);if(old&&old.url!==record.url)throw fail('Mixed evidence conflicts with an original source identity.');merged.set(record.id,mergeFreshEvidence(old,record));}
 const candidateObservations=observations.slice(0,leads.length),fetched=candidateObservations.filter(row=>row.status==='fetched').length;
 return {sources:[...merged.values()],enrichment:{schema:1,status:leads.length?fetched?'completed':'failed':'no_new_leads',startedAt,completedAt:stamp(now),selected:leads.length,attempted:candidateObservations.filter(row=>row.requests>0).length,fetched,failed:leads.length-fetched,requests,policy:PRODUCT_EVIDENCE_POLICY,observations:candidateObservations,recoveryBatch:{version:1,mode:learningSelection.researchPolicy.mode,widened:true,maxLeads:10,maxPerDemandSource:3,minBuilderLeads:3,leadAssignments},corroboratingDemand:{observations:observations.slice(leads.length)},note:'Every builder is paired to one freshly fetched public chore and an eligible nontechnical customer segment. Search assignments are not evidence of a paying AI customer or independent approval.'}};
}
