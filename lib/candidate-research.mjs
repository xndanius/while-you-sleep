// Pure continuation planner: no filesystem/network access, scheduling or models.
// A plan is neither new evidence nor a publication approval.
import {sha256,stableJSON,hash} from './storage.mjs';
import {completedAssessmentReasons} from './validation.mjs';
import {deriveLearningReceipt} from './learning.mjs';
import {recentProductAssessments,selectProductLeads} from './product-evidence.mjs';
import {candidatePlanReasons} from './candidate-plan.mjs';
import {demandQuoteOccurs} from './demand-quotes.mjs';
import {privateArtifactReasons} from './privacy.mjs';
import {DISCUSSION_IMPLEMENTATION_CATALOG,selectDiscussionImplementationReferences,discussionImplementationReference} from './discussion-implementation.mjs';

const copy=value=>structuredClone(value);
const digest=value=>sha256(stableJSON(value));
const fail=()=>{throw new Error('Research continuation requires an intact completed discussion assessment.');};
const historyInput=({run,draft,context,manifest,research,scan,learning})=>({runs:[run],drafts:[draft],contexts:[context],checks:[manifest],research:[research],scans:[scan],learning:[learning]});
export const researchSourceFingerprint=source=>digest({text:source.text,spans:source.nativeReadingContext?.spans||[],taskExample:source.taskExample||null,native:source.nativeReadingContext?Object.fromEntries(['version','normalizationVersion','topicUrl','topicId','postId','postNumber','postUrl','postCreatedAt','postUpdatedAt','normalizedSha256','normalizedLength'].map(key=>[key,source.nativeReadingContext[key]])):null});
const textFingerprint=researchSourceFingerprint;

function verifyBundle(bundle){
 const {run,draft,context,manifest,research,scan,learning}=bundle||{};
 try{
  if(run.status!=='completed_no_post'||run.published.length||draft.posts.length||context.candidatePlanVersion!==1||!context.demandContext?.discussionBatchPolicy)fail();
  if(digest(research)!==context.demandContext.discussionBatchPolicy.researchSha256)fail();
  if(completedAssessmentReasons(draft,context,manifest).length||candidatePlanReasons(draft,{candidatePlanVersion:1}).length)fail();
  if(digest(deriveLearningReceipt({run,selection:research.learningSelection,scan,draft,context,manifest,expectedSelectionSha256:learning.selectionSha256,expectedScanSha256:learning.scanSha256,expectedDraftSha256:learning.draftSha256,expectedContextSha256:learning.contextSha256,now:learning.createdAt}))!==digest(learning))fail();
  const recent=recentProductAssessments({...historyInput(bundle),now:Date.parse(run.checkedAssessment.completedAt)+1});
  if(!recent.length||privateArtifactReasons({draft,research,context}).length)fail();
  return recent;
 }catch{fail();}
}

export function researchDossiers(bundle){
 const recent=verifyBundle(bundle),{run,draft,context,research,scan,manifest,learning}=bundle;
 const provenance={runId:run.id,runSha256:digest(run),draftSha256:digest(draft),contextSha256:digest(context),researchSha256:digest(research),scanSha256:digest(scan),manifestSha256:digest(manifest),selectionSha256:digest(research.learningSelection),learningSha256:digest(learning)};
 const catalogSha256=digest(DISCUSSION_IMPLEMENTATION_CATALOG);
 return draft.candidates.flatMap((candidate,index)=>{
  const assignment=context.demandContext.discussionBatchPolicy.leadAssignments.find(row=>row.productUrl===candidate.productUrl);
  const source=context.sources.find(row=>row.id===assignment?.demandSourceId&&row.url===candidate.productUrl);
  if(!source||!recent.some(row=>row.productUrl===candidate.productUrl)||candidate.segment!==assignment.segment||candidate.demandEvidence?.sourceIds?.length!==1||candidate.demandEvidence.sourceIds[0]!==source.id||candidate.demandEvidence.kind!==source.demandKind||!demandQuoteOccurs(source,candidate.demandEvidence.evidenceQuote))fail();
  const references=selectDiscussionImplementationReferences([source]).filter(ref=>discussionImplementationReference(ref,{demandSources:[source]}));
  const existing=new Set(context.sources.filter(row=>row.role==='building'&&discussionImplementationReference(row,{demandSources:context.sources.filter(item=>item.role==='demand')})&&row.supportsDemandSourceIds.includes(source.id)).map(row=>row.implementationReferenceId));
  const requests=references.filter(ref=>!existing.has(ref.implementationReferenceId));
  const values=Object.values(candidate.scoring?.criteria||{}).map(row=>row.value);
  if(values.length!==5||values.some(value=>!Number.isInteger(value)||value<1||value>10))fail();
  const sourceSha256=textFingerprint(source),gapId=digest({productUrl:source.url,sourceSha256,catalogSha256,referenceIds:requests.map(row=>row.implementationReferenceId).sort()});
  return [{version:1,id:hash(source.url),gapId,status:'proposed_research',provenance,catalogSha256,candidateIndex:index,candidateSha256:digest(candidate),candidate:copy(candidate),assignment:copy(assignment),source:copy(source),sourceSha256,discoverySha256:recent.find(row=>row.productUrl===source.url)?.discoveryEvidenceSha256||null,unresolved:copy(candidate.experimentPlan.unverified),referenceRequests:copy(requests),provisionalMean:values.reduce((a,b)=>a+b,0)/5,coverage:references.length===0?'no_catalog_match':requests.length?'missing_capability_evidence':'catalog_evidence_already_available',notice:'The preserved plan and requested documentation are not execution, demand validation, a checked score or publication approval.'}];
 }).sort((a,b)=>b.provisionalMean-a.provisionalMean||a.id.localeCompare(b.id));
}

export function planResearchContinuation(dossier,bundle,{selectionInput,laterBundles=[]}={}){
 const original=researchDossiers(bundle).find(row=>row.id===dossier?.id);
 if(!original||digest(original)!==digest(dossier)||!selectionInput||!Array.isArray(laterBundles)||laterBundles.length>96)fail();
 const at=new Date(typeof selectionInput.now==='function'?selectionInput.now():selectionInput.now).getTime();
 if(!Number.isFinite(at)||selectionInput.cooldownHours!==bundle.research.learningSelection.researchPolicy.cooldownHours||at<Date.parse(bundle.run.checkedAssessment.completedAt))fail();
 if(!dossier.referenceRequests.length)return {status:'unresolved',reason:dossier.coverage,priorityProductUrl:null,referenceRequests:[]};
 // A generated plan never consumes an attempt. Only an intact later assessed
 // snapshot that actually requested these URLs can record an acquisition result.
 let attempted=null;
 for(const later of laterBundles.slice().sort((a,b)=>String(b?.run?.checkedAssessment?.completedAt||'').localeCompare(String(a?.run?.checkedAssessment?.completedAt||'')))){
  try{verifyBundle(later);}catch{continue;}
  if(Date.parse(later.run.checkedAssessment.completedAt)<=Date.parse(bundle.run.checkedAssessment.completedAt)||Date.parse(later.run.checkedAssessment.completedAt)>at)continue;
  const sameSource=later.context.sources.find(row=>row.id===dossier.source.id);
  if(!sameSource||textFingerprint(sameSource)!==dossier.sourceSha256)continue;
  const observations=later.research.enrichment?.supportingReferences?.observations||[];
  if(dossier.referenceRequests.some(request=>observations.some(row=>row.productUrl===request.url))){
   const complete=dossier.referenceRequests.every(request=>later.context.sources.some(source=>source.implementationReferenceId===request.implementationReferenceId&&source.supportsDemandSourceIds?.includes(dossier.source.id)&&discussionImplementationReference(source,{demandSources:[sameSource]})));
   const result={status:complete?'evidence_available':'attempt_finished_unresolved',reason:complete?'Later independently examined evidence contains the requested capabilities.':'A later verified acquisition attempted this gap; do not blindly repeat it.',priorityProductUrl:null,referenceRequests:[],attemptRunId:later.run.id};
   if(complete)return result;
   attempted??=result;
  }
 }
 if(attempted)return attempted;
 // Use the ordinary selector as the eligibility authority, with its caller's
 // current sources, posts, source limits, original receipts and cooldown.
 const recorded=verifyBundle(bundle),history=[...recorded,...(selectionInput.recentAssessments||[])];
 const eligible=selectProductLeads(selectionInput.sources,{...selectionInput,recentAssessments:history});
 if(!eligible.some(row=>row.productUrl===dossier.source.url))return {status:'not_currently_eligible',reason:'The ordinary selector does not currently admit this identity.',priorityProductUrl:null,referenceRequests:[]};
 const current=selectionInput.sources.find(row=>row.id===dossier.source.id&&row.url===dossier.source.url);
 const freshMatch=current&&textFingerprint(current)===dossier.sourceSha256,discoveryMatch=current&&dossier.discoverySha256&&sha256(current.text)===dossier.discoverySha256;
 if(!freshMatch&&!discoveryMatch)return {status:'changed_evidence',reason:'The current task evidence differs; review a new dossier before reusing its gap or plan.',priorityProductUrl:null,referenceRequests:[]};
 const matched=selectDiscussionImplementationReferences([freshMatch?current:dossier.source]);
 const requests=dossier.referenceRequests.filter(request=>matched.some(row=>digest(row)===digest(request)));
 if(requests.length!==dossier.referenceRequests.length)return {status:'changed_evidence',reason:'Current evidence no longer supports the preserved reference request; review a new dossier.',priorityProductUrl:null,referenceRequests:[]};
 return {status:'ready_for_scheduled_research',requiresFreshPrimaryCheck:!freshMatch,advisoryOnly:true,currentSelectionVerified:false,reason:'Prioritize this identity, eligible in the supplied snapshot, and its missing fixed documentation inside the existing research budget.',priorityProductUrl:dossier.source.url,referenceRequests:copy(requests),gapId:dossier.gapId,maximumReferences:2,maximumAttempts:1,notice:'The caller must seal and validate current selection input before production use. This local advisory plan dispatches nothing and grants no evidence, score or approval.'};
}

export function pickResearchContinuation(bundle,options){
 const rows=researchDossiers(bundle).filter(row=>row.referenceRequests.length);
 for(const dossier of rows){const plan=planResearchContinuation(dossier,bundle,options);if(plan.status==='ready_for_scheduled_research')return {dossier,plan};}
 return {dossier:rows[0]||null,plan:rows.length?planResearchContinuation(rows[0],bundle,options):{status:'unresolved',reason:'No supported missing capability has a fixed-catalog acquisition path.',priorityProductUrl:null,referenceRequests:[]}};
}
