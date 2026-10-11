import {sha256,stableJSON} from '../../lib/storage.mjs';
import {contentHash} from '../../lib/validation.mjs';
import {SCORING_KEYS,parseScoringPolicy,scoreDraft} from '../../lib/scoring.mjs';
import {scoreContext,assessedSidecar} from '../../lib/score-batch.mjs';

export function scoringFixture(){
 const now=Date.parse('2026-10-11T11:30:00.000Z'),timestamp=new Date(now).toISOString();
 const rules='Protected before.\n<!-- scoring-policy:start -->\n```json\n{"weights":{"ease":1,"profit":1,"feasibility":1,"autonomy":1,"evidence":1},"publishThreshold":6}\n```\n<!-- scoring-policy:end -->\nProtected after.\n';
 const policy=parseScoringPolicy(rules),source={id:'fixture-source',url:'https://example.com/product',title:'Fixture demonstration',publisher:'example.com',fetchedAt:timestamp,verifiedAt:timestamp,text:'This fixture demonstrates scheduled checks on public documentation and saves a review queue for a human editor. Its small setup uses accessible tools and a bounded first-day experiment, without any evidence of customers or revenue.'};
 const original={id:'fixture-post',candidateId:'fixture-post',title:'A test fixture, never a real post',promise:'Inspect a bounded review loop.',whatItIs:'A synthetic test example.',whoPays:'Hypothesis: documentation teams might pay; demand is unproved.',loop:['Fetch public docs.','Run a bounded check.','Queue a human review.'],evidence:'This is a synthetic test fixture.',uncertainty:'A human reviews decisions and demand is unknown.',first24Hours:['Choose one document.','Test one check.','Review the result.'],productUrl:source.url,publishedAt:timestamp,runId:'original-test',sources:[Object.fromEntries(Object.entries(source).filter(([key])=>key!=='text'))],checker:{passed:true,checkedAt:timestamp,checkerRunId:'original-test-check'}};
 original.contentSha256=contentHash(original);
 const criteria=Object.fromEntries(SCORING_KEYS.map(key=>[key,{value:key==='profit'?5:key==='evidence'?7:6,reason:key==='profit'?'Hypothesis: documentation teams might pay for a review queue; demand remains unproved.':'The demonstration supports a bounded check and human review, with setup limits.',sourceIds:[source.id]}]));
 const input={schema:1,runId:'score-123-1',createdAt:timestamp,rules,rulesSha256:sha256(rules),rulesCommit:'a'.repeat(40),policy,posts:[original],sources:[source],health:[]};
 const rating=scoreDraft(original.id,original.contentSha256,criteria),draft={runId:input.runId,posts:[rating]},context=scoreContext(input,draft,[source],[],timestamp),entry=context.posts[0];
 const scoreChecks=SCORING_KEYS.map(criterion=>({criterion,supported:true,maxSupportedScore:criteria[criterion].value,reason:criterion==='profit'?'Hypothesis: a buyer is plausible, but the source establishes no demand.':'The bounded check and human review support this assessment, with stated limits.',sourceId:source.id,evidenceQuote:'scheduled checks'}));
 const check={runId:input.runId,draftSha256:context.draftSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,policySha256:policy.policySha256,checks:[{postId:entry.postId,postContentSha256:entry.postContentSha256,draftSha256:entry.draftSha256,sourceSnapshotSha256:entry.sourceSnapshotSha256,pass:true,reasons:[],scoreChecks}]};
 const sidecar=assessedSidecar(original,rating,check.checks[0],context,input,{checkedAt:timestamp});
 const env={RUN_ID:input.runId,EXPECTED_INPUT_SHA:sha256(stableJSON(input)),EXPECTED_DRAFT_SHA:sha256(stableJSON(draft)),EXPECTED_CONTEXT_SHA:sha256(stableJSON(context)),RULES_SHA256:input.rulesSha256,RULES_COMMIT:input.rulesCommit};
 return {now,timestamp,rules,policy,source,original,criteria,input,draft,context,check,scoreChecks,sidecar,env};
}
