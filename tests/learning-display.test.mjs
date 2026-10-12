import test from 'node:test';
import assert from 'node:assert/strict';
import {renderLearningHTML} from '../public/learning-display.js';

const row={id:'education',searches:1,successes:0,rejections:0,unknown:1,selectionProbability:.25,reason:'Verification incomplete; reward unknown.'};
const state={schema:1,coldStart:false,updatedAt:'2026-10-12T12:20:00.000Z',segments:[row],sources:[{...row,id:'school',name:'School duties',url:'https://example.com/demand',role:'demand',status:'probation'},{...row,id:'building',name:'Tool-only media',role:'building'}],marks:{count:0},selection:{selectedSegment:'education',demandSourceIds:['school'],reason:'Try education'},lastRun:{runId:'loop-123-1'}};
test('unknown remains separate from refusals, with demand-only source choices and immutable run link',()=>{
 const html=renderLearningHTML(state);
 assert.match(html,/Unknown/);assert.match(html,/Verification incomplete; reward unknown/);assert.match(html,/25%/);assert.match(html,/School duties/);assert.doesNotMatch(html,/Tool-only media/);assert.match(html,/data\/learning\/loop-123-1.json/);assert.match(html,/counts as 20/);assert.match(html,/six of any segment/);
});
test('cold start never labels old tool-first history as success or improvement',()=>{
 const html=renderLearningHTML({...state,coldStart:true,updatedAt:null,selection:null,lastRun:null});
 assert.match(html,/Beta 1\/1 prior/);assert.match(html,/no invented demand reward/);assert.match(html,/No completed demand run yet/);assert.match(html,/first automatic demand search/);
});
test('untrusted display text and unsafe source URLs cannot become markup',()=>{
 const html=renderLearningHTML({...state,sources:[{...state.sources[0],name:'<img src=x onerror=evil()>',url:'javascript:alert(1)',reason:'<script>evil()</script>'}]});
 assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|href="javascript:/);
 assert.match(renderLearningHTML(null),/No improvement is claimed/);
});
