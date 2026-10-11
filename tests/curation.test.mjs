import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,cp,rm} from 'node:fs/promises';
import {rmSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {contentHash} from '../lib/validation.mjs';
import {parseScoringPolicy,publishedScoring,scoringPolicyHash} from '../lib/scoring.mjs';
import {validateCurationConfig,curationSlots,curationDecision,validateCurationReceipt,validateCurationReceipts,validatedCurationPicks,selectCurationPost,curationStatus,readCurationRecords} from '../lib/curation.mjs';
import {curationReceipt,prepareCurationGate,publishCuration} from '../scripts/curate-posts.mjs';
import {scoringFixture} from './fixtures/scoring.mjs';

const config={schema:1,enabled:true,activatedAt:'2026-10-12T06:00:00.000Z'},now=new Date('2026-10-12T09:25:00.000Z'),evening=new Date('2026-10-12T15:25:00.000Z'),env={RUN_ID:'curate-200-1',GITHUB_EVENT_NAME:'workflow_dispatch'};
function checkedPost(id,{values={},publishedAt='2026-10-12T08:00:00.000Z'}={}){
 const fixture=scoringFixture(),post=structuredClone(fixture.original),criteria=structuredClone(fixture.criteria),source={...fixture.source,id:'source-'+id,url:'https://example.com/'+id};
 post.id=id;post.candidateId=id;post.title='Synthetic curation fixture '+id;post.productUrl=source.url;post.publishedAt=publishedAt;post.sources=[Object.fromEntries(Object.entries(source).filter(([key])=>key!=='text'))];
 for(const key of Object.keys(criteria)){criteria[key].value=values[key]??8;criteria[key].sourceIds=[source.id];}
 post.checker.scoreChecks=fixture.scoreChecks.map(check=>({...check,maxSupportedScore:criteria[check.criterion].value,sourceId:source.id}));post.checker.scoreSources=[source];post.checker.sourceSnapshotSha256=sha256(stableJSON([source]));post.checker.scoringPolicy=fixture.policy;
 post.scoring=publishedScoring(criteria,fixture.policy,{checkedAt:fixture.timestamp,checkerRunId:post.checker.checkerRunId});post.contentSha256=contentHash(post);return post;
}
async function pickedReceipt(post,{when=now,activation=config,prior=[],policy=scoringFixture().policy,runEnv=env}={}){
 const slot=curationSlots(activation,when).filter(slot=>Date.parse(slot.scheduledAt)<=when.getTime()&&!prior.some(receipt=>receipt.slotId===slot.id))[0],pick=await selectCurationPost({config:activation,posts:[post],policy,receipts:prior,now:when});
 return curationReceipt({slot,config:activation,pick,receipts:prior,policy,rulesSha256:sha256(scoringFixture().rules),env:runEnv,now:when});
}
test('activation enables only future current-day fixed odd-minute slots; disabled and preactivation slots remain untouched',()=>{
 assert.deepEqual(validateCurationConfig({schema:1,enabled:false,activatedAt:null}),[]);assert.equal(curationDecision({config:{schema:1,enabled:false,activatedAt:null},now}).due,false);
 assert.ok(validateCurationConfig({...config,minimumScore:1}).length);assert.ok(validateCurationConfig({...config,activatedAt:null}).length);
 assert.deepEqual(curationSlots(config,now).map(slot=>slot.localTime),['12:17','18:17']);assert.equal(curationDecision({config,now}).slots.length,1);
 const afterNoon={...config,activatedAt:'2026-10-12T10:00:00.000Z'};assert.equal(curationDecision({config:afterNoon,now}).due,false);assert.deepEqual(curationSlots(afterNoon,evening).map(slot=>slot.localTime),['18:17']);
 const nextDay=curationDecision({config,now:new Date('2026-10-13T06:00:00Z')});assert.equal(nextDay.due,false,'yesterday missed slots are not backfilled');
});
test('selection uses current unrounded checked weights, exact twelve-hour window and stable tie-breaking',async()=>{
 const policy=scoringFixture().policy,older=checkedPost('older',{publishedAt:'2026-10-12T07:00:00.000Z'}),newer=checkedPost('newer'),best=checkedPost('best',{values:{ease:9}});
 assert.equal((await selectCurationPost({config,posts:[older,newer,best],policy,now})).postId,'best');
 assert.equal((await selectCurationPost({config,posts:[older,newer],policy,now})).postId,'newer');
 const a=checkedPost('alpha'),z=checkedPost('zeta');assert.equal((await selectCurationPost({config,posts:[z,a],policy,now})).postId,'alpha');
 const tooOld=checkedPost('old',{publishedAt:'2026-10-12T05:59:59.000Z'}),future=checkedPost('future',{publishedAt:'2026-10-12T09:26:00.000Z'});assert.equal(await selectCurationPost({config,posts:[tooOld,future],policy,now}),null);
 const historical={...config,activatedAt:'2026-10-10T00:00:00.000Z'},expired=checkedPost('expired',{publishedAt:'2026-10-11T21:24:59.999Z'});assert.equal(await selectCurationPost({config:historical,posts:[expired],policy,now}),null);
 const values={ease:7,profit:7,feasibility:7,autonomy:7,evidence:6},below=checkedPost('below',{values}),weights={...policy.weights,evidence:0.1},roundedPolicy={weights,threshold:6,policySha256:scoringPolicyHash(weights,6)};
 assert.equal(await selectCurationPost({config,posts:[below],policy:roundedPolicy,now}),null,'a mean that rounds to 7 must not qualify');
 assert.equal(await selectCurationPost({config:{schema:1,enabled:false,activatedAt:null},posts:[best],policy,now}),null);
});
test('picked receipts freeze verified criteria and policy; builds can verify them after a later weight change',async()=>{
 const post=checkedPost('selected'),receipt=await pickedReceipt(post),before=stableJSON(post);
 assert.deepEqual(validateCurationReceipt(receipt,{config,posts:[post]}),[]);assert.equal(receipt.pick.scoring.overall,8);
 const picks=await validatedCurationPicks({config,receipts:[receipt],posts:[post]});assert.equal(picks[0].postId,post.id);assert.equal(picks[0].pickedAt,now.toISOString());assert.equal(stableJSON(post),before);
 const altered=structuredClone(receipt);altered.pick.scoring.overall=9;assert.ok(validateCurationReceipt(altered,{config}).length);
 const broken=structuredClone(post);broken.checker.scoreChecks[0].maxSupportedScore=1;await assert.rejects(validatedCurationPicks({config,receipts:[receipt],posts:[broken]}),/checked scores/);
 const historical={...config,activatedAt:'2026-10-12T08:01:00.000Z'};assert.ok(validateCurationReceipt(receipt,{config:historical}).length);
});
test('terminal empty decisions settle exactly one slot and never retry it on later clock ticks',async()=>{
 const policy=scoringFixture().policy,slot=curationDecision({config,now}).slots[0],receipt=curationReceipt({slot,config,pick:null,receipts:[],policy,rulesSha256:sha256('rules'),env,now});
 assert.equal(receipt.outcome,'empty');assert.equal(receipt.scheduleStatus,'completed');assert.equal(curationDecision({config,receipts:[receipt],now:new Date('2026-10-12T10:30:00Z')}).due,false);
 assert.equal(curationDecision({config,receipts:[receipt],now:evening}).slots[0].localTime,'18:17');
 const status=curationStatus({config,receipts:[receipt],now});assert.equal(status.totalPicks,0);assert.equal(status.nextSelectionAt,'2026-10-12T15:17:00.000Z');assert.equal(status.lastDecision.status,'empty');assert.equal(status.lastSelectionAt,null);
});
test('prior picks are never selected again and duplicate receipts, slots or post IDs fail closed',async()=>{
 const first=checkedPost('first'),second=checkedPost('second',{values:{ease:7}}),receipt=await pickedReceipt(first);
 assert.equal((await selectCurationPost({config,posts:[first,second],policy:scoringFixture().policy,receipts:[receipt],now:evening})).postId,'second');
 assert.ok(validateCurationReceipts([receipt,receipt],{config}).some(reason=>reason.includes('terminal slot')));
 const secondReceipt=await pickedReceipt(first,{when:evening});assert.ok(validateCurationReceipts([receipt,secondReceipt],{config}).some(reason=>reason.includes('already picked')));
 await assert.rejects(validatedCurationPicks({config,receipts:[receipt,secondReceipt],posts:[first]}),/already picked/);
});
test('receipt validation blocks changed originals, extra fields, foreign workflow identity and preactivation picks',async()=>{
 const post=checkedPost('tested'),receipt=await pickedReceipt(post);
 for(const mutate of [value=>value.extra=true,value=>value.githubRunUrl='https://github.com/other/repo/actions/runs/200',value=>value.pick.publishedAt='2026-10-12T05:00:00.000Z',value=>value.windowStart='2026-10-12T00:00:00.000Z',value=>value.scheduledAt='2026-10-13T09:17:00.000Z',value=>value.pick.scoring.criteria.ease.value=9]){
  const altered=structuredClone(receipt);mutate(altered);assert.ok(validateCurationReceipt(altered,{config,posts:[post]}).length);
 }
 const changed={...post,title:'Changed'};changed.contentSha256=contentHash(changed);assert.ok(validateCurationReceipt(receipt,{config,posts:[changed]}).length);
});
test('cheap planner can import and run in a clean checkout without third-party modules',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-curation-node-only-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await cp(new URL('../lib',import.meta.url),path.join(root,'lib'),{recursive:true});await mkdir(path.join(root,'public'));for(const file of ['schedule.js','cadence-config.js'])await cp(new URL('../public/'+file,import.meta.url),path.join(root,'public',file));await writeFile(path.join(root,'package.json'),'{"type":"module"}');
 const code="import {curationDecision} from './lib/curation.mjs';console.log(curationDecision({config:{schema:1,enabled:false,activatedAt:null}}).due)";
 const result=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'false');
});
async function curatorFixture(t,{posts=[checkedPost('one')],activation=config}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-curation-script-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(path.join(root,'data','curation'),{recursive:true});await mkdir(path.join(root,'data','posts'),{recursive:true});
 await writeFile(path.join(root,'data','curation','config.json'),JSON.stringify(activation));await writeFile(path.join(root,'RULES.md'),scoringFixture().rules);
 const originals=new Map();for(const post of posts){const raw=JSON.stringify(post,null,2)+'\n';originals.set(post.id,raw);await writeFile(path.join(root,'data','posts',post.id+'.json'),raw);}return {root,posts,originals};
}
test('deterministic curator writes a pick once, skips duplicates and keeps every original raw byte',async t=>{
 const {root,posts,originals}=await curatorFixture(t),gate=await prepareCurationGate({root,env,now});assert.equal(gate.due,true);
 const first=await publishCuration({root,env,now,push:false});assert.equal(first.written.length,1);assert.equal(first.written[0].outcome,'picked');
 const duplicate=await publishCuration({root,env,now,push:false});assert.equal(duplicate.written.length,0);assert.equal(duplicate.committed,false);
 assert.equal((await readCurationRecords(root)).length,1);for(const post of posts)assert.equal(await readFile(path.join(root,'data','posts',post.id+'.json'),'utf8'),originals.get(post.id));
});
test('missed current-day slots catch up at most two distinct posts; old slots never backfill',async t=>{
 const {root}=await curatorFixture(t,{posts:[checkedPost('one'),checkedPost('two',{values:{evidence:7}}),checkedPost('three',{values:{ease:7}})]});
 const result=await publishCuration({root,env,now:evening,push:false});assert.equal(result.written.length,2);assert.equal(new Set(result.written.map(receipt=>receipt.pick.postId)).size,2);
 const next=await publishCuration({root,env,now:new Date('2026-10-13T06:00:00Z'),push:false});assert.equal(next.written.length,0);
});
test('initial disabled curator writes no receipt and activation excludes historical posts honestly',async t=>{
 const disabled=await curatorFixture(t,{activation:{schema:1,enabled:false,activatedAt:null}});assert.equal((await prepareCurationGate({root:disabled.root,env,now})).due,false);assert.equal((await publishCuration({root:disabled.root,env,now,push:false})).written.length,0);
 const active=await curatorFixture(t,{posts:[checkedPost('historical',{publishedAt:'2026-10-12T05:00:00.000Z'})]});const result=await publishCuration({root:active.root,env,now,push:false});assert.equal(result.written[0].outcome,'empty');assert.equal((await publishCuration({root:active.root,env,now:evening,push:false})).written[0].outcome,'empty');
});
test('push races discard only unpushed receipts and re-evaluate selection under the new main policy',async t=>{
 const {root}=await curatorFixture(t,{posts:[checkedPost('sensitive',{values:{ease:9,profit:8,feasibility:9,autonomy:9,evidence:4}})]}),ci={...env,GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'xndanius/while-you-sleep',GITHUB_REF:'refs/heads/main',GITHUB_RUN_ID:'200',GITHUB_RUN_ATTEMPT:'1'},operations=[];let pushes=0;
 const gitRun=(args)=>{
  operations.push(args);
  if(args[0]==='rev-parse')return {ok:true,stdout:'a'.repeat(40)+'\n'};
  if(args[0]==='push')return {ok:++pushes>1,stdout:''};
  if(args[0]==='reset'){rmSync(path.join(root,'data','curations'),{recursive:true,force:true});writeFileSync(path.join(root,'RULES.md'),scoringFixture().rules.replace('"evidence":1','"evidence":100'));}
  return {ok:true,stdout:''};
 };
 const result=await publishCuration({root,env:ci,now,push:true,gitRun});assert.equal(result.committed,true);assert.equal(pushes,2);assert.equal(result.written[0].outcome,'empty');assert.ok(operations.some(args=>args[0]==='reset'));
 assert.equal((await readCurationRecords(root))[0].pick,null);
});
