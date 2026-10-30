import {sha256,stableJSON} from './storage.mjs';
import {parseScoringPolicy,SCORING_KEYS,validateScoringCriteria,weightedOverall,publishedScoring} from './scoring.mjs';
import {checkApproval,completedAssessmentReasons,deterministicCheck,frozenScoringPolicyReasons} from './validation.mjs';
import {createNoveltyContext} from './novelty.mjs';
import {privateArtifactCategories} from './privacy.mjs';
import {WEBSITE_ONLY,websiteOnly} from './publication-distribution.mjs';
import {assistantCheckerId,assistantProvenanceReasons} from './assistant-identity.mjs';
export {assistantCheckerId,assistantProvenanceReasons} from './assistant-identity.mjs';

const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;

export function assistantBindings({draft,context,manifest,research,rules,writer,checker}){
 return {researchSha256:sha256(stableJSON(research)),draftSha256:sha256(stableJSON(draft)),contextSha256:sha256(stableJSON(context)),sourceSnapshotSha256:sha256(stableJSON(context.sources)),rulesSha256:sha256(rules),policySha256:context.scoringPolicy?.policySha256,manifestSha256:sha256(stableJSON(manifest)),writerReceiptSha256:sha256(stableJSON(writer)),checkerReceiptSha256:sha256(stableJSON(checker))};
}

export function validateAssistantExecution(record,inputs,{expectedSha256,previous=[],now=new Date()}={}){
 const reasons=assistantProvenanceReasons(record);
 if(reasons.length)throw new Error(reasons.join(' '));
 if(!hex(expectedSha256)||sha256(stableJSON(record))!==expectedSha256)throw new Error('The host-pinned assistant execution fingerprint is missing or changed.');
 const {draft,context,manifest,research,rules}=inputs;
 if(record.runId!==draft.runId||record.runId!==context.runId||record.runId!==research.runId)throw new Error('Assistant artifacts have different run identities.');
 const actual=assistantBindings({...inputs,writer:record.writer,checker:record.checker});
 if(stableJSON(record.bindings)!==stableJSON(actual)||context.draftSha256!==actual.draftSha256||context.sourceSnapshotSha256!==actual.sourceSnapshotSha256)throw new Error('Assistant artifacts changed after independent checking.');
 if(stableJSON(record.checks)!==stableJSON(checkDigests(manifest,draft)))throw new Error('Assistant post decisions changed after independent checking.');
 const at=new Date(now).getTime(),created=Date.parse(context.createdAt);
 if(!Number.isFinite(at)||!stamp(context.createdAt)||!stamp(research.createdAt)||Date.parse(research.createdAt)>Date.parse(record.writer.startedAt)||created<Date.parse(record.writer.completedAt)||created>Date.parse(record.checker.startedAt)||at<Date.parse(record.registeredAt)||at-created>3*3600000)throw new Error('Assistant evidence or runtime timestamps are stale, future or out of order.');
 if(!Array.isArray(research.sources)||research.sources.some(source=>!stamp(source.fetchedAt)||Date.parse(source.fetchedAt)>Date.parse(record.writer.startedAt))||context.sources.some(source=>!stamp(source.verifiedAt)||Date.parse(source.verifiedAt)>created||at-Date.parse(source.verifiedAt)>3*3600000))throw new Error('Assistant source retrieval timestamps are stale, future or after their reader.');
 if(context.assessmentContractVersion!==1||context.noveltyContractVersion!==1||context.demandContractVersion!==1||context.candidateScoringVersion!==1)throw new Error('Assistant checks require current assessment, candidate, demand and novelty contracts.');
 const policy=parseScoringPolicy(rules);
 if(policy.threshold!==6||SCORING_KEYS.some(key=>policy.weights[key]!==1)||stableJSON(policy)!==stableJSON(context.scoringPolicy))throw new Error('Assistant publication retains the six-point threshold and five equal weights.');
 const novelty=createNoveltyContext(previous,{now:context.noveltyContext?.asOf});
 if(stableJSON(novelty)!==stableJSON(context.noveltyContext))throw new Error('Assistant checker did not receive the complete current novelty index.');
 // Runtime IDs have a strict opaque syntax above; numeric UUID components
 // are not telephone evidence. Apply content privacy checks to source data.
 if(privateArtifactCategories({draft,context,research,manifest}).length)throw new Error('Assistant artifacts contain private data.');
 const failures=[...frozenScoringPolicyReasons(context,{expectedRulesSha256:actual.rulesSha256}),...completedAssessmentReasons(draft,context,manifest),...draft.posts.flatMap(post=>validateScoringCriteria(post.scoring?.criteria,{sourceIds:post.sourceIds,sources:context.sources}))];
 if(failures.length)throw new Error([...new Set(failures)].join(' '));
 // Recompute deterministic checks against current publications. A valid
 // rejection remains a recorded rejection; registration never promotes it.
 return checkApproval(draft,context,manifest).map(result=>{
  const post=draft.posts.find(post=>post.id===result.postId);
  const more=deterministicCheck(post,context.sources,previous,{scoringPolicy:policy,demandContext:context,demandRequired:true,noveltyNow:now});
  if(weightedOverall(post.scoring.criteria,policy.weights)<policy.threshold)more.push('Overall score is below the frozen publish threshold.');
  return {...result,pass:result.pass&&!more.length,reasons:[...new Set([...result.reasons,...more])]};
 });
}

export function createAssistantExecution(inputs,{writer,checker,expectedWriterReceiptSha256,expectedCheckerReceiptSha256,previous=[],now=new Date()}={}){
 if(!hex(expectedWriterReceiptSha256)||sha256(stableJSON(writer))!==expectedWriterReceiptSha256||!hex(expectedCheckerReceiptSha256)||sha256(stableJSON(checker))!==expectedCheckerReceiptSha256)throw new Error('Both runtime receipts need independent host-supplied fingerprints.');
 const record={schema:1,kind:'assistant-execution',runId:inputs.draft.runId,registeredAt:new Date(now).toISOString(),bindings:assistantBindings({...inputs,writer,checker}),writer,checker,checks:checkDigests(inputs.manifest,inputs.draft),distribution:{...WEBSITE_ONLY}};
 const decisions=validateAssistantExecution(record,inputs,{expectedSha256:sha256(stableJSON(record)),previous,now});
 return {record,decisions};
}
const draftFields=['id','candidateId','title','promise','whatItIs','whoPays','loop','evidence','uncertainty','first24Hours','productUrl','segment','demandEvidence'];
function draftPostHash(post){
 const projection=Object.fromEntries(draftFields.filter(key=>post[key]!==undefined).map(key=>[key,post[key]]));
 projection.sourceIds=[...(post.sourceIds||post.sources.map(source=>source.id))].sort();
 projection.scoring={criteria:post.scoring.criteria};
 return sha256(stableJSON(projection));
}
const checkDigests=(manifest,draft)=>(manifest.checks||[]).map(check=>({postId:check.postId,sha256:sha256(stableJSON(check)),draftPostSha256:draftPostHash(draft.posts.find(post=>post.id===check.postId))})).sort((a,b)=>a.postId.localeCompare(b.postId));

export function assistantPostReasons(post){
 const record=post?.assistantExecution,reasons=assistantProvenanceReasons(record);
 if(reasons.length)return reasons;
 if(post.origin!=='assistant-checked-publication'||!websiteOnly(post.distribution)||post.runId!==record.runId||post.rulesSha256!==record.bindings.rulesSha256||post.scoring?.policySha256!==record.bindings.policySha256||post.checker?.checkerRunId!==assistantCheckerId(record)||post.checker?.checkedAt!==record.checker.completedAt||post.checker?.draftSha256!==record.bindings.draftSha256||post.checker?.sourceSnapshotSha256!==record.bindings.sourceSnapshotSha256||post.checker?.manifestSha256!==record.bindings.manifestSha256)reasons.push('Published assistant identity, scope or checked fingerprints changed.');
 const check=post.checker?.approval;
 if(!check||check.postId!==post.id||check.pass!==true||sha256(stableJSON(check))!==record.checks.find(item=>item.postId===post.id)?.sha256||['claimChecks','scoreChecks','noveltyCheck','demandCheck'].some(key=>stableJSON(post.checker[key])!==stableJSON(check[key]))||sha256(stableJSON(post.checker.scoreSources))!==record.bindings.sourceSnapshotSha256)reasons.push('Published assistant check decisions or source evidence changed.');
 try{
  if(draftPostHash(post)!==record.checks.find(item=>item.postId===post.id)?.draftPostSha256||stableJSON(post.scoring)!==stableJSON(publishedScoring(post.scoring.criteria,post.checker.scoringPolicy,{checkedAt:record.checker.completedAt,checkerRunId:assistantCheckerId(record)})))reasons.push('Published assistant content or displayed scores differ from the approved draft.');
  const ids=new Set(post.sources.map(source=>source.id));
  const approvedSources=post.checker.scoreSources.filter(source=>ids.has(source.id)).map(({id,title,url,publisher,fetchedAt,verifiedAt,discussionMetadataVersion,community})=>({id,title,url,publisher,fetchedAt,verifiedAt,...(discussionMetadataVersion===1&&typeof community==='string'?{community}: {})}));
  if(ids.size!==post.sources.length||stableJSON(approvedSources)!==stableJSON(post.sources))reasons.push('Published source metadata differs from the independently checked source snapshot.');
 }catch{reasons.push('Published assistant content or scores are malformed.');}
 return reasons;
}
