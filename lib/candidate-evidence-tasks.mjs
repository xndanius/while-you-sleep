import {sha256,stableJSON} from './storage.mjs';
import {privateArtifactReasons} from './privacy.mjs';
import {selectDiscussionImplementationReferences,discussionImplementationReference,DISCUSSION_IMPLEMENTATION_CATALOG} from './discussion-implementation.mjs';

const kinds=new Set(['documentation','local_fixture','existing_access','hypothesis','unrouted']);
const keys=['id','kind','status','gapIndexes','question','method','acceptanceCheck','scopeLimit','referenceId'];
const task=(productUrl,body)=>({id:sha256(stableJSON({productUrl,...body})),...body});

// These are work requests, not evidence or permission. Only a fixed public
// documentation route is automatic. No task can report a completed experiment.
export function candidateEvidenceTasks({candidate,source,capabilitySources=[]}){
 const gaps=candidate.experimentPlan.unverified,used=new Set(),tasks=[];
 const existing=capabilitySources.filter(row=>discussionImplementationReference(row,{demandSources:[source]})).map(row=>row.implementationReferenceId);
 const missing=selectDiscussionImplementationReferences([source],{priorityDemandSourceId:source.id,excludePriorityReferenceIds:existing});
 for(const ref of missing)tasks.push(task(candidate.productUrl,{kind:'documentation',status:'pending',gapIndexes:[],question:`Read ${ref.title} for the observed task.`,method:'One existing guarded public documentation request.',acceptanceCheck:'Retain the literal relevant capability section and independently refetch it.',scopeLimit:'Documentation does not establish a working integration, access, buyer demand or execution.',referenceId:ref.implementationReferenceId}));
 const csv=selectDiscussionImplementationReferences([source],{priorityDemandSourceId:source.id,priorityReferenceIds:['n8n-csv-extraction-v1']}).some(row=>row.implementationReferenceId==='n8n-csv-extraction-v1');
 const matching=pattern=>gaps.flatMap((gap,index)=>pattern.test(gap)?[index]:[]);
 const add=(kind,indexes,question,method,acceptanceCheck,scopeLimit)=>{if(!indexes.length)return;indexes.forEach(index=>used.add(index));tasks.push(task(candidate.productUrl,{kind,status:'pending',gapIndexes:indexes,question,method,acceptanceCheck,scopeLimit,referenceId:null}));};
 if(csv){
  add('local_fixture',matching(/\b(?:duplicate|dedup\w*|keys?)\b/i),'Which explicit key preserves distinct observations while rejecting a repeated file version?',
   'Use fictional file IDs, revisions and row ordinals in an isolated local CSV fixture.',
   'Replay and restart insert no duplicate rows; distinct identical measurements survive; changed bytes under the same file revision fail closed.',
   'A chosen synthetic key tests only that contract. It does not establish the real export schema or n8n runtime behavior.');
  add('existing_access',matching(/\b(?:phone|upload\w*|trigger\w*|drive)\b/i),'Does the actual phone export produce a stable file ID and revision and trigger one complete-file read?',
   'Requires an owner-authorized existing device/export and integration environment; no account or credential acquisition is automatic.',
   'Observe actual create, update, retry and incomplete-upload events before claiming live reliability.',
   'Public documentation or a local synthetic test cannot close this live-integration gap.');
 }
 add('hypothesis',matching(/\b(?:buyers?|pay(?:ing|ment)?|willingness|demand|customers?)\b/i),'What evidence supports the proposed buyer and recurring need?',
  'Use already permitted public primary evidence; do not initiate outreach or collect personal data.',
  'Separate observed recurrence from buyer and payment hypotheses; retain unknowns when evidence is absent.',
  'No completed experiment or paying customer may be inferred from a proposal or technical test.');
 for(const [index,gap] of gaps.entries())if(!used.has(index))tasks.push(task(candidate.productUrl,{kind:'unrouted',status:'pending',gapIndexes:[index],question:gap,method:'No configured automatic evidence route.',acceptanceCheck:'Resolve this exact question with an authorized, independently verifiable source or explicitly retain it as unknown.',scopeLimit:'Unrouted is not completed and cannot raise a score.',referenceId:null}));
 const errors=candidateEvidenceTaskReasons(tasks,candidate.productUrl);if(errors.length)throw Error(errors.join(' '));return tasks;
}

export function candidateEvidenceTaskReasons(tasks,productUrl){
 if(!Array.isArray(tasks)||tasks.length>18||new Set(tasks.map(row=>row?.id)).size!==tasks.length||privateArtifactReasons(tasks).length)return ['Invalid bounded evidence task list.'];
 for(const row of tasks){
  if(!row||Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key))||!kinds.has(row.kind)||row.status!=='pending'||!Array.isArray(row.gapIndexes)||row.gapIndexes.some(index=>!Number.isInteger(index)||index<0||index>11)||new Set(row.gapIndexes).size!==row.gapIndexes.length||['question','method','acceptanceCheck','scopeLimit'].some(key=>typeof row[key]!=='string'||!row[key].trim()||row[key].length>1000)||(row.kind==='documentation'?!DISCUSSION_IMPLEMENTATION_CATALOG.some(ref=>ref.id===row.referenceId):row.referenceId!==null))return ['Invalid evidence task request.'];
  const {id,...body}=row;if(id!==sha256(stableJSON({productUrl,...body})))return ['Evidence task identity changed.'];
 }
 return [];
}
