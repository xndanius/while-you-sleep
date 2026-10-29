import {sha256, stableJSON, validId} from './storage.mjs';
import {verifyPublishedPost} from './validation.mjs';
import {sourceQuoteOccurs} from './evidence-contract.mjs';

export const SCORING_KEYS = Object.freeze(['ease','profit','feasibility','autonomy','evidence']);
const START='<!-- scoring-policy:start -->', END='<!-- scoring-policy:end -->';
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const object=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const shortText=(value,min=8,max=280)=>typeof value==='string'&&value.trim().length>=min&&value.length<=max&&!/\bsk-(?:proj-)?[A-Za-z0-9_-]{25,}/.test(value);
const reason=value=>shortText(value)&&!/[\r\n]/.test(value);
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const same=(left,right)=>stableJSON(left)===stableJSON(right);

export function scoringPolicyHash(weights,threshold){return sha256(stableJSON({weights,publishThreshold:threshold}));}
export function validateScoringPolicy(policy){
 const reasons=[];
 if(!object(policy)||!exact(policy.weights,SCORING_KEYS)||SCORING_KEYS.some(key=>typeof policy.weights[key]!=='number'||!Number.isFinite(policy.weights[key])||policy.weights[key]<=0||policy.weights[key]>100))reasons.push('Scoring weights must contain exactly five finite values greater than zero and no greater than 100.');
 if(typeof policy?.threshold!=='number'||!Number.isFinite(policy.threshold)||policy.threshold<1||policy.threshold>10)reasons.push('Scoring threshold must be a finite value from 1 to 10.');
 if(!reasons.length&&policy.policySha256!==scoringPolicyHash(policy.weights,policy.threshold))reasons.push('Scoring policy fingerprint does not match its weights and threshold.');
 return reasons;
}
export function policyBlockRange(rulesText){
 if(typeof rulesText!=='string'||rulesText.split(START).length!==2||rulesText.split(END).length!==2)throw new Error('RULES must contain exactly one scoring policy block.');
 const start=rulesText.indexOf(START),end=rulesText.indexOf(END)+END.length;
 if(end<=start+START.length)throw new Error('Scoring policy markers are out of order.');
 return {start,end};
}
export function parseScoringPolicy(rulesText){
 const {start,end}=policyBlockRange(rulesText),block=rulesText.slice(start+START.length,end-END.length);
 const match=block.match(/^\s*```json\s*\n([\s\S]*?)\n```\s*$/);
 if(!match)throw new Error('Scoring policy must be one fenced JSON object.');
 let raw;try{raw=JSON.parse(match[1]);}catch{throw new Error('Scoring policy is not valid JSON.');}
 if(!exact(raw,['weights','publishThreshold']))throw new Error('Scoring policy contains unexpected fields.');
 const policy={weights:raw.weights,threshold:raw.publishThreshold,policySha256:scoringPolicyHash(raw.weights,raw.publishThreshold)};
 const failures=validateScoringPolicy(policy);if(failures.length)throw new Error(failures.join(' '));return policy;
}
export function replaceScoringPolicy(rulesText,raw){
 if(!exact(raw,['weights','publishThreshold']))throw new Error('Replacement scoring policy contains unexpected fields.');
 const policy={weights:raw.weights,threshold:raw.publishThreshold,policySha256:scoringPolicyHash(raw.weights,raw.publishThreshold)};
 const failures=validateScoringPolicy(policy);if(failures.length)throw new Error(failures.join(' '));
 const {start,end}=policyBlockRange(rulesText);
 return rulesText.slice(0,start)+START+'\n```json\n'+JSON.stringify({weights:policy.weights,publishThreshold:policy.threshold})+'\n```\n'+END+rulesText.slice(end);
}
export function validateScoringCriteria(criteria,{sourceIds,sources}={}){
 const reasons=[];
 if(!exact(criteria,SCORING_KEYS))return ['Scores must contain exactly ease, profit, feasibility, autonomy and evidence.'];
 for(const key of SCORING_KEYS){
  const rating=criteria[key];
  if(!exact(rating,['value','reason','sourceIds'])){reasons.push(`${key} score contains missing or unexpected fields.`);continue;}
  if(!Number.isInteger(rating.value)||rating.value<1||rating.value>10)reasons.push(`${key} score must be an integer from 1 to 10.`);
  if(!reason(rating.reason))reasons.push(`${key} score needs one bounded evidence-based reason.`);
  if(key==='profit'&&(!/\bhypothes(?:is|es|ized|ised)|\bhypothetical\b/i.test(rating.reason||'')||/\bguaranteed\b|\bwill (?:earn|make|generate)\b|(?:[$€£]\s*\d|\d\s*(?:dollars?|euros?|USD|EUR)\b)/i.test(rating.reason||'')))reasons.push('Profit score must state a buyer hypothesis without invented earnings or prices.');
  if(!Array.isArray(rating.sourceIds)||rating.sourceIds.length<1||rating.sourceIds.length>4||rating.sourceIds.some(id=>!validId(id))||new Set(rating.sourceIds).size!==rating.sourceIds.length)reasons.push(`${key} score needs one to four distinct source IDs.`);
  else if(rating.sourceIds.some(id=>sourceIds&&!sourceIds.includes(id)||sources&&!sources.some(source=>source?.id===id)))reasons.push(`${key} score references unavailable or unattached evidence.`);
 }
 return reasons;
}
// A no-post batch still contains scored decisions. Check their bindings without
// granting a score, adding evidence or changing any model-written value.
export const CANDIDATE_SCORING_VERSION=1;
export function candidateScoringVersionReasons(version){
 return version===undefined||version===CANDIDATE_SCORING_VERSION?[]:['Candidate scoring contract version is unsupported.'];
}
export function candidateScoringReasons(draft,{sources}={}){
 const reasons=[],available=Array.isArray(sources)?sources:[];
 for(const [index,candidate] of (Array.isArray(draft?.candidates)?draft.candidates:[]).entries()){
  if(!candidate||typeof candidate!=='object'||!Object.hasOwn(candidate,'scoring'))continue;
  const sourceIds=Array.isArray(candidate.sourceIds)?candidate.sourceIds:[];
  for(const reason of validateScoringCriteria(candidate.scoring?.criteria,{sourceIds,sources:available}))reasons.push(`Scored candidate ${index+1}: ${reason}`);
 }
 return reasons;
}
export function checkScoringApproval(criteria,scoreChecks,sources,{sourceIds}={}){
 sources=Array.isArray(sources)?sources:[];
 const reasons=validateScoringCriteria(criteria,{sourceIds,sources});
 if(!Array.isArray(scoreChecks)||scoreChecks.length!==5||new Set(scoreChecks.map(check=>check?.criterion)).size!==5||SCORING_KEYS.some(key=>!scoreChecks.some(check=>check?.criterion===key)))return [...reasons,'Independent checker must assess each of the five criteria exactly once.'];
 for(const check of scoreChecks){
  if(!exact(check,['criterion','supported','maxSupportedScore','reason','sourceId','evidenceQuote'])){reasons.push('A score check contains missing or unexpected fields.');continue;}
  const rating=criteria?.[check.criterion],source=sources.find(value=>value?.id===check.sourceId);
  if(check.supported!==true||!Number.isInteger(check.maxSupportedScore)||check.maxSupportedScore<1||check.maxSupportedScore>10||rating?.value>check.maxSupportedScore)reasons.push(`${check.criterion} score exceeds what the independent checker supports.`);
  if(!reason(check.reason)||check.criterion==='profit'&&!/\bhypothes(?:is|es|ized|ised)|\bhypothetical\b/i.test(check.reason))reasons.push(`${check.criterion} score check needs a bounded reason, with profit explicitly hypothetical.`);
  if(!source||!rating?.sourceIds?.includes(check.sourceId)||sourceIds&&!sourceIds.includes(check.sourceId))reasons.push(`${check.criterion} score check references unattached evidence.`);
  if(!shortText(check.evidenceQuote,12,500)||!sourceQuoteOccurs(source,check.evidenceQuote))reasons.push(`${check.criterion} score check needs an exact quote from the newly fetched source.`);
 }
 return [...new Set(reasons)];
}
export function weightedOverall(criteria,weights){
 const policy={weights,threshold:1,policySha256:scoringPolicyHash(weights,1)};
 if(validateScoringPolicy(policy).length||validateScoringCriteria(criteria).length)throw new Error('Cannot aggregate invalid criterion values or weights.');
 const total=SCORING_KEYS.reduce((sum,key)=>sum+weights[key],0);
 return Math.min(10,Math.max(1,SCORING_KEYS.reduce((sum,key)=>sum+criteria[key].value*weights[key],0)/total));
}
export function publishedScoring(criteria,policy,{checkedAt,checkerRunId}={}){
 if(validateScoringPolicy(policy).length||validateScoringCriteria(criteria).length||!timestamp(checkedAt)||!validId(checkerRunId))throw new Error('Checked scores need a valid frozen policy and checker identity.');
 return {criteria,overall:weightedOverall(criteria,policy.weights),weights:policy.weights,threshold:policy.threshold,policySha256:policy.policySha256,assessmentPolicySha256:policy.policySha256,checkedAt,checkerRunId};
}
export function scoreDraft(postId,postContentSha256,criteria){return {postId,postContentSha256,criteria};}
export function validateScoreSidecar(post,sidecar){
 const reasons=[];
 if(!verifyPublishedPost(post))return ['Immutable original post failed its content fingerprint.'];
 if(!object(sidecar)||sidecar.schema!==1||sidecar.origin!=='github-actions-codex-scorer'||sidecar.postId!==post.id||sidecar.postContentSha256!==post.contentSha256)reasons.push('Score sidecar does not bind this immutable original post.');
 const policy=sidecar?.assessmentPolicy,check=sidecar?.checker,sources=sidecar?.sources;
 reasons.push(...validateScoringPolicy(policy));
 if(!timestamp(sidecar?.checkedAt)||!validId(sidecar?.checkerRunId)||!Array.isArray(sources)||!sources.length||sources.length>5||new Set(sources.map(source=>source?.id)).size!==sources.length||sources.some(source=>!validId(source?.id)||!shortText(source?.text,100,18000)||!timestamp(source?.verifiedAt)||!timestamp(source?.fetchedAt)))reasons.push('Score sidecar lacks a bounded fresh evidence snapshot or checker identity.');
 if(Array.isArray(sources)&&sources.some(source=>!post.sources?.some(original=>original.id===source?.id&&original.url===source?.url)||Date.parse(source?.verifiedAt)>Date.parse(sidecar?.checkedAt)||Date.parse(sidecar?.checkedAt)-Date.parse(source?.verifiedAt)>3*3600000))reasons.push('Score sidecar evidence is not an original attachment freshly verified at assessment time.');
 if(!hex(sidecar?.draftSha256)||sidecar.draftSha256!==sha256(stableJSON(scoreDraft(post.id,post.contentSha256,sidecar.criteria))))reasons.push('Score sidecar draft fingerprint does not match its criterion values.');
 if(!hex(sidecar?.sourceSnapshotSha256)||sidecar.sourceSnapshotSha256!==sha256(stableJSON(sources)))reasons.push('Score sidecar evidence fingerprint does not match its sources.');
 if(!check||check.passed!==true||check.postId!==post.id||check.postContentSha256!==post.contentSha256||check.draftSha256!==sidecar.draftSha256||check.sourceSnapshotSha256!==sidecar.sourceSnapshotSha256||check.policySha256!==policy?.policySha256)reasons.push('Score sidecar lacks independent approval for the exact post, draft, sources and policy.');
 reasons.push(...checkScoringApproval(sidecar?.criteria,check?.scoreChecks,sources,{sourceIds:post.sources?.map(source=>source.id)}));
 if(!sidecar?.batch||!/^score-\d+-\d+$/.test(sidecar.batch.runId)||!hex(sidecar.batch.draftSha256)||!hex(sidecar.batch.contextSha256)||!hex(sidecar.batch.rulesSha256)||!/^[a-f0-9]{40}$/.test(sidecar.batch.rulesCommit||'')||sidecar.checkerRunId!==`${sidecar.batch.runId}-independent-check`||sidecar.batch.githubRunUrl!==`https://github.com/xndanius/while-you-sleep/actions/runs/${sidecar.batch.runId.match(/^score-(\d+)-\d+$/)?.[1]}`)reasons.push('Score sidecar lacks the trusted cloud batch provenance.');
 return [...new Set(reasons)];
}
export function hydrateScoring(post,sidecar,currentPolicy){
 try{
 if(!verifyPublishedPost(post)||validateScoringPolicy(currentPolicy).length)return null;
 let criteria,policy,checkedAt,checkerRunId;
 if(post.scoring){
  const scoring=post.scoring,check=post.checker;
  policy=check.scoringPolicy;criteria=scoring.criteria;checkedAt=scoring.checkedAt;checkerRunId=scoring.checkerRunId;
  if(validateScoringPolicy(policy).length||!Array.isArray(check.scoreSources)||sha256(stableJSON(check.scoreSources))!==check.sourceSnapshotSha256||checkScoringApproval(criteria,check.scoreChecks,check.scoreSources,{sourceIds:post.sources?.map(source=>source.id)}).length)return null;
  try{if(!same(scoring,publishedScoring(criteria,policy,{checkedAt,checkerRunId}))||checkedAt!==check.checkedAt||checkerRunId!==check.checkerRunId)return null;}catch{return null;}
 }else{
  if(validateScoreSidecar(post,sidecar).length)return null;
  ({criteria,assessmentPolicy:policy,checkedAt,checkerRunId}=sidecar);
 }
 const result=publishedScoring(criteria,currentPolicy,{checkedAt,checkerRunId});
 result.assessmentPolicySha256=policy.policySha256;
 return result;
 }catch{return null;}
}
