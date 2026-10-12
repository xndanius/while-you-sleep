import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {CODE_FREEZE,codeFreezeActive,codeFreezeStatus,isFrozenCodePath,codeSnapshot,assertCodeFreeze} from '../lib/code-freeze.mjs';

test('the Vilnius lecture freeze starts at Monday 18:00 and ends Tuesday 15:00 exactly',()=>{
  assert.equal(codeFreezeActive('2026-10-12T14:59:59.999Z'),false);
  assert.equal(codeFreezeActive(CODE_FREEZE.startsAt),true);
  assert.equal(codeFreezeActive('2026-10-13T11:59:59.999Z'),true);
  assert.equal(codeFreezeActive(CODE_FREEZE.endsAt),false);
  assert.equal(codeFreezeStatus('2026-10-12T14:00:00Z').state,'planned');
  assert.equal(codeFreezeStatus('2026-10-12T16:00:00Z').state,'active');
  assert.equal(codeFreezeStatus(CODE_FREEZE.endsAt).state,'ended');
  assert.throws(()=>codeFreezeActive('unknown'),/valid clock/);
});

test('code includes workflows, prompts, rules and assets while content and source records may continue',()=>{
  for(const file of ['RULES.md','AGENTS.md','package-lock.json','.github/workflows/loop.yml','.github/codex/prompts/checker.md','lib/validation.mjs','scripts/build-data.mjs','public/machine.js','public/index.html','public/styles.css','public/cadence-config.js'])assert.equal(isFrozenCodePath(file),true,file);
  for(const file of ['data/posts/post.json','data/clock/state.json','data/sources/registry.json','README.md','metrics.json','docs/AUDIT.md','public/cards/post.jpg','public/api/machine.json','public/feed.xml','public/best.xml','public/p/post/index.html','public/machine/index.html','public/method/index.html'])assert.equal(isFrozenCodePath(file),false,file);
});

test('unchanged code still deploys new hosted records during the freeze; edits, additions and removals are blocked',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'wys-code-freeze-'));
  t.after(()=>rm(root,{recursive:true,force:true,maxRetries:3}));
  const git=spawnSync('git',['init','-q'],{cwd:root,encoding:'utf8'});assert.equal(git.status,0,git.stderr);
  const put=async(file,text)=>{await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),text);};
  await put('RULES.md','Frozen six point threshold.');await put('lib/runner.mjs','export const version=1;');await put('public/styles.css','body{color:white;}');
  const snapshot=await codeSnapshot(root),manifest={schema:1,...CODE_FREEZE,sealedAt:'2026-10-12T08:00:00Z',...snapshot},now='2026-10-12T16:00:00Z';
  await put('data/posts/new.json','{"published":true}');await put('data/clock/state.json','{"tick":2}');await put('README.md','Updated token totals');await put('public/cards/new.jpg','new card');await put('metrics.json','{"views":null}');
  assert.equal((await assertCodeFreeze({root,now,manifest})).codeSha256,snapshot.codeSha256);
  await put('lib/runner.mjs','export const version=2;');await assert.rejects(assertCodeFreeze({root,now,manifest}),/Changed files: lib\/runner.mjs/);
  await put('lib/runner.mjs','export const version=1;');await put('scripts/new-code.mjs','new code');await assert.rejects(assertCodeFreeze({root,now,manifest}),/scripts\/new-code.mjs/);
  await rm(path.join(root,'scripts/new-code.mjs'));await rm(path.join(root,'public/styles.css'));await assert.rejects(assertCodeFreeze({root,now,manifest}),/public\/styles.css/);
  await assert.rejects(assertCodeFreeze({root,now,manifest:{...manifest,sealedAt:now}}),/baseline/);
  assert.equal((await assertCodeFreeze({root,now:CODE_FREEZE.endsAt,manifest})).state,'ended');
});
