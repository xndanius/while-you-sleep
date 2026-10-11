import {sha256,stableJSON,validId} from './storage.mjs';
import {verifyPublishedPost} from './validation.mjs';
import {parseScoringPolicy,validateScoringPolicy,validateScoringCriteria,checkScoringApproval,scoreDraft,validateScoreSidecar} from './scoring.mjs';

const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const equal=(left,right)=>stableJSON(left)===stableJSON(right);
const fingerprint=value=>sha256(stableJSON(value));
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
export const SCORE_FILES=Object.freeze(['input.json','draft.json','context.json','check.json']);
export function validateScoreInput(input,{runId,expectedInputSha256,rulesSha256,rulesCommit}={}){
 const failures=[];
 if(!exact(input,['schema','runId','createdAt','rules','rulesSha256','rulesCommit','policy','posts','sources','health'])||input.schema!==1||!/^score-\d+-\d+$/.test(input.runId)||runId&&input.runId!==runId)failures.push('Scoring input schema or run identity is invalid.');
 if(expectedInputSha256&&fingerprint(input)!==expectedInputSha256)failures.push('Scorer changed the frozen trusted input.');
 if(!timestamp(input?.createdAt)||typeof input?.rules!=='string'||sha256(input.rules)!==input.rulesSha256||rulesSha256&&input.rulesSha256!==rulesSha256||!/^[a-f0-9]{40}$/.test(input?.rulesCommit||'')||rulesCommit&&input.rulesCommit!==rulesCommit)failures.push('Scoring input does not bind the frozen RULES and repository revision.');
 try{if(!equal(parseScoringPolicy(input.rules),input.policy))failures.push('Scoring input policy differs from the frozen RULES.');}catch{failures.push('Scoring input RULES policy is invalid.');}
 if(!Array.isArray(input?.posts)||input.posts.length<1||input.posts.length>10||new Set(input.posts.map(post=>post?.id)).size!==input.posts.length||input.posts.some(post=>!verifyPublishedPost(post)||post.scoring))failures.push('Scoring input must contain one to ten distinct verified original posts without inline ratings.');
 if(!Array.isArray(input?.sources)||input.sources.length>40||new Set(input.sources.map(source=>source?.id)).size!==input.sources.length)failures.push('Scoring input source snapshot is invalid.');
 else for(const source of input.sources){
  const attached=input.posts?.some(post=>post.sources?.some(original=>original.id===source.id&&original.url===source.url));
  if(!attached||typeof source.text!=='string'||source.text.length<100||source.text.length>18000||!timestamp(source.fetchedAt)||!timestamp(source.verifiedAt))failures.push('Scoring source is not a bounded fresh original attachment.');
 }
 return [...new Set(failures)];
}
export function validateScoreDraft(draft,input){
 const failures=[];
 if(!exact(draft,['runId','posts'])||draft.runId!==input.runId||!Array.isArray(draft.posts)||draft.posts.length!==input.posts.length) return ['Scorer draft must contain exactly one criterion-only assessment for every frozen original post.'];
 if(new Set(draft.posts.map(post=>post?.postId)).size!==draft.posts.length)failures.push('Scorer repeated an original post.');
 for(const rating of draft.posts){
  const original=input.posts.find(post=>post.id===rating?.postId);
  if(!exact(rating,['postId','postContentSha256','criteria'])||!original||rating.postContentSha256!==original.contentSha256)failures.push('Scorer rating does not bind its immutable original post.');
  failures.push(...validateScoringCriteria(rating?.criteria,{sourceIds:original?.sources?.map(source=>source.id),sources:input.sources}));
 }
 return [...new Set(failures)];
}
export function scoreContext(input,draft,sources,health,createdAt=new Date().toISOString()){
 return {schema:1,runId:input.runId,createdAt,inputSha256:fingerprint(input),rulesSha256:input.rulesSha256,scoringPolicy:input.policy,draftSha256:fingerprint(draft),sourceSnapshotSha256:fingerprint(sources),sources,health,posts:draft.posts.map(rating=>{
  const original=input.posts.find(post=>post.id===rating.postId),sourceIds=original.sources.map(source=>source.id),attached=sources.filter(source=>sourceIds.includes(source.id));
  return {postId:rating.postId,postContentSha256:rating.postContentSha256,draftSha256:fingerprint(rating),sourceSnapshotSha256:fingerprint(attached),sourceIds,deterministicReasons:validateScoringCriteria(rating.criteria,{sourceIds,sources:attached})};
 })};
}
export function validateScoreContext(context,input,draft,{expectedDraftSha256,expectedContextSha256,now=Date.now()}={}){
 const failures=[];
 if(!exact(context,['schema','runId','createdAt','inputSha256','rulesSha256','scoringPolicy','draftSha256','sourceSnapshotSha256','sources','health','posts'])||context.schema!==1||context.runId!==input.runId||context.inputSha256!==fingerprint(input)||context.rulesSha256!==input.rulesSha256||!equal(context.scoringPolicy,input.policy))failures.push('Fresh scoring context changed its trusted input, identity or policy.');
 if(context?.draftSha256!==fingerprint(draft)||expectedDraftSha256!==fingerprint(draft)||expectedContextSha256!==fingerprint(context))failures.push('Checker changed its frozen draft or source context.');
 if(!timestamp(context?.createdAt)||now-Date.parse(context.createdAt)>3*3600000||Date.parse(context.createdAt)>now+60000)failures.push('Fresh scoring context is missing or expired.');
 if(!Array.isArray(context?.sources)||context.sources.length>40||context.sourceSnapshotSha256!==fingerprint(context.sources))failures.push('Fresh scoring source snapshot fingerprint is invalid.');
 else for(const source of context.sources){
  if(!input.posts.some(post=>post.sources.some(original=>original.id===source.id&&original.url===source.url))||typeof source.text!=='string'||source.text.length<100||source.text.length>18000||!timestamp(source.verifiedAt)||!timestamp(source.fetchedAt)||Date.parse(source.verifiedAt)<Date.parse(context.createdAt)-15*60000||Date.parse(source.verifiedAt)>Date.parse(context.createdAt))failures.push('Checker source is not a fresh bounded original attachment.');
 }
 if(Array.isArray(context?.sources)&&!equal(context.posts,scoreContext(input,draft,context.sources,context.health,context.createdAt).posts))failures.push('Checker context changed its per-post fingerprints or deterministic results.');
 return [...new Set(failures)];
}
export function validateScoreManifest(manifest,context){
 const failures=[];
 if(!exact(manifest,['runId','draftSha256','sourceSnapshotSha256','policySha256','checks'])||manifest.runId!==context.runId||manifest.draftSha256!==context.draftSha256||manifest.sourceSnapshotSha256!==context.sourceSnapshotSha256||manifest.policySha256!==context.scoringPolicy.policySha256)failures.push('Independent score manifest does not bind the frozen draft, fresh sources and policy.');
 if(!Array.isArray(manifest?.checks)||manifest.checks.length!==context.posts.length||new Set(manifest.checks.map(check=>check?.postId)).size!==manifest.checks.length)failures.push('Independent score manifest omitted or repeated an original post.');
 for(const check of manifest?.checks||[]){
  const trusted=context.posts.find(post=>post.postId===check?.postId);
  if(!exact(check,['postId','postContentSha256','draftSha256','sourceSnapshotSha256','pass','reasons','scoreChecks'])||!trusted||check.postContentSha256!==trusted.postContentSha256||check.draftSha256!==trusted.draftSha256||check.sourceSnapshotSha256!==trusted.sourceSnapshotSha256||typeof check.pass!=='boolean'||!Array.isArray(check.reasons)||check.reasons.length>10||check.reasons.some(reason=>typeof reason!=='string'||!reason.trim()||reason.length>600)||check.pass&&check.reasons.length)failures.push('Independent per-post score decision changed its bound assessment.');
 }
 return [...new Set(failures)];
}
export function assessedSidecar(original,rating,check,context,input,{checkedAt=new Date().toISOString()}={}){
 const sources=context.sources.filter(source=>original.sources.some(attached=>attached.id===source.id));
 const sidecar={schema:1,postId:original.id,postContentSha256:original.contentSha256,criteria:rating.criteria,assessmentPolicy:context.scoringPolicy,draftSha256:fingerprint(scoreDraft(original.id,original.contentSha256,rating.criteria)),sourceSnapshotSha256:fingerprint(sources),checkedAt,checkerRunId:`${input.runId}-independent-check`,checker:{passed:true,postId:original.id,postContentSha256:original.contentSha256,draftSha256:check.draftSha256,sourceSnapshotSha256:check.sourceSnapshotSha256,policySha256:context.scoringPolicy.policySha256,scoreChecks:check.scoreChecks},sources,batch:{runId:input.runId,draftSha256:context.draftSha256,contextSha256:fingerprint(context),rulesSha256:input.rulesSha256,rulesCommit:input.rulesCommit,githubRunUrl:`https://github.com/xndanius/while-you-sleep/actions/runs/${input.runId.match(/^score-(\d+)-\d+$/)[1]}`},origin:'github-actions-codex-scorer'};
 const failures=validateScoreSidecar(original,sidecar);if(failures.length)throw new Error(failures.join(' '));return sidecar;
}
export function scoreDecisions(input,draft,context,manifest){
 return input.posts.map(original=>{
  const rating=draft.posts.find(post=>post.postId===original.id),check=manifest.checks.find(value=>value.postId===original.id),trusted=context.posts.find(value=>value.postId===original.id),sources=context.sources.filter(source=>original.sources.some(attached=>attached.id===source.id));
  const failures=[...(trusted?.deterministicReasons||['No deterministic score context.']),...checkScoringApproval(rating.criteria,check?.scoreChecks,sources,{sourceIds:original.sources.map(source=>source.id)})];
  if(check?.pass!==true)failures.push(...(check?.reasons?.length?check.reasons:['Independent checker rejected this historical assessment.']));
  return {postId:original.id,pass:failures.length===0,reasons:[...new Set(failures)],rating,check};
 });
}
