import {sha256,stableJSON,safeError} from './storage.mjs';
import {completedAssessmentReasons,checkApproval} from './validation.mjs';

const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const string={type:'string'},reason={type:'string',minLength:1,maxLength:500};
const array=items=>({type:'array',items});
const fixed=(type,value)=>({type,enum:[value]});

export function checkerOutputSchema(draft,context){
 const claim=object({claim:reason,supported:{type:'boolean'},sourceId:string,evidenceQuote:{type:'string',minLength:12,maxLength:500}});
 const score=object({criterion:{type:'string',enum:['ease','profit','feasibility','autonomy','evidence']},supported:{type:'boolean'},maxSupportedScore:{type:'integer',minimum:1,maximum:10},reason:{type:'string',minLength:1,maxLength:280},sourceId:string,evidenceQuote:{type:'string',minLength:12,maxLength:500}});
 const checkFields={postId:draft.posts.length?{type:'string',enum:draft.posts.map(post=>post.id)}:string,pass:{type:'boolean'},reasons:array(reason),claimChecks:{...array(claim),minItems:3,maxItems:30},scoreChecks:{...array(score),minItems:5,maxItems:5}};
 if(context.noveltyContractVersion===1){
  const comparison=object({distinct:{type:'boolean'},closestPostId:{anyOf:[string,{type:'null'}]},reason});
  checkFields.noveltyCheck=object({recentPostsSha256:fixed('string',context.noveltyContext.postsSha256),windowDays:fixed('integer',14),comparedPostCount:fixed('integer',context.noveltyContext.posts.length),product:comparison,workflow:comparison,customer:comparison});
 }
 const check=object(checkFields);
 const fields={runId:fixed('string',context.runId),draftSha256:fixed('string',context.draftSha256),sourceSnapshotSha256:fixed('string',context.sourceSnapshotSha256),policySha256:fixed('string',context.scoringPolicy.policySha256),checks:{...array(check),minItems:draft.posts.length,maxItems:draft.posts.length}};
 if(context.assessmentContractVersion===1)fields.completedAssessment=object({schema:fixed('integer',1),completed:fixed('boolean',true),decision:fixed('string',draft.posts.length?'assessed':'no_supported_candidate'),reason,contextSha256:fixed('string',sha256(stableJSON(context))),rulesSha256:fixed('string',context.rulesSha256),draftSha256:fixed('string',context.draftSha256),sourceSnapshotSha256:fixed('string',context.sourceSnapshotSha256),policySha256:fixed('string',context.scoringPolicy.policySha256)});
 return object({outcome:{type:'string',enum:['completed','operational_failure']},reason,manifest:{anyOf:[{type:'null'},object(fields)]}});
}

export function acceptCheckerOutput(response,draft,context,{existing,expectedDraftSha256,expectedContextSha256}={}){
 if(expectedDraftSha256&&sha256(stableJSON(draft))!==expectedDraftSha256||expectedContextSha256&&sha256(stableJSON(context))!==expectedContextSha256)throw new Error('Checker changed its trusted frozen draft or evidence context.');
 if(!response||typeof response!=='object'||Array.isArray(response)||Object.keys(response).length!==3||!['outcome','reason','manifest'].every(key=>Object.hasOwn(response,key))||typeof response.reason!=='string'||!response.reason.trim()||response.reason.length>500)throw new Error('Independent checker output envelope is missing or malformed.');
 if(response.outcome==='operational_failure')throw new Error('Independent checker reported an operational failure: '+response.reason);
 if(response.outcome!=='completed'||!response.manifest||typeof response.manifest!=='object'||Array.isArray(response.manifest))throw new Error('Independent checker did not return a completed manifest.');
 const manifest=response.manifest;
 if(existing&&stableJSON(existing)!==stableJSON(manifest))throw new Error('Independent checker file and final response disagree.');
 if(sha256(stableJSON(draft))!==context.draftSha256||sha256(stableJSON(context.sources))!==context.sourceSnapshotSha256)throw new Error('Independent checker output does not belong to the frozen draft and source snapshot.');
 const reasons=completedAssessmentReasons(draft,context,manifest);
 if(manifest.runId!==context.runId||manifest.draftSha256!==context.draftSha256||manifest.sourceSnapshotSha256!==context.sourceSnapshotSha256||manifest.policySha256!==context.scoringPolicy.policySha256||!Array.isArray(manifest.checks))reasons.push('Independent checker output fingerprints or identity changed.');
 if(reasons.length)throw new Error([...new Set(reasons)].join(' '));
 // A well formed rejection is valid output; this call checks bindings rather
 // than converting a rejected candidate into an approval.
 checkApproval(draft,context,manifest);
 return manifest;
}

// This is a trusted scheduling decision to publish nothing, never a replacement
// for the independent check. It carries no approved claims or criterion scores.
export function unverifiedAssessment(scheduling,{reason,stage='check',code='content_verification_unavailable'},now=new Date()){
 if(scheduling?.assessmentContractVersion!==1||scheduling.decision!=='run')throw new Error('An unverified outcome needs a trusted version-1 reservation.');
 return {schema:1,completed:false,contractVersion:1,runId:scheduling.runId,schedulingSha256:sha256(stableJSON(scheduling)),slotIds:scheduling.slotIds||[scheduling.slotId],decision:'no_post_unverified',reason:safeError({message:reason}).replace(/[\r\n\x00-\x1f\x7f]/g,' ').trim()||'The independent content verification did not complete.',stage,code,completedAt:new Date(now).toISOString()};
}

export function checkerFailure(error){
 const reason=safeError(error).replace(/[\r\n\x00-\x1f\x7f]/g,' ').trim();
 const code=/trusted frozen|fingerprint|frozen draft|source snapshot|bind all frozen|identity changed/i.test(reason)?'checker_binding_unverified':/operational failure/i.test(reason)?'checker_examination_unverified':/ENOENT|no such file/i.test(reason)?'checker_output_missing':'checker_output_unverified';
 return {stage:'check',code,reason:reason||'The independent checker did not provide a verifiable output.'};
}
