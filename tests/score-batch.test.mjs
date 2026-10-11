import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {validateScoreInput,validateScoreDraft,validateScoreContext,validateScoreManifest} from '../lib/score-batch.mjs';
import {validateScoreBatch,recordScorePosts,recheckScoreEvidence} from '../scripts/record-score-posts.mjs';
import {readScoreArtifact} from '../scripts/prepare-score-check.mjs';
import {fetchScoreSources} from '../scripts/prepare-score-posts.mjs';
import {scoringFixture} from './fixtures/scoring.mjs';

test('trusted batch binds original posts, scorer criteria, frozen rules and fresh context before any approval',()=>{
 const fixture=scoringFixture(),{input,draft,context,check,env,now}=fixture;
 assert.deepEqual(validateScoreInput(input,{runId:env.RUN_ID,expectedInputSha256:env.EXPECTED_INPUT_SHA,rulesSha256:env.RULES_SHA256,rulesCommit:env.RULES_COMMIT}),[]);
 assert.deepEqual(validateScoreDraft(draft,input),[]);assert.deepEqual(validateScoreContext(context,input,draft,{expectedDraftSha256:env.EXPECTED_DRAFT_SHA,expectedContextSha256:env.EXPECTED_CONTEXT_SHA,now}),[]);assert.deepEqual(validateScoreManifest(check,context),[]);
 assert.equal(validateScoreBatch({input,draft,context,check},{env,now})[0].pass,true);
 for(const [field,mutate] of [['input',value=>value.posts[0].title='Mutated'],['draft',value=>value.posts[0].criteria.ease.value=10],['context',value=>value.sources[0].text+='Mutated'],['check',value=>value.policySha256='a'.repeat(64)]]){
  const altered=structuredClone({input,draft,context,check});mutate(altered[field]);assert.throws(()=>validateScoreBatch(altered,{env,now}));
 }
 assert.throws(()=>validateScoreBatch({input,draft,context,check},{env:{...env,EXPECTED_CONTEXT_SHA:''},now}));
 assert.throws(()=>validateScoreBatch({input,draft,context,check},{env,now:now+4*3600000}));
});
test('checker refusals and score ceilings remain audited decisions, never hand-adjusted ratings',()=>{
 const {input,draft,context,check,env,now}=scoringFixture();
 const refused=structuredClone(check);refused.checks[0].pass=false;refused.checks[0].reasons=['The proposed ease exceeds the source support.'];refused.checks[0].scoreChecks[0].maxSupportedScore=4;
 const decisions=validateScoreBatch({input,draft,context,check:refused},{env,now});assert.equal(decisions[0].pass,false);assert.equal(decisions[0].rating.criteria.ease.value,6);assert.ok(decisions[0].reasons.some(reason=>reason.includes('exceeds')));
});
test('artifact importer accepts only exact bounded JSON files and rejects extra files, symlinks and possible keys',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-score-artifact-'));
 await writeFile(path.join(root,'input.json'),'{}');assert.deepEqual(await readScoreArtifact(root,['input.json']),{input:{}});
 await writeFile(path.join(root,'code.mjs'),'throw new Error();');await assert.rejects(readScoreArtifact(root,['input.json']));
 const linkroot=await mkdtemp(path.join(os.tmpdir(),'wys-score-link-'));await symlink(path.join(root,'input.json'),path.join(linkroot,'input.json'));await assert.rejects(readScoreArtifact(linkroot,['input.json']));
 const secretroot=await mkdtemp(path.join(os.tmpdir(),'wys-score-key-'));await writeFile(path.join(secretroot,'input.json'),JSON.stringify({fake:'sk-proj-'+'x'.repeat(30)}));await assert.rejects(readScoreArtifact(secretroot,['input.json']));
});
test('source fetch failures are recorded honestly and each successful source is newly timestamped',async()=>{
 const {original,source,timestamp}=scoringFixture();
 const good=await fetchScoreSources([original],{fetchPage:async()=>({text:source.text,fetchedAt:timestamp})});assert.equal(good.sources[0].verifiedAt,timestamp);assert.deepEqual(good.health,[]);
 const failed=await fetchScoreSources([original],{fetchPage:async()=>{throw new Error('HTTP 503');}});assert.deepEqual(failed.sources,[]);assert.equal(failed.health[0].status,'failed');
});
async function stagingFixture(){
 const fixture=scoringFixture(),root=await mkdtemp(path.join(os.tmpdir(),'wys-score-record-'));
 await mkdir(path.join(root,'.staging','scoring'),{recursive:true});await mkdir(path.join(root,'data','posts'),{recursive:true});
 for(const name of ['input','draft','context','check'])await writeFile(path.join(root,'.staging','scoring',name+'.json'),JSON.stringify(fixture[name],null,2)+'\n');
 const raw=JSON.stringify(fixture.original,null,2)+'\n';await writeFile(path.join(root,'data','posts',fixture.original.id+'.json'),raw);return {...fixture,root,raw};
}
test('trusted recorder writes immutable checked sidecars and audit files while every original raw byte stays unchanged',async()=>{
 const {root,env,now,original,raw,source,timestamp}=await stagingFixture();
 const record=await recordScorePosts({root,env,now,push:false,fetchPage:async()=>({text:source.text,fetchedAt:timestamp})});assert.equal(record.status,'completed');assert.deepEqual(record.written,[original.id]);
 assert.equal(await readFile(path.join(root,'data','posts',original.id+'.json'),'utf8'),raw);
 const sidecar=JSON.parse(await readFile(path.join(root,'data','scores',original.id+'.json'),'utf8'));assert.equal(sidecar.postContentSha256,original.contentSha256);assert.equal(sidecar.batch.runId,env.RUN_ID);
 assert.equal((await readdir(path.join(root,'data','score-checks'))).length,1);
});
test('trusted recorder stores a rejection without creating a score or altering original posts',async()=>{
 const {root,env,now,original,raw,check}=await stagingFixture();check.checks[0].pass=false;check.checks[0].reasons=['Fresh source does not support this ease rating.'];
 await writeFile(path.join(root,'.staging','scoring','check.json'),JSON.stringify(check));
 const record=await recordScorePosts({root,env,now,push:false});assert.equal(record.status,'rejected');assert.deepEqual(record.written,[]);
 await assert.rejects(readFile(path.join(root,'data','scores',original.id+'.json')),{code:'ENOENT'});assert.equal(await readFile(path.join(root,'data','posts',original.id+'.json'),'utf8'),raw);
});
test('trusted recorder blocks changed originals and never accepts an artifact-owned fingerprint',async()=>{
 const {root,env,now,original}=await stagingFixture();await writeFile(path.join(root,'data','posts',original.id+'.json'),JSON.stringify({...original,promise:'Changed independently.'}));
 await assert.rejects(recordScorePosts({root,env,now,push:false}),/immutable original/);
});
test('final trusted evidence verification rejects vanished quotes and network failures without fabricating a score',async()=>{
 for(const fetchPage of [async()=>({text:'Readable changed page without the original quote. '.repeat(4)}),async()=>{throw new Error('HTTP 503');}]){
  const {root,env,now,original,raw}=await stagingFixture(),record=await recordScorePosts({root,env,now,push:false,fetchPage});
  assert.equal(record.status,'rejected');assert.deepEqual(record.written,[]);assert.ok(record.decisions[0].reasons.every(reason=>reason.includes('no longer available')));
  await assert.rejects(readFile(path.join(root,'data','scores',original.id+'.json')),{code:'ENOENT'});assert.equal(await readFile(path.join(root,'data','posts',original.id+'.json'),'utf8'),raw);
 }
});
