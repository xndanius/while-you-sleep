import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {parseScoringPolicy,validateScoringPolicy,weightedOverall} from '../lib/scoring.mjs';
import {candidatePlanReasons} from '../lib/candidate-plan.mjs';
import {checkerAssessmentView} from '../lib/checker-assessment.mjs';
import {checkApproval} from '../lib/validation.mjs';

const load=async(directory,id)=>JSON.parse(await readFile(new URL(`../data/${directory}/${id}.json`,import.meta.url),'utf8'));
const frozen=async id=>({draft:await load('drafts',id),context:await load('check-context',id)});
const guidePath='docs/SCORING_CALIBRATION.md';

test('all four scheduled model stages are instructed to read one guide with the exact authoritative bands',async()=>{
 const [rules,guide,writer,checker,workflow]=await Promise.all(['RULES.md',guidePath,'.github/codex/prompts/writer.md','.github/codex/prompts/checker.md','.github/workflows/loop.yml'].map(file=>readFile(new URL('../'+file,import.meta.url),'utf8')));
 const bands=guide.split('<!-- rubric-bands:start -->\n')[1]?.split('\n<!-- rubric-bands:end -->')[0];
 assert.equal(bands,rules.match(/^Use modest ratings[^\n]+/m)?.[0]);
 for(const prompt of [writer,checker])assert.ok(prompt.split('\n')[0].includes(guidePath));
 assert.equal(workflow.split('prompt-file: .github/codex/prompts/writer.md').length-1,2,'writer and repair share the corrected instructions');
 assert.equal(workflow.split('prompt-file: .github/codex/prompts/checker.md').length-1,2,'initial and final checker share the corrected instructions');
 assert.deepEqual(validateScoringPolicy(parseScoringPolicy(rules)),[]);
 for(const run of ['loop-40810428270-1-first','loop-40827730261-1','loop-40848279392-1']){
  const policy=(await load('check-context',run)).scoringPolicy;
  assert.deepEqual(validateScoringPolicy(policy),[]);
  assert.equal(policy.threshold,6);assert.deepEqual(policy.weights,{ease:1,profit:1,feasibility:1,autonomy:1,evidence:1});
 }
});

test('frozen band and scope regressions remain visible without rewriting historical scores or approvals',async()=>{
 const alert=await frozen('loop-40810428270-1-first'),totals=await frozen('loop-40827730261-1'),csv=await frozen('loop-40848279392-1');
 const refusal=await load('checks','loop-40810428270-1-first'),before=stableJSON({alert,totals,csv,refusal});
 assert.match(refusal.checks[0].reasons[0],/ease score of 7.*unusually straightforward/);
 assert.equal(weightedOverall(alert.draft.posts[0].scoring.criteria,alert.context.scoringPolicy.weights),6);
 assert.equal(checkApproval(alert.draft,alert.context,refusal)[0].pass,false,'the guide does not retroactively approve the historical refusal');
 assert.ok(alert.draft.candidates[0].experimentPlan.steps.some(step=>/test Slack channel/.test(step)),'delivery remains an in-scope uncertainty in this real case');
 const comparison=totals.draft.candidates.find(candidate=>candidate.productUrl==='https://community.shopify.com/t/705757');
 assert.match(comparison.scoring.criteria.evidence.reason,/corroboration or a verified service/);
 assert.ok(comparison.experimentPlan.steps.includes('Flag gaps without assigning a cause.'));
 const csvCandidate=csv.draft.candidates.find(candidate=>candidate.productUrl==='https://community.n8n.io/t/325109');
 assert.match(csvCandidate.experimentPlan.humanBoundary,/upload|sheet/i);
 assert.equal(csvCandidate.experimentPlan.status,'proposed');
 for(const f of [alert,totals,csv]){
  assert.equal(sha256(stableJSON(f.draft)),f.context.draftSha256);
  assert.deepEqual(candidatePlanReasons(f.draft,{candidatePlanVersion:f.context.candidatePlanVersion}),[]);
  const view=checkerAssessmentView(f.draft,f.context,{role:'final-checker'});
  assert.deepEqual(view.draft,f.draft,'scores, plans and unverified capabilities all survive the reading aid');
 }
 assert.equal(stableJSON({alert,totals,csv,refusal}),before);
});

test('actual initial and final checker preparation preserve the CSV scope and pending claims without network or models',async t=>{
 const id='loop-40848279392-1',f=await frozen(id),original=stableJSON(f);
 for(const role of ['checker','final-checker']){
  const root=await mkdtemp(path.join(os.tmpdir(),'wys-rubric-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const directory of ['lib','scripts'])await cp(new URL('../'+directory,import.meta.url),path.join(root,directory),{recursive:true});
  await mkdir(path.join(root,'public'));
  for(const name of ['schedule.js','cadence-config.js'])await cp(new URL('../public/'+name,import.meta.url),path.join(root,'public',name));
  await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),path.join(root,'node_modules'),'dir');
  await writeFile(path.join(root,'package.json'),'{"type":"module"}');
  await cp(new URL('../RULES.md',import.meta.url),path.join(root,'RULES.md'));
  await mkdir(path.join(root,'docs'));await cp(new URL('../'+guidePath,import.meta.url),path.join(root,guidePath));
  for(const [directory,value] of [['drafts',f.draft],['check-context',f.context]]){
   await mkdir(path.join(root,'data',directory),{recursive:true});await writeFile(path.join(root,'data',directory,id+'.json'),stableJSON(value));
  }
  const countsFile=path.join(root,'network-counts.json'),preload=path.join(root,'offline.mjs');
  await writeFile(preload,`import dns from 'node:dns/promises';import {syncBuiltinESMExports} from 'node:module';import {writeFileSync} from 'node:fs';const counts={dns:0,http:0};dns.lookup=async()=>{counts.dns++;throw new Error('Offline rubric fixture');};syncBuiltinESMExports();globalThis.fetch=async()=>{counts.http++;throw new Error('Offline rubric fixture');};process.on('exit',()=>writeFileSync(${JSON.stringify(countsFile)},JSON.stringify(counts)));`);
  const execution=spawnSync(process.execPath,['scripts/prepare-run.mjs',role],{cwd:root,encoding:'utf8',env:{PATH:process.env.PATH,RUN_ID:id,NODE_OPTIONS:'--import='+preload,CHECKER_PHASE:role==='checker'?'initial':'final'}});
  assert.equal(execution.status,0,execution.stderr);
  const context=JSON.parse(await readFile(path.join(root,'.run/context.json'),'utf8'));
  const reading=JSON.parse(await readFile(path.join(root,context.checkerAssessment.path),'utf8'));
  assert.equal(context.role,role);assert.deepEqual(reading.draft,f.draft);
  assert.equal(context.rulesSha256,f.context.rulesSha256);
  assert.deepEqual(JSON.parse(await readFile(countsFile,'utf8')),{dns:0,http:0});
  assert.equal(await readFile(path.join(root,'data/drafts',id+'.json'),'utf8'),stableJSON(f.draft));
 }
 assert.equal(stableJSON(f),original);
});
