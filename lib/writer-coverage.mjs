import {canonicalURL,hash} from './storage.mjs';
import {SEGMENTS} from './demand.mjs';
import {privateArtifactReasons} from './privacy.mjs';
import {sealedDiscussionAssignmentReasons} from './check-diagnostics.mjs';
import {DISCUSSION_SOURCE_CATALOG,DISCUSSION_PROVIDER_CATALOG,discussionPostURL} from './discussion-sources.mjs';
import {candidatePlanReasons} from './candidate-plan.mjs';
import {candidateScoringReasons} from './scoring.mjs';

const fields=Object.freeze(['posts','candidates','rejected']);
const tupleKeys=Object.freeze(['productUrl','segment','kind','demandSourceId','registrySourceId']);
const runPattern=/^loop-[1-9]\d{0,15}-[1-9]\d{0,3}$/;
const id=value=>typeof value==='string'&&/^[a-f0-9]{24}$/.test(value);
const catalog=[...DISCUSSION_SOURCE_CATALOG,...DISCUSSION_PROVIDER_CATALOG];
// Foreign rows are identified by their list/index. Reflect a URL only when it
// is already a canonical fixed public-post URL, never an arbitrary profile.
const visibleIdentity=url=>catalog.some(definition=>discussionPostURL(definition,url)===url)?url:null;
const exactTuple=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===tupleKeys.length&&tupleKeys.every(key=>Object.hasOwn(value,key));
const publicIdentity=value=>{
 if(typeof value!=='string'||value.length>2048)return null;
 try{const parsed=new URL(value);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port&&parsed.port!=='443')return null;const url=canonicalURL(value);return privateArtifactReasons({url}).length?null:url;}catch{return null;}
};
const initial=runId=>({schema:1,kind:'writer_coverage',runId:runPattern.test(runId||'')?runId:null,coverageOnly:true,valid:false,assignedCount:0,consideredUniqueCount:0,coveredAssignedCount:0,missing:[],foreign:[],duplicates:[],bindingMismatches:[],malformed:[],reasons:[]});

// This is a structural work-list check only. A complete work list establishes
// no source availability, factual support, score, independent check or post.
export function writerCoverage(draft,{runId,assignments,candidatePlanVersion,demandSources}={}){
 const report=initial(runId),urls=new Set(),ids=new Set(),counts=new Map();
 if(!runPattern.test(runId||''))report.reasons.push('Writer coverage requires its exact loop run identity.');
 if(!Array.isArray(assignments)||assignments.length<1||assignments.length>10)report.reasons.push('Writer coverage requires one to ten original discussion assignments.');
 else for(const assignment of assignments){
  const url=publicIdentity(assignment?.productUrl);
  if(!exactTuple(assignment)||!url||url!==assignment.productUrl||!catalog.some(definition=>definition.id===assignment.registrySourceId&&discussionPostURL(definition,url)===url)||assignment.kind!=='discussion'||!SEGMENTS.includes(assignment.segment)||!id(assignment.demandSourceId)||assignment.demandSourceId!==hash(url)||!id(assignment.registrySourceId)||urls.has(url)||ids.has(assignment.demandSourceId)){
   report.reasons.push('Writer coverage assignments have malformed or repeated sealed identities.');break;
  }
  urls.add(url);ids.add(assignment.demandSourceId);counts.set(assignment.registrySourceId,(counts.get(assignment.registrySourceId)||0)+1);
 }
 if([...counts.values()].some(count=>count>3))report.reasons.push('Writer coverage assignments exceed three posts per original source.');
 if(report.reasons.length){report.reasons=[...new Set(report.reasons)];return report;}
 report.assignedCount=assignments.length;
 if(!draft||typeof draft!=='object'||Array.isArray(draft)||draft.runId!==runId){report.reasons.push('Writer draft does not match its exact original loop run.');return report;}
 report.reasons.push(...candidatePlanReasons(draft,{candidatePlanVersion}));
 if(demandSources!==undefined)report.reasons.push(...candidateScoringReasons(draft,{sources:demandSources}));
 const assigned=new Map(assignments.map(row=>[row.productUrl,row])),considered=new Set();
 for(const list of fields){
  const rows=draft[list]===undefined&&list!=='posts'?[]:draft[list];
  if(!Array.isArray(rows)){report.reasons.push(`Writer ${list} must be an array of explicit discussion decisions.`);continue;}
  if(rows.length>10)report.reasons.push(`Writer ${list} exceeds the ten-assignment row bound.`);
  const occurrences=new Map();
  for(const [index,item] of rows.slice(0,10).entries()){
   const url=publicIdentity(item?.productUrl);
   if(!item||typeof item!=='object'||Array.isArray(item)||!url){report.malformed.push({list,index});continue;}
   considered.add(url);const indexes=occurrences.get(url)||[];indexes.push(index);occurrences.set(url,indexes);
   const assignment=assigned.get(url);
   if(!assignment){report.foreign.push({list,index,productUrl:visibleIdentity(url)});continue;}
   const mismatch=field=>report.bindingMismatches.push({list,index,productUrl:assignment.productUrl,field});
   if((Object.hasOwn(item,'segment')||Object.hasOwn(item,'demandEvidence'))&&item.segment!==assignment.segment)mismatch('segment');
   if(Object.hasOwn(item,'demandSourceId')&&item.demandSourceId!==assignment.demandSourceId)mismatch('demandSourceId');
   if(Object.hasOwn(item,'registrySourceId')&&item.registrySourceId!==assignment.registrySourceId)mismatch('registrySourceId');
   if(Object.hasOwn(item,'demandEvidence')&&(!item.demandEvidence||typeof item.demandEvidence!=='object'||Array.isArray(item.demandEvidence)||!Array.isArray(item.demandEvidence.sourceIds)||item.demandEvidence.sourceIds.length!==1||item.demandEvidence.sourceIds[0]!==assignment.demandSourceId))mismatch('demandEvidence.sourceIds');
   // The sealed entry point supplies the original source metadata. Signal kind
   // is a source identity field, not the writer's classification of its idea.
   // Plain work-list callers without source metadata retain their legacy API.
   if(demandSources!==undefined&&(list!=='rejected'||Object.hasOwn(item,'demandEvidence'))){
    const source=Array.isArray(demandSources)&&demandSources.find(row=>row.id===assignment.demandSourceId&&row.url===assignment.productUrl&&row.registrySourceId===assignment.registrySourceId);
    if(!source||item.demandEvidence?.kind!==source.demandKind)mismatch('demandEvidence.kind');
   }
  }
  for(const [productUrl,indexes] of occurrences)if(indexes.length>1)report.duplicates.push({list,productUrl:visibleIdentity(productUrl),indexes});
 }
 report.consideredUniqueCount=considered.size;
 report.coveredAssignedCount=assignments.filter(row=>considered.has(row.productUrl)).length;
 report.missing=assignments.filter(row=>!considered.has(row.productUrl)).map(row=>Object.fromEntries(tupleKeys.map(key=>[key,row[key]])));
 if(report.missing.length)report.reasons.push('Writer omitted assigned discussion source IDs: '+report.missing.map(row=>row.demandSourceId).join(', ')+'.');
 if(report.foreign.length)report.reasons.push('Writer included a discussion identity outside the sealed assignment list.');
 if(report.duplicates.length)report.reasons.push('Writer repeated a canonical discussion identity within one decision list.');
 if(report.bindingMismatches.length)report.reasons.push('Writer changed an assigned discussion segment, demand-source binding or signal kind.');
 if(report.malformed.length)report.reasons.push('Writer included an invalid or unsafe discussion identity.');
 report.reasons=[...new Set(report.reasons)];report.valid=report.reasons.length===0;return report;
}

export function sealedWriterCoverage(draft,{runId,research,selection,expectedResearchSha256,expectedSelectionSha256}={}){
 const reasons=sealedDiscussionAssignmentReasons({runId,research,selection,expectedResearchSha256,expectedSelectionSha256});
 if(reasons.length)return {...initial(runId),reasons:['Writer coverage lacks unchanged trusted original discussion assignments.',...reasons]};
 return writerCoverage(draft,{runId,assignments:research.enrichment.discussionBatch.leadAssignments,candidatePlanVersion:research.candidatePlanVersion,demandSources:research.sources});
}
