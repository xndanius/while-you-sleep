import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ROOT,dataPath,readJSON,writeJSON,sha256,safeError } from '../lib/storage.mjs';
import { evaluateImprovement } from '../lib/improvement.mjs';
import { proposalTrialReadiness,isCompletedProposalRejection } from '../lib/improvement-runtime.mjs';
import { trustedScheduledMetadata } from './prepare-scheduled-job.mjs';
import {codeFreezeActive} from '../lib/code-freeze.mjs';

const runId=process.argv[2];
let decision={adopted:false,reasons:[],baselineScore:null,challengerScore:null,evaluations:[]},input,proposal,grade,completedProposalRejection=false;
try{
  input=await readJSON(dataPath('improvements',runId+'-input'));
  proposal=await readJSON(dataPath('improvements',runId));
  const validation=proposalTrialReadiness(input,proposal,{expectedInputSha256:process.env.EXPECTED_INPUT_SHA256});
  if(validation.status==='rejected'){
    decision.reasons=validation.reasons;
    let recordedValidation,stages;
    try{recordedValidation=await readJSON(dataPath('improvements',runId+'-validation'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(process.env.IMPROVEMENT_STAGE_RESULTS){try{stages=JSON.parse(process.env.IMPROVEMENT_STAGE_RESULTS);}catch{stages={};}}
    completedProposalRejection=isCompletedProposalRejection(input,proposal,recordedValidation,stages);
  }else{
    const labels=await readJSON(dataPath('improvements',runId+'-labels')),blind=await readJSON(dataPath('improvements',runId+'-blind'));grade=await readJSON(dataPath('improvements',runId+'-grade'));
    const current=await fs.readFile(path.join(ROOT,'RULES.md'),'utf8');
    decision=evaluateImprovement(input,proposal,labels,blind,grade);
    if(sha256(current)!==input.rulesSha256){decision.adopted=false;decision.reasons.push('RULES.md changed while the improvement trial was running; refusing a stale overwrite.');}
    if(decision.adopted&&codeFreezeActive()){decision.adopted=false;decision.reasons.push('Code and RULES are frozen until Tuesday 13 October 15:00 Vilnius; the evaluated proposal was not adopted.');}
    if(decision.adopted)await fs.writeFile(path.join(ROOT,'RULES.md'),proposal.newRules);
  }
}catch(error){decision.adopted=false;decision.reasons.push(safeError(error));}
try{
  const record={id:runId,createdAt:new Date().toISOString(),startedAt:input?.createdAt||null,status:decision.adopted?'adopted':'rejected',change:proposal?.change||'Improvement trial could not complete',reason:!decision.adopted&&decision.reasons.length?decision.reasons.join(' '):proposal?.reason||'No complete model proposal or independent evaluation was available.',proposalReason:proposal?.reason||null,section:proposal?.section||null,parentRulesSha256:input?.rulesSha256||null,newRulesSha256:decision.adopted?sha256(proposal.newRules):input?.rulesSha256||null,...decision,githubRunUrl:input?.githubRunUrl||null,...trustedScheduledMetadata('improve'),scheduleStatus:completedProposalRejection||(grade?.status!=='unavailable'&&decision.evaluations.length>=3)?'completed':'failed',evaluationStatus:completedProposalRejection?'proposal_rejected':decision.evaluations.length>=3?'evaluated':'unavailable',usage:{inputTokens:null,outputTokens:null,costUsd:null},measurementCaveat:'Observed measurements propose a hypothesis; blinded held-out grading gates rule adoption. No causal engagement lift is claimed.'};
  await writeJSON(dataPath('versions',runId),record,{immutable:true});
  const score=typeof decision.baselineScore==='number'?`baseline ${decision.baselineScore.toFixed(2)} / proposal ${decision.challengerScore.toFixed(2)}`:completedProposalRejection?'not run: proposal failed deterministic validation':'evaluation unavailable';
  const message=`${decision.adopted?'Improve':'Reject improvement'}: ${record.change.slice(0,100)}\n\nReason: ${record.reason}\nHeld-out test: ${score}; ${decision.evaluations.length} cases.\n${decision.reasons.join('\n')}\nCloud run: ${input?.githubRunUrl||runId}\n`;
  await fs.mkdir(path.join(ROOT,'.run'),{recursive:true});
  await fs.writeFile(path.join(ROOT,'.run','improvement-commit-message.txt'),message);
  if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,`adopted=${decision.adopted}\n`);
  console.log(JSON.stringify({runId,status:record.status,baselineScore:decision.baselineScore,challengerScore:decision.challengerScore,reasons:decision.reasons}));
}catch(error){console.error(safeError(error));process.exitCode=1;}
