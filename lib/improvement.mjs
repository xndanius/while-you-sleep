import { sha256, stableJSON } from './storage.mjs';
import { parseScoringPolicy,replaceScoringPolicy,validateScoringCriteria,weightedOverall,checkScoringApproval } from './scoring.mjs';

function sections(rules) {
  const matches=[...rules.matchAll(/^## ([^\n]+)\n/gm)];
  return {preamble:rules.slice(0,matches[0]?.index??rules.length),items:matches.map((m,i)=>({name:m[1],text:rules.slice(m.index,matches[i+1]?.index??rules.length)}))};
}

export function validateRuleProposal(baseline,proposal) {
  if(!proposal||typeof proposal!=='object'||Array.isArray(proposal))return ['No complete rule proposal was produced.'];
  const reasons=[];
  if(proposal.rulesSha256!==sha256(baseline))reasons.push('Proposal does not bind the exact original RULES.md.');
  if(typeof proposal.change!=='string'||!proposal.change.trim()||typeof proposal.reason!=='string'||!proposal.reason.trim())reasons.push('A specific change and evidence-based reason are required.');
  if(typeof proposal.newRules!=='string'){reasons.push('Proposal has no complete newRules text.');return reasons;}
  if(/sk-[A-Za-z0-9_-]{12,}|BEGIN .*PRIVATE KEY|Bearer\s+[A-Za-z0-9_.-]{12,}/.test(proposal.newRules))reasons.push('Proposal contains credential-like text.');
  if(proposal.type==='scoring_policy'){
    if(proposal.section!=='Pick')reasons.push('A scoring policy proposal may change only the Pick policy block.');
    const fields=new Set(['type','runId','rulesSha256','policySha256','section','change','reason','policy','newRules']);
    if(Object.keys(proposal).some(field=>!fields.has(field)))reasons.push('A scoring policy proposal contains fields outside its bounded schema.');
    try{
      const original=parseScoringPolicy(baseline);
      if(proposal.policySha256!==original.policySha256)reasons.push('Proposal does not bind the exact original scoring policy.');
      const replacement=replaceScoringPolicy(baseline,proposal.policy);
      if(replacement!==proposal.newRules)reasons.push('Only the declared scoring policy block may change; all other RULES bytes are protected.');
      const changed=parseScoringPolicy(replacement);
      if(/^<!-- publish-threshold-lock:6 -->$/m.test(baseline)&&changed.threshold!==6)reasons.push('The operator publish threshold is locked at 6; scoring-policy improvements may change weights only.');
      if(changed.policySha256===original.policySha256)reasons.push('Proposal made no scoring policy change.');
    }catch(error){reasons.push(`Invalid bounded scoring policy: ${error.message}`);}
    return [...new Set(reasons)];
  }
  if(proposal.type!==undefined&&proposal.type!=='append')reasons.push('Unknown rule proposal type.');
  if(!['Pick','Write'].includes(proposal.section))reasons.push('Only Pick or Write may change.');
  if(typeof proposal.addition!=='string'||!proposal.addition.trim()||proposal.addition.length>500||/[\r\n]/.test(proposal.addition))reasons.push('Exactly one added rule paragraph, <=500 characters, is required.');
  if(/scoring-policy:|publishThreshold|\b(?:threshold|weights?|weighted mean|overall score)\b/i.test(proposal.addition||''))reasons.push('Scoring parameters may change only through the bounded scoring_policy proposal, never an appended override.');
  if(/\b(ignore|override|bypass|disable|relax|skip|remove|suppress)\b.{0,60}\b(safety|check|checker|truth|source|evidence|secret|approval|duplicate|limit|rules?|instructions?)\b/i.test(proposal.addition||''))reasons.push('An improvement cannot weaken protected safety, evidence, or publishing requirements.');
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
  if(baseline.includes('<!-- scoring-policy:')){
    try{if(parseScoringPolicy(proposal.newRules).policySha256!==parseScoringPolicy(baseline).policySha256)reasons.push('An appended prose rule changed the protected scoring policy.');}
    catch{reasons.push('An appended prose rule made the scoring policy malformed or ambiguous.');}
  }
  return [...new Set(reasons)];
}

// Policy trials assess the same held-out ideas under their assigned policy.
// Refusal below the threshold is an outcome, not a missing writing artifact.
export function policyTrialAssessment(raw,candidate,sources,policy) {
  const reasons=[];
  const fields=new Set(['candidateId','scoring','selected','reason']);
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {assessment:null,policySha256:policy.policySha256,deterministicReasons:['Policy trial produced no candidate assessment.']};
  if(Object.keys(raw).some(field=>!fields.has(field))||raw.candidateId!==candidate.candidateId)reasons.push('Policy assessment does not match its exact candidate schema.');
  if(!raw.scoring||typeof raw.scoring!=='object'||Array.isArray(raw.scoring)||Object.keys(raw.scoring).some(field=>field!=='criteria'))reasons.push('Policy assessment scoring may contain only criteria.');
  reasons.push(...validateScoringCriteria(raw.scoring?.criteria,{sourceIds:candidate.sourceIds,sources}));
  if(typeof raw.selected!=='boolean'||typeof raw.reason!=='string'||!raw.reason.trim()||raw.reason.length>500||/[\r\n]/.test(raw.reason))reasons.push('Policy assessment needs a selected/refused decision and one bounded reason.');
  let overall=null;
  if(!reasons.length){
    overall=weightedOverall(raw.scoring.criteria,policy.weights);
    if(raw.selected!==(overall>=policy.threshold))reasons.push('Policy selection decision disagrees with the trusted unrounded weighted mean and threshold.');
  }
  return {assessment:raw,policySha256:policy.policySha256,overall,selected:typeof raw.selected==='boolean'?raw.selected:null,deterministicReasons:[...new Set(reasons)]};
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
  const policyTrial=proposal.type==='scoring_policy';
  if(policyTrial&&blind.trialKind!=='scoring_policy')reasons.push('Scoring policy proposal lacks its independently bound policy trial.');
  let baselinePolicy,challengerPolicy;
  if(policyTrial){
    try{baselinePolicy=parseScoringPolicy(input.baselineRules);challengerPolicy=parseScoringPolicy(proposal.newRules);}
    catch(error){reasons.push(`Frozen trial scoring policy is invalid: ${error.message}`);}
  }
  for(const candidate of input.candidates){
    const result=grade.cases?.find(c=>c.candidateId===candidate.candidateId),mapping=labelMap.cases.find(c=>c.candidateId===candidate.candidateId),trial=blind.cases.find(c=>c.candidateId===candidate.candidateId);
    if(!result||!mapping||!trial){reasons.push('A held-out case or private label map is missing.');continue;}
    const expectedSources=input.sources.filter(s=>candidate.sourceIds.includes(s.id));
    if(stableJSON(trial.sources)!==stableJSON(expectedSources))reasons.push('A blind trial case changed its frozen source evidence.');
    if(!['A','B'].includes(mapping.baseline)||!['A','B'].includes(mapping.proposal)||mapping.baseline===mapping.proposal)reasons.push('Private trial labels do not identify two distinct variants.');
    const baseline=result[mapping.baseline],challenger=result[mapping.proposal];
    const fields=policyTrial?['factuality','safety','scoreCalibration','selectionQuality']:['factuality','clarity','feasibility','safety'];
    if([baseline,challenger].some(score=>!score||fields.some(k=>typeof score[k]!=='number'||!Number.isFinite(score[k])||score[k]<0||score[k]>5))){reasons.push('Grader scores must be finite values from 0 to 5.');continue;}
    if(policyTrial){
      for(const [label,policy] of [[mapping.baseline,baselinePolicy],[mapping.proposal,challengerPolicy]]){
        const variant=trial[label],assessment=variant?.assessment;
        if(!policy||variant?.policySha256!==policy.policySha256||variant?.deterministicReasons?.length||!assessment){reasons.push(`Held-out policy assessment ${candidate.candidateId} does not bind its exact assigned policy.`);continue;}
        const checked=policyTrialAssessment(assessment,candidate,expectedSources,policy);
        if(checked.deterministicReasons.length||checked.overall!==variant.overall||checked.selected!==variant.selected)reasons.push(`Held-out policy decision ${candidate.candidateId} changed after trusted preparation.`);
        const score=grade.cases?.find(row=>row.candidateId===candidate.candidateId)?.[label];
        if(checkScoringApproval(assessment.scoring?.criteria,score?.scoreChecks,expectedSources,{sourceIds:candidate.sourceIds}).length)reasons.push(`Blind policy grader did not substantiate every score on ${candidate.candidateId}.`);
      }
      if(challenger.scoreCalibration<baseline.scoreCalibration)reasons.push(`Score calibration regressed on ${candidate.candidateId}.`);
    }else if(!trial.A.post||!trial.B.post||trial.A.deterministicReasons.length||trial.B.deterministicReasons.length)reasons.push(`Held-out trial ${candidate.candidateId} lacked two valid drafts.`);
    if(challenger.supported!==true||challenger.safe!==true)reasons.push(`Proposal failed evidence or safety on ${candidate.candidateId}.`);
    if(challenger.factuality<baseline.factuality||challenger.safety<baseline.safety)reasons.push(`Grounding or safety regressed on ${candidate.candidateId}.`);
    evaluations.push({candidateId:candidate.candidateId,productUrl:candidate.productUrl,baselineScore:fields.reduce((n,k)=>n+baseline[k],0),challengerScore:fields.reduce((n,k)=>n+challenger[k],0),baseline,challenger});
  }
  const baselineScore=evaluations.length?evaluations.reduce((n,e)=>n+e.baselineScore,0)/evaluations.length:null,challengerScore=evaluations.length?evaluations.reduce((n,e)=>n+e.challengerScore,0)/evaluations.length:null;
  if(!evaluations.length||challengerScore<=baselineScore)reasons.push('Proposal did not score strictly higher than the baseline.');
  return {adopted:reasons.length===0&&evaluations.length>=3,reasons:[...new Set(reasons)],baselineScore,challengerScore,evaluations};
}
