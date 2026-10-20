import { readJSON,dataPath } from '../lib/storage.mjs';
import {checkApproval,completedAssessmentReasons} from '../lib/validation.mjs';
import {isOmittedCandidateRepair,validateOmittedCandidateRepair} from '../lib/omitted-candidate-repair.mjs';
import {appendFile} from 'node:fs/promises';
const runId=process.argv[2];
const draft=await readJSON(dataPath('drafts',runId));const context=await readJSON(dataPath('check-context',runId));const manifest=await readJSON(dataPath('checks',runId));
if(isOmittedCandidateRepair(manifest)){
 validateOmittedCandidateRepair(manifest,draft,context,{allowInitial:process.env.CHECKER_PHASE==='initial',expectedFeedbackSha256:process.env.EXPECTED_REPAIR_FEEDBACK_SHA,requireFeedbackSha256:true});
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'repair=true\npassed=0\n');
 console.log(JSON.stringify({runId,passed:0,repair:true,kind:'omitted_candidate',productUrl:manifest.omission.productUrl}));process.exit(0);
}
const incomplete=completedAssessmentReasons(draft,context,manifest);
if(incomplete.length)throw new Error(incomplete.join(' '));
const results=checkApproval(draft,context,manifest);
const count=results.filter(x=>x.pass).length;const target=Number.isInteger(draft.targetCount)&&draft.targetCount>=1&&draft.targetCount<=6?draft.targetCount:1;
// A quota shortfall or a valid below-threshold score does not need a rewrite.
const repair=context.assessmentContractVersion===1?results.some(result=>!result.pass):count<target;
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`repair=${repair}\npassed=${count}\n`);
console.log(JSON.stringify({runId,passed:count,target,repair,rejected:results.filter(x=>!x.pass).map(({postId,reasons})=>({postId,reasons}))}));
