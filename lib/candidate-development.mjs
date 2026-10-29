import {sha256,stableJSON,hash,canonicalURL} from './storage.mjs';
import {privateArtifactReasons} from './privacy.mjs';
import {completedAssessmentReasons,verifyPublishedPost,checkApproval} from './validation.mjs';
import {deriveLearningReceipt} from './learning.mjs';
import {researchDossiers,researchSourceFingerprint} from './candidate-research.mjs';
import {continuationIntentReasons,continuationResultReasons,continuationRequests,continuationRouteKey} from './research-continuation.mjs';
import {readResearchBundle,verifyContinuationIntent} from './research-continuation.mjs';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {readBoundedJSON} from './source-registry.mjs';
import {candidatePlanReasons} from './candidate-plan.mjs';
import {candidateEvidenceTasks,candidateEvidenceTaskReasons} from './candidate-evidence-tasks.mjs';
const digest=value=>sha256(stableJSON(value));
export const developmentRevisionId=(caseId,candidateSha256,sourceSha256,capabilitySources=[])=>digest({caseId,candidateSha256,sourceSha256,capabilitySources:capabilitySources.slice().sort((a,b)=>a.sourceId.localeCompare(b.sourceId))});
const revision=developmentRevisionId;
const capabilities=(context,sourceId)=>(context?.sources||[]).filter(row=>row.role==='building'&&row.supportsDemandSourceIds?.includes(sourceId)).map(row=>({sourceId:row.id,url:row.url,textSha256:sha256(row.text)}));
const event=(kind,caseId,productUrl,sourceRunId,details)=>{const body={kind,caseId,productUrl,sourceRunId,details};return {id:digest(body),...body};};
const states=new Set(['origin','acquisition','assessment','publication']);
export function developmentProgress(previous,current){
 if(!previous)return 'first_recorded_assessment';
 if(current.capabilitySources.some(source=>!previous.capabilitySources?.some(old=>old.sourceId===source.sourceId&&old.textSha256===source.textSha256)))return 'new_capability_evidence';
 if(current.sourceSha256!==previous.sourceSha256)return 'source_evidence_changed';
 return current.candidateSha256===previous.candidateSha256?'same_evidence_and_plan':'plan_only_revision';
}

export function candidateDevelopmentReasons(record){
 if(record?.schema!==1||record.type!=='candidate-development'||!/^loop-\d+-\d+$/.test(record.runId||'')||!Number.isFinite(Date.parse(record.createdAt))||!Array.isArray(record.events)||record.events.length>24||new Set(record.events.map(e=>e?.id)).size!==record.events.length||Buffer.byteLength(stableJSON(record))>524288||privateArtifactReasons(record).length)return ['Invalid bounded candidate development record.'];
 for(const e of record.events){const {id,...body}=e,d=e.details;if(!states.has(e.kind)||id!==digest(body)||!/^loop-\d+-\d+$/.test(e.sourceRunId||'')||!/^https:\/\//.test(e.productUrl||'')||canonicalURL(e.productUrl)!==e.productUrl||hash(e.productUrl)!==e.caseId||!d||typeof d!=='object')return ['Invalid candidate development event.'];
  if(['origin','assessment'].includes(e.kind)&&(!['revisionId','candidateSha256','sourceSha256'].every(k=>/^[a-f0-9]{64}$/.test(d[k]||''))||!Array.isArray(d.limitations)||candidatePlanReasons({candidates:[{scoring:{},experimentPlan:d.plan}]},{candidatePlanVersion:1}).length))return ['Invalid preserved candidate revision.'];
  if(e.kind==='assessment'&&(!Array.isArray(d.missingReferences)||d.missingReferences.length>2||!Array.isArray(d.capabilitySources)||d.capabilitySources.length>2||d.criteriaStatus!=='writer_provisional_batch_examined'))return ['Invalid candidate assessment detail.'];
  if(d.evidenceTasks!==undefined&&candidateEvidenceTaskReasons(d.evidenceTasks,e.productUrl).length)return ['Invalid candidate evidence tasks.'];
  if(e.kind==='acquisition'&&(!Array.isArray(d.routes)||d.routes.length<1||d.routes.length>2||d.routes.some(route=>!['waiting','not_attempted','unknown','interrupted','fetched','failed','changed'].includes(route.status))))return ['Invalid candidate acquisition detail.'];
  if(e.kind==='publication'&&(!/^[a-f0-9]{24}$/.test(d.postId||'')||!/^[a-f0-9]{64}$/.test(d.contentSha256||'')||!Number.isFinite(Date.parse(d.publishedAt))))return ['Invalid candidate publication detail.'];
 }
 return [];
}
function checkedBundle(bundle){
 try{
  const {run,draft,context,manifest,research,scan,learning}=bundle;
  if(!run.checkedAssessment?.completed||run.assessmentOutcome!=='completed'||run.operationalFailures.length||completedAssessmentReasons(draft,context,manifest).length||context.demandContext?.discussionBatchPolicy?.researchSha256!==digest(research))return false;
  return digest(deriveLearningReceipt({run,selection:research.learningSelection,scan,draft,context,manifest,expectedSelectionSha256:learning.selectionSha256,expectedScanSha256:learning.scanSha256,expectedDraftSha256:learning.draftSha256,expectedContextSha256:learning.contextSha256,now:learning.createdAt}))===digest(learning);
 }catch{return false;}
}

// Only this trusted record-stage derivation creates lifecycle events. A model
// plan, a requested URL, or an acquisition result cannot authorize publication.
export function deriveCandidateDevelopment({run,bundle=null,intent=null,result=null,originBundle=null,posts=[],history=[]}){
 const preceding=history.filter(record=>record.createdAt<run.finishedAt||record.createdAt===run.finishedAt&&record.runId<run.id),events=[],previous=reduceCandidateDevelopment(preceding,{posts});
 if(intent){
  if(continuationIntentReasons(intent).length||intent.runId!==run.id)throw new Error('Development intent identity is invalid.');
  if(originBundle&&digest(originBundle.context)!==intent.dossier.provenance.contextSha256)throw new Error('Development origin evidence does not match its preserved dossier.');
  const d=intent.dossier,capabilitySources=capabilities(originBundle?.context,d.source.id),revisionId=revision(d.id,d.candidateSha256,d.sourceSha256,capabilitySources);
  events.push(event('origin',d.id,d.source.url,d.provenance.runId,{revisionId,parentRevisionId:null,candidateSha256:d.candidateSha256,sourceSha256:d.sourceSha256,capabilitySources,plan:d.candidate.experimentPlan,limitations:d.unresolved,provenance:d.provenance}));
  if(result&&continuationResultReasons(result,intent,{sealed:true}).length)throw new Error('Development acquisition receipt is invalid.');
  const routes=continuationRequests(intent).map(ref=>{const terminal=result?.events.find(e=>e.key===ref.implementationReferenceId&&e.status!=='started'),started=result?.events.some(e=>e.key===ref.implementationReferenceId&&e.status==='started');return {key:continuationRouteKey(d,ref),referenceId:ref.implementationReferenceId,url:ref.url,purpose:intent.refreshReferenceIds?.includes(ref.implementationReferenceId)?'freshness_verification':'new_acquisition',status:terminal?.status||(!result?'unknown':started?'interrupted':result.outcome==='not_eligible'?'waiting':'not_attempted'),evidenceSha256:terminal?.evidenceSha256||null};});
  events.push(event('acquisition',d.id,d.source.url,run.id,{revisionId,intentSha256:digest(intent),resultSha256:result?digest(result):null,outcome:result?.outcome||'unknown',routes}));
 }
 if(bundle&&bundle.run.id===run.id&&digest(bundle.run)===digest(run)&&checkedBundle(bundle)){
  const {draft,context,manifest,research,learning}=bundle;
  let dossiers=[];if(run.status==='completed_no_post')dossiers=researchDossiers(bundle);
  for(const [index,candidate] of (draft.candidates||[]).entries()){
   const assignment=context.demandContext.discussionBatchPolicy.leadAssignments.find(a=>a.productUrl===candidate.productUrl),source=context.sources.find(s=>s.id===assignment?.demandSourceId);
   if(!source||!candidate.experimentPlan)continue;
   const caseId=hash(candidate.productUrl),candidateSha256=digest(candidate),sourceSha256=researchSourceFingerprint(source),capabilitySources=capabilities(context,source.id),revisionId=revision(caseId,candidateSha256,sourceSha256,capabilitySources),d=dossiers.find(row=>row.id===caseId);
   const prior=previous.find(c=>c.id===caseId)?.revisions.at(-1),parentRevisionId=intent?.dossier.id===caseId?revision(caseId,intent.dossier.candidateSha256,intent.dossier.sourceSha256,capabilities(originBundle?.context,source.id)):prior?.revisionId||null;
   const progress=developmentProgress(prior,{candidateSha256,sourceSha256,capabilitySources}),evidenceTasks=candidateEvidenceTasks({candidate,source,capabilitySources:context.sources.filter(row=>row.role==='building')});
   events.push(event('assessment',caseId,candidate.productUrl,run.id,{revisionId,parentRevisionId:parentRevisionId===revisionId?null:parentRevisionId,candidateIndex:index,candidateSha256,sourceSha256,capabilitySources,progress,plan:candidate.experimentPlan,limitations:candidate.experimentPlan.unverified,evidenceTasks,provisionalCriteria:candidate.scoring.criteria,criteriaStatus:'writer_provisional_batch_examined',outcome:manifest.completedAssessment.decision,missingReferences:d?.referenceRequests.map(ref=>({key:continuationRouteKey(d,ref),referenceId:ref.implementationReferenceId,url:ref.url}))||[],acquisitionPath:d?.coverage||'not_required_for_this_assessment',provenance:{runSha256:digest(run),draftSha256:digest(draft),contextSha256:digest(context),manifestSha256:digest(manifest),researchSha256:digest(research),learningSha256:digest(learning)}}));
  }
  const approvals=checkApproval(draft,context,manifest);
  for(const post of posts.filter(p=>p.runId===run.id&&(run.published||[]).includes(p.id)&&verifyPublishedPost(p)&&approvals.some(a=>a.postId===p.id&&a.pass))){const url=canonicalURL(post.productUrl);events.push(event('publication',hash(url),url,run.id,{postId:post.id,contentSha256:post.contentSha256,publishedAt:post.publishedAt,manifestSha256:digest(manifest)}));}
 }
 if(!events.length)return null;
 const record={schema:1,type:'candidate-development',runId:run.id,createdAt:run.finishedAt,events};
 const errors=candidateDevelopmentReasons(record);if(errors.length)throw new Error(errors.join(' '));return record;
}

export function reduceCandidateDevelopment(records,{posts=[]}={}){
 const cases=new Map(),seen=new Set();
 for(const record of records.slice().sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.runId.localeCompare(b.runId))){
  const errors=candidateDevelopmentReasons(record);if(errors.length)throw new Error(errors.join(' '));
  for(const e of record.events){if(seen.has(e.id))continue;seen.add(e.id);let c=cases.get(e.caseId);if(!c){c={id:e.caseId,productUrl:e.productUrl,state:'origin_recorded',revisions:[],history:[],routes:[],publishedPostId:null};cases.set(e.caseId,c);}c.history.push({eventId:e.id,kind:e.kind,runId:e.sourceRunId,recordedAt:record.createdAt});
   if(e.kind==='origin'||e.kind==='assessment'){
    const index=c.revisions.findIndex(r=>r.revisionId===e.details.revisionId);if(index<0)c.revisions.push({...e.details,sourceRunId:e.sourceRunId});else c.revisions[index]={...c.revisions[index],...e.details,sourceRunId:e.sourceRunId};
    if(e.kind==='assessment'){c.state=e.details.missingReferences.length?'needs_evidence':e.details.acquisitionPath==='no_catalog_match'?'no_permitted_route':e.details.outcome==='no_supported_candidate'?'independently_assessed_no_post':'independently_assessed';c.latestAssessmentRunId=e.sourceRunId;c.latestProgress=e.details.progress;}
   }
   if(e.kind==='acquisition'){for(const route of e.details.routes){const i=c.routes.findIndex(r=>r.key===route.key);if(i<0)c.routes.push({...route,runId:e.sourceRunId});else if(!['waiting','not_attempted'].includes(route.status))c.routes[i]={...route,runId:e.sourceRunId};}c.state=e.details.outcome==='completed'?'evidence_acquired':['unknown','interrupted'].includes(e.details.outcome)?'attempt_unknown':e.details.outcome==='not_eligible'?'cooldown_or_availability_wait':e.details.outcome==='changed_source'?'source_changed':'route_unresolved';}
   if(e.kind==='publication'&&posts.some(post=>post.id===e.details.postId&&post.contentSha256===e.details.contentSha256&&canonicalURL(post.productUrl)===e.productUrl&&post.runId===e.sourceRunId&&post.publishedAt===e.details.publishedAt&&verifyPublishedPost(post))){c.state='published';c.publishedPostId=e.details.postId;}
  }
 }
 for(const c of cases.values()){
  const missing=c.revisions.at(-1)?.missingReferences?.map(ref=>ref.key)||[];
  if(c.routes.some(r=>missing.includes(r.key)&&['failed','interrupted','unknown'].includes(r.status))&&c.state==='needs_evidence')c.state='needs_other_evidence_route';
  const published=posts.find(post=>canonicalURL(post.productUrl)===c.productUrl&&verifyPublishedPost(post));if(published){c.state='published';c.publishedPostId=published.id;}
 }
 return [...cases.values()];
}

export async function loadDevelopmentHistory(root){
 let names;try{names=(await fs.readdir(path.join(root,'data/candidate-development'))).filter(name=>/^loop-\d+-\d+\.json$/.test(name)).sort().reverse().slice(0,96);}catch(error){if(error.code==='ENOENT')return [];throw error;}
 const records=await Promise.all(names.map(name=>readBoundedJSON(path.join(root,'data/candidate-development',name))));
 for(const record of records){const errors=candidateDevelopmentReasons(record);if(errors.length)throw new Error(errors.join(' '));}
 return records;
}

// A later plan-only rewrite must not hide the earlier concrete design. Expose
// one independently examined proposal, never old source evidence or ratings.
// Revalidate the original bundle rather than trusting the history projection.
export async function previousContinuationPlans(root,intent){
 const origin=await verifyContinuationIntent(root,intent),d=intent.dossier;
 const currentPlan=digest(d.candidate.experimentPlan),history=await loadDevelopmentHistory(root),known=new Map();
 for(const record of history)for(const e of record.events){
  if(e.caseId!==d.id||!['origin','assessment'].includes(e.kind)||e.details.sourceSha256!==d.sourceSha256||e.sourceRunId===d.provenance.runId||digest(e.details.plan)===currentPlan)continue;
  known.set(e.sourceRunId+'|'+e.details.candidateSha256,{...e.details,sourceRunId:e.sourceRunId});
 }
 // Projection insertion order is not assessment chronology. Read only bounded
 // run metadata before spending the three complete-bundle validation slots.
 const dates=new Map(await Promise.all([...new Set([...known.values()].map(r=>r.sourceRunId))].map(async id=>{
  try{const run=await readBoundedJSON(path.join(root,'data/runs',id+'.json'));return [id,run.id===id&&run.checkedAssessment?.completed===true?Date.parse(run.checkedAssessment.completedAt):NaN];}
  catch{return [id,NaN];}
 })));
 const originAt=Date.parse(origin.run.checkedAssessment.completedAt);
 const candidates=[...known.values()].filter(r=>Number.isFinite(dates.get(r.sourceRunId))&&dates.get(r.sourceRunId)<originAt).sort((a,b)=>dates.get(b.sourceRunId)-dates.get(a.sourceRunId)||a.sourceRunId.localeCompare(b.sourceRunId)).slice(0,3);
 for(const revision of candidates){
  try{
   const bundle=await readResearchBundle(root,revision.sourceRunId);
   if(Date.parse(bundle.run.checkedAssessment.completedAt)>=Date.parse(origin.run.checkedAssessment.completedAt))continue;
   const old=researchDossiers(bundle).find(row=>row.id===d.id&&row.sourceSha256===d.sourceSha256&&row.candidateSha256===revision.candidateSha256);
   if(!old||digest(old.candidate.experimentPlan)===currentPlan)continue;
   return [{status:'historical_proposal',sourceRunId:bundle.run.id,candidateSha256:old.candidateSha256,sourceSha256:old.sourceSha256,plan:structuredClone(old.candidate.experimentPlan),provenance:{runSha256:old.provenance.runSha256,draftSha256:old.provenance.draftSha256,contextSha256:old.provenance.contextSha256},notice:'An earlier independently examined proposed design, not an executed test or current evidence. Re-evaluate its assumptions and gaps against the current sources.'}];
  }catch{ /* Missing or invalid historical evidence cannot restore a plan. */ }
 }
 return [];
}
export async function developmentCandidateBundles(root,{posts=[]}={}){
 const states=reduceCandidateDevelopment(await loadDevelopmentHistory(root),{posts});
 const priority=c=>c.state==='needs_evidence'||c.state==='evidence_acquired'?1:0;
 const queued=states.filter(c=>c.state!=='published').sort((a,b)=>priority(b)-priority(a)||b.history.at(-1).recordedAt.localeCompare(a.history.at(-1).recordedAt)).slice(0,64);
 const ids=[...new Set(queued.map(c=>c.latestAssessmentRunId||c.revisions.at(-1)?.sourceRunId).filter(Boolean))];
 return (await Promise.all(ids.map(id=>readResearchBundle(root,id).catch(()=>null)))).filter(Boolean);
}
