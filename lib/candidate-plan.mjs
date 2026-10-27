import {privateArtifactReasons} from './privacy.mjs';

export const CANDIDATE_PLAN_VERSION=1;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=['version','status','output','inputs','trigger','steps','acceptanceCheck','humanBoundary','unverified'];
const text=(value,min,max)=>typeof value==='string'&&value.trim().length>=min&&value.length<=max&&!/[\r\n\x00-\x1f\x7f]/.test(value);
const list=(value,min,max,itemMin,itemMax)=>Array.isArray(value)&&value.length>=min&&value.length<=max&&value.every(item=>text(item,itemMin,itemMax));

export function candidatePlanVersionReasons(version){
 return version===undefined||version===CANDIDATE_PLAN_VERSION?[]:['Candidate plan contract version is unsupported.'];
}

// A proposed design makes a score's scope inspectable. It is not evidence of
// execution, demand or feasibility, and this gate cannot grant a score/pass.
export function candidatePlanReasons(draft,{candidatePlanVersion}={}){
 const reasons=candidatePlanVersionReasons(candidatePlanVersion);
 if(reasons.length||candidatePlanVersion===undefined)return reasons;
 if(draft?.candidates!==undefined&&!Array.isArray(draft.candidates))return ['Candidate plans require a bounded candidate list.'];
 for(const [index,candidate] of (draft?.candidates||[]).entries()){
  if(!object(candidate)||!Object.hasOwn(candidate,'scoring'))continue;
  const plan=candidate.experimentPlan;
  if(!object(plan)||Object.keys(plan).length!==keys.length||!keys.every(key=>Object.hasOwn(plan,key))||plan.version!==CANDIDATE_PLAN_VERSION||plan.status!=='proposed'){
   reasons.push(`Scored candidate ${index+1} needs an exact version-1 proposed experiment plan.`);continue;
  }
  if(!text(plan.output,12,500)||!list(plan.inputs,1,6,3,200)||!text(plan.trigger,5,280)||!list(plan.steps,3,7,8,280)||!text(plan.acceptanceCheck,12,500)||!text(plan.humanBoundary,12,500)||!list(plan.unverified,1,6,5,280)||JSON.stringify(plan).length>6000)reasons.push(`Scored candidate ${index+1} has missing or unbounded experiment scope, acceptance check or limits.`);
  if(privateArtifactReasons(plan).length)reasons.push(`Scored candidate ${index+1} experiment plan contains private data.`);
 }
 return [...new Set(reasons)];
}
