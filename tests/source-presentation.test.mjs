import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedSourceView} from '../lib/source-presentation.mjs';

test('source presentation separates measured zero, unmeasured history and absent score samples',()=>{
  const view={schema:1,coverageStartedAt:'2026-10-11T13:00:00.000Z',policy:{activeCap:40},sources:[{id:'seed',yield:{scans:0,itemsFetched:0,candidates:0,passedChecks:0,averageScore:null,published:0,linkedInPicks:0}}],unknownAttribution:{legacyPosts:5}};
  const original=JSON.stringify(view),result=normalizedSourceView(view);
  assert.equal(result.enabled,true);assert.equal(result.rows[0].stats.itemsFetched,0);assert.equal(result.rows[0].stats.averageScore,null);assert.equal(result.rows[0].stats.checkedCandidates,null);assert.equal(result.coverage.unknownAttribution.legacyPosts,5);assert.equal(result.rows[0].historicalAttribution,'unknown');assert.equal(JSON.stringify(view),original);
});

test('source presentation does not infer fetch success from admission or manufacture malformed counts',()=>{
  const result=normalizedSourceView({schema:1,coverageStartedAt:null,sources:[{lastScannedAt:'2026-10-11T13:00:00.000Z',lastValidatedAt:'2026-10-11T12:00:00.000Z',validation:{robotsState:'allowed'},yield:{scans:-1,successfulScans:2.5,averageScore:11}}]});
  assert.equal(result.enabled,false);assert.equal(result.rows[0].health,null);assert.equal(result.rows[0].stats.fetchAttempts,null);assert.equal(result.rows[0].stats.successfulFetches,null);assert.equal(result.rows[0].stats.averageScore,null);assert.equal(result.rows[0].validation.robotsState,'allowed');
});

test('source presentation retains the actual failed observation, transition reason and ranking basis',()=>{
  const result=normalizedSourceView({schema:1,coverageStartedAt:'2026-10-11T12:00:00.000Z',sources:[{status:'probation',health:{status:'failed',message:'HTTP 429',fetchedAt:'2026-10-11T13:00:00.000Z'},validation:{robotsAllowed:true,robots:[{allowed:true}]},rank:{value:.6,basis:'Verified pass yield with prior',exploration:true},yield:{scans:1,successfulScans:0}}],recentChanges:[{createdAt:'2026-10-11T12:00:00.000Z',fromStatus:null,toStatus:'probation',reason:'Hosted readable feed admitted'}]});
  assert.equal(result.rows[0].health.status,'failed');assert.equal(result.rows[0].health.message,'HTTP 429');assert.equal(result.rows[0].ranking.exploration,true);assert.equal(result.changes[0].to,'probation');assert.equal(result.changes[0].reason,'Hosted readable feed admitted');
  assert.equal(result.rows[0].validation.robotsState,'allowed');
  assert.throws(()=>normalizedSourceView({schema:1}),/validated registry view/);
});
