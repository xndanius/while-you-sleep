import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchPublic} from '../lib/source-fetch.mjs';
import {ROBOTS_CACHE_MS} from '../lib/robots.mjs';

const response=(body,status=200,type='text/plain')=>new Response(body,{status,headers:{'content-type':type}});
function batchHarness(){
 const calls=[];let time=Date.parse('2026-10-20T10:00:00.000Z'),robotsStatus=429;
 const transport={lookupHost:async()=>[{address:'93.184.216.34',family:4}],now:()=>time,fetchImpl:async input=>{
  const url=new URL(input);calls.push(url.toString());
  return url.pathname==='/robots.txt'?response(robotsStatus===200?'User-agent: *\nAllow: /':'Too many requests',robotsStatus):response('A complete public discussion response.',200,'text/html');
 }};
 return {calls,transport,options:{...transport,robotsCache:new Map(),cacheRobots429:true},advance:duration=>{time+=duration;},status:value=>{robotsStatus=value;},allow:()=>{robotsStatus=200;}};
}
const refused=error=>error.code==='robots_unavailable'&&error.stage==='robots'&&error.validation?.status===429&&error.validation.allowed===false;

test('a scoped batch retains one robots429 refusal across distinct URLs even beyond the success-cache lifetime',async()=>{
 const h=batchHarness(),urls=['https://batch.example.org/api/items/1','https://batch.example.org/api/items/2','https://batch.example.org/t/3'];
 for(const [index,url] of urls.entries()){
  if(index===2)h.advance(ROBOTS_CACHE_MS+1);
  await assert.rejects(fetchPublic(url,h.options),error=>refused(error)&&error.validation.origin==='https://batch.example.org');
 }
 assert.deepEqual(h.calls,['https://batch.example.org/robots.txt'],'Denied discussion pages and APIs are never requested or retried.');
});

test('concurrent same-origin requests share the same denied robots promise and other origins remain independent',async()=>{
 const h=batchHarness(),results=await Promise.allSettled(['/one','/two','/three'].map(path=>fetchPublic('https://batch.example.org'+path,h.options)));
 assert.ok(results.every(result=>result.status==='rejected'&&refused(result.reason)));
 await assert.rejects(fetchPublic('https://other.example.org/page',h.options),refused);
 assert.deepEqual(h.calls,['https://batch.example.org/robots.txt','https://other.example.org/robots.txt']);
});

test('a fresh scoped batch may make one new guarded robots read while the denied batch remains refused',async()=>{
 const h=batchHarness();await assert.rejects(fetchPublic('https://batch.example.org/first',h.options),refused);h.allow();
 await assert.rejects(fetchPublic('https://batch.example.org/still-denied',h.options),refused);
 const next={...h.transport,robotsCache:new Map(),cacheRobots429:true},page=await fetchPublic('https://batch.example.org/new-batch',next);
 assert.equal(page.status,200);assert.equal(page.robots[0].allowed,true);
 assert.deepEqual(h.calls,['https://batch.example.org/robots.txt','https://batch.example.org/robots.txt','https://batch.example.org/new-batch']);
});

test('the scoped429 policy cannot retain failures in the process-global cache',async()=>{
 const h=batchHarness();const {robotsCache,...withoutScope}=h.options;
 await assert.rejects(fetchPublic('https://batch.example.org/page',withoutScope),error=>error.code==='invalid_robots_batch_policy');
 assert.deepEqual(h.calls,[]);
});

test('default failure eviction and successful origin-cache expiry remain unchanged',async()=>{
 const h=batchHarness(),{robotsCache,cacheRobots429,...defaults}=h.options;
 await assert.rejects(fetchPublic('https://default.example.net/first',defaults),refused);h.allow();
 assert.equal((await fetchPublic('https://default.example.net/second',defaults)).status,200);
 const scoped=batchHarness();scoped.allow();
 await fetchPublic('https://batch.example.org/one',scoped.options);await fetchPublic('https://batch.example.org/two',scoped.options);
 assert.equal(scoped.calls.filter(url=>url.endsWith('/robots.txt')).length,1);
 scoped.advance(ROBOTS_CACHE_MS+1);await fetchPublic('https://batch.example.org/three',scoped.options);
 assert.equal(scoped.calls.filter(url=>url.endsWith('/robots.txt')).length,2);
 assert.deepEqual(h.calls,['https://default.example.net/robots.txt','https://default.example.net/robots.txt','https://default.example.net/second']);
});

test('the batch option retains only typed robots429, not other robots errors or evidence-page429',async()=>{
 for(const status of [403,503]){
  const h=batchHarness();h.status(status);
  for(const path of ['/one','/two'])await assert.rejects(fetchPublic('https://batch.example.org'+path,h.options),error=>error.code==='robots_unavailable'&&error.validation.status===status);
  assert.deepEqual(h.calls,['https://batch.example.org/robots.txt','https://batch.example.org/robots.txt']);
 }
 const h=batchHarness();h.allow();const options={...h.options,fetchImpl:async raw=>{const url=new URL(raw);h.calls.push(url.toString());return url.pathname==='/robots.txt'?response('User-agent: *\nAllow: /'):response('Too many requests',429);}};
 for(const path of ['/one','/two'])await assert.rejects(fetchPublic('https://batch.example.org'+path,options),error=>error.code==='source_http_error'&&error.stage==='fetch'&&error.validation.httpStatus===429);
 assert.deepEqual(h.calls,['https://batch.example.org/robots.txt','https://batch.example.org/one','https://batch.example.org/two']);
});
