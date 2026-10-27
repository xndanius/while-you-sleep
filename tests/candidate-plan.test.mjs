import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {candidatePlanReasons,candidatePlanVersionReasons} from '../lib/candidate-plan.mjs';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {completedAssessmentReasons} from '../lib/validation.mjs';
import {checkerAssessmentView} from '../lib/checker-assessment.mjs';
import {sealedWriterCoverage} from '../lib/writer-coverage.mjs';
import {weightedOverall} from '../lib/scoring.mjs';
import {researchSnapshot} from '../scripts/research-snapshot.mjs';

const runId='loop-40510493857-1';
const load=directory=>readFile(new URL(`../data/${directory}/${runId}.json`,import.meta.url),'utf8').then(JSON.parse);
const plan=()=>({version:1,status:'proposed',output:'A proposed routing table showing the chosen folder for each fictional message.',inputs:['Operator-defined folder rules','Fictional message subjects and bodies'],trigger:'The operator starts a local sample batch.',steps:['Read each fictional message and its rule set.','Apply the configured matching rule to each sample.','Write the proposed folder and flag ambiguous matches.'],acceptanceCheck:'Compare every proposed folder against the operator-labelled expected table, including ambiguous samples.',humanBoundary:'A person supplies labels, reviews ambiguous matches and separately authorizes any live mailbox access.',unverified:['Live mailbox access and production integration remain untested.','Buyer demand and production accuracy are not established.']});
async function fixture(){const [draft,context,manifest,research,selection,scheduling]=await Promise.all(['drafts','check-context','checks','research','learning-selection','scheduling'].map(load));return {draft,context,manifest,research,selection,scheduling};}
function bind(draft,context,manifest){context.draftSha256=sha256(stableJSON(draft));manifest.draftSha256=context.draftSha256;manifest.completedAssessment.draftSha256=context.draftSha256;manifest.completedAssessment.contextSha256=sha256(stableJSON(context));}

test('a new scored candidate needs a proposed plan, while exclusions and legacy records stay unchanged',async()=>{
 const f=await fixture(),before=stableJSON(f);
 assert.deepEqual(candidatePlanReasons(f.draft),[]);
 assert.ok(candidatePlanReasons(f.draft,{candidatePlanVersion:1}).some(reason=>reason.includes('proposed experiment plan')));
 assert.deepEqual(candidatePlanReasons({candidates:[],rejected:f.draft.rejected},{candidatePlanVersion:1}),[]);
 assert.deepEqual(candidatePlanReasons({candidates:[{title:'An unscored structural row'}]},{candidatePlanVersion:1}),[]);
 for(const version of [null,0,2,'1'])assert.ok(candidatePlanVersionReasons(version).length);
 assert.equal(stableJSON(f),before);
});

test('a complete below-threshold plan remains a proposal and does not alter scores or claim execution',async()=>{
 const f=await fixture(),originalScores=stableJSON(f.draft.candidates[0].scoring),originalSources=stableJSON(f.context.sources);
 f.draft.candidates[0].experimentPlan=plan();f.context.candidatePlanVersion=1;bind(f.draft,f.context,f.manifest);
 assert.deepEqual(candidatePlanReasons(f.draft,{candidatePlanVersion:1}),[]);
 assert.equal(weightedOverall(f.draft.candidates[0].scoring.criteria,f.context.scoringPolicy.weights),4.4);
 assert.deepEqual(completedAssessmentReasons(f.draft,f.context,f.manifest),[]);
 const view=checkerAssessmentView(f.draft,f.context,{role:'checker'});
 assert.deepEqual(view.draft.candidates[0].experimentPlan,plan());assert.equal(view.draft.posts.length,0);
 assert.equal(stableJSON(f.draft.candidates[0].scoring),originalScores);assert.equal(stableJSON(f.context.sources),originalSources);
 assert.equal(view.draft.candidates[0].experimentPlan.status,'proposed');
 for(const field of ['testsPassed','approved','executionEvidence','score'])assert.equal(view.draft.candidates[0].experimentPlan[field],undefined);
});

test('missing, malformed, private or execution-labelled new plans cannot complete a no-post assessment',async()=>{
 for(const mutate of [candidate=>{},candidate=>candidate.experimentPlan=null,candidate=>candidate.experimentPlan={...plan(),status:'tested'},candidate=>candidate.experimentPlan={...plan(),testResults:'All tests passed'},candidate=>candidate.experimentPlan={...plan(),inputs:[]},candidate=>candidate.experimentPlan={...plan(),steps:['Run it.']},candidate=>candidate.experimentPlan={...plan(),acceptanceCheck:''},candidate=>candidate.experimentPlan={...plan(),humanBoundary:''},candidate=>candidate.experimentPlan={...plan(),unverified:[]},candidate=>candidate.experimentPlan={...plan(),output:'Contact person@example.invalid with this output.'}]){
  const f=await fixture();mutate(f.draft.candidates[0]);f.context.candidatePlanVersion=1;bind(f.draft,f.context,f.manifest);
  assert.ok(candidatePlanReasons(f.draft,{candidatePlanVersion:1}).length,mutate.toString());
  assert.ok(completedAssessmentReasons(f.draft,f.context,f.manifest).length,mutate.toString());
 }
 const legacy=await fixture();assert.deepEqual(completedAssessmentReasons(legacy.draft,legacy.context,legacy.manifest),[]);
});

test('the sealed writer advisory enforces new plans without changing source assignments or historical coverage',async()=>{
 const f=await fixture(),before=stableJSON(f),options={runId,research:f.research,selection:f.selection,expectedResearchSha256:sha256(stableJSON(f.research)),expectedSelectionSha256:sha256(stableJSON(f.selection))};
 assert.equal(sealedWriterCoverage(f.draft,options).valid,true);
 f.research.candidatePlanVersion=1;options.expectedResearchSha256=sha256(stableJSON(f.research));
 const missing=sealedWriterCoverage(f.draft,options);assert.equal(missing.valid,false);assert.equal(missing.missing.length,0);assert.match(missing.reasons.join(' '),/proposed experiment plan/);
 f.draft.candidates[0].experimentPlan=plan();const good=sealedWriterCoverage(f.draft,options);assert.equal(good.valid,true);assert.equal(good.coverageOnly,true);assert.equal(good.coveredAssignedCount,2);
 const fresh=await fixture();assert.equal(stableJSON(fresh),before);
});

test('new discussion research seals the version before model access',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-plan-snapshot-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(path.join(root,'data','sources'),{recursive:true});await cp(new URL('../data/sources/registry.json',import.meta.url),path.join(root,'data','sources','registry.json'));await cp(new URL('../RULES.md',import.meta.url),path.join(root,'RULES.md'));
 const now=new Date('2026-10-27T13:00:00.000Z');
 const result=await researchSnapshot({root,runId:'loop-712-1',now,discussionOnly:true,researchPolicy:{mode:'repair',widened:true,fallbackEnabled:true,maxLeads:10,cooldownHours:3},env:{GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'xndanius/while-you-sleep',GITHUB_RUN_ID:'712',GITHUB_RUN_ATTEMPT:'1',SOURCE_HEAD_SHA:'a'.repeat(40)},scan:async definitions=>({sources:[],observations:definitions.map(definition=>({feedId:definition.id,url:definition.url,status:'failed',itemCount:0,fetchedAt:now.toISOString(),message:'Synthetic offline unavailable source.'})),originMap:[]})});
 assert.equal(result.snapshot.learningSelection.selectionStrategy,'discussion-first-v1');assert.equal(result.snapshot.candidatePlanVersion,1);assert.equal(result.research_sha256,sha256(stableJSON(result.snapshot)));
 const disk=JSON.parse(await readFile(path.join(root,'data','research','loop-712-1.json'),'utf8'));assert.equal(disk.candidatePlanVersion,1);
});

test('the real checker preparation rejects a missing new plan before DNS or HTTP and preserves original inputs',async t=>{
 const f=await fixture(),root=await mkdtemp(path.join(os.tmpdir(),'wys-plan-check-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const directory of ['lib','scripts'])await cp(new URL('../'+directory,import.meta.url),path.join(root,directory),{recursive:true});
 await mkdir(path.join(root,'public'));for(const name of ['schedule.js','cadence-config.js'])await cp(new URL('../public/'+name,import.meta.url),path.join(root,'public',name));await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),path.join(root,'node_modules'),'dir');await writeFile(path.join(root,'package.json'),'{"type":"module"}');
 await cp(new URL('../RULES.md',import.meta.url),path.join(root,'RULES.md'));await mkdir(path.join(root,'data','sources'),{recursive:true});await cp(new URL('../data/sources/registry.json',import.meta.url),path.join(root,'data','sources','registry.json'));
 f.research.candidatePlanVersion=1;
 for(const [directory,value] of [['drafts',f.draft],['research',f.research],['learning-selection',f.selection],['scheduling',f.scheduling]]){await mkdir(path.join(root,'data',directory),{recursive:true});await writeFile(path.join(root,'data',directory,runId+'.json'),JSON.stringify(value));}
 const draftFile=path.join(root,'data','drafts',runId+'.json'),before=await readFile(draftFile,'utf8'),countsFile=path.join(root,'network-counts.json'),preload=path.join(root,'offline.mjs');
 await writeFile(preload,`import dns from 'node:dns/promises';import {syncBuiltinESMExports} from 'node:module';import {writeFileSync} from 'node:fs';const counts={dns:0,http:0};dns.lookup=async()=>{counts.dns++;throw new Error('Offline fixture');};syncBuiltinESMExports();globalThis.fetch=async()=>{counts.http++;throw new Error('Offline fixture');};process.on('exit',()=>writeFileSync(${JSON.stringify(countsFile)},JSON.stringify(counts)));`);
 const result=spawnSync(process.execPath,['scripts/prepare-check.mjs',runId],{cwd:root,encoding:'utf8',env:{PATH:process.env.PATH,NODE_OPTIONS:'--import='+preload,GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',DEMAND_CONTRACT_VERSION:'1',LOOP_SCHEDULING_SHA:sha256(stableJSON(f.scheduling)),EXPECTED_RESEARCH_SHA:sha256(stableJSON(f.research)),EXPECTED_LEARNING_SELECTION_SHA:sha256(stableJSON(f.selection))}});
 assert.equal(result.status,1);assert.match(result.stderr,/proposed experiment plan/);assert.deepEqual(JSON.parse(await readFile(countsFile,'utf8')),{dns:0,http:0});assert.equal(await readFile(draftFile,'utf8'),before);
 await assert.rejects(readFile(path.join(root,'data','check-context',runId+'.json')),error=>error.code==='ENOENT');
});
