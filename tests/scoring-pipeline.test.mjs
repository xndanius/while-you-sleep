import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateIdentity,sha256,stableJSON } from '../lib/storage.mjs';
import { deterministicCheck,checkApproval,contentHash,verifyPublishedPost,frozenScoringPolicyReasons } from '../lib/validation.mjs';
import { parseScoringPolicy,SCORING_KEYS,weightedOverall,publishedScoring } from '../lib/scoring.mjs';
import { repairFeedback } from '../scripts/save-first-check.mjs';
import {cp,mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';

const rules='# Rules\n\n## Pick\nEvidence before claims.\n\n<!-- scoring-policy:start -->\n```json\n{"weights":{"ease":1,"profit":1,"feasibility":1,"autonomy":1,"evidence":1},"publishThreshold":6}\n```\n<!-- scoring-policy:end -->\n';
const source={id:'source-1',url:'https://example.com/product',text:'The product reads uploaded receipts and extracts structured fields for review. It exports parsed fields as CSV. Human approval remains required before records are sent.'};
const criteria=Object.fromEntries(SCORING_KEYS.map(key=>[key,{value:6,reason:key==='profit'?'Hypothesis: small teams may value reduced receipt administration.':'The source supports a bounded receipt extraction and review experiment.',sourceIds:[source.id]}]));
const post={id:candidateIdentity({productUrl:source.url}),candidateId:candidateIdentity({productUrl:source.url}),title:'A receipt review assistant',promise:'Turn receipts into a draft for human review.',whatItIs:'A receipt extraction experiment.',whoPays:'Hypothesis: teams with receipt administration.',loop:['Upload a receipt','Extract a draft','Review and export'],evidence:'The source describes extraction and CSV export.',uncertainty:'Demand and revenue are unproved; review remains manual.',first24Hours:['Choose one receipt format.','Extract sample fields.','Build a review screen.'],sourceIds:[source.id],productUrl:source.url,scoring:{criteria}};
const scoreChecks=SCORING_KEYS.map(criterion=>({criterion,supported:true,maxSupportedScore:6,reason:criterion==='profit'?'Hypothesis: a plausible administration buyer without demand proof.':'The source supports this bounded example and its review limits.',sourceId:source.id,evidenceQuote:'extracts structured fields for review'}));
function fixtures(){
 const draft={runId:'test-run',posts:[structuredClone(post)]};
 const context={runId:draft.runId,rulesSha256:sha256(rules),scoringPolicy:parseScoringPolicy(rules),draftSha256:sha256(stableJSON(draft)),sourceSnapshotSha256:sha256(stableJSON([source])),sources:[source],deterministicResults:[{postId:post.id,pass:true,reasons:[]}]};
 const checks=[{postId:post.id,pass:true,reasons:[],scoreChecks:structuredClone(scoreChecks),claimChecks:[
  {claim:'Receipt extraction exists.',supported:true,sourceId:source.id,evidenceQuote:'reads uploaded receipts and extracts structured fields'},
  {claim:'CSV export exists.',supported:true,sourceId:source.id,evidenceQuote:'exports parsed fields as CSV'},
  {claim:'Human review remains.',supported:true,sourceId:source.id,evidenceQuote:'Human approval remains required before records are sent'},
 ]}];
 return {draft,context,manifest:{runId:draft.runId,draftSha256:context.draftSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,policySha256:context.scoringPolicy.policySha256,checks}};
}

test('the live schema requires five evidence ratings and rejects writer-owned aggregates',()=>{
 const policy=parseScoringPolicy(rules);
 assert.deepEqual(deterministicCheck(post,[source],[],{scoringPolicy:policy}),[]);
 for(const scoring of [undefined,{criteria,overall:10},{criteria:{...criteria,novelty:criteria.ease}},{criteria:{...criteria,ease:{...criteria.ease,value:11}}},
  {criteria:{...criteria,profit:{...criteria.profit,reason:'Teams will earn guaranteed income.'}}},
  {criteria:{...criteria,ease:{...criteria.ease,sourceIds:['invented']}}}]){
  assert.ok(deterministicCheck({...post,scoring},[source],[],{scoringPolicy:policy}).length);
 }
});

test('frozen policy weights, threshold and writer RULES fingerprint fail closed',()=>{
 const {context}=fixtures();
 assert.deepEqual(frozenScoringPolicyReasons(context,{expectedRulesSha256:context.rulesSha256}),[]);
 assert.ok(frozenScoringPolicyReasons(context,{expectedRulesSha256:sha256('later rules')}).length);
 assert.ok(frozenScoringPolicyReasons(context,{expectedRulesSha256:''}).length);
 for(const scoringPolicy of [undefined,{...context.scoringPolicy,policySha256:'a'.repeat(64)},
  {...context.scoringPolicy,weights:{...context.scoringPolicy.weights,ease:2}},
  {...context.scoringPolicy,threshold:7}])assert.ok(frozenScoringPolicyReasons({...context,scoringPolicy}).length);
 assert.deepEqual(frozenScoringPolicyReasons(context,{expectedRulesSha256:sha256(rules)}),[],'a later main policy is irrelevant to the frozen writer identity');
});

test('independent score ceilings and fresh literal evidence are mandatory despite raw approval',()=>{
 const valid=fixtures();assert.equal(checkApproval(valid.draft,valid.context,valid.manifest)[0].pass,true);
 for(const change of ['missing','duplicate','ceiling','malformed','unsupported','quote','case-only','foreign-source','policy-sha']){
  const {draft,context,manifest}=fixtures(),checks=manifest.checks[0].scoreChecks;
  if(change==='missing')checks.pop();
  if(change==='duplicate')checks[4]=structuredClone(checks[0]);
  if(change==='ceiling')checks[0].maxSupportedScore=5;
  if(change==='malformed')checks[0].maxSupportedScore=NaN;
  if(change==='unsupported')checks[0].supported=false;
  if(change==='quote')checks[0].evidenceQuote='Invented statement absent from the fetched source.';
  if(change==='case-only')checks[0].evidenceQuote=checks[0].evidenceQuote.toUpperCase();
  if(change==='foreign-source')checks[0].sourceId='unattached';
  if(change==='policy-sha')manifest.policySha256='a'.repeat(64);
  assert.equal(checkApproval(draft,context,manifest)[0].pass,false,change);
 }
});

test('an honestly unbuilt proposal has no execution gate, while unsupported execution claims still fail',()=>{
 const {draft,context,manifest}=fixtures();
 draft.posts[0].whatItIs='A proposed receipt review service; no prototype or live integration has been executed.';
 draft.posts[0].uncertainty='This is an unbuilt proposal. Sales and production accuracy are unverified; a person reviews every result.';
 context.draftSha256=sha256(stableJSON(draft));manifest.draftSha256=context.draftSha256;
 assert.equal(checkApproval(draft,context,manifest)[0].pass,true,'synthetic approval control exercises the existing gate, not a real model or publication');
 const unsupported=structuredClone(manifest);
 unsupported.checks[0].claimChecks.push({claim:'This proposed service already passed a live integration test.',supported:false,sourceId:source.id,evidenceQuote:'Human approval remains required before records are sent'});
 assert.equal(checkApproval(draft,context,unsupported)[0].pass,false,'an independent unsupported-claim verdict still blocks the post');
 const fabricated=structuredClone(manifest);
 fabricated.checks[0].claimChecks.push({claim:'This proposed service already passed a live integration test.',supported:true,sourceId:source.id,evidenceQuote:'The proposed service passed a live integration test.'});
 assert.equal(checkApproval(draft,context,fabricated)[0].pass,false,'a raw pass cannot make an absent execution quote valid');
 assert.equal(weightedOverall(draft.posts[0].scoring.criteria,context.scoringPolicy.weights),6);
});

test('repair feedback does not retain an inflated score or a fabricated score quote',()=>{
 const {draft,context,manifest}=fixtures();manifest.checks[0].scoreChecks[0].maxSupportedScore=5;manifest.checks[0].scoreChecks[1].evidenceQuote='Invented demand figures from nowhere.';
 const result=repairFeedback(draft,context,manifest);
 assert.deepEqual(result.approvedPostIds,[]);assert.deepEqual(result.repairPostIds,[post.id]);
 assert.equal(result.decisions[0].scoreIssues[0].criterion,'ease');
 assert.equal(result.decisions[0].quoteIssues[0].criterion,'profit');
});

test('publication uses the unrounded weighted mean and scores remain inside content integrity',()=>{
 const policy=parseScoringPolicy(rules),roundedUp={...criteria,evidence:{...criteria.evidence,value:5}};
 const weights={...policy.weights,evidence:0.1};
 const overall=weightedOverall(roundedUp,weights);
 assert.equal(Number(overall.toFixed(1)),6);assert.ok(overall<6,'display rounding cannot qualify a below-threshold idea');
 const scoring=publishedScoring(criteria,policy,{checkedAt:'2026-10-11T10:20:06.032Z',checkerRunId:'test-run-independent-check'});
 const record={...post,scoring,publishedAt:'2026-10-11T10:20:06.032Z',checker:{passed:true,checkerRunId:scoring.checkerRunId}};record.contentSha256=contentHash(record);
 assert.equal(verifyPublishedPost(record),true);
 assert.equal(verifyPublishedPost({...record,scoring:{...scoring,overall:10}}),false);
});

async function runPublisher(t,{mutate=()=>{},liveText=source.text}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-score-publication-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await cp(new URL('../lib',import.meta.url),path.join(root,'lib'),{recursive:true});
 await mkdir(path.join(root,'public'));for(const file of ['schedule.js','cadence-config.js'])await cp(new URL('../public/'+file,import.meta.url),path.join(root,'public',file));
 await cp(new URL('../public/cadence-config.js',import.meta.url),path.join(root,'public','cadence-config.js'));
 await writeFile(path.join(root,'package.json'),JSON.stringify({type:'module'}));
 await mkdir(path.join(root,'scripts'));await cp(new URL('../scripts/publish-checked.mjs',import.meta.url),path.join(root,'scripts','publish-checked.mjs'));
 await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),path.join(root,'node_modules'),'dir');
 const fixture=fixtures(),now=new Date().toISOString();fixture.context.createdAt=now;fixture.manifest.checkedAt=now;
 mutate(fixture);
 fixture.context.draftSha256=sha256(stableJSON(fixture.draft));fixture.context.sourceSnapshotSha256=sha256(stableJSON(fixture.context.sources));
 fixture.manifest.draftSha256=fixture.context.draftSha256;fixture.manifest.sourceSnapshotSha256=fixture.context.sourceSnapshotSha256;fixture.manifest.policySha256=fixture.context.scoringPolicy.policySha256;
 for(const [directory,record] of [['drafts',fixture.draft],['check-context',fixture.context],['checks',fixture.manifest],['research',{runId:'test-run',createdAt:now,sources:fixture.context.sources,health:[]}]]){
  await mkdir(path.join(root,'data',directory),{recursive:true});await writeFile(path.join(root,'data',directory,'test-run.json'),JSON.stringify(record));
 }
 const code=`import dns from 'node:dns/promises';import {syncBuiltinESMExports} from 'node:module';dns.lookup=async()=>[{address:'203.0.113.10',family:4}];syncBuiltinESMExports();let fetches=0;globalThis.fetch=async()=>{fetches++;return new Response(${JSON.stringify(liveText)},{status:200,headers:{'content-type':'text/plain'}});};process.argv=['node','scripts/publish-checked.mjs','test-run','1'];await import('./scripts/publish-checked.mjs');process.stdout.write('FETCH_COUNT '+fetches+'\\n');`;
 const execution=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:root,env:{PATH:process.env.PATH,GITHUB_ACTIONS:'false'},encoding:'utf8'});
 return {root,fixture,execution};
}

test('trusted publication records checked scoring while a vanished score-only quote blocks publication',async t=>{
 const positive=await runPublisher(t);
 assert.equal(positive.execution.status,0,positive.execution.stderr);
 const saved=JSON.parse(await readFile(path.join(positive.root,'data','posts',post.id+'.json'),'utf8'));
 assert.equal(verifyPublishedPost(saved),true);assert.equal(saved.scoring.overall,6);
 assert.deepEqual(saved.checker.scoreChecks,positive.fixture.manifest.checks[0].scoreChecks);
 assert.deepEqual(saved.checker.scoringPolicy,positive.fixture.context.scoringPolicy);
 assert.equal(sha256(stableJSON(saved.checker.scoreSources)),saved.checker.sourceSnapshotSha256);
 const quote='Reviewers mark uncertain fields for correction.';
 const vanished=await runPublisher(t,{mutate:fixture=>{
  fixture.context.sources=[{...source,text:source.text+' '+quote}];
  fixture.manifest.checks[0].scoreChecks[0].evidenceQuote=quote;
 }});
 assert.equal(vanished.execution.status,1);
 await assert.rejects(readFile(path.join(vanished.root,'data','posts',post.id+'.json')),error=>error.code==='ENOENT');
 const rejected=JSON.parse(await readFile(path.join(vanished.root,'data','rejections','test-run-000.json'),'utf8'));
 assert.match(rejected.reason,/score evidence quote no longer exists/);
});

test('actual publisher rejects a mean that rounds to the threshold before any live source request',async t=>{
 const {root,execution}=await runPublisher(t,{mutate:fixture=>{
  fixture.draft.posts[0].scoring.criteria.evidence.value=5;
  fixture.context.scoringPolicy=parseScoringPolicy(rules.replace('"evidence":1','"evidence":0.1'));
 }});
 assert.equal(execution.status,1,execution.stderr);assert.match(execution.stdout,/FETCH_COUNT 0/);
 await assert.rejects(readFile(path.join(root,'data','posts',post.id+'.json')),error=>error.code==='ENOENT');
 const rejected=JSON.parse(await readFile(path.join(root,'data','rejections','test-run-000.json'),'utf8'));
 assert.match(rejected.reason,/below the frozen publish threshold of 6/);
});
