import {promises as fs} from 'node:fs';
import path from 'node:path';
import {canonicalURL,sha256,stableJSON} from './storage.mjs';
import {recentProductAssessments,PRODUCT_SELECTION_POLICY} from './product-evidence.mjs';
import {selectBuildingReferences} from './building-references.mjs';
import {discussionEvidenceReasons} from './evidence-contract.mjs';
import {DISCUSSION_SOURCE_CATALOG,DISCUSSION_PROVIDER_CATALOG} from './discussion-sources.mjs';
export {selectBuildingReferences} from './building-references.mjs';

async function boundedRecord(file){
 try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>3*1024*1024)throw new Error('Candidate history must be a bounded regular file.');return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
export async function candidateHistory(root,now=new Date(),{continuations=false}={}){
 let files;try{files=await fs.readdir(path.join(root,'data','runs'));}catch(error){if(error.code==='ENOENT')return {recentAssessments:[],rejections:[]};throw error;}
 const current=new Date(now).getTime(),cutoff=current-24*3600000;
 const runs=(await Promise.all(files.filter(file=>/^loop-\d+-\d+\.json$/.test(file)).sort().reverse().slice(0,PRODUCT_SELECTION_POLICY.maxHistoryRecords).map(file=>boundedRecord(path.join(root,'data','runs',file))))).filter(run=>run?.assessmentOutcome==='completed'&&run.checkedAssessment?.completed===true&&Date.parse(run.checkedAssessment.completedAt)>cutoff&&Date.parse(run.checkedAssessment.completedAt)<=current).slice(0,PRODUCT_SELECTION_POLICY.maxHistoryRuns);
 const [drafts,research,contexts,scans,learning,checks]=await Promise.all(['drafts','research','check-context','source-scans','learning','checks'].map(directory=>Promise.all(runs.map(run=>boundedRecord(path.join(root,'data',directory,run.id+'.json')))).then(values=>values.filter(Boolean))));
 const recentAssessments=recentProductAssessments({runs,drafts,research,contexts,scans,learning,checks,now}),cooled=new Set(recentAssessments.map(item=>item.runId+'|'+item.productUrl)),rejections=[];
 for(const run of runs){const draft=drafts.find(item=>item.runId===run.id&&sha256(stableJSON(item))===run.checkedAssessment.draftSha256);if(!draft||run.operationalFailures?.length)continue;
  for(const candidate of (draft.candidates||[]).slice(0,12)){if(!candidate.productUrl)continue;rejections.push({runId:run.id,assessedAt:run.checkedAssessment.completedAt,title:candidate.title,productUrl:candidate.productUrl,reason:candidate.reason,writerCriteria:candidate.scoring?.criteria||null,primaryEvidenceFetched:cooled.has(run.id+'|'+canonicalURL(candidate.productUrl)),ratingStatus:'Writer ratings are provisional. The completed batch stamp is not an individual criterion approval.'});}
 }
 return {recentAssessments,rejections:rejections.slice(0,96),...(continuations?{continuationBundles:runs.map(run=>({run,draft:drafts.find(row=>row.runId===run.id),research:research.find(row=>row.runId===run.id),context:contexts.find(row=>row.runId===run.id),scan:scans.find(row=>row.runId===run.id),learning:learning.find(row=>row.runId===run.id),manifest:checks.find(row=>row.runId===run.id)}))}:{})};
}
export function writerResearchView(snapshot){
 const observations=snapshot?.enrichment?.observations;
 if(snapshot?.enrichment?.status==='not_requested'||!Array.isArray(observations))return snapshot;
 const usable=snapshot.enrichment.discussionBatch?.version===1?observations.filter(item=>item.status==='fetched'):observations;
 const ids=new Set(usable.flatMap(item=>[...(item.originSourceIds||[]),...(item.evidenceIds||[])]));
 const selected=snapshot.sources.filter(source=>ids.has(source.id));
 const supportingIds=new Set((snapshot.enrichment.supportingReferences?.observations||[]).filter(item=>item.status==='fetched').flatMap(item=>item.evidenceIds||[]));
 const support=snapshot.sources.filter(source=>supportingIds.has(source.id)&&source.enriched===true&&source.role!=='demand'&&!source.demand).slice(0,2);
 const building=snapshot.learningSelection?[...support,...selectBuildingReferences(snapshot.sources.filter(source=>!ids.has(source.id)&&!supportingIds.has(source.id)),selected.filter(source=>source.role==='demand'&&source.demand),{limit:8-support.length})]:[];
 return {...snapshot,...(snapshot.discoveryCarryover?{discoveryCarryover:{...snapshot.discoveryCarryover,records:snapshot.discoveryCarryover.records.filter(record=>ids.has(record.sourceId))}}:{}),sources:[...selected,...building],writerView:{originalSourceCount:snapshot.sources.length,selectionOnly:true,note:snapshot.learningSelection?'Selected public demand notices identify the customer. Up to eight already-fetched building references are chosen for task overlap and source-host variety. Building references only describe possible implementation; they establish no customer demand.':'Only selected lead discovery and primary evidence. The immutable full snapshot remains the checker and attribution input.'}};
}

// A missing selected demand item is a research limitation, never a reason to
// spend model tokens inventing a customer or to stamp an empty assessment.
export function writerReadiness(snapshot,{demandRequired=false,now}={}){
 if(!demandRequired)return {ready:true,reason:null};
 if(snapshot?.learningSelection?.selectionStrategy==='discussion-first-v1'){
  const batch=snapshot.enrichment?.discussionBatch,assignments=batch?.leadAssignments||[],observations=snapshot.enrichment?.observations||[],counts=new Map();
  const complete=batch?.version===1&&batch.maxLeads===10&&batch.maxPerDemandSource===3&&batch.postIsDemand===true&&assignments.length>0&&assignments.length<=10&&new Set(assignments.map(item=>item.productUrl)).size===assignments.length&&assignments.every(item=>{counts.set(item.registrySourceId,(counts.get(item.registrySourceId)||0)+1);return item.kind==='discussion'&&snapshot.learningSelection.demandSourceIds.includes(item.registrySourceId)&&snapshot.learningSelection.eligibleSegments.includes(item.segment)&&observations.some(row=>row.productUrl===item.productUrl&&row.status==='fetched'&&row.evidenceIds?.includes(item.demandSourceId))&&snapshot.sources?.some(source=>source.id===item.demandSourceId&&source.registrySourceId===item.registrySourceId&&source.url===item.productUrl&&source.productUrl===item.productUrl&&source.discussionMetadataVersion===1&&source.enriched===true&&source.role==='demand'&&source.demand===true&&source.segment===item.segment);})&&[...counts.values()].every(count=>count<=3);
  const evidence=complete&&assignments.every(item=>{const source=snapshot.sources.find(source=>source.id===item.demandSourceId),definition=[...DISCUSSION_SOURCE_CATALOG,...DISCUSSION_PROVIDER_CATALOG].find(definition=>definition.id===item.registrySourceId);return discussionEvidenceReasons(source,{definition,asOf:now||snapshot.enrichment?.completedAt||snapshot.createdAt||source.verifiedAt}).length===0;});
  return evidence?{ready:true,reason:null,discussionFirst:true}:{ready:false,reason:'No bounded public discussion batch retained exact freshly reread post identities and eligible customer segments; continue without a model call.'};
 }
 if(snapshot?.learningSelection?.selectionStrategy==='mixed-recovery-v1'){
  const batch=snapshot.enrichment?.recoveryBatch,assignments=batch?.leadAssignments||[],builders=assignments.filter(item=>item.kind==='builder');
  const complete=assignments.length<=10&&builders.length>=3&&assignments.every(item=>snapshot.sources?.some(source=>source.id===item.demandSourceId&&source.enriched===true&&source.role==='demand'&&source.segment===item.segment)&&snapshot.sources.some(source=>source.enriched===true&&[source.productUrl,source.url].includes(item.productUrl)));
  return complete?{ready:true,reason:null,mixedRecovery:true}:{ready:false,reason:`Mixed recovery retained ${builders.length} of the required three fresh builder leads with exact public demand signals; no model call or approval can be fabricated.`};
 }
 if(snapshot?.enrichment?.fallback===true&&snapshot?.learningSelection?.researchPolicy?.fallbackEnabled===true&&snapshot.learningSelection.selectedSegment&&snapshot.enrichment.fallbackFrom?.status==='no_new_leads'&&snapshot.enrichment.fallbackFrom.selected===0&&snapshot.enrichment.fallbackFrom.attempted===0){
  const fetched=(snapshot.enrichment.observations||[]).filter(row=>row.status==='fetched'),ids=new Set(fetched.flatMap(row=>row.evidenceIds||[]));
  if(fetched.length&&snapshot.sources?.some(source=>ids.has(source.id)&&source.role==='demand'&&source.demand===true&&source.segment===snapshot.learningSelection.selectedSegment)&&snapshot.sources.some(source=>ids.has(source.id)&&source.role!=='demand'&&source.demand!==true&&source.enriched===true))return {ready:true,reason:null,fallback:true};
 }
 if(snapshot?.enrichment?.fallback===true)return {ready:false,reason:'No bounded builder fallback retained both clean fetched implementation evidence and a fresh public demand signal; continue without a model call.'};
 if(!snapshot?.learningSelection?.selectedSegment)return {ready:false,reason:'No eligible fresh demand source was selected; leave the slot unverified without a model call.'};
 const observations=snapshot?.enrichment?.observations;
 const ids=new Set((Array.isArray(observations)?observations:[]).filter(row=>row.status==='fetched').flatMap(row=>row.evidenceIds||[]));
 if(!snapshot.sources?.some(source=>ids.has(source.id)&&source.role==='demand'&&source.demand===true&&source.segment===snapshot.learningSelection.selectedSegment))return {ready:false,reason:'No selected demand notice was freshly fetched; leave the slot unverified without a model call.'};
 return {ready:true,reason:null};
}
