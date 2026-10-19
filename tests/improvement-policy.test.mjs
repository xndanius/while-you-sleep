import test from 'node:test';
import assert from 'node:assert/strict';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {SCORING_KEYS,parseScoringPolicy,replaceScoringPolicy} from '../lib/scoring.mjs';
import {validateRuleProposal,policyTrialAssessment,evaluateImprovement} from '../lib/improvement.mjs';
import {makeProposerInput,proposalTrialReadiness,isCompletedProposalRejection} from '../lib/improvement-runtime.mjs';

const rules='# Rules\n\n## Pick\nEvidence, honest ratings and no duplicates.\n\n<!-- scoring-policy:start -->\n```json\n{"weights":{"ease":1,"profit":1,"feasibility":1,"autonomy":1,"evidence":1},"publishThreshold":6}\n```\n<!-- scoring-policy:end -->\n\n## Write\nPlain words and truthful claims.\n\n## Safety\nNo unsafe topics or secrets.\n';
const current=parseScoringPolicy(rules);
const source={id:'s',text:'This working product extracts receipt fields and exports reviewed records. A person checks extracted results before export. No customer or revenue figures are supplied.'};
const criteria=Object.fromEntries(SCORING_KEYS.map(key=>[key,{value:6,reason:key==='profit'?'Hypothesis: a small administration buyer could test this workflow.':'The source establishes a bounded extraction and review experiment.',sourceIds:['s']} ]));
const scoreChecks=SCORING_KEYS.map(criterion=>({criterion,supported:true,maxSupportedScore:6,reason:criterion==='profit'?'Hypothesis: a buyer is plausible but demand remains unproved.':'The source supports this bounded experiment and its review limits.',sourceId:'s',evidenceQuote:'extracts receipt fields and exports reviewed records'}));
const proposal={type:'scoring_policy',runId:'test-improve',rulesSha256:sha256(rules),policySha256:current.policySha256,section:'Pick',change:'Test a more selective publish threshold.',reason:'Test whether rejecting marginal ideas improves selection; traffic remains unavailable.',policy:{weights:current.weights,publishThreshold:7},newRules:replaceScoringPolicy(rules,{weights:current.weights,publishThreshold:7})};
test('the operator threshold lock rejects lower or higher thresholds as completed refusals while allowing weight trials',()=>{
 const locked='<!-- publish-threshold-lock:6 -->\n'+rules,input={runId:proposal.runId,baselineRules:locked,rulesSha256:sha256(locked),sources:[],sourceSnapshotSha256:sha256(stableJSON([])),candidates:[]},stages={seed:{result:'success'},propose:{result:'success'},'validate-proposal':{result:'success'}};
 for(const threshold of [5,7]){const policy={weights:current.weights,publishThreshold:threshold},changed={...proposal,rulesSha256:sha256(locked),policy,newRules:replaceScoringPolicy(locked,policy)},validation=proposalTrialReadiness(input,changed);assert.equal(validation.status,'rejected');assert.match(validation.reasons.join(' '),/operator publish threshold is locked at 6/);assert.equal(isCompletedProposalRejection(input,changed,validation,stages),true,'successful deterministic refusal completes the slot without an error or fabricated evaluation');}
 const policy={weights:{...current.weights,evidence:2},publishThreshold:6},weights={...proposal,rulesSha256:sha256(locked),policy,newRules:replaceScoringPolicy(locked,policy)};assert.deepEqual(validateRuleProposal(locked,weights),[]);assert.deepEqual(validateRuleProposal(rules,proposal),[],'historical unmarked threshold trials retain their validation semantics');assert.ok(validateRuleProposal(locked,{...weights,newRules:weights.newRules.replace('<!-- publish-threshold-lock:6 -->\n','')}).length,'the protected lock cannot be removed');
});
function fixtures(){
 const sources=[source],candidates=[1,2,3].map(n=>({candidateId:'c'+n,productUrl:'https://example.com/'+n,sourceIds:['s']}));
 const input={runId:'test-improve',baselineRules:rules,rulesSha256:sha256(rules),sources,sourceSnapshotSha256:sha256(stableJSON(sources)),candidates};
 const challengerPolicy=parseScoringPolicy(proposal.newRules);
 const cases=candidates.map(candidate=>({candidateId:candidate.candidateId,productUrl:candidate.productUrl,sources,
  A:policyTrialAssessment({candidateId:candidate.candidateId,scoring:{criteria:structuredClone(criteria)},selected:true,reason:'Its mean meets the assigned threshold.'},candidate,sources,current),
  B:policyTrialAssessment({candidateId:candidate.candidateId,scoring:{criteria:structuredClone(criteria)},selected:false,reason:'Its mean is below the assigned threshold.'},candidate,sources,challengerPolicy)}));
 const blind={runId:input.runId,trialKind:'scoring_policy',sourceSnapshotSha256:input.sourceSnapshotSha256,cases,trialsSha256:sha256(stableJSON(cases))};
 const labelMap={proposalSha256:sha256(stableJSON(proposal)),cases:candidates.map(candidate=>({candidateId:candidate.candidateId,baseline:'A',proposal:'B'}))};
 const grade={runId:input.runId,trialsSha256:blind.trialsSha256,sourceSnapshotSha256:input.sourceSnapshotSha256,cases:candidates.map(candidate=>({candidateId:candidate.candidateId,
  A:{factuality:4,safety:5,scoreCalibration:4,selectionQuality:2,supported:true,safe:true,reason:'Grounded values, but this marginal idea is less useful.',scoreChecks:structuredClone(scoreChecks)},
  B:{factuality:4,safety:5,scoreCalibration:4,selectionQuality:4,supported:true,safe:true,reason:'The justified refusal improves selection in this held-out example.',scoreChecks:structuredClone(scoreChecks)}}))};
 return {input,proposal:structuredClone(proposal),labelMap,blind,grade};
}

test('numeric policy tuning replaces only the bounded exact block and binds its original fingerprint',()=>{
 assert.deepEqual(validateRuleProposal(rules,proposal),[]);
 for(const extra of [{policySha256:'a'.repeat(64)},{section:'Write'},
  {policy:{weights:{...current.weights,evidence:0},publishThreshold:7}},
  {policy:{weights:{...current.weights,evidence:101},publishThreshold:7}},
  {policy:{weights:current.weights,publishThreshold:11}},
  {newRules:proposal.newRules.replace('No unsafe topics','Some unsafe topics')},
  {newRules:proposal.newRules+'\n'}, {addition:'Also weaken a rule.'},
  {policy:{weights:current.weights,publishThreshold:6},newRules:rules}]){
  assert.ok(validateRuleProposal(rules,{...proposal,...extra}).length,JSON.stringify(extra));
 }
});

test('append proposals cannot inject policy markers or override numeric parameters',()=>{
 for(const addition of ['Publish at threshold 1.','Use overall score 1 as the minimum.','Set evidence weight to 99.','<!-- scoring-policy:start -->']){
  const appended={runId:'test-improve',rulesSha256:sha256(rules),section:'Pick',change:'Untrusted numeric override.',reason:'A test fixture.',addition,newRules:rules.replace('\n\n## Write','\n\n'+addition+'\n\n## Write')};
  assert.ok(validateRuleProposal(rules,appended).length,addition);
 }
 const addition='Explain the first concrete input a student should collect.';
 assert.deepEqual(validateRuleProposal(rules,{runId:'test-improve',rulesSha256:sha256(rules),section:'Write',change:'Make the input concrete.',reason:'Test clarity with independent evidence.',addition,newRules:rules.replace('Plain words and truthful claims.\n\n','Plain words and truthful claims.\n\n'+addition+'\n\n')}),[]);
});

test('below-threshold refusal is a valid policy trial while forged selection or scores are not',()=>{
 const {input,blind}=fixtures();assert.deepEqual(blind.cases[0].B.deterministicReasons,[]);assert.equal(blind.cases[0].B.selected,false);assert.equal(blind.cases[0].B.overall,6);
 const candidate=input.candidates[0],policy=parseScoringPolicy(proposal.newRules),raw=blind.cases[0].B.assessment;
 assert.ok(policyTrialAssessment({...raw,selected:true},candidate,input.sources,policy).deterministicReasons.length);
 assert.ok(policyTrialAssessment({...raw,scoring:{criteria,overall:10}},candidate,input.sources,policy).deterministicReasons.length);
 assert.ok(policyTrialAssessment({...raw,scoring:{criteria:{...criteria,ease:{...criteria.ease,value:NaN}}}},candidate,input.sources,policy).deterministicReasons.length);
});

test('three independently supported better policy decisions can adopt without producing posts',()=>{
 const f=fixtures(),result=evaluateImprovement(f.input,f.proposal,f.labelMap,f.blind,f.grade);
 assert.equal(result.adopted,true);assert.equal(result.evaluations.length,3);assert.equal(result.baselineScore,15);assert.equal(result.challengerScore,17);
});

test('policy adoption rejects calibration regression, bad ceilings, stale bindings and changed decisions',()=>{
 for(const change of ['calibration','ceiling','quote','policy-sha','decision','kind','labels','grade-hash']){
  const f=fixtures();
  if(change==='calibration'){f.grade.cases[0].B.scoreCalibration=3;f.grade.cases[0].B.selectionQuality=5;}
  if(change==='ceiling')f.grade.cases[0].B.scoreChecks[0].maxSupportedScore=5;
  if(change==='quote')f.grade.cases[0].B.scoreChecks[0].evidenceQuote='This quotation was never in the evidence.';
  if(change==='policy-sha')f.blind.cases[0].B.policySha256=current.policySha256;
  if(change==='decision')f.blind.cases[0].B.assessment.selected=true;
  if(change==='kind')f.blind.trialKind='prose';
  if(change==='labels')f.labelMap.cases[0]={candidateId:'c1',baseline:'B',proposal:'A'};
  if(change==='grade-hash')f.grade.trialsSha256='stale';
  if(['policy-sha','decision','labels'].includes(change)){f.blind.trialsSha256=sha256(stableJSON(f.blind.cases));f.grade.trialsSha256=f.blind.trialsSha256;}
  assert.equal(evaluateImprovement(f.input,f.proposal,f.labelMap,f.blind,f.grade).adopted,false,change);
 }
});

test('proposer sees the current policy but no held-out candidate or evidence details',()=>{
 const {input}=fixtures(),result=makeProposerInput(input);
 assert.deepEqual(result.scoringPolicy,current);assert.equal(result.candidates,undefined);assert.equal(result.sources,undefined);
 assert.ok(!JSON.stringify(result).includes(source.text));
});
