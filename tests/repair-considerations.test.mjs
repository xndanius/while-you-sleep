import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {preserveRepairConsiderations} from '../scripts/preserve-repair-considerations.mjs';
import {canonicalURL,sha256,stableJSON} from '../lib/storage.mjs';
import {loopDecision} from '../lib/loop-schedule.mjs';

const runId='loop-777-1',now='2026-10-11T12:20:00.000Z';
const text='The product reads uploaded receipts and extracts structured fields for review. It exports parsed fields as CSV. Human approval remains required before records are sent.';
const rules='<!-- scoring-policy:start -->\n```json\n{"weights":{"ease":1,"profit":1,"feasibility":1,"autonomy":1,"evidence":1},"publishThreshold":6}\n```\n<!-- scoring-policy:end -->\n';
const row=index=>({title:`Considered product ${index}`,productUrl:`https://example.org/tool-${index}`,sourceIds:[`source-${index}`],reason:'The independently assessed scope is unsupported.'});
function fixture(count=12){const candidates=Array.from({length:count},(_,i)=>row(i)),first={runId,targetCount:1,candidates,posts:[{...candidates[0]}],rejected:candidates.slice(1).map(item=>({...item}))},repaired={runId,targetCount:1,candidates:[{...candidates[0],reason:'Corrected evidence-based refusal.',scoring:{criteria:{profit:{value:4,reason:'Hypothesis: demand remains unproved.'}}}}],posts:[],rejected:[{...candidates[0],reason:'Repair mean remains below the frozen threshold.'}]},context={runId,draftSha256:sha256(stableJSON(first))};return {first,context,repaired,expected:{expectedDraftSha256:sha256(stableJSON(first)),expectedContextSha256:sha256(stableJSON(context))}};}
function bind(f){f.context.draftSha256=sha256(stableJSON(f.first));f.expected={expectedDraftSha256:f.context.draftSha256,expectedContextSha256:sha256(stableJSON(f.context))};}

test('repair dropping eleven exclusions restores the original twelve-product batch without restoring an old proposal',()=>{
 const f=fixture(),before=stableJSON(f),result=preserveRepairConsiderations(f.first,f.context,f.repaired,f.expected);assert.equal(result.candidates.length,12);assert.equal(result.rejected.length,12);assert.deepEqual(result.posts,[]);assert.equal(result.candidates[0].reason,f.repaired.candidates[0].reason);assert.deepEqual(result.candidates[0].scoring,f.repaired.candidates[0].scoring);assert.equal(result.repairAttempt,1);assert.equal(new Set(result.candidates.map(item=>canonicalURL(item.productUrl))).size,12);assert.equal(stableJSON(f),before);assert.deepEqual(preserveRepairConsiderations(f.first,f.context,result,f.expected),result);
});

test('canonical duplicate URLs merge and repaired rows win while active posts have no resurrected refusal',()=>{
 const f=fixture(2);f.repaired.candidates[0].productUrl+='?utm_source=repair#fragment';f.repaired.posts=[{...f.first.candidates[1],productUrl:f.first.candidates[1].productUrl+'/'}];f.repaired.rejected.push({...f.first.candidates[1]});const result=preserveRepairConsiderations(f.first,f.context,f.repaired,f.expected);assert.equal(result.candidates.length,2);assert.equal(result.candidates[0].reason,'Corrected evidence-based refusal.');assert.equal(result.rejected.length,1);assert.deepEqual(result.posts,f.repaired.posts);
});

test('saved first files cannot establish their own trust after mutation and every reservation must match',()=>{
 for(const change of [f=>f.first.candidates[1].reason='Changed after original check.',f=>f.context.extra='Changed context.',f=>f.repaired.runId='loop-778-1',f=>f.repaired.targetCount=2]){const f=fixture();change(f);assert.throws(()=>preserveRepairConsiderations(f.first,f.context,f.repaired,f.expected));}
 const f=fixture();f.first.candidates[1].reason='Rehashed by model.';f.context.draftSha256=sha256(stableJSON(f.first));assert.throws(()=>preserveRepairConsiderations(f.first,f.context,f.repaired,f.expected),/trusted checker job fingerprints/);assert.throws(()=>preserveRepairConsiderations(f.first,f.context,f.repaired),/trusted checker job fingerprints/);
});

test('thirteen distinct union products and disappearing proposals fail closed without truncation',()=>{
 const f=fixture();f.repaired.candidates.push(row(12));assert.throws(()=>preserveRepairConsiderations(f.first,f.context,f.repaired,f.expected),/twelve distinct/);const missing=fixture();missing.repaired.rejected=[];assert.throws(()=>preserveRepairConsiderations(missing.first,missing.context,missing.repaired,missing.expected),/explicit repair rejection/);const malformed=fixture();malformed.repaired.candidates[0].productUrl='not a URL';assert.throws(()=>preserveRepairConsiderations(malformed.first,malformed.context,malformed.repaired,malformed.expected));
});

test('the actual saved 21:07 regression recovers eleven omitted considerations with unchanged historical inputs',async()=>{
 const id='loop-38163159638-1',load=(dir,suffix='')=>readFile(new URL(`../data/${dir}/${id}${suffix}.json`,import.meta.url),'utf8').then(JSON.parse),[first,context,repaired]=await Promise.all([load('drafts','-first'),load('check-context','-first'),load('drafts')]),before=stableJSON({first,context,repaired}),result=preserveRepairConsiderations(first,context,repaired,{expectedDraftSha256:sha256(stableJSON(first)),expectedContextSha256:sha256(stableJSON(context))});assert.equal(first.candidates.length,12);assert.equal(repaired.candidates.length,1);assert.equal(result.candidates.length,12);assert.equal(result.rejected.length,12);assert.deepEqual(result.posts,[]);assert.equal(stableJSON({first,context,repaired}),before);
});

test('trusted restoration precedes fresh re-fetch and context fingerprints for all twelve actual exclusions',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-repair-considerations-'));t.after(()=>rm(root,{recursive:true,force:true}));await cp(new URL('../lib',import.meta.url),path.join(root,'lib'),{recursive:true});await cp(new URL('../scripts',import.meta.url),path.join(root,'scripts'),{recursive:true});await mkdir(path.join(root,'public'));for(const name of ['schedule.js','cadence-config.js'])await cp(new URL('../public/'+name,import.meta.url),path.join(root,'public',name));await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),path.join(root,'node_modules'),'dir');await writeFile(path.join(root,'package.json'),' {"type":"module"}');await writeFile(path.join(root,'RULES.md'),rules);
 const f=fixture(),scheduling=loopDecision({runId,eventName:'workflow_dispatch',githubRunId:'777',githubRunUrl:'https://github.com/xndanius/while-you-sleep/actions/runs/777',now:new Date(now),cadence:{schema:1,mode:'legacy',activatedAt:null,relayConfirmedAt:null}});f.first.targetCount=scheduling.targetCount;f.repaired.targetCount=scheduling.targetCount;bind(f);const sources=f.first.candidates.map((item,index)=>({id:`source-${index}`,url:item.productUrl,text,fetchedAt:now})),research={runId,createdAt:now,sources,health:[]};
 for(const [directory,name,record] of [['drafts',runId+'-first',f.first],['check-context',runId+'-first',f.context],['drafts',runId,f.repaired],['research',runId,research],['scheduling',runId,scheduling]]){await mkdir(path.join(root,'data',directory),{recursive:true});await writeFile(path.join(root,'data',directory,name+'.json'),JSON.stringify(record));}
 const preload=`import dns from 'node:dns/promises';import {syncBuiltinESMExports} from 'node:module';dns.lookup=async()=>[{address:'203.0.113.10',family:4}];syncBuiltinESMExports();globalThis.fetch=async()=>new Response(${JSON.stringify(text)},{status:200,headers:{'content-type':'text/plain'}});`;await writeFile(path.join(root,'preload.mjs'),preload);
 const env={PATH:process.env.PATH,NODE_OPTIONS:`--import=${path.join(root,'preload.mjs')}`,RUN_ID:runId,GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',LOOP_SCHEDULING_SHA:sha256(stableJSON(scheduling)),EXPECTED_FIRST_DRAFT_SHA:f.expected.expectedDraftSha256,EXPECTED_FIRST_CONTEXT_SHA:f.expected.expectedContextSha256};
 const invoke=name=>spawnSync(process.execPath,[`scripts/${name}.mjs`,runId],{cwd:root,env,encoding:'utf8'});const preserved=invoke('preserve-repair-considerations');assert.equal(preserved.status,0,preserved.stderr);const prepared=invoke('prepare-check');assert.equal(prepared.status,0,prepared.stderr);const context=JSON.parse(await readFile(path.join(root,'data','check-context',runId+'.json'),'utf8')),draft=JSON.parse(await readFile(path.join(root,'data','drafts',runId+'.json'),'utf8'));assert.equal(context.considerationEvidence.length,12);assert.equal(context.sources.length,12);assert.ok(context.sources.every(source=>source.verifiedAt&&source.text===text));assert.ok(context.considerationEvidence.every(item=>item.availableSourceIds.length===1&&item.unavailableSourceIds.length===0));assert.equal(context.draftSha256,sha256(stableJSON(draft)));assert.equal(context.sourceSnapshotSha256,sha256(stableJSON(context.sources)));assert.notEqual(context.draftSha256,f.expected.expectedDraftSha256);assert.equal(draft.candidates[0].reason,'Corrected evidence-based refusal.');
});
