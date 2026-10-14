import test from 'node:test';
import assert from 'node:assert/strict';
import {SCORING_KEYS,parseScoringPolicy,replaceScoringPolicy,validateScoringPolicy,scoringPolicyHash,validateScoringCriteria,checkScoringApproval,weightedOverall,publishedScoring,hydrateScoring,validateScoreSidecar} from '../lib/scoring.mjs';
import {contentHash} from '../lib/validation.mjs';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {scoringFixture} from './fixtures/scoring.mjs';

test('RULES policy is exact, bounded, fingerprinted and replaces only its marker block',()=>{
 const {rules,policy}=scoringFixture();assert.equal(policy.threshold,6);assert.equal(policy.policySha256,scoringPolicyHash(policy.weights,6));
 const updated=replaceScoringPolicy(rules,{weights:{...policy.weights,evidence:2},publishThreshold:6.5});
 assert.ok(updated.startsWith('Protected before.\n'));assert.ok(updated.endsWith('\nProtected after.\n'));assert.equal(parseScoringPolicy(updated).weights.evidence,2);
 assert.notEqual(parseScoringPolicy(updated).policySha256,policy.policySha256);
 for(const altered of [rules+rules,rules.replace('"ease":1','"ease":0'),rules.replace('"ease":1','"ease":101'),rules.replace('"ease":1','"ease":1e400'),rules.replace('"ease":1','"other":1'),rules.replace('"publishThreshold":6','"publishThreshold":11'),rules.replace('```json','```'),rules.replace('"weights":','"extra":true,"weights":')])assert.throws(()=>parseScoringPolicy(altered));
 assert.ok(validateScoringPolicy({...policy,policySha256:'b'.repeat(64)}).length);
});
test('criterion schema rejects invented aggregates, fractional values, unattached evidence and non-hypothetical profit',()=>{
 const {criteria,source}=scoringFixture();assert.deepEqual(validateScoringCriteria(criteria,{sourceIds:[source.id],sources:[source]}),[]);
 for(const altered of [{...criteria,overall:9},{...criteria,ease:{...criteria.ease,value:6.5}},{...criteria,ease:{...criteria.ease,sourceIds:['unknown']}},{...criteria,ease:{...criteria.ease,reason:'Two lines\nare forbidden.'}},{...criteria,profit:{...criteria.profit,reason:'A guaranteed income stream.'}},{...criteria,profit:{...criteria.profit,reason:'Hypothesis: they will earn $500.'}}])assert.ok(validateScoringCriteria(altered,{sourceIds:[source.id],sources:[source]}).length);
});
test('fresh checker must cover exactly five criteria, supported ceilings and literal case-sensitive evidence',()=>{
 const {criteria,scoreChecks,source}=scoringFixture();assert.deepEqual(checkScoringApproval(criteria,scoreChecks,[source],{sourceIds:[source.id]}),[]);
 assert.ok(checkScoringApproval(criteria,scoreChecks.slice(0,4),[source]).length);
 for(const mutation of [{supported:false},{maxSupportedScore:1},{sourceId:'unattached'},{evidenceQuote:'Scheduled checks'},{evidenceQuote:'scheduled automated checks'},{reason:'Two lines\ninvalid.'},{extra:true}])assert.ok(checkScoringApproval(criteria,scoreChecks.map((value,index)=>index===0?{...value,...mutation}:value),[source]).length);
 assert.ok(checkScoringApproval(criteria,scoreChecks.map(value=>value.criterion==='profit'?{...value,reason:'The customer will pay for this.'}:value),[source]).length);
});
test('building evidence must be attached to both the proposal and the criterion before a capability can pass',()=>{
 const {criteria,scoreChecks,source}=scoringFixture(),building={...source,id:'b'.repeat(24),url:'https://example.com/docs/checks',text:'The documented test tool can flag missing cells for human review.'};
 const ratings={...criteria,ease:{...criteria.ease,sourceIds:[building.id]}},checks=scoreChecks.map(check=>check.criterion==='ease'?{...check,sourceId:building.id,evidenceQuote:'flag missing cells for human review'}:check),sources=[source,building];
 assert.ok(checkScoringApproval(ratings,checks,sources,{sourceIds:[source.id]}).length,'a source merely available in the research context is not attached to the post');
 assert.deepEqual(checkScoringApproval(ratings,checks,sources,{sourceIds:[source.id,building.id]}),[]);
 assert.ok(checkScoringApproval(criteria,checks,sources,{sourceIds:[source.id,building.id]}).length,'post-level attachment alone cannot support a criterion citing different evidence');
 assert.ok(checkScoringApproval(ratings,checks.map(check=>check.criterion==='ease'?{...check,evidenceQuote:'automatically correct all payroll entries'}:check),sources,{sourceIds:[source.id,building.id]}).length,'a related document cannot support an invented capability quote');
});
test('weighted means use unrounded values and clamp only floating-point range overflow',()=>{
 const {criteria,policy}=scoringFixture();assert.equal(weightedOverall(criteria,policy.weights),6);
 assert.equal(weightedOverall(criteria,{...policy.weights,evidence:2}),37/6);
 const decimal={ease:42.2875275056208,profit:8.288931974674487,feasibility:92.42861373923024,autonomy:56.39828448137024,evidence:2.246417797635258};
 assert.equal(weightedOverall(Object.fromEntries(SCORING_KEYS.map(key=>[key,{...criteria[key],value:10}])),decimal),10);
 assert.equal(weightedOverall(Object.fromEntries(SCORING_KEYS.map(key=>[key,{...criteria[key],value:1}])),decimal),1);
});
test('sidecar hydration preserves original post hashes and retains frozen assessment policy when reaggregating',()=>{
 const {original,sidecar,policy,criteria}=scoringFixture(),before=stableJSON(original);
 assert.deepEqual(validateScoreSidecar(original,sidecar),[]);
 const hydrated=hydrateScoring(original,sidecar,policy);assert.equal(hydrated.overall,6);assert.deepEqual(hydrated.criteria,criteria);
 const weights={...policy.weights,evidence:2},current={weights,threshold:7,policySha256:scoringPolicyHash(weights,7)},updated=hydrateScoring(original,sidecar,current);
 assert.equal(updated.overall,37/6);assert.equal(updated.threshold,7);assert.equal(updated.assessmentPolicySha256,policy.policySha256);assert.equal(updated.policySha256,current.policySha256);assert.equal(stableJSON(original),before);
});
test('sidecars fail closed when original, ratings, evidence, frozen policy or cloud provenance changes',()=>{
 const {original,sidecar,policy}=scoringFixture();
 for(const mutation of [value=>value.postContentSha256='c'.repeat(64),value=>value.criteria.ease.value=10,value=>value.sources[0].text+='Changed',value=>value.assessmentPolicy.weights.ease=2,value=>value.checker.scoreChecks[0].evidenceQuote='Scheduled checks',value=>value.batch.runId='scores-123-1',value=>value.sources=[null],value=>value.sources={},value=>value.checker=null]){
  const altered=structuredClone(sidecar);mutation(altered);assert.equal(hydrateScoring(original,altered,policy),null);
 }
 assert.equal(hydrateScoring({...original,title:'Changed'},sidecar,policy),null);
 const changed={...original,title:'Rehashed changed original'};changed.contentSha256=contentHash(changed);assert.equal(hydrateScoring(changed,sidecar,policy),null);
});
test('inline scoring uses the same checked evidence and frozen policy without changing contentHash exclusions',()=>{
 const {original,criteria,policy,scoreChecks,source,timestamp}=scoringFixture(),post=structuredClone(original);
 post.checker.scoreChecks=scoreChecks;post.checker.scoreSources=[source];post.checker.sourceSnapshotSha256=sha256(stableJSON([source]));post.checker.scoringPolicy=policy;
 post.scoring=publishedScoring(criteria,policy,{checkedAt:timestamp,checkerRunId:post.checker.checkerRunId});post.contentSha256=contentHash(post);
 assert.equal(hydrateScoring(post,null,policy).overall,6);
 const invalid=structuredClone(post);invalid.checker.scoreChecks[0].maxSupportedScore=1;assert.equal(contentHash(invalid),post.contentSha256);assert.equal(hydrateScoring(invalid,null,policy),null);
 const changed=structuredClone(post);changed.scoring.criteria.ease.value=10;assert.notEqual(contentHash(changed),post.contentSha256);assert.equal(hydrateScoring(changed,null,policy),null);
});
