import {promises as fs} from 'node:fs';
import path from 'node:path';
import {hash,sha256,stableJSON,canonicalURL,validId,candidateIdentity} from './storage.mjs';
import {TIMEZONE,localParts} from './config.mjs';
import {checkApproval,verifyPublishedPost,completedAssessmentReasons} from './validation.mjs';
import {standaloneResearchRecords} from './scheduler-proof.mjs';
import {checkScoringApproval,validateScoringPolicy,validateScoringCriteria,weightedOverall} from './scoring.mjs';
import {DEMAND_SOURCE_KINDS,isDemandSourceDefinition,demandSourceMetadata,demandTaskCount,DEMAND_TASK_EXTRACTOR_VERSION} from './demand-sources.mjs';
import {scanPrivacyOmissionReasons} from './research-privacy.mjs';
import {isCurrentResearchSource,validProviderSourceValidation,discussionScanItemLimit} from './discussion-sources.mjs';

export const SOURCE_POLICY=Object.freeze({activeCap:40,scanBudget:20,explorationSlots:5,maxDiscoveriesPerDay:3,timezone:TIMEZONE,review:'Daily promotion and retirement review; later hosted research scans may use its unused three-probe discovery budget',promotion:{minAgeDays:7,minSuccessfulScans:6,minCheckedCandidates:10,minPassedChecks:3,minPublished:1,minimumAverageScore:'current_publish_threshold'},retirement:{minAgeDays:7,minSuccessfulScans:10,minCheckedCandidates:10,maxPassRateExclusive:0.1,consecutiveAccessFailures:10}});
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const bounded=(value,max=500)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\r\n]/.test(value);
const kinds=new Set(['hn','rss','html','json-feed','github-trending','hf-spaces','hn-launches','yc-directory','betalist','yc-launches','n8n-workflows',...DEMAND_SOURCE_KINDS]);
const same=(a,b)=>stableJSON(a)===stableJSON(b),runMatch=id=>typeof id==='string'&&id.match(/^(loop|research|source-bootstrap)-(\d+)-(\d+)$/);
function publicHTTPS(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&!/(^|\.)(localhost|local|internal|test|invalid)$/i.test(url.hostname);}catch{return false;}}
function validSourceFetch(validation){
 try{
 const v=validation;
 return !!v&&v.publicHttps===true&&v.robotsAllowed===true&&v.readable===true&&Array.isArray(v.robots)&&v.robots.length>=1&&v.robots.length<=4&&Array.isArray(v.redirects)&&v.redirects.length+1===v.robots.length
  &&v.robots.every((record,index)=>record?.allowed===true&&publicHTTPS(record.evaluatedUrl)&&record.origin===new URL(record.evaluatedUrl).origin&&publicHTTPS(record.robotsUrl)&&Number.isFinite(Date.parse(record.fetchedAt))&&(record.state==='missing'?[404,410].includes(record.status):record.state==='available'&&record.status>=200&&record.status<300&&/^text\/plain\b/i.test(record.contentType||''))&&(index===0||canonicalURL(v.redirects[index-1].next)===canonicalURL(record.evaluatedUrl)))
  &&v.redirects.every((record,index)=>[301,302,303,307,308].includes(record.status)&&publicHTTPS(record.url)&&publicHTTPS(record.next)&&canonicalURL(record.url)===canonicalURL(v.robots[index].evaluatedUrl))
  &&v.httpStatus>=200&&v.httpStatus<300&&/^(?:text\/|application\/(?:[a-z0-9.+-]*\+)?(?:json|xml)|application\/(?:rss|atom)\+xml)/i.test(v.contentType||'')&&publicHTTPS(v.resolvedUrl)&&canonicalURL(v.resolvedUrl)===canonicalURL(v.robots.at(-1).evaluatedUrl)
  &&Number.isFinite(Date.parse(v.fetchedAt))&&v.maxBytes===2000000&&v.truncated===false&&['public-sources-v1','public-sources-v2'].includes(v.parserVersion)&&Number.isInteger(v.itemCount)&&v.itemCount>=0&&v.itemCount<=20;
 }catch{return false;}
}
export const validSourceAdmission=validation=>validProviderSourceValidation(validation)||validSourceFetch(validation)&&validation.itemCount>=1;
export function sourceValidationMatchesDefinition(validation,definition){try{return validProviderSourceValidation(validation,definition)||validSourceFetch(validation)&&validation.itemCount>=1&&definition.kind!=='provider-discussion'&&canonicalURL(validation.robots[0].evaluatedUrl)===definition.url;}catch{return false;}}
export function validEmptyDemandScan(observation,definition){const v=observation?.validation,e=v?.emptyFeed;return !!definition&&isDemandSourceDefinition(definition)&&observation.status==='empty'&&observation.code==='no_eligible_demand_tasks'&&observation.itemCount===0&&validSourceFetch(v)&&v.itemCount===0&&canonicalURL(v.robots[0].evaluatedUrl)===definition.url&&!!e&&Object.keys(e).length===4&&e.schema===1&&['rss','atom','json'].includes(e.format)&&Number.isInteger(e.examinedItems)&&e.examinedItems>=0&&e.examinedItems<=discussionScanItemLimit(definition,e.format)&&e.eligibleItems===0;}
export const sourceRunURL=id=>`https://github.com/xndanius/while-you-sleep/actions/runs/${runMatch(id)?.[2]||''}`;
export function sourceDefinitionReasons(source){
 try{const url=new URL(source?.url);return !source||source.id!==hash(canonicalURL(source.url))||!bounded(source.name,120)||!kinds.has(source.kind)||DEMAND_SOURCE_KINDS.includes(source.kind)&&!isDemandSourceDefinition(source)||url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||canonicalURL(source.url)!==source.url?['Invalid fixed public source definition.']:[];}catch{return ['Invalid fixed public source definition.'];}
}
export function emptySourceRegistry(){return {schema:1,initializedAt:null,coverageStartedAt:null,updatedAt:null,sources:[],exclusions:[]};}
export function validateSourceRegistry(registry){
 try{
 const failures=[];
 if(!registry||registry.schema!==1||!Array.isArray(registry.sources)||registry.sources.length>400||!Array.isArray(registry.exclusions)||registry.exclusions.length>64)return ['Source registry schema is invalid.'];
 if(registry.initializedAt===null){if(registry.sources.length||registry.coverageStartedAt!==null||registry.updatedAt!==null)failures.push('Uninitialized registry contains admitted sources.');}
 else if(!stamp(registry.initializedAt)||registry.coverageStartedAt!==registry.initializedAt||!stamp(registry.updatedAt))failures.push('Registry measurement coverage is invalid.');
 for(const source of registry.sources){failures.push(...sourceDefinitionReasons(source));if(!['active','probation','retired'].includes(source.status)||!stamp(source.addedAt)||!['seed','discovery'].includes(source.howAdded)||!bounded(source.statusReason)||!stamp(source.lastValidatedAt)||!sourceValidationMatchesDefinition(source.validation,source)||Date.parse(source.addedAt)<Date.parse(registry.initializedAt))failures.push('Source admission/status evidence is invalid.');}
 if(registry.exclusions.some(record=>!validId(record?.id)||!validId(record.sourceId)||!bounded(record.name,120)||!publicHTTPS(record.url)||!stamp(record.checkedAt)||!bounded(record.reason)||!bounded(record.code,100)||!['seed','discovery'].includes(record.proposedBy)||!runMatch(record.runId)||record.runUrl!==sourceRunURL(record.runId)))failures.push('Source exclusion evidence is invalid.');
 if(new Set(registry.sources.map(source=>source.id)).size!==registry.sources.length||new Set(registry.sources.map(source=>source.url)).size!==registry.sources.length)failures.push('Source registry repeats a canonical source.');
 if(registry.sources.filter(source=>source.status!=='retired').length>SOURCE_POLICY.activeCap)failures.push('Source registry exceeds its non-retired source cap.');
 return [...new Set(failures)];
 }catch{return ['Source registry contains malformed nested admission metadata.'];}
}
export async function readPublicSourceRegistry(root){
 try{const value=await readBoundedJSON(path.join(root,'data','sources','registry.json'));const failures=validateSourceRegistry(value);if(failures.length)throw new Error(failures.join(' '));return value;}catch(error){if(error.code==='ENOENT')return emptySourceRegistry();throw error;}
}
export function sourceYieldScore(yieldValue={}){
 return (Number(yieldValue.passedChecks||0)+1)/(Number(yieldValue.checkedCandidates||0)+5)
  +.25*(Number(yieldValue.published||0)+1)/(Number(yieldValue.candidates||0)+5)
  +.25*(Number(yieldValue.linkedInPicks||0)+1)/(Number(yieldValue.candidates||0)+5)
  +(yieldValue.averageScore||0)/100;
}
export function registryDefinitions(registry,stats={bySource:{}},{limit=SOURCE_POLICY.scanBudget,explorationSlots=SOURCE_POLICY.explorationSlots,discussionOnly=true}={}){
 const failures=validateSourceRegistry(registry);if(failures.length)throw new Error(failures.join(' '));
 if(!Number.isInteger(limit)||limit<1||limit>SOURCE_POLICY.scanBudget||!Number.isInteger(explorationSlots)||explorationSlots<0||explorationSlots>limit)throw new Error('Invalid bounded source selection.');
 const available=registry.sources.filter(source=>source.status!=='retired'&&(!discussionOnly||isCurrentResearchSource(source))),oldest=(a,b)=>(stats.bySource?.[a.id]?.lastScannedAt||'').localeCompare(stats.bySource?.[b.id]?.lastScannedAt||'')||a.id.localeCompare(b.id);
 const exploration=available.slice().sort((a,b)=>Number(a.status!=='probation')-Number(b.status!=='probation')||(stats.bySource?.[a.id]?.yield?.successfulScans||0)-(stats.bySource?.[b.id]?.yield?.successfulScans||0)||oldest(a,b)).slice(0,explorationSlots),selected=new Set(exploration.map(source=>source.id));
 const ranked=available.filter(source=>!selected.has(source.id)).sort((a,b)=>sourceYieldScore(stats.bySource?.[b.id]?.yield)-sourceYieldScore(stats.bySource?.[a.id]?.yield)||oldest(a,b));
 return [...ranked.slice(0,Math.max(0,limit-exploration.length)),...exploration].map(({id,name,url,kind})=>({id,name,url,kind}));
}
export function createSourceScanReceipt({runId,registry,sources,observations,originMap,privacyOmissions,producer,now=new Date()}){
 const metadata=sources.map(source=>({id:source.id,url:source.url,productUrl:source.productUrl||null,textSha256:sha256(source.text),...(source.role==='demand'&&source.taskExcerptVersion===DEMAND_TASK_EXTRACTOR_VERSION?{taskEvidence:{version:DEMAND_TASK_EXTRACTOR_VERSION,count:demandTaskCount(source)}}:{})}));
 const receipt={schema:1,id:runId,runId,type:'source-scan',createdAt:new Date(now).toISOString(),registrySha256:sha256(stableJSON(registry)),definitions:producer.definitions,definitionsSha256:sha256(stableJSON(producer.definitions)),sources:metadata,sourcesSha256:sha256(stableJSON(metadata)),sourceSnapshotSha256:sha256(stableJSON(sources)),observations,originMap,...(privacyOmissions?{privacyOmissions}: {}),producer:{repository:producer.repository,runId:producer.runId,runAttempt:producer.runAttempt,workflow:producer.workflow,stage:producer.stage,headSha:producer.headSha}};
 const failures=validateSourceScanReceipt(receipt);if(failures.length)throw new Error(failures.join(' '));return receipt;
}
export function validateSourceScanReceipt(receipt,{expectedSha256,runId}={}){
 try{
 const failures=[],match=runMatch(receipt?.id),producer=receipt?.producer;
 if(!receipt||receipt.schema!==1||receipt.type!=='source-scan'||!match||!['loop','research'].includes(match[1])||receipt.runId!==receipt.id||runId&&receipt.id!==runId||!stamp(receipt.createdAt)||!hex(receipt.registrySha256))return ['Trusted source scan identity is invalid.'];
 if(expectedSha256&&(!hex(expectedSha256)||sha256(stableJSON(receipt))!==expectedSha256))failures.push('Pre-model source scan fingerprint changed.');
 if(!producer||producer.repository!=='xndanius/while-you-sleep'||producer.runId!==match[2]||producer.runAttempt!==Number(match[3])||producer.workflow!==(match[1]==='loop'?'loop.yml':'research.yml')||producer.stage!==(match[1]==='loop'?'pre_model':'research')||!/^[a-f0-9]{40}$/.test(producer.headSha||''))failures.push('Trusted source scan producer is invalid.');
 if(!Array.isArray(receipt.definitions)||receipt.definitions.length>SOURCE_POLICY.scanBudget||receipt.definitionsSha256!==sha256(stableJSON(receipt.definitions)))failures.push('Trusted selected-source definition fingerprint is invalid.');
 const definitions=Array.isArray(receipt.definitions)?receipt.definitions:[];if(definitions.some(source=>sourceDefinitionReasons(source).length)||new Set(definitions.map(source=>source.id)).size!==definitions.length)failures.push('Source scan contains unsupported or duplicate feed definitions.');
 if(!Array.isArray(receipt.sources)||receipt.sources.length>800||receipt.sourcesSha256!==sha256(stableJSON(receipt.sources))||!hex(receipt.sourceSnapshotSha256))failures.push('Source scan contents fingerprint is invalid.');
 const sources=Array.isArray(receipt.sources)?receipt.sources:[];if(new Set(sources.map(source=>source?.id)).size!==sources.length||sources.some(source=>!validId(source?.id)||!hex(source?.textSha256)||!publicHTTPS(source?.url)||source.id!==hash(canonicalURL(source.url))||source.productUrl!==null&&!publicHTTPS(source.productUrl)))failures.push('Source scan contains malformed or duplicate source records.');
 if(sources.some(source=>source.taskEvidence!==undefined&&(!source.taskEvidence||Object.keys(source.taskEvidence).length!==2||source.taskEvidence.version!==DEMAND_TASK_EXTRACTOR_VERSION||!Number.isInteger(source.taskEvidence.count)||source.taskEvidence.count<0||source.taskEvidence.count>3)))failures.push('Source scan task evidence metadata is invalid.');
 if(!Array.isArray(receipt.observations)||receipt.observations.length!==definitions.length||new Set(receipt.observations.map(item=>item?.feedId)).size!==definitions.length||receipt.observations.some(item=>!definitions.some(source=>source.id===item?.feedId&&source.url===item.url)||!['ok','empty','failed'].includes(item.status)||!Number.isInteger(item.itemCount)||item.itemCount<0||item.itemCount>20||!Number.isFinite(Date.parse(item.fetchedAt))||!bounded(item.message)||item.status==='failed'&&item.itemCount!==0||item.status==='empty'&&!validEmptyDemandScan(item,definitions.find(source=>source.id===item.feedId))||item.status==='ok'&&(!sourceValidationMatchesDefinition(item.validation,definitions.find(source=>source.id===item.feedId))||item.validation.itemCount!==item.itemCount)))failures.push('Source scan observations are not bound to selected feeds.');
 if(!Array.isArray(receipt.originMap)||receipt.originMap.length<sources.length||receipt.originMap.length>800||new Set(receipt.originMap.map(item=>stableJSON([item?.sourceId,item?.url,item?.productUrl||null]))).size!==receipt.originMap.length||receipt.originMap.some(item=>!sources.some(source=>source.id===item?.sourceId&&source.url===item.url)||item.productUrl&&!publicHTTPS(item.productUrl)||!Array.isArray(item.feedIds)||!item.feedIds.length||new Set(item.feedIds).size!==item.feedIds.length||item.feedIds.some(id=>!definitions.some(source=>source.id===id)||!receipt.observations?.some(observation=>observation.feedId===id&&observation.status==='ok')))||sources.some(source=>!receipt.originMap?.some(item=>item.sourceId===source.id)))failures.push('Source scan origin map is not the original bounded scan.');
 if(receipt.observations?.some(observation=>observation.status==='ok'&&observation.validation?.type==='provider-pool-validation'&&(observation.validation.items.some(item=>!sources.some(source=>source.id===item.sourceId&&source.url===item.url)||!receipt.originMap?.some(origin=>origin.sourceId===item.sourceId&&origin.url===item.url&&origin.feedIds.includes(observation.feedId)))||receipt.originMap?.filter(origin=>origin.feedIds.includes(observation.feedId)).some(origin=>!observation.validation.items.some(item=>item.sourceId===origin.sourceId&&item.url===origin.url)))))failures.push('Provider pool proof is not bound to the exact sanitized source and origin map.');
 failures.push(...scanPrivacyOmissionReasons(receipt));
 if(Array.isArray(receipt.observations)&&Array.isArray(receipt.originMap)&&receipt.observations.some(observation=>receipt.originMap.filter(item=>item.feedIds?.includes(observation.feedId)).length!==(receipt.privacyOmissions?observation.retainedItemCount:observation.itemCount)))failures.push('Source item counts disagree with the frozen per-feed origin entries.');
 if(Buffer.byteLength(stableJSON(receipt))>3*1024*1024)failures.push('Source scan exceeds its bounded record size.');return [...new Set(failures)];
 }catch{return ['Trusted source scan contains malformed nested metadata.'];}
}
export function deriveSourceAttribution({scan,draft,context,manifest,run,posts=[],expectedScanSha256,expectedDraftSha256,expectedContextSha256,rulesSha256,now=new Date()}){
 const failures=validateSourceScanReceipt(scan,{expectedSha256:expectedScanSha256,runId:run?.id});
 if(!hex(expectedScanSha256)||!hex(expectedDraftSha256)||!hex(expectedContextSha256)||!hex(rulesSha256)||sha256(stableJSON(draft))!==expectedDraftSha256||sha256(stableJSON(context))!==expectedContextSha256||context?.rulesSha256!==rulesSha256||context?.draftSha256!==expectedDraftSha256||context?.sourceSnapshotSha256!==sha256(stableJSON(context?.sources))||draft?.runId!==run?.id||context?.runId!==run?.id||!Array.isArray(draft?.posts)||draft.posts.length>6||validateScoringPolicy(context?.scoringPolicy).length)failures.push('Source attribution lacks exact trusted draft/context/rules fingerprints.');
 if(failures.length)throw new Error([...new Set(failures)].join(' '));
 const proof=run.checkedAssessment;
 const assessmentComplete=context.assessmentContractVersion===1&&manifest?.runId===run.id&&manifest.draftSha256===expectedDraftSha256&&manifest.sourceSnapshotSha256===context.sourceSnapshotSha256&&manifest.policySha256===context.scoringPolicy.policySha256&&completedAssessmentReasons(draft,context,manifest).length===0&&run.assessmentOutcome==='completed'&&(!run.operationalFailures||Array.isArray(run.operationalFailures)&&!run.operationalFailures.length)&&proof?.schema===1&&proof.contractVersion===1&&proof.completed===true&&proof.runId===run.id&&stamp(proof.completedAt)&&proof.contextSha256===expectedContextSha256&&proof.draftSha256===expectedDraftSha256&&proof.rulesSha256===rulesSha256&&proof.sourceSnapshotSha256===context.sourceSnapshotSha256&&proof.policySha256===context.scoringPolicy.policySha256;
 const checks=checkApproval(draft,context,manifest||{}),candidates=[],seen=new Set();
 for(const post of draft.posts){
  if(!validId(post?.id)||post.id!==candidateIdentity(post)||seen.has(post.id))throw new Error('Attribution contains an invalid or repeated deterministic product identity.');seen.add(post.id);
  const known=scan.originMap.filter(item=>post.sourceIds?.includes(item.sourceId)&&context.sources.some(source=>source.id===item.sourceId&&source.url===item.url)&&[item.url,item.productUrl].filter(Boolean).some(url=>canonicalURL(url)===canonicalURL(post.productUrl)));
  const feedIds=[...new Set(known.flatMap(item=>item.feedIds))].sort(),check=checks.find(item=>item.postId===post.id),scoreReasons=checkScoringApproval(post.scoring?.criteria,check?.check?.scoreChecks,context.sources,{sourceIds:post.sourceIds});
  const published=posts.find(value=>value.id===post.id&&value.runId===run.id&&run.published?.includes(value.id)&&verifyPublishedPost(value));
  candidates.push({id:post.id,productUrl:canonicalURL(post.productUrl),feedIds,sourceIds:[...(post.sourceIds||[])],evidenceUrls:context.sources.filter(source=>post.sourceIds?.includes(source.id)).map(source=>source.url),checkStatus:assessmentComplete?(check?.pass?'passed':'rejected'):'unassessed',checkReasons:(check?.reasons||[]).map(reason=>String(reason).replace(/[\r\n]/g,' ').slice(0,500)).slice(0,20),scoreSupported:assessmentComplete&&scoreReasons.length===0,criteria:assessmentComplete&&scoreReasons.length===0?post.scoring.criteria:null,assessmentPolicy:context.scoringPolicy,publishedPostId:published?.id||null});
 }
 return {schema:1,id:run.id,runId:run.id,type:'source-attribution',createdAt:new Date(now).toISOString(),scanSha256:expectedScanSha256,draftSha256:expectedDraftSha256,contextSha256:expectedContextSha256,rulesSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,candidates,unknownCandidates:candidates.filter(candidate=>!candidate.feedIds.length).length};
}
export function validateSourceAttributionReceipt(receipt){
 try{if(receipt?.schema!==1||receipt.type!=='source-attribution'||!/^loop-\d+-\d+$/.test(receipt.id)||receipt.runId!==receipt.id||!stamp(receipt.createdAt)||['scanSha256','draftSha256','contextSha256','rulesSha256','sourceSnapshotSha256'].some(key=>!hex(receipt[key]))||!Array.isArray(receipt.candidates)||receipt.candidates.length>6||new Set(receipt.candidates.map(candidate=>candidate.id)).size!==receipt.candidates.length)return ['Invalid source attribution identity or fingerprints.'];
 if(receipt.candidates.some(candidate=>!validId(candidate.id)||candidate.id!==candidateIdentity(candidate)||canonicalURL(candidate.productUrl)!==candidate.productUrl||!Array.isArray(candidate.feedIds)||candidate.feedIds.length>20||new Set(candidate.feedIds).size!==candidate.feedIds.length||candidate.feedIds.some(id=>!validId(id))||!Array.isArray(candidate.sourceIds)||candidate.sourceIds.length<1||candidate.sourceIds.length>4||!Array.isArray(candidate.evidenceUrls)||candidate.evidenceUrls.length>4||candidate.evidenceUrls.some(url=>!publicHTTPS(url))||!['unassessed','passed','rejected'].includes(candidate.checkStatus)||typeof candidate.scoreSupported!=='boolean'||!Array.isArray(candidate.checkReasons)||candidate.checkReasons.length>20||candidate.checkReasons.some(reason=>!bounded(reason))||validateScoringPolicy(candidate.assessmentPolicy).length||(candidate.scoreSupported?candidate.criteria===null||validateScoringCriteria(candidate.criteria).length>0:candidate.criteria!==null)))return ['Source attribution candidates are malformed.'];
 if(receipt.unknownCandidates!==receipt.candidates.filter(candidate=>!candidate.feedIds.length).length)return ['Unknown source attribution count changed.'];return [];}catch{return ['Malformed source attribution metadata.'];}
}
export const SOURCE_CONSIDERATION_LIMIT=40;
// Consideration is a deterministic source join, never an independent approval.
// These rows deliberately carry no model-owned score, reason or pass flag.
export function deriveSourceConsiderations({scan,draft,expectedScanSha256,expectedDraftSha256}){
 const failures=validateSourceScanReceipt(scan,{expectedSha256:expectedScanSha256,runId:draft?.runId});
 if(!hex(expectedScanSha256)||!hex(expectedDraftSha256)||sha256(stableJSON(draft))!==expectedDraftSha256||draft?.runId!==scan?.runId)failures.push('Considerations lack the original scan and exact trusted draft fingerprints.');
 if(failures.length)throw new Error(failures.join(' '));
 const raw=draft.candidates===undefined?[]:draft.candidates,items=new Map();let invalidConsiderations=Array.isArray(raw)?0:1;
 for(const candidate of (Array.isArray(raw)?raw:[]).slice(0,SOURCE_CONSIDERATION_LIMIT)){
  let productUrl,id;
  try{if(typeof candidate?.productUrl!=='string'||candidate.productUrl.length>4096||!publicHTTPS(candidate.productUrl)||!Array.isArray(candidate.sourceIds)||candidate.sourceIds.length<1||candidate.sourceIds.length>4||candidate.sourceIds.some(value=>!validId(value))||new Set(candidate.sourceIds).size!==candidate.sourceIds.length)throw new Error('Invalid consideration identity.');productUrl=canonicalURL(candidate.productUrl);id=candidateIdentity({productUrl});}catch{invalidConsiderations++;continue;}
  const sourceIds=[...candidate.sourceIds].sort(),origins=scan.originMap.filter(origin=>sourceIds.includes(origin.sourceId)&&scan.sources.some(source=>source.id===origin.sourceId&&source.url===origin.url)&&[origin.url,origin.productUrl].filter(Boolean).some(url=>canonicalURL(url)===productUrl));
  const feedIds=[...new Set(origins.flatMap(origin=>origin.feedIds))].sort();
  if(!items.has(id))items.set(id,{id,productUrl,sourceIds:[],feedIds:[]});
  const item=items.get(id);item.sourceIds=[...new Set([...item.sourceIds,...sourceIds])].sort();item.feedIds=[...new Set([...item.feedIds,...feedIds])].sort();
 }
 const considered=[...items.values()].sort((a,b)=>a.id.localeCompare(b.id));
 return {schema:1,runId:scan.runId,scanSha256:expectedScanSha256,draftSha256:expectedDraftSha256,createdAt:scan.createdAt,items:considered,unmappedConsiderations:considered.filter(item=>!item.feedIds.length).length,invalidConsiderations,omittedConsiderations:Array.isArray(raw)?Math.max(0,raw.length-SOURCE_CONSIDERATION_LIMIT):0};
}
export function sourceStatistics({registry,scans=[],attributions=[],considerations=[],picks=[],currentPolicy,now=new Date()}){
 if(validateSourceRegistry(registry).length||validateScoringPolicy(currentPolicy).length)throw new Error('Verified source statistics need valid registry and current scoring policy.');
 const bySource=Object.fromEntries(registry.sources.map(source=>[source.id,{yield:{scans:0,successfulScans:0,itemsFetched:0,distinctItems:0,candidates:0,checkedCandidates:0,passedChecks:0,scoreSamples:0,averageScore:null,published:0,linkedInPicks:0},items:new Set(),candidates:new Set(),checked:new Set(),passed:new Set(),scores:new Map(),published:new Set(),picks:new Set(),lastScannedAt:null,health:null,consecutiveAccessFailures:0}])),seenScans=new Set(),seenRuns=new Set(),publishedOrigins=new Map();
 for(const scan of scans.slice().sort((a,b)=>a.createdAt.localeCompare(b.createdAt))){if(validateSourceScanReceipt(scan).length)throw new Error('Invalid committed source scan.');if(seenScans.has(scan.id))throw new Error('Source statistics repeated a scan.');seenScans.add(scan.id);
  for(const observation of scan.observations){const row=bySource[observation.feedId],source=registry.sources.find(item=>item.id===observation.feedId);if(!row||Date.parse(scan.createdAt)<Date.parse(source.addedAt))continue;row.yield.scans++;row.yield.itemsFetched+=observation.itemCount;if(['ok','empty'].includes(observation.status)){row.yield.successfulScans++;row.consecutiveAccessFailures=0;}else row.consecutiveAccessFailures++;row.lastScannedAt=observation.fetchedAt;row.health={status:observation.status,message:observation.message,fetchedAt:observation.fetchedAt};}
  for(const origin of scan.originMap)for(const id of origin.feedIds){const source=registry.sources.find(item=>item.id===id);if(source&&Date.parse(scan.createdAt)>=Date.parse(source.addedAt))bySource[id]?.items.add(origin.sourceId);}
 }
 for(const receipt of attributions.slice().sort((a,b)=>a.createdAt.localeCompare(b.createdAt))){if(seenRuns.has(receipt.runId))throw new Error('Source statistics repeated an attributed run.');seenRuns.add(receipt.runId);
  if(validateSourceAttributionReceipt(receipt).length)throw new Error('Invalid committed source attribution.');
  for(const candidate of receipt.candidates){for(const feedId of candidate.feedIds){const row=bySource[feedId],source=registry.sources.find(item=>item.id===feedId);if(!row||Date.parse(receipt.createdAt)<Date.parse(source.addedAt))continue;row.candidates.add(candidate.productUrl);if(['passed','rejected'].includes(candidate.checkStatus))row.checked.add(candidate.productUrl);if(candidate.checkStatus==='passed'){row.passed.add(candidate.productUrl);if(candidate.scoreSupported&&candidate.criteria)row.scores.set(candidate.productUrl,weightedOverall(candidate.criteria,currentPolicy.weights));}if(candidate.publishedPostId){row.published.add(candidate.publishedPostId);if(!publishedOrigins.has(candidate.publishedPostId))publishedOrigins.set(candidate.publishedPostId,new Set());publishedOrigins.get(candidate.publishedPostId).add(feedId);}}
  }
 }
 const seenConsiderations=new Set();
 for(const receipt of considerations){
  const attribution=attributions.find(value=>value.runId===receipt?.runId),scan=scans.find(value=>value.runId===receipt?.runId);
  if(!attribution||!scan||receipt.schema!==1||receipt.scanSha256!==attribution.scanSha256||receipt.draftSha256!==attribution.draftSha256||receipt.createdAt!==scan.createdAt||seenConsiderations.has(receipt.runId)||!Array.isArray(receipt.items)||receipt.items.length>SOURCE_CONSIDERATION_LIMIT||new Set(receipt.items.map(item=>item?.id)).size!==receipt.items.length)throw new Error('Consideration metrics lack their validated original attribution boundary.');
  seenConsiderations.add(receipt.runId);
  for(const item of receipt.items){
   if(item.id!==candidateIdentity(item)||canonicalURL(item.productUrl)!==item.productUrl||!Array.isArray(item.sourceIds)||!Array.isArray(item.feedIds)||new Set(item.feedIds).size!==item.feedIds.length||item.feedIds.some(feedId=>!scan.originMap.some(origin=>origin.feedIds.includes(feedId)&&item.sourceIds.includes(origin.sourceId)&&[origin.url,origin.productUrl].filter(Boolean).some(url=>canonicalURL(url)===item.productUrl))))throw new Error('Consideration source credit differs from its frozen origin.');
   for(const feedId of item.feedIds){const source=registry.sources.find(value=>value.id===feedId);if(source&&Date.parse(scan.createdAt)>=Date.parse(source.addedAt))bySource[feedId].candidates.add(item.productUrl);}
  }
 }
 for(const pick of picks){for(const id of publishedOrigins.get(pick.postId)||[]){if(bySource[id])bySource[id].picks.add(pick.postId);}}
 for(const row of Object.values(bySource)){row.yield.distinctItems=row.items.size;row.yield.candidates=row.candidates.size;row.yield.checkedCandidates=row.checked.size;row.yield.passedChecks=row.passed.size;row.yield.scoreSamples=row.scores.size;row.yield.averageScore=row.scores.size?[...row.scores.values()].reduce((sum,score)=>sum+score,0)/row.scores.size:null;row.yield.published=row.published.size;row.yield.linkedInPicks=row.picks.size;for(const field of ['items','candidates','checked','passed','scores','published','picks'])delete row[field];}
 return {coverageStartedAt:registry.coverageStartedAt,updatedAt:new Date(now).toISOString(),bySource};
}
export function planSourceEvolution({registry,stats,currentPolicy,now=new Date()}){
 const plans=[],date=new Date(now);if(validateSourceRegistry(registry).length||validateScoringPolicy(currentPolicy).length)throw new Error('Invalid source evolution state.');
 for(const source of registry.sources.filter(source=>source.status!=='retired')){const row=stats.bySource[source.id],yieldValue=row?.yield;if(!yieldValue)continue;const age=(date-Date.parse(source.addedAt))/86400000;
  if(row.consecutiveAccessFailures>=SOURCE_POLICY.retirement.consecutiveAccessFailures)plans.push({sourceId:source.id,toStatus:'retired',reason:'Retired after ten consecutive guarded public-access failures.',statistics:row});
  else if(age>=7&&yieldValue.successfulScans>=10&&yieldValue.checkedCandidates>=10&&yieldValue.passedChecks/yieldValue.checkedCandidates<.1)plans.push({sourceId:source.id,toStatus:'retired',reason:'Retired after at least seven days, ten successful scans and ten checked candidates with fewer than ten percent passing.',statistics:row});
  else if(source.status==='probation'&&age>=7&&yieldValue.successfulScans>=6&&yieldValue.checkedCandidates>=10&&yieldValue.passedChecks>=3&&yieldValue.published>=1&&yieldValue.averageScore!==null&&yieldValue.averageScore>=currentPolicy.threshold)plans.push({sourceId:source.id,toStatus:'active',reason:'Promoted after at least seven days, six successful scans, ten checked candidates, three passed checks and one publication; supported mean reaches the current threshold.',statistics:row});
 }
 return plans;
}
export function applySourceTransition(registry,{definition,toStatus,reason,validation,sourceId,howAdded='discovery',now=new Date()}){
 if(validateSourceRegistry(registry).length||!bounded(reason)||!['active','probation','retired'].includes(toStatus))throw new Error('Invalid source registry transition.');const result=structuredClone(registry),at=new Date(now).toISOString();
 if(!result.initializedAt){result.initializedAt=at;result.coverageStartedAt=at;}
 const existing=result.sources.find(source=>source.id===(sourceId||definition?.id));
 if(existing){if(existing.status===toStatus)throw new Error('A registry transition must change status.');if(existing.status==='retired')throw new Error('A retired source cannot reactivate without a new guarded admission contract.');existing.status=toStatus;existing.statusReason=reason;}
 else {if(toStatus!=='probation'||sourceDefinitionReasons(definition).length||!sourceValidationMatchesDefinition(validation,definition))throw new Error('A new source needs guarded admission and starts on probation.');result.sources.push({...definition,status:'probation',addedAt:at,howAdded,statusReason:reason,lastValidatedAt:at,validation});}
 result.updatedAt=at;const failures=validateSourceRegistry(result);if(failures.length)throw new Error(failures.join(' '));return result;
}
export function dailyDiscoveryBudget({day,evolutions=[],discoveries=[]}){
 const review=evolutions.find(record=>record.day===day),receipts=discoveries.filter(record=>record.day===day).sort((a,b)=>a.probeNumber-b.probeNumber);
 const used=(review?.probes.length||0)+receipts.length;
 if(used>SOURCE_POLICY.maxDiscoveriesPerDay)throw new Error('Source discovery exceeds the three-probe daily budget.');
 return {review,receipts,used,remaining:SOURCE_POLICY.maxDiscoveriesPerDay-used};
}
export function validateSourceDiscoveryReceipts(discoveries,{evolutions=[],changes=[],exclusions=[]}={}){
 try{
  const keys=['schema','id','type','day','probeNumber','runId','runUrl','createdAt','evolutionId','evolutionSha256','previousSha256','quotaBefore','quotaAfter','statisticsSha256','policySha256','probe','changeId','exclusionId'];
  if(!Array.isArray(discoveries)||new Set(discoveries.map(record=>record.id)).size!==discoveries.length)return ['Source discovery receipts repeat an identity.'];
  for(const day of new Set(discoveries.map(record=>record.day))){
   const {review,receipts}=dailyDiscoveryBudget({day,evolutions,discoveries});if(!review)throw new Error('Source discovery lost its original daily review.');
   const urls=new Set(review.probes.map(probe=>canonicalURL(probe.url)));let previous=null;
   for(let index=0;index<receipts.length;index++){
    const record=receipts[index],number=review.probes.length+index+1,probe=record.probe;
    if(!same(Object.keys(record).sort(),keys.slice().sort())||record.schema!==1||record.type!=='source-discovery'||record.id!==`source-discovery-${day}-${number}`||record.probeNumber!==number||!/^research-\d+-\d+$/.test(record.runId)||record.runUrl!==sourceRunURL(record.runId)||!stamp(record.createdAt)||localParts(record.createdAt).day!==day||record.evolutionId!==review.id||record.evolutionSha256!==sha256(stableJSON(review))||record.previousSha256!==(previous?sha256(stableJSON(previous)):null)||record.quotaBefore!==SOURCE_POLICY.maxDiscoveriesPerDay-number+1||record.quotaAfter!==SOURCE_POLICY.maxDiscoveriesPerDay-number||!hex(record.statisticsSha256)||!hex(record.policySha256))throw new Error('Source discovery identity, review or quota binding is invalid.');
    if(!probe||probe.sourceId!==hash(canonicalURL(probe.url))||!publicHTTPS(probe.url)||canonicalURL(probe.url)!==probe.url||urls.has(probe.url)||!stamp(probe.checkedAt)||typeof probe.eligible!=='boolean'||!bounded(probe.reason)||typeof probe.validation!=='object'||probe.validation===null||probe.eligible&&!validSourceAdmission(probe.validation))throw new Error('Source discovery probe lacks its exact guarded evidence.');
    const change=changes.find(value=>value.id===record.changeId),exclusion=exclusions.find(value=>value.id===record.exclusionId);
    if(probe.eligible?record.exclusionId!==null||!change||change.runId!==record.runId||change.sourceId!==probe.sourceId||change.url!==probe.url||change.fromStatus!==null||change.toStatus!=='probation'||!same(change.validation,probe.validation):record.changeId!==null||!exclusion||exclusion.runId!==record.runId||exclusion.sourceId!==probe.sourceId||exclusion.url!==probe.url||exclusion.checkedAt!==probe.checkedAt||exclusion.reason!==probe.reason||exclusion.code!==(probe.code||'ADMISSION_REFUSED'))throw new Error('Source discovery probe lost its committed admission or exclusion.');
    urls.add(probe.url);previous=record;
   }
  }
  return [];
 }catch(error){return [error.message||'Source discovery receipts are malformed.'];}
}
export function sourceRegistryView({registry,stats,changes=[],evolutions=[],discoveries=[],now=new Date(),unknownAttribution={}}){
 const selected=registryDefinitions(registry,stats),selectedIds=new Set(selected.map(source=>source.id)),explorationIds=new Set(selected.slice(-Math.min(SOURCE_POLICY.explorationSlots,selected.length)).map(source=>source.id));
 const sources=registry.sources.slice().sort((a,b)=>Number(a.status==='retired')-Number(b.status==='retired')||sourceYieldScore(stats.bySource[b.id]?.yield)-sourceYieldScore(stats.bySource[a.id]?.yield)||a.id.localeCompare(b.id)).map((source,index)=>{const measured=stats.bySource[source.id];return {...source,...demandSourceMetadata(source),lastScannedAt:measured?.lastScannedAt||null,health:measured?.health||null,latestObservation:measured?.health||null,yield:measured?.yield,rank:{position:source.status==='retired'?null:index+1,value:source.status==='retired'?null:sourceYieldScore(measured?.yield),basis:'Verified check pass rate, publication and LinkedIn yield, supported mean score; smoothed for small samples.',exploration:selectedIds.has(source.id)&&explorationIds.has(source.id)},historicalAttribution:'unknown'};});
 const exclusions=registry.exclusions.map(record=>record.code==='robots_disallowed'?{...record,robotsState:'disallowed'}:record);
 const budget=dailyDiscoveryBudget({day:localParts(now).day,evolutions,discoveries});
 return {schema:1,enabled:!!registry.initializedAt,coverageStartedAt:registry.coverageStartedAt,updatedAt:stats.updatedAt,policy:SOURCE_POLICY,sources,recentChanges:changes.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,20),exclusions,lastEvolutionAt:evolutions.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]?.createdAt||null,lastDiscoveryAt:discoveries.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]?.createdAt||null,discoveryBudget:{day:localParts(now).day,used:budget.used,remaining:budget.remaining},recentDiscoveries:discoveries.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.probeNumber-a.probeNumber).slice(0,12),unknownAttribution};
}
export async function readBoundedJSON(file,maxBytes=3*1024*1024){const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxBytes)throw new Error('Source record is not a bounded regular file.');return JSON.parse(await fs.readFile(file,'utf8'));}
async function sourceRecords(root,directory){let files;try{files=await fs.readdir(path.join(root,'data',directory));}catch(error){if(error.code==='ENOENT')return [];throw error;}return Promise.all(files.filter(file=>file.endsWith('.json')).map(async file=>{if(!validId(file.slice(0,-5)))throw new Error('Invalid source record filename.');const record=await readBoundedJSON(path.join(root,'data',directory,file));if(record.id+'.json'!==file)throw new Error('Source record changed physical identity.');return record;}));}
export async function loadSourceRegistryData({root,posts=[],picks=[],currentPolicy,now=new Date()}){
 const registry=await readPublicSourceRegistry(root),[scans,attributions,changes,evolutions,discoveries,exclusions]=await Promise.all(['source-scans','source-attributions','source-changes','source-evolution','source-discovery','source-exclusions'].map(directory=>sourceRecords(root,directory)));
 const considerations=[];
 for(const receipt of attributions){const scan=scans.find(value=>value.id===receipt.runId);if(!scan)throw new Error('Source attribution lost its immutable pre-model scan.');const base=path.join(root,'data'),[draft,context,manifest,run]=await Promise.all([['drafts',receipt.runId],['check-context',receipt.runId],['checks',receipt.runId],['runs',receipt.runId]].map(([directory,id])=>readBoundedJSON(path.join(base,directory,id+'.json'))));const expected=deriveSourceAttribution({scan,draft,context,manifest,run,posts,expectedScanSha256:receipt.scanSha256,expectedDraftSha256:receipt.draftSha256,expectedContextSha256:receipt.contextSha256,rulesSha256:receipt.rulesSha256,now:new Date(receipt.createdAt)});if(!same(receipt,expected))throw new Error('Committed source attribution differs from its original checked evidence.');considerations.push(deriveSourceConsiderations({scan,draft,expectedScanSha256:receipt.scanSha256,expectedDraftSha256:receipt.draftSha256}));}
 for(const change of changes){if(change.schema!==1||change.type!=='source-change'||!runMatch(change.runId)||!stamp(change.createdAt)||!validId(change.sourceId)||!bounded(change.reason)||!['probation','active','retired'].includes(change.toStatus)||change.fromStatus!==null&&!['probation','active','retired'].includes(change.fromStatus)||!hex(change.beforeSha256)||!hex(change.afterSha256)||change.runUrl!==sourceRunURL(change.runId))throw new Error('Source transition record is invalid.');}
 if(new Set(evolutions.map(record=>record.day)).size!==evolutions.length)throw new Error('Source evolution repeats a completed local day.');
 for(const record of evolutions){if(record.schema!==1||record.type!=='source-evolution'||!/^\d{4}-\d{2}-\d{2}$/.test(record.day)||record.id!==`source-evolution-${record.day}`||!runMatch(record.runId)||!stamp(record.createdAt)||!Array.isArray(record.probes)||record.probes.length>SOURCE_POLICY.maxDiscoveriesPerDay||!hex(record.statisticsSha256)||!hex(record.policySha256)||!Array.isArray(record.changeIds)||record.changeIds.some(id=>!changes.some(change=>change.id===id&&change.runId===record.runId)))throw new Error('Source evolution record is invalid.');}
 const discoveryFailures=validateSourceDiscoveryReceipts(discoveries,{evolutions,changes,exclusions});if(discoveryFailures.length)throw new Error(discoveryFailures.join(' '));
 const [legacyResearch,runRecords]=await Promise.all([standaloneResearchRecords(path.join(root,'data','research')),sourceRecords(root,'runs')]),hosted=record=>{const match=runMatch(record?.id);return match&&(!Object.hasOwn(record,'runId')||record.runId===record.id)&&record.githubRunUrl===sourceRunURL(record.id)&&stamp(record.createdAt||record.startedAt);},unknownAttribution={legacyScans:legacyResearch.filter(record=>hosted(record)&&!scans.some(scan=>scan.id===record.id)).length,legacyRuns:runRecords.filter(record=>hosted(record)&&record.type==='loop'&&!attributions.some(receipt=>receipt.id===record.id)).length,legacyPosts:posts.filter(post=>verifyPublishedPost(post)&&!attributions.some(receipt=>receipt.candidates.some(candidate=>candidate.publishedPostId===post.id))).length,legacyPicks:picks.filter(pick=>!attributions.some(receipt=>receipt.candidates.some(candidate=>candidate.publishedPostId===pick.postId))).length,unmappedCandidates:attributions.reduce((sum,receipt)=>sum+receipt.unknownCandidates,0)};
 unknownAttribution.unmappedConsiderations=new Set(considerations.flatMap(receipt=>receipt.items.filter(item=>!item.feedIds.length).map(item=>item.productUrl))).size;unknownAttribution.invalidConsiderations=considerations.reduce((sum,receipt)=>sum+receipt.invalidConsiderations,0);unknownAttribution.omittedConsiderations=considerations.reduce((sum,receipt)=>sum+receipt.omittedConsiderations,0);
 const stats=sourceStatistics({registry,scans,attributions,considerations,picks,currentPolicy,now});return {registry,scans,attributions,considerations,changes,evolutions,discoveries,stats,unknownAttribution};
}
export async function loadSourceRegistryState(options){const data=await loadSourceRegistryData(options);return sourceRegistryView({...data,now:options.now});}
