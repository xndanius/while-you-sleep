import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm,cp,symlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import * as development from '../lib/candidate-development.mjs';
import {sha256,stableJSON} from '../lib/storage.mjs';

const read=async(dir,id)=>JSON.parse(await readFile(new URL(`../data/${dir}/loop-${id}-1.json`,import.meta.url)));
const dirs=['runs','drafts','check-context','checks','research','source-scans','learning'];
async function isolated(t){
 const temp=await mkdtemp(path.join(os.tmpdir(),'wys-plan-memory-'));t.after(()=>rm(temp,{recursive:true,force:true}));
 for(const id of ['40769477977','40799759234','40822510539'])for(const dir of dirs){await mkdir(path.join(temp,'data',dir),{recursive:true});await writeFile(path.join(temp,'data',dir,`loop-${id}-1.json`),JSON.stringify(await read(dir,id)));}
 for(const id of ['40769477977','40822510539']){await mkdir(path.join(temp,'data/candidate-development'),{recursive:true});await writeFile(path.join(temp,'data/candidate-development',`loop-${id}-1.json`),JSON.stringify(await read('candidate-development',id)));}
 return temp;
}

test('the frozen generic CSV revision can recover its exact earlier concrete plan without changing history or claiming execution',async t=>{
 const root=await isolated(t),intent=await read('research-intents','40841532528'),before=stableJSON(intent),old=await read('drafts','40799759234');
 assert.equal(typeof development.previousContinuationPlans,'function');
 const plans=await development.previousContinuationPlans(root,intent);
 assert.equal(plans.length,1);assert.equal(plans[0].sourceRunId,'loop-40799759234-1');
 assert.deepEqual(plans[0].plan,old.candidates.find(c=>c.productUrl===intent.dossier.source.url).experimentPlan);
 assert.match(plans[0].plan.unverified.join(' '),/duplicate key.*CSV formats/);
 assert.equal(plans[0].status,'historical_proposal');assert.equal(plans[0].sourceSha256,intent.dossier.sourceSha256);
 assert.equal(Object.hasOwn(plans[0],'score'),false);assert.equal(Object.hasOwn(plans[0],'executed'),false);
 assert.equal(stableJSON(intent),before);assert.match(intent.dossier.candidate.experimentPlan.output,/human-reviewed output/);
});

const eventId=event=>{const {id,...body}=event;return sha256(stableJSON(body));};
async function putHistory(root,record){assert.deepEqual(development.candidateDevelopmentReasons(record),[]);await writeFile(path.join(root,'data/candidate-development',record.runId+'.json'),JSON.stringify(record));}

test('three post-origin projections cannot hide an older verified plan inside the bounded search',async t=>{
 const root=await isolated(t),intent=await read('research-intents','40841532528');
 const sample=(await read('candidate-development','40769477977')).events.find(e=>e.kind==='assessment');
 for(let n=1;n<=3;n++){
  const id=`loop-${900000000+n}-1`,event=structuredClone(sample);
  event.sourceRunId=id;event.details.candidateSha256=String(n).repeat(64);event.details.plan.output=`Synthetic future plan ${n} for the same task.`;
  event.details.revisionId=development.developmentRevisionId(event.caseId,event.details.candidateSha256,event.details.sourceSha256,event.details.capabilitySources);
  event.id=eventId(event);
  await putHistory(root,{schema:1,type:'candidate-development',runId:id,createdAt:`2026-10-30T0${n}:00:00.000Z`,events:[event]});
  await writeFile(path.join(root,'data/runs',id+'.json'),JSON.stringify({id,checkedAssessment:{completed:true,completedAt:`2026-10-30T0${n}:00:00.000Z`}}));
 }
 const plans=await development.previousContinuationPlans(root,intent);
 assert.equal(plans.length,1);assert.equal(plans[0].sourceRunId,'loop-40799759234-1');
});

test('historical assessment time, not projection insertion order, selects the prior plan',async t=>{
 const root=await isolated(t),intent=await read('research-intents','40841532528');
 await rm(path.join(root,'data/candidate-development'),{recursive:true});await mkdir(path.join(root,'data/candidate-development'));
 const newer=(await read('candidate-development','40822510539')).events.find(e=>e.kind==='origin');
 const older=(await read('candidate-development','40769477977')).events.find(e=>e.kind==='assessment');
 for(const [n,source] of [[1,newer],[2,older]]){
  const event=structuredClone(source);event.kind='origin';event.id=eventId(event);
  await putHistory(root,{schema:1,type:'candidate-development',runId:`loop-${800000000+n}-1`,createdAt:`2026-10-29T0${n+1}:00:00.000Z`,events:[event]});
 }
 const plans=await development.previousContinuationPlans(root,intent);
 assert.equal(plans.length,1);assert.equal(plans[0].sourceRunId,'loop-40799759234-1');
});

test('missing or modified historical evidence cannot restore a plan; an altered active intent fails closed',async t=>{
 const temp=await isolated(t),intent=await read('research-intents','40841532528');
 assert.equal(typeof development.previousContinuationPlans,'function');
 const old=await read('drafts','40799759234');old.candidates[0].experimentPlan.output='Unverified replacement for the original plan.';
 await writeFile(path.join(temp,'data/drafts/loop-40799759234-1.json'),JSON.stringify(old));
 let plans=await development.previousContinuationPlans(temp,intent);
 assert.ok(plans.every(p=>p.sourceRunId!=='loop-40799759234-1'));
 await rm(path.join(temp,'data/drafts/loop-40769477977-1.json'));
 assert.deepEqual(await development.previousContinuationPlans(temp,intent),[]);
 const changed=structuredClone(intent);changed.dossier.sourceSha256='f'.repeat(64);
 await assert.rejects(development.previousContinuationPlans(temp,changed));
});

test('an otherwise valid history projection cannot invent a checked candidate hash',async t=>{
 const root=await isolated(t),intent=await read('research-intents','40841532528'),record=await read('candidate-development','40822510539');
 const event=record.events.find(e=>e.kind==='origin');event.details.candidateSha256='f'.repeat(64);event.id=eventId(event);await putHistory(root,record);
 const plans=await development.previousContinuationPlans(root,intent);
 assert.ok(plans.every(plan=>plan.candidateSha256!=='f'.repeat(64)));
 assert.ok(plans.every(plan=>plan.sourceRunId!=='loop-40799759234-1'));
});

async function prepareWriter(t,mutateResult=()=>{}){
 const temp=await isolated(t),id='40822510539',runId=`loop-${id}-1`;
 for(const dir of ['lib','scripts'])await cp(new URL('../'+dir,import.meta.url),path.join(temp,dir),{recursive:true});
 await mkdir(path.join(temp,'public'),{recursive:true});
 for(const file of ['schedule.js','cadence-config.js'])await cp(new URL('../public/'+file,import.meta.url),path.join(temp,'public',file));
 await cp(new URL('../RULES.md',import.meta.url),path.join(temp,'RULES.md'));
 await symlink(new URL('../node_modules',import.meta.url).pathname,path.join(temp,'node_modules'),'dir');
 for(const dir of ['research-intents','research-results','learning-selection']){await mkdir(path.join(temp,'data',dir),{recursive:true});await writeFile(path.join(temp,'data',dir,runId+'.json'),JSON.stringify(await read(dir,id)));}
 const intent=await read('research-intents',id),result=await read('research-results',id),freeze=path.join(temp,'clock.mjs');mutateResult(result);
 await writeFile(path.join(temp,'data/research-results',runId+'.json'),JSON.stringify(result));
 await writeFile(freeze,"import dns from 'node:dns/promises';import {syncBuiltinESMExports} from 'node:module';const D=Date;globalThis.Date=class extends D{constructor(...a){super(...(a.length?a:['2026-10-29T05:19:00.000Z']));}static now(){return D.parse('2026-10-29T05:19:00.000Z');}};dns.lookup=async()=>{throw Error('Unexpected DNS in offline plan-memory fixture');};syncBuiltinESMExports();globalThis.fetch=async()=>{throw Error('Unexpected HTTP in offline plan-memory fixture');};");
 const env={PATH:process.env.PATH,RUN_ID:runId,DEMAND_CONTRACT_VERSION:'1',EXPECTED_RESEARCH_INTENT_SHA:sha256(stableJSON(intent)),EXPECTED_RESEARCH_RESULT_SHA:sha256(stableJSON(result))};
 const run=spawnSync(process.execPath,['--import',freeze,'scripts/prepare-run.mjs','writer'],{cwd:temp,env,encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 const context=JSON.parse(await readFile(path.join(temp,'.run/context.json')));
 return {context,intent};
}

test('the real writer preparation includes separately labelled historical plans only after a verified completed continuation',async t=>{
 const {context,intent}=await prepareWriter(t);
 assert.equal(context.researchContinuation.previousCheckedPlans.length,1);
 assert.equal(context.researchContinuation.previousCheckedPlans[0].sourceRunId,'loop-40769477977-1');
 assert.deepEqual(context.researchContinuation.priorPlan,intent.dossier.candidate.experimentPlan);
 assert.equal(context.role,'writer');assert.equal(context.researchContinuation.previousCheckedPlans[0].plan.status,'proposed');
 const prompt=await readFile(new URL('../.github/codex/prompts/writer.md',import.meta.url),'utf8');
 assert.match(prompt,/docs\/SCORING_CALIBRATION\.md/);assert.match(prompt,/optional previousCheckedPlans/);
});

test('failed, interrupted or changed-source acquisition does not expose historical context as a completed continuation',async t=>{
 for(const outcome of ['failed','interrupted','changed_source']){
  const {context}=await prepareWriter(t,result=>{
   result.outcome=outcome;
   if(outcome==='interrupted')result.events.pop();
   else Object.assign(result.events.at(-1),{status:outcome==='failed'?'failed':'changed',evidenceSha256:null,code:outcome==='failed'?'http_error':'source_changed'});
  });
  assert.equal(context.researchContinuation,undefined,outcome);
 }
});
