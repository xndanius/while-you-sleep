import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {versionBrowserAssets} from '../lib/browser-assets.mjs';

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'wys-assets-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'public'));
  await fs.writeFile(path.join(root,'public','styles.css'),'body { color: green; }');
  await fs.writeFile(path.join(root,'public','app.js'),"import {hours} from './schedule.js';\nconsole.log(hours);\n");
  await fs.writeFile(path.join(root,'public','schedule.js'),'export const hours=[8,13,19];\n');
  return root;
}

test('browser versions remain stable on repeated builds and version every module edge',async t=>{
  const root=await fixture(t),first=await versionBrowserAssets(root);
  const body=await fs.readFile(path.join(root,'public','app.js'),'utf8');
  assert.ok(body.includes(`./schedule.js?v=${first.scriptVersion}`));
  const second=await versionBrowserAssets(root);
  assert.equal(first.scriptVersion,second.scriptVersion);
  assert.equal(first.styleVersion,second.styleVersion);
  assert.equal(body,await fs.readFile(path.join(root,'public','app.js'),'utf8'));
  const html='<link href="styles.css"><script src="app.js" type="module"></script><a href="feed.xml">Feed</a>';
  const rendered=first.versionHTML(html);
  assert.ok(rendered.includes(`styles.css?v=${first.styleVersion}`));
  assert.ok(rendered.includes(`app.js?v=${first.scriptVersion}`));
  assert.equal(rendered,second.versionHTML(rendered));
  assert.ok(rendered.includes('href="feed.xml"'));
});

test('a shared cadence change refreshes an otherwise unchanged entrypoint',async t=>{
  const root=await fixture(t),old=await versionBrowserAssets(root);
  await fs.writeFile(path.join(root,'public','schedule.js'),'export const hours=Array.from({length:24},(_,i)=>i);\n');
  const fresh=await versionBrowserAssets(root);
  assert.notEqual(old.scriptVersion,fresh.scriptVersion);
  assert.equal(old.styleVersion,fresh.styleVersion);
  assert.ok((await fs.readFile(path.join(root,'public','app.js'),'utf8')).includes(`schedule.js?v=${fresh.scriptVersion}`));
  assert.ok(fresh.versionHTML('<script src="app.js"></script>').includes(`app.js?v=${fresh.scriptVersion}`));
});

test('unknown local imports fail before a generated module can be written',async t=>{
  const root=await fixture(t);
  const broken="import {bad} from './missing.js';\n";
  await fs.writeFile(path.join(root,'public','app.js'),broken);
  await assert.rejects(versionBrowserAssets(root),/public module/);
  assert.equal(await fs.readFile(path.join(root,'public','app.js'),'utf8'),broken);
});
