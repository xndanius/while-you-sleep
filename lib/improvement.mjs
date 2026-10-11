import { sha256, stableJSON } from './storage.mjs';

function sections(rules) {
  const matches=[...rules.matchAll(/^## ([^\n]+)\n/gm)];
  return {preamble:rules.slice(0,matches[0]?.index??rules.length),items:matches.map((m,i)=>({name:m[1],text:rules.slice(m.index,matches[i+1]?.index??rules.length)}))};
}

export function validateRuleProposal(baseline,proposal) {
  if(!proposal||typeof proposal!=='object'||Array.isArray(proposal))return ['No complete rule proposal was produced.'];
  const reasons=[];
  if(proposal.rulesSha256!==sha256(baseline))reasons.push('Proposal does not bind the exact original RULES.md.');
  if(!['Pick','Write'].includes(proposal.section))reasons.push('Only Pick or Write may change.');
  if(typeof proposal.change!=='string'||!proposal.change.trim()||typeof proposal.reason!=='string'||!proposal.reason.trim())reasons.push('A specific change and evidence-based reason are required.');
  if(typeof proposal.addition!=='string'||!proposal.addition.trim()||proposal.addition.length>500||/[\r\n]/.test(proposal.addition))reasons.push('Exactly one added rule paragraph, <=500 characters, is required.');
  if(/\b(ignore|override|bypass|disable|relax|skip|remove|suppress)\b.{0,60}\b(safety|check|checker|truth|source|evidence|secret|approval|duplicate|limit|rules?|instructions?)\b/i.test(proposal.addition||''))reasons.push('An improvement cannot weaken protected safety, evidence, or publishing requirements.');
  if(typeof proposal.newRules!=='string'){reasons.push('Proposal has no complete newRules text.');return reasons;}
  if(/sk-[A-Za-z0-9_-]{12,}|BEGIN .*PRIVATE KEY|Bearer\s+[A-Za-z0-9_.-]{12,}/.test(proposal.newRules))reasons.push('Proposal contains credential-like text.');
  const old=sections(baseline),next=sections(proposal.newRules);
  if(old.preamble!==next.preamble||old.items.length!==next.items.length||old.items.some((s,i)=>s.name!==next.items[i]?.name))reasons.push('The rule preamble and section structure must remain exactly preserved.');
  for(let i=0;i<old.items.length;i++){
    const before=old.items[i],after=next.items[i];
    if(!after)continue;
    if(before.name!==proposal.section){if(before.text!==after.text)reasons.push(`Protected section ${before.name} changed.`);}
    else{
      const expected=before.text.trimEnd()+'\n\n'+String(proposal.addition).trim()+'\n\n';
      // A final section may have a single terminal newline; both are explicit.
      const terminal=before.text.trimEnd()+'\n\n'+String(proposal.addition).trim()+'\n';
      if(after.text!==expected&&!(i===old.items.length-1&&after.text===terminal))reasons.push('Current rules must remain verbatim; only the declared paragraph may be appended.');
    }
  }
  if(proposal.newRules===baseline)reasons.push('Proposal made no rule change.');
  return [...new Set(reasons)];
}

export function evaluateImprovement(input,proposal,labelMap,blind,grade) {
  const reasons=validateRuleProposal(input.baselineRules,proposal),evaluations=[];
  if(input.rulesSha256!==sha256(input.baselineRules))reasons.push('Frozen baseline hash is invalid.');
  if(input.sourceSnapshotSha256!==sha256(stableJSON(input.sources)))reasons.push('Frozen evidence hash is invalid.');
  if(labelMap.proposalSha256!==sha256(stableJSON(proposal)))reasons.push('Trial labels do not bind this exact proposal.');
  if(blind.trialsSha256!==sha256(stableJSON(blind.cases)))reasons.push('Blind trials changed after preparation.');
  if(blind.sourceSnapshotSha256!==input.sourceSnapshotSha256)reasons.push('Blind trial evidence does not bind the frozen source snapshot.');
  if(grade.runId!==input.runId||grade.trialsSha256!==blind.trialsSha256||grade.sourceSnapshotSha256!==input.sourceSnapshotSha256)reasons.push('Separate grader does not bind these exact blind trials and sources.');
  if(!Array.isArray(grade.cases)||grade.cases.length!==input.candidates.length||input.candidates.length<3)reasons.push('At least three complete held-out cases must be graded.');
  if(new Set((grade.cases||[]).map(c=>c.candidateId)).size!==(grade.cases||[]).length)reasons.push('Grader repeated a candidate.');
  for(const candidate of input.candidates){
    const result=grade.cases?.find(c=>c.candidateId===candidate.candidateId),mapping=labelMap.cases.find(c=>c.candidateId===candidate.candidateId),trial=blind.cases.find(c=>c.candidateId===candidate.candidateId);
    if(!result||!mapping||!trial){reasons.push('A held-out case or private label map is missing.');continue;}
    const expectedSources=input.sources.filter(s=>candidate.sourceIds.includes(s.id));
    if(stableJSON(trial.sources)!==stableJSON(expectedSources))reasons.push('A blind trial case changed its frozen source evidence.');
    if(!['A','B'].includes(mapping.baseline)||!['A','B'].includes(mapping.proposal)||mapping.baseline===mapping.proposal)reasons.push('Private trial labels do not identify two distinct variants.');
    const baseline=result[mapping.baseline],challenger=result[mapping.proposal];
    const fields=['factuality','clarity','feasibility','safety'];
    if([baseline,challenger].some(score=>!score||fields.some(k=>typeof score[k]!=='number'||!Number.isFinite(score[k])||score[k]<0||score[k]>5))){reasons.push('Grader scores must be finite values from 0 to 5.');continue;}
    if(!trial.A.post||!trial.B.post||trial.A.deterministicReasons.length||trial.B.deterministicReasons.length)reasons.push(`Held-out trial ${candidate.candidateId} lacked two valid drafts.`);
    if(challenger.supported!==true||challenger.safe!==true)reasons.push(`Proposal failed evidence or safety on ${candidate.candidateId}.`);
    if(challenger.factuality<baseline.factuality||challenger.safety<baseline.safety)reasons.push(`Grounding or safety regressed on ${candidate.candidateId}.`);
    evaluations.push({candidateId:candidate.candidateId,productUrl:candidate.productUrl,baselineScore:fields.reduce((n,k)=>n+baseline[k],0),challengerScore:fields.reduce((n,k)=>n+challenger[k],0),baseline,challenger});
  }
  const baselineScore=evaluations.length?evaluations.reduce((n,e)=>n+e.baselineScore,0)/evaluations.length:null,challengerScore=evaluations.length?evaluations.reduce((n,e)=>n+e.challengerScore,0)/evaluations.length:null;
  if(!evaluations.length||challengerScore<=baselineScore)reasons.push('Proposal did not score strictly higher than the baseline.');
  return {adopted:reasons.length===0&&evaluations.length>=3,reasons:[...new Set(reasons)],baselineScore,challengerScore,evaluations};
}
