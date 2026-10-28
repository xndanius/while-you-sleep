import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {deriveCandidateDevelopment,reduceCandidateDevelopment,candidateDevelopmentReasons,developmentProgress,developmentRevisionId,developmentCandidateBundles} from '../lib/candidate-development.mjs';
import {researchDossiers} from '../lib/candidate-research.mjs';
import {continuationRouteKey} from '../lib/research-continuation.mjs';
import {sha256,stableJSON,hash,canonicalURL} from '../lib/storage.mjs';
const digest=x=>sha256(stableJSON(x));
const bundle=async id=>Object.fromEntries(await Promise.all(Object.entries({run:'runs',draft:'drafts',context:'check-context',manifest:'checks',research:'research',scan:'source-scans',learning:'learning'}).map(async([key,dir])=>[key,JSON.parse(await readFile(new URL(`../data/${dir}/loop-${id}-1.json`,import.meta.url)))])));

test('accepted no-post candidates retain their plans, limitations and provisional—not approved—scores',async()=>{
 const b=await bundle('40734809732'),before=stableJSON(b),record=deriveCandidateDevelopment({run:b.run,bundle:b});
 assert.deepEqual(candidateDevelopmentReasons(record),[]);assert.equal(record.events.length,4);
 const states=reduceCandidateDevelopment([record]),csv=states.find(c=>c.productUrl.endsWith('/325109'));
 assert.equal(csv.state,'needs_evidence');assert.equal(csv.revisions[0].plan.status,'proposed');assert.equal(csv.revisions[0].criteriaStatus,'writer_provisional_batch_examined');assert.deepEqual(csv.revisions[0].limitations,b.draft.candidates[1].experimentPlan.unverified);
 assert.deepEqual(reduceCandidateDevelopment([record,record]),states);assert.equal(stableJSON(b),before);
});

test('real invoice reassessment becomes a linked revision without rewriting its original4.2',async()=>{
 const first=await bundle('40549856676'),later=await bundle('40600573853'),a=deriveCandidateDevelopment({run:first.run,bundle:first}),b=deriveCandidateDevelopment({run:later.run,bundle:later,history:[a]});
 const state=reduceCandidateDevelopment([a,b]).find(c=>c.productUrl.endsWith('/118145'));
 assert.equal(state.revisions.length,2);assert.equal(state.revisions[1].parentRevisionId,state.revisions[0].revisionId);assert.equal(Object.values(state.revisions[0].provisionalCriteria).reduce((sum,c)=>sum+c.value,0)/5,4.2);assert.equal(state.publishedPostId,null);
 assert.equal(state.latestProgress,'new_capability_evidence');
});

test('image input and other unmatched capabilities stay explicit, not invented routes',async()=>{
 const b=await bundle('40743503809'),record=deriveCandidateDevelopment({run:b.run,bundle:b}),states=reduceCandidateDevelopment([record]);
 const image=states.find(c=>c.productUrl.endsWith('/118271'));assert.equal(image.state,'no_permitted_route');assert.ok(image.revisions[0].limitations.some(x=>x.includes('image transfer')));assert.deepEqual(image.revisions[0].missingReferences,[]);
 for(const id of ['50278264','50274358','50257159'])assert.equal(states.some(c=>c.productUrl.endsWith('id='+id)),false);
});

test('interrupted acquisition preserves the candidate and exact unresolved routes',async()=>{
 const b=await bundle('40734809732'),d=researchDossiers(b).find(d=>d.source.url.endsWith('/325109')),run={id:'loop-999900011-1',finishedAt:'2026-10-28T20:31:00.000Z'};
 const intent={schema:2,type:'candidate-research-intent',runId:run.id,createdAt:'2026-10-28T20:30:00.000Z',producer:{repository:'xndanius/while-you-sleep',runId:'999900011',runAttempt:1,workflow:'loop.yml',stage:'pre_model',headSha:'a'.repeat(40)},dossier:d,referenceIds:d.referenceRequests.map(r=>r.implementationReferenceId)};
 const record=deriveCandidateDevelopment({run,intent}),state=reduceCandidateDevelopment([record])[0];
 assert.equal(state.state,'attempt_unknown');assert.equal(state.routes.length,2);assert.ok(state.routes.every(r=>r.status==='unknown'));assert.deepEqual(state.revisions[0].plan,d.candidate.experimentPlan);assert.equal(state.publishedPostId,null);
});

test('route identity ignores unrelated catalog revisions but changes with source evidence',async()=>{
 const b=await bundle('40734809732'),d=researchDossiers(b)[0],ref=d.referenceRequests[0],key=continuationRouteKey(d,ref);
 assert.equal(continuationRouteKey({...d,catalogSha256:'f'.repeat(64)},ref),key);assert.notEqual(continuationRouteKey({...d,sourceSha256:'f'.repeat(64)},ref),key);
 assert.notEqual(continuationRouteKey({...d,id:hash('https://news.ycombinator.com/item?id=99999999'),source:{...d.source,url:'https://news.ycombinator.com/item?id=99999999'}},ref),key,'Two cases with identical text cannot consume each other\'s route.');
});

test('lifecycle records cannot mint a publication and verified publication is terminal and deduplicated',async()=>{
 const post=JSON.parse(await readFile(new URL('../data/posts/b89af4e5c65cc81c424c080b.json',import.meta.url))),url=canonicalURL(post.productUrl),details={postId:post.id,contentSha256:post.contentSha256,publishedAt:post.publishedAt,manifestSha256:'a'.repeat(64)},body={kind:'publication',caseId:hash(url),productUrl:url,sourceRunId:post.runId,details},record={schema:1,type:'candidate-development',runId:post.runId,createdAt:post.publishedAt,events:[{id:digest(body),...body}]};
 assert.equal(reduceCandidateDevelopment([record],{posts:[]})[0].publishedPostId,null);
 const good=reduceCandidateDevelopment([record,record],{posts:[post]})[0];assert.equal(good.state,'published');assert.equal(good.history.length,1);
 const forged=structuredClone(post);forged.title+=' changed';assert.equal(reduceCandidateDevelopment([record],{posts:[forged]})[0].publishedPostId,null);
 const corrupt=structuredClone(record);corrupt.events[0].details.postId='invented';assert.ok(candidateDevelopmentReasons(corrupt).length);
 const different=structuredClone(body);different.productUrl='https://news.ycombinator.com/item?id=99999999';different.caseId=hash(different.productUrl);const unrelated={...record,events:[{id:digest(different),...different}]};assert.notEqual(reduceCandidateDevelopment([unrelated],{posts:[post]})[0].state,'published');
});

test('unverified or changed assessment bundles create no invented revision',async()=>{
 const b=await bundle('40734809732');b.context.sources[0].text+=' changed';assert.equal(deriveCandidateDevelopment({run:b.run,bundle:b}),null);
});

test('a wording-only plan revision is not counted as new evidence',()=>{
 const before={candidateSha256:'a',sourceSha256:'same-source',capabilitySources:[{sourceId:'doc',textSha256:'same-text'}]};
 assert.equal(developmentProgress(before,{...before,candidateSha256:'new-wording'}),'plan_only_revision');
 assert.equal(developmentProgress(before,{...before,capabilitySources:[{sourceId:'doc',textSha256:'new-text'}]}),'new_capability_evidence');
 assert.equal(developmentProgress(before,{...before,sourceSha256:'changed-source'}),'source_evidence_changed');
 assert.notEqual(developmentRevisionId('case','same-plan','same-source',before.capabilitySources),developmentRevisionId('case','same-plan','same-source',[{sourceId:'doc',textSha256:'new-text'}]));
});

test('reprocessing an older run after a newer revision cannot assign a future parent',async()=>{
 const first=await bundle('40549856676'),later=await bundle('40600573853'),a=deriveCandidateDevelopment({run:first.run,bundle:first}),b=deriveCandidateDevelopment({run:later.run,bundle:later,history:[a]});
 assert.deepEqual(deriveCandidateDevelopment({run:first.run,bundle:first,history:[b]}),a);
});

test('persistent development records restore older candidate bundles without another discovery or model call',async t=>{
 const b=await bundle('40734809732'),record=deriveCandidateDevelopment({run:b.run,bundle:b}),root=await mkdtemp(path.join(os.tmpdir(),'wys-case-history-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const dirs={run:'runs',draft:'drafts',context:'check-context',manifest:'checks',research:'research',scan:'source-scans',learning:'learning'};
 for(const [key,dir] of Object.entries(dirs)){await mkdir(path.join(root,'data',dir),{recursive:true});await writeFile(path.join(root,'data',dir,b.run.id+'.json'),JSON.stringify(b[key]));}
 await mkdir(path.join(root,'data/candidate-development'));await writeFile(path.join(root,'data/candidate-development',b.run.id+'.json'),JSON.stringify(record));
 const restored=await developmentCandidateBundles(root);assert.equal(restored.length,1);assert.deepEqual(restored[0],b);
});
