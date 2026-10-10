import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256,stableJSON } from '../lib/storage.mjs';
import { validateRuleProposal,evaluateImprovement } from '../lib/improvement.mjs';

const rules='# Rules\n\n## Pick\nEvidence and no duplicates.\n\n## Write\nPlain words and truthful claims.\n\n## Safety\nNo unsafe topics or secrets.\n';
const addition='Name the first input the student should collect.';
const proposal={runId:'test-improve',rulesSha256:sha256(rules),section:'Write',change:'Make the first input concrete.',reason:'Test a clarity hypothesis; traffic is unavailable.',addition,newRules:rules.replace('Plain words and truthful claims.\n\n','Plain words and truthful claims.\n\n'+addition+'\n\n')};
function fixtures(){
  const sources=[{id:'s',text:'Verified product supports extraction and review.'}];
  const candidates=[1,2,3].map(i=>({candidateId:'c'+i,productUrl:'https://example.com/'+i,sourceIds:['s']}));
  const input={runId:'test-improve',baselineRules:rules,rulesSha256:sha256(rules),sources,sourceSnapshotSha256:sha256(stableJSON(sources)),candidates};
  const cases=candidates.map(c=>({...c,sources,A:{post:{title:'Baseline'},deterministicReasons:[]},B:{post:{title:'Proposal'},deterministicReasons:[]}}));
  const blind={runId:input.runId,sourceSnapshotSha256:input.sourceSnapshotSha256,cases,trialsSha256:sha256(stableJSON(cases))};
  const labelMap={proposalSha256:sha256(stableJSON(proposal)),cases:candidates.map(c=>({candidateId:c.candidateId,baseline:'A',proposal:'B'}))};
  const grade={runId:input.runId,trialsSha256:blind.trialsSha256,sourceSnapshotSha256:input.sourceSnapshotSha256,cases:candidates.map(c=>({candidateId:c.candidateId,A:{factuality:4,clarity:3,feasibility:3,safety:5,supported:true,safe:true},B:{factuality:4,clarity:4,feasibility:4,safety:5,supported:true,safe:true}}))};
  return {input,proposal:structuredClone(proposal),labelMap,blind,grade};
}
test('only one appended paragraph in Pick or Write passes exact section guard',()=>{
  assert.deepEqual(validateRuleProposal(rules,proposal),[]);
  assert.ok(validateRuleProposal(rules,{...proposal,newRules:proposal.newRules.replace('No unsafe topics','Some unsafe topics')}).some(r=>r.includes('Protected section')));
  assert.ok(validateRuleProposal(rules,{...proposal,newRules:proposal.newRules.replace('truthful claims','bold claims')}).some(r=>r.includes('verbatim')));
  assert.ok(validateRuleProposal(rules,{...proposal,section:'Safety'}).length);
});
test('higher-scoring supported safe proposal passes three blind held-out cases',()=>{
  const f=fixtures(),r=evaluateImprovement(f.input,f.proposal,f.labelMap,f.blind,f.grade);
  assert.equal(r.adopted,true);assert.equal(r.baselineScore,15);assert.equal(r.challengerScore,17);
});
test('equal scores, unsupported facts, and per-case safety regression reject',()=>{
  for(const change of ['equal','unsupported','regression']){
    const f=fixtures();
    if(change==='equal')for(const c of f.grade.cases)c.B={...c.A};
    if(change==='unsupported')f.grade.cases[0].B.supported=false;
    if(change==='regression')f.grade.cases[0].B.safety=4;
    assert.equal(evaluateImprovement(f.input,f.proposal,f.labelMap,f.blind,f.grade).adopted,false);
  }
});
test('stale hashes and changed evidence reject independent grade',()=>{
  const f=fixtures();f.grade.trialsSha256='stale';assert.equal(evaluateImprovement(f.input,f.proposal,f.labelMap,f.blind,f.grade).adopted,false);
  const g=fixtures();g.blind.cases[0].sources=[{id:'s',text:'Fabricated evidence'}];g.blind.trialsSha256=sha256(stableJSON(g.blind.cases));g.grade.trialsSha256=g.blind.trialsSha256;
  assert.equal(evaluateImprovement(g.input,g.proposal,g.labelMap,g.blind,g.grade).adopted,false);
});
test('missing trials never become a measured score of zero',()=>{
  const f=fixtures();f.grade.cases=[];const result=evaluateImprovement(f.input,f.proposal,f.labelMap,f.blind,f.grade);
  assert.equal(result.adopted,false);assert.equal(result.baselineScore,null);assert.equal(result.challengerScore,null);
});
