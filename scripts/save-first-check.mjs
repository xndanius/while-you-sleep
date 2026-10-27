import {copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,dataPath,readJSON,writeJSON,sha256,stableJSON} from '../lib/storage.mjs';
import {checkApproval} from '../lib/validation.mjs';
import {plainText} from '../lib/research.mjs';
import {sourceQuoteOccurs} from '../lib/evidence-contract.mjs';
import {isOmittedCandidateRepair,validateOmittedCandidateRepair} from '../lib/omitted-candidate-repair.mjs';

export function repairFeedback(draft,context,manifest,{expectedDraftSha256,expectedContextSha256,expectedFeedbackSha256}={}) {
  if(isOmittedCandidateRepair(manifest)||expectedFeedbackSha256){
    validateOmittedCandidateRepair(manifest,draft,context,{allowInitial:true,expectedDraftSha256,expectedContextSha256,expectedFeedbackSha256,requireFeedbackSha256:true});
    return {runId:draft.runId,kind:'omitted_candidate',draftSha256:context.draftSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,initialFeedbackSha256:sha256(stableJSON(manifest)),approvedPostIds:[],repairPostIds:[],decisions:[],omittedCandidate:manifest.omission};
  }
  const results=checkApproval(draft,context,manifest);
  return {
    runId:draft.runId,draftSha256:context.draftSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,
    approvedPostIds:results.filter(result=>result.pass).map(result=>result.postId),
    repairPostIds:results.filter(result=>!result.pass).map(result=>result.postId),
    decisions:results.map(result=>({postId:result.postId,passed:result.pass,checkerPass:result.check?.pass===true,reasons:result.reasons,
      quoteIssues:[...(result.check?.claimChecks||[]),...(result.check?.scoreChecks||[])].flatMap(claim=>{
        const source=context.sources.find(source=>source.id===claim.sourceId);
        const quote=typeof claim.evidenceQuote==='string'?plainText(claim.evidenceQuote):'';
        const occurs=sourceQuoteOccurs(source,claim.evidenceQuote,claim.criterion?{}:{normalize:value=>plainText(value).toLowerCase()});
        return !source||quote.length<12||!occurs
          ? [{...(claim.criterion?{criterion:claim.criterion}:{claim:claim.claim}),sourceId:claim.sourceId,evidenceQuote:claim.evidenceQuote,reason:'This quote is missing, too short, or is not a contiguous substring of its verified source. Copy a literal source span; do not paraphrase.'}] : [];
      }),scoreIssues:(result.check?.scoreChecks||[]).filter(check=>check.supported!==true||draft.posts.find(post=>post.id===result.postId)?.scoring?.criteria?.[check.criterion]?.value>check.maxSupportedScore)
        .map(check=>({criterion:check.criterion,maxSupportedScore:check.maxSupportedScore,reason:check.reason}))})),
  };
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const runId=process.argv[2];
  const [draft,context,manifest]=await Promise.all(['drafts','check-context','checks'].map(directory=>readJSON(dataPath(directory,runId))));
  const feedback=repairFeedback(draft,context,manifest,{expectedDraftSha256:process.env.EXPECTED_FIRST_DRAFT_SHA,expectedContextSha256:process.env.EXPECTED_FIRST_CONTEXT_SHA,expectedFeedbackSha256:process.env.EXPECTED_REPAIR_FEEDBACK_SHA});
  for(const directory of ['drafts','checks','check-context'])await copyFile(dataPath(directory,runId),dataPath(directory,`${runId}-first`));
  await writeJSON(path.join(ROOT,'.run','repair-feedback.json'),feedback);
  draft.repairAttempt=1;await writeJSON(dataPath('drafts',runId),draft);
  console.log(JSON.stringify({runId,approved:feedback.approvedPostIds.length,repair:feedback.repairPostIds.length,omittedCandidate:feedback.kind==='omitted_candidate'}));
}
