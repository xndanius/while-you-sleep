import {sha256,stableJSON} from './storage.mjs';
import {completedAssessmentReasons,checkApproval} from './validation.mjs';

const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const string={type:'string'},reason={type:'string',minLength:1,maxLength:500};
const array=items=>({type:'array',items});
const fixed=(type,value)=>({type,enum:[value]});

export function checkerOutputSchema(draft,context){
 const claim=object({claim:reason,supported:{type:'boolean'},sourceId:string,evidenceQuote:{type:'string',minLength:12,maxLength:500}});
 const score=object({criterion:{type:'string',enum:['ease','profit','feasibility','autonomy','evidence']},supported:{type:'boolean'},maxSupportedScore:{type:'integer',minimum:1,maximum:10},reason:{type:'string',minLength:1,maxLength:280},sourceId:string,evidenceQuote:{type:'string',minLength:12,maxLength:500}});
 const check=object({postId:draft.posts.length?{type:'string',enum:draft.posts.map(post=>post.id)}:string,pass:{type:'boolean'},reasons:array(reason),claimChecks:{...array(claim),minItems:3,maxItems:30},scoreChecks:{...array(score),minItems:5,maxItems:5}});
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
