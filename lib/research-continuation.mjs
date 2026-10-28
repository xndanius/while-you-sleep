import {promises as fs} from 'node:fs';
import path from 'node:path';
import {sha256,stableJSON,writeJSON} from './storage.mjs';
import {readBoundedJSON,validateSourceScanReceipt} from './source-registry.mjs';
import {validateLearningSelection} from './learning.mjs';
import {privateArtifactReasons} from './privacy.mjs';
import {researchDossiers,planResearchContinuation,researchSourceFingerprint} from './candidate-research.mjs';
import {discussionDiscoveryReasons,verifyDiscussionDiscovery} from './discussion-discovery.mjs';

const digest=x=>sha256(stableJSON(x));
const runPattern=/^loop-([1-9]\d{0,15})-([1-9]\d{0,3})$/;
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const stamp=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const producerKeys=['repository','runId','runAttempt','workflow','stage','headSha'];
const target=(root,kind,id)=>path.join(root,'data',kind,id+'.json');
export const continuationRequests=intent=>intent.dossier.referenceRequests.filter(row=>intent.schema===1||[...intent.referenceIds,...(intent.refreshReferenceIds||[])].includes(row.implementationReferenceId));
export const continuationRouteKey=(dossier,reference)=>digest({caseId:dossier.id,sourceUrl:dossier.source.url,sourceSha256:dossier.sourceSha256,referenceId:reference.implementationReferenceId,url:reference.url});
export async function readResearchBundle(root,id){
 if(!runPattern.test(id))throw new Error('Invalid historical research identity.');
 return Object.fromEntries(await Promise.all(Object.entries({run:'runs',draft:'drafts',context:'check-context',manifest:'checks',research:'research',scan:'source-scans',learning:'learning'}).map(async([key,dir])=>[key,await readBoundedJSON(target(root,dir,id))])));
}
export function continuationIntentReasons(intent,{expectedSha256,runId,headSha}={}){
 const match=intent?.runId?.match(runPattern),p=intent?.producer;
 if(![1,2].includes(intent?.schema)||!exact(intent,['schema','type','runId','createdAt','producer','dossier',...(intent.schema===2?['referenceIds',...(intent.refreshReferenceIds!==undefined?['refreshReferenceIds']:[]),...(intent.purpose!==undefined?['purpose']:[])]:[])])||intent.type!=='candidate-research-intent'||!match||!stamp(intent.createdAt)||!exact(p,producerKeys)||p.repository!=='xndanius/while-you-sleep'||p.runId!==match[1]||p.runAttempt!==Number(match[2])||p.workflow!=='loop.yml'||p.stage!=='pre_model'||!/^[a-f0-9]{40}$/.test(p.headSha||'')||runId&&runId!==intent.runId||headSha&&headSha!==p.headSha||expectedSha256&&digest(intent)!==expectedSha256||!intent.dossier?.gapId||Buffer.byteLength(stableJSON(intent))>131072||privateArtifactReasons(intent).length)return ['Research intent has invalid bounded identity or provenance.'];
 if(intent.purpose!==undefined&&!['acquire_evidence','review_evidence'].includes(intent.purpose))return ['Research intent purpose is unsupported.'];
 if(!hex(intent.dossier.catalogSha256)||intent.schema===2&&(!Array.isArray(intent.referenceIds)||!intent.referenceIds.length&&intent.purpose!=='review_evidence'||intent.referenceIds.length>2||new Set(intent.referenceIds).size!==intent.referenceIds.length||intent.referenceIds.some(id=>!intent.dossier.referenceRequests.some(row=>row.implementationReferenceId===id))))return ['Research intent names an unsupported acquisition route.'];
 if(intent.refreshReferenceIds!==undefined&&(!Array.isArray(intent.refreshReferenceIds)||intent.referenceIds.length+intent.refreshReferenceIds.length>2||new Set([...intent.referenceIds,...intent.refreshReferenceIds]).size!==intent.referenceIds.length+intent.refreshReferenceIds.length||intent.refreshReferenceIds.some(id=>!intent.dossier.referenceRequests.some(row=>row.implementationReferenceId===id))))return ['Research refresh routes are invalid.'];
 if(intent.purpose==='review_evidence'&&(intent.referenceIds.length||!intent.refreshReferenceIds?.length))return ['Review intent must only refresh already acquired evidence.'];
 return [];
}
export async function verifyContinuationIntent(root,intent,options={}){
 const errors=continuationIntentReasons(intent,options);if(errors.length)throw new Error(errors.join(' '));
 const bundle=await readResearchBundle(root,intent.dossier.provenance.runId);
 const comparable=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['catalogSha256','gapId','referenceRequests','coverage'].includes(key)));
 const original=researchDossiers(bundle).find(row=>digest(comparable(row))===digest(comparable(intent.dossier)));
 const expectedGap=digest({productUrl:intent.dossier.source.url,sourceSha256:intent.dossier.sourceSha256,catalogSha256:intent.dossier.catalogSha256,referenceIds:intent.dossier.referenceRequests.map(row=>row.implementationReferenceId).sort()});
 if(!original||intent.dossier.gapId!==expectedGap||intent.dossier.referenceRequests.some(ref=>!original.referenceRequests.some(row=>digest(row)===digest(ref)))||Date.parse(bundle.run.checkedAssessment.completedAt)>Date.parse(intent.createdAt))throw new Error('Research intent differs from its original completed assessment.');
 return bundle;
}
const outcomes=new Set(['planned','not_eligible','changed_source','completed','partial','failed','interrupted','unknown']);
export function continuationResultReasons(result,intent,{expectedSha256,sealed=false}={}){
 if(!exact(result,['schema','type','runId','intentSha256','producer','sourceScanSha256','selectionSha256','events','outcome','sealedAt'])||result.schema!==1||result.type!=='candidate-research-result'||result.runId!==intent.runId||result.intentSha256!==digest(intent)||stableJSON(result.producer)!==stableJSON(intent.producer)||!outcomes.has(result.outcome)||!Array.isArray(result.events)||result.events.length>6||result.sourceScanSha256!==null&&!hex(result.sourceScanSha256)||result.selectionSha256!==null&&!hex(result.selectionSha256)||result.sealedAt!==null&&!stamp(result.sealedAt)||sealed&&!stamp(result.sealedAt)||expectedSha256&&digest(result)!==expectedSha256||privateArtifactReasons(result).length)return ['Research result has invalid identity, bounds or seal.'];
 const allowed=new Map([['primary',intent.dossier.source.url],...continuationRequests(intent).map(row=>[row.implementationReferenceId,row.url])]),started=new Map(),finished=new Set();
 for(const event of result.events){
  if(!exact(event,['key','url','status','at','requests','evidenceSha256','code'])||allowed.get(event.key)!==event.url||!['started','fetched','failed','changed'].includes(event.status)||!stamp(event.at)||Date.parse(event.at)<Date.parse(intent.createdAt)||result.sealedAt&&Date.parse(event.at)>Date.parse(result.sealedAt)||!Number.isInteger(event.requests)||event.requests<0||event.requests>3||event.evidenceSha256!==null&&!hex(event.evidenceSha256)||event.code!==null&&(!/^[a-z0-9_]{1,80}$/.test(event.code)))return ['Research result contains an invalid request event.'];
  if(event.status==='started'){if(started.has(event.key)||event.requests!==0||event.evidenceSha256!==null||event.code!==null)return ['Research request started more than once or has invented results.'];started.set(event.key,event);}
  else{if(!started.has(event.key)||finished.has(event.key)||event.at<started.get(event.key).at||event.status==='fetched'&&(!event.evidenceSha256||event.requests<1)||event.status==='failed'&&event.evidenceSha256!==null)return ['Research terminal event lacks its exact start or evidence.'];finished.add(event.key);}
 }
 if(result.events.length&&(!hex(result.sourceScanSha256)||!hex(result.selectionSha256)))return ['Research attempts need the current scan and selection fingerprints.'];
 if(sealed&&result.outcome!==resultOutcome(result,intent))return ['Research result outcome differs from its request events.'];
 return [];
}
function resultOutcome(result,intent){
 if(!result.events.length)return ['not_eligible','changed_source'].includes(result.outcome)?result.outcome:'unknown';
 const starts=result.events.filter(e=>e.status==='started');
 if(starts.some(start=>!result.events.some(e=>e.key===start.key&&e.status!=='started')))return 'interrupted';
 if(result.events.some(e=>e.status==='changed'))return 'changed_source';
 if(result.events.some(e=>e.status==='failed'))return 'failed';
 return continuationRequests(intent).every(ref=>result.events.some(e=>e.key===ref.implementationReferenceId&&e.status==='fetched'))?'completed':'partial';
}
async function receipts(root,directory){
 let names;try{names=(await fs.readdir(path.join(root,'data',directory))).filter(x=>runPattern.test(x.replace(/\.json$/,''))&&x.endsWith('.json')).sort().reverse().slice(0,288);}catch(error){if(error.code==='ENOENT')return [];throw error;}
 return (await Promise.all(names.map(name=>readBoundedJSON(path.join(root,'data',directory,name)).catch(()=>null)))).filter(Boolean);
}
export async function prepareContinuationIntent({root,runId,bundles,producer,now=new Date(),published=[],allowedRegistryIds=null,allowedSegments=null}){
 if(!runPattern.test(runId))throw new Error('Invalid continuation run.');
 const intents=(await receipts(root,'research-intents')).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),results=await receipts(root,'research-results'),consumed=new Set(),successful=new Set(),reviewed=new Set(),latestRoute=new Set(),unavailable=new Map(),saved=[];
 for(const intent of intents){
  let bundle;try{bundle=await verifyContinuationIntent(root,intent);}catch{continue;}
  if(Date.parse(intent.createdAt)>new Date(now).getTime())continue;
  saved.push(bundle);
  const result=results.find(row=>row.runId===intent.runId);
  if(result?.outcome==='not_eligible'&&!continuationResultReasons(result,intent,{sealed:true}).length&&!unavailable.has(intent.dossier.id))unavailable.set(intent.dossier.id,Date.parse(intent.createdAt));
  const requested=continuationRequests(intent),invalid=!result||continuationResultReasons(result,intent,{sealed:true}).length;
  const primaryUnknown=invalid||result.events.some(e=>e.key==='primary'&&e.status==='started')&&!result.events.some(e=>e.key==='primary'&&e.status==='fetched')||!result.events.length&&!['not_eligible','changed_source'].includes(result.outcome);
  if(intent.purpose==='review_evidence'&&(primaryUnknown||result.events.some(e=>e.status==='started')))reviewed.add(intent.dossier.id+'|'+intent.dossier.sourceSha256);
  for(const reference of requested){const key=continuationRouteKey(intent.dossier,reference),attempted=primaryUnknown||result?.events.some(e=>e.key===reference.implementationReferenceId&&e.status==='started');if(attempted)consumed.add(key);if(attempted&&!latestRoute.has(key)){latestRoute.add(key);if(!primaryUnknown&&result?.events.some(e=>e.key===reference.implementationReferenceId&&e.status==='fetched'))successful.add(key);}}
 }
 const latest=new Map();
 for(const bundle of [...saved,...bundles]){let rows;try{rows=researchDossiers(bundle);}catch{continue;}for(const dossier of rows){const old=latest.get(dossier.id);if(!old||bundle.run.checkedAssessment.completedAt>old.bundle.run.checkedAssessment.completedAt)latest.set(dossier.id,{dossier,bundle});}}
 const eligible=({bundle})=>Date.parse(bundle.run.checkedAssessment.completedAt)+bundle.research.learningSelection.researchPolicy.cooldownHours*3600000<=new Date(now).getTime()?1:0;
 const needsReview=dossier=>!reviewed.has(dossier.id+'|'+dossier.sourceSha256)&&dossier.referenceRequests.length&&dossier.referenceRequests.every(ref=>successful.has(continuationRouteKey(dossier,ref)));
 const choices=[...latest.values()].filter(({dossier})=>(dossier.referenceRequests.some(ref=>!consumed.has(continuationRouteKey(dossier,ref)))||needsReview(dossier))&&(!allowedRegistryIds||allowedRegistryIds.includes(dossier.assignment.registrySourceId))&&(!allowedSegments||allowedSegments.includes(dossier.assignment.segment))&&!published.some(p=>p.productUrl===dossier.source.url)).sort((a,b)=>eligible(b)-eligible(a)||(unavailable.get(a.dossier.id)||0)-(unavailable.get(b.dossier.id)||0)||b.dossier.provisionalMean-a.dossier.provisionalMean||a.dossier.id.localeCompare(b.dossier.id));
 if(!choices.length)return null;
 const dossier=choices[0].dossier,referenceIds=dossier.referenceRequests.filter(ref=>!consumed.has(continuationRouteKey(dossier,ref))).map(ref=>ref.implementationReferenceId),refreshReferenceIds=dossier.referenceRequests.filter(ref=>successful.has(continuationRouteKey(dossier,ref))&&!referenceIds.includes(ref.implementationReferenceId)).slice(0,2-referenceIds.length).map(ref=>ref.implementationReferenceId),intent={schema:2,type:'candidate-research-intent',runId,createdAt:new Date(now).toISOString(),producer,dossier,referenceIds,refreshReferenceIds,purpose:referenceIds.length?'acquire_evidence':'review_evidence'};
 await verifyContinuationIntent(root,intent,{runId,headSha:producer.headSha});
 await writeJSON(target(root,'research-intents',runId),intent,{immutable:true});return intent;
}
export async function startContinuation({root,intent,scan,selection,selectionInput,clock=()=>new Date().toISOString()}){
 const bundle=await verifyContinuationIntent(root,intent);let plan=planResearchContinuation(intent.dossier,bundle,{selectionInput});
 if(validateSourceScanReceipt(scan,{runId:intent.runId}).length||validateLearningSelection(selection,{runId:intent.runId}).length||scan.producer.headSha!==intent.producer.headSha||selection.producer.headSha!==intent.producer.headSha)throw new Error('Continuation current scan or selection is not trusted.');
 if(scan.registrySha256!==selection.registrySha256||stableJSON(scan.producer)!==stableJSON(selection.producer))throw new Error('Continuation scan and selection disagree about their producer.');
 const current=selectionInput.sources.find(row=>row.id===intent.dossier.source.id),metadata=scan.sources.find(row=>row.id===current?.id&&row.url===current?.url);
 const direct=!!current&&!!metadata&&metadata.textSha256===sha256(current.text)&&scan.originMap.some(row=>row.sourceId===current.id&&row.url===current.url&&row.feedIds.includes(current.registrySourceId));
 let carried=false;
 // A feed may rotate a still-valid discovered post out of its latest page.
 // Reuse the existing 24-hour discovery trust boundary, never an arbitrary URL.
 // It authorizes only an attempted read; a matching fresh primary remains
 // mandatory before documentation priority or evidence is granted.
 if(current&&!metadata&&selectionInput.discoveryCarryover!==undefined){
  const provenance=selectionInput.discoveryCarryover;
  if(discussionDiscoveryReasons(provenance).length)throw new Error('Continuation discovery provenance is malformed.');
  const row=provenance.records.find(row=>row.sourceId===current.id&&row.url===current.url);
  if(row){
   const errors=await verifyDiscussionDiscovery(root,{version:1,records:[row]},{definitions:selectionInput.demandDefinitions,selection,now:new Date(typeof selectionInput.now==='function'?selectionInput.now():selectionInput.now)});
   if(errors.length)throw new Error(`Continuation discovery proof failed: ${errors.join(' ')}`);
   carried=row.textSha256===sha256(current.text)&&row.feedIds.includes(current.registrySourceId)&&selectionInput.originMap.some(origin=>origin.sourceId===current.id&&origin.url===current.url&&origin.feedIds.includes(current.registrySourceId));
  }
 }
 if(!direct&&!carried)plan={status:'not_currently_eligible'};
 const file=target(root,'research-results',intent.runId),result={schema:1,type:'candidate-research-result',runId:intent.runId,intentSha256:digest(intent),producer:intent.producer,sourceScanSha256:digest(scan),selectionSha256:digest(selection),events:[],outcome:plan.status==='ready_for_scheduled_research'?'planned':plan.status==='changed_evidence'?'changed_source':'not_eligible',sealedAt:null};
 const active=result.outcome==='planned';let primaryMatches=false;
 const save=async()=>{const errors=continuationResultReasons(result,intent);if(errors.length)throw new Error(errors.join(' '));await writeJSON(file,result);};
 await save();
 const event=async({phase,lead,observation,source},primary)=>{
  if(!active||primary&&lead.productUrl!==intent.dossier.source.url)return;
  const reference=primary?null:continuationRequests(intent).find(row=>row.url===lead.productUrl);
  if(!primary&&(!primaryMatches||!reference))return;
  const key=primary?'primary':reference.implementationReferenceId;
  if(phase==='started')result.events.push({key,url:lead.productUrl,status:'started',at:clock(),requests:0,evidenceSha256:null,code:null});
  else{primaryMatches=primary?!!source&&researchSourceFingerprint(source)===intent.dossier.sourceSha256:primaryMatches;const changed=primary&&source&&!primaryMatches;result.events.push({key,url:lead.productUrl,status:changed?'changed':observation.status,at:clock(),requests:observation.requests,evidenceSha256:source?digest(source):null,code:changed?'source_changed':observation.status==='failed'&&/^[a-z0-9_]{1,80}$/.test(observation.code||'')?observation.code:null});}
  await save();
 };
 return {priorityProductUrl:active?intent.dossier.source.url:null,onLeadEvent:data=>event(data,true),onReferenceEvent:data=>event(data,false),referencePriority:()=>primaryMatches?{priorityDemandSourceId:intent.dossier.source.id,priorityReferenceIds:intent.schema===1?continuationRequests(intent).map(row=>row.implementationReferenceId):[...intent.referenceIds,...(intent.refreshReferenceIds||[])],excludePriorityReferenceIds:intent.dossier.referenceRequests.filter(row=>!continuationRequests(intent).some(ref=>ref.implementationReferenceId===row.implementationReferenceId)).map(row=>row.implementationReferenceId)}:null,result};
}
export async function sealContinuationResult({root,intent,clock=()=>new Date().toISOString()}){
 let result;try{result=await readBoundedJSON(target(root,'research-results',intent.runId));}catch(error){if(error.code!=='ENOENT')throw error;result={schema:1,type:'candidate-research-result',runId:intent.runId,intentSha256:digest(intent),producer:intent.producer,sourceScanSha256:null,selectionSha256:null,events:[],outcome:'unknown',sealedAt:null};}
 if(result.sealedAt){const errors=continuationResultReasons(result,intent,{sealed:true});if(errors.length)throw new Error(errors.join(' '));return result;}
 result.sealedAt=clock();result.outcome=resultOutcome(result,intent);
 const errors=continuationResultReasons(result,intent,{sealed:true});if(errors.length)throw new Error(errors.join(' '));
 await writeJSON(target(root,'research-results',intent.runId),result);return result;
}
