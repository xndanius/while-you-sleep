import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ROOT,dataPath,readJSON,writeJSON,sha256,safeError } from '../lib/storage.mjs';
import { evaluateImprovement } from '../lib/improvement.mjs';

const runId=process.argv[2];
let decision={adopted:false,reasons:[],baselineScore:null,challengerScore:null,evaluations:[]},input,proposal;
try{
  input=await readJSON(dataPath('improvements',runId+'-input'));
  proposal=await readJSON(dataPath('improvements',runId));
  const labels=await readJSON(dataPath('improvements',runId+'-labels')),blind=await readJSON(dataPath('improvements',runId+'-blind')),grade=await readJSON(dataPath('improvements',runId+'-grade'));
  const current=await fs.readFile(path.join(ROOT,'RULES.md'),'utf8');
  decision=evaluateImprovement(input,proposal,labels,blind,grade);
  if(sha256(current)!==input.rulesSha256){decision.adopted=false;decision.reasons.push('RULES.md changed while the improvement trial was running; refusing a stale overwrite.');}
  if(decision.adopted)await fs.writeFile(path.join(ROOT,'RULES.md'),proposal.newRules);
}catch(error){decision.adopted=false;decision.reasons.push(safeError(error));}
try{
  const record={id:runId,createdAt:new Date().toISOString(),status:decision.adopted?'adopted':'rejected',change:proposal?.change||'Improvement trial could not complete',reason:proposal?.reason||'No complete model proposal or independent evaluation was available.',section:proposal?.section||null,parentRulesSha256:input?.rulesSha256||null,newRulesSha256:decision.adopted?sha256(proposal.newRules):input?.rulesSha256||null,...decision,githubRunUrl:input?.githubRunUrl||null,usage:{inputTokens:null,outputTokens:null,costUsd:null},measurementCaveat:'Observed measurements propose a hypothesis; blinded held-out grading gates rule adoption. No causal engagement lift is claimed.'};
  await writeJSON(dataPath('versions',runId),record,{immutable:true});
  const score=typeof decision.baselineScore==='number'?`baseline ${decision.baselineScore.toFixed(2)} / proposal ${decision.challengerScore.toFixed(2)}`:'evaluation unavailable';
  const message=`${decision.adopted?'Improve':'Reject improvement'}: ${record.change.slice(0,100)}\n\nReason: ${record.reason}\nHeld-out test: ${score}; ${decision.evaluations.length} cases.\n${decision.reasons.join('\n')}\nCloud run: ${input?.githubRunUrl||runId}\n`;
  await fs.mkdir(path.join(ROOT,'.run'),{recursive:true});
  await fs.writeFile(path.join(ROOT,'.run','improvement-commit-message.txt'),message);
  if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,`adopted=${decision.adopted}\n`);
  console.log(JSON.stringify({runId,status:record.status,baselineScore:decision.baselineScore,challengerScore:decision.challengerScore,reasons:decision.reasons}));
}catch(error){console.error(safeError(error));process.exitCode=1;}
