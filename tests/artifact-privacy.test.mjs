import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {guardPrivateArtifacts,privateArtifactReasons} from '../scripts/guard-private-artifacts.mjs';
import {createNoveltyContext} from '../lib/novelty.mjs';

async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'wys-privacy-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
async function put(root,file,value){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),JSON.stringify(value));}
test('privacy guard rejects contact/profile fields and contact patterns without emitting their values',()=>{
 for(const value of [{note:'person@example.invalid'},{phone:'+37060000000'},{author:'Fictional Person'},{profile:{any:'content'}}])assert.ok(privateArtifactReasons(value).length);
 assert.deepEqual(privateArtifactReasons({kind:'public_tender',noticeId:'000123-2026',publishedAt:'2026-10-12T11:00:00.000Z',chore:'Catalogue office records.'}),[]);
});
test('unsafe writer artifact set is deleted rather than redacted, rewritten or approved',async t=>{
 const root=await fixture(t),runId='loop-123-1';await put(root,`data/research/${runId}.json`,{sources:[]});await put(root,`data/drafts/${runId}.json`,{whoPays:'person@example.invalid'});
 const result=await guardPrivateArtifacts({root,runId,phase:'writer',env:{}});assert.equal(result.safe,false);assert.equal(JSON.stringify(result).includes('person@example'),false);
 for(const directory of ['research','drafts'])await assert.rejects(stat(path.join(root,'data',directory,runId+'.json')),error=>error.code==='ENOENT');
});
test('independent checker final response is guarded before manifest acceptance/upload',async t=>{
 const root=await fixture(t),runId='loop-123-1';await put(root,`.run/checker-response.json`,{reason:'Send private details to person@example.invalid'});await put(root,`data/checks/${runId}.json`,{checks:[]});
 const result=await guardPrivateArtifacts({root,runId,phase:'checker',env:{}});assert.equal(result.safe,false);await assert.rejects(stat(path.join(root,'.run','checker-response.json')),error=>error.code==='ENOENT');
});
test('a checker context with real recent-post novelty signals passes while literal profile fields stay forbidden',async t=>{
 const posts=await Promise.all(['e20bcacf021524725d3fc275','98b4f6281cc3de4ecdfa95f6'].map(id=>readFile(new URL(`../data/posts/${id}.json`,import.meta.url),'utf8').then(JSON.parse)));
 const root=await fixture(t),runId='loop-123-1',file=`data/check-context/${runId}.json`,context={noveltyContractVersion:1,noveltyContext:createNoveltyContext(posts,{now:new Date('2026-10-12T12:00:00Z')})};
 await put(root,file,context);const before=await readFile(path.join(root,file));assert.deepEqual(privateArtifactReasons(context),[]);assert.equal((await guardPrivateArtifacts({root,runId,phase:'checker',env:{}})).safe,true);assert.deepEqual(await readFile(path.join(root,file)),before);
 assert.ok(privateArtifactReasons({profile:context.noveltyContext.posts[0].noveltySignals}).includes('Personal/contact/profile fields are forbidden in stored content artifacts.'));
});
test('safe protected pre-model selector survives a withheld scan so learning remains honestly unknown',async t=>{
 const root=await fixture(t),runId='loop-123-1',selection={id:runId,runId,type:'learning-selection',producer:{stage:'pre_model'}};
 await put(root,`data/learning-selection/${runId}.json`,selection);await put(root,`data/research/${runId}.json`,{note:'person@example.invalid'});
 const result=await guardPrivateArtifacts({root,runId,phase:'scan',env:{}});assert.equal(result.safe,false);assert.equal(result.selectionSafe,true);assert.deepEqual(JSON.parse(await readFile(path.join(root,'data','learning-selection',runId+'.json'),'utf8')),selection);
 await assert.rejects(stat(path.join(root,'data','research',runId+'.json')),error=>error.code==='ENOENT');
});
test('a safe phase remains byte-for-byte intact and emits no approval',async t=>{
 const root=await fixture(t),runId='loop-123-1',file=`data/drafts/${runId}.json`,record={segment:'public_sector',chore:'Catalogue office records.'};await put(root,file,record);const before=await readFile(path.join(root,file));
 const result=await guardPrivateArtifacts({root,runId,phase:'writer',env:{}});assert.equal(result.safe,true);assert.deepEqual(await readFile(path.join(root,file)),before);assert.equal(Object.hasOwn(result,'approved'),false);
});
