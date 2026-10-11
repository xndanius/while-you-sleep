import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { measureGoatCounter, measurementPeriod, goatCounterSite, sanitizeSocial, latestSocialRecords, collectMetrics } from '../scripts/measure.mjs';

const now = new Date('2026-10-10T18:30:00.000Z');
const env = {GOATCOUNTER_SITE:'https://while-you-sleep.goatcounter.com',GOATCOUNTER_API_TOKEN:'a-secret-that-must-stay-private'};
const posts = [{id:'public-post-1'},{id:'public-post-2'}];
const response = data => ({ok:true,status:200,json:async () => data});

test('website and LinkedIn relay scope never queries the retired posting service',async () => {
  let requests=0;
  const result=await collectMetrics({posts,now,env:{POSTIZ_API_KEY:'unused-private-value'},fetch:async()=>{requests++;throw new Error('unexpected request');}});
  assert.equal(requests,0);
  assert.equal(result.social.provider,'zapier');
  assert.equal(result.social.status,'not_connected');
  assert.deepEqual(result.social.posts,[]);
  assert.ok(!JSON.stringify(result).includes('unused-private-value'));
});

test('missing counter access stays null without making a request',async () => {
  let requests = 0;
  const result = await measureGoatCounter(posts,{}, {now,fetch:async () => { requests++; }});
  assert.equal(requests,0);
  assert.equal(result.site.status,'not_connected');
  assert.equal(result.site.views,null);
  assert.equal(result.site.saves,null);
  assert.ok(result.posts.every(post => post.views === null && post.saves === null));
  const waiting = await measureGoatCounter(posts,{GOATCOUNTER_SITE:env.GOATCOUNTER_SITE},{now});
  assert.equal(waiting.site.status,'awaiting_api_access');
});

test('successful empty counter response preserves real zero',async () => {
  const result = await measureGoatCounter(posts,env,{now,noDelay:true,fetch:async url =>
    response(url.pathname.endsWith('/total') ? {total:0,total_events:0} : {hits:[],more:false})});
  assert.equal(result.site.status,'measured');
  assert.equal(result.site.views,0);
  assert.equal(result.site.saves,0);
  assert.ok(result.posts.every(post => post.views === 0 && post.saves === 0));
});

test('separates feed visits from events and reads every page without exposing unknown paths',async () => {
  const calls = [];
  const result = await measureGoatCounter(posts,env,{now,noDelay:true,fetch:async (url,options) => {
    calls.push({url,options});
    if (url.pathname.endsWith('/total')) return response({total:12,total_events:2,raw:'private provider data'});
    if (!url.searchParams.has('exclude_paths')) return response({hits:[
      {path_id:1,path:'save:public-post-1',event:true,count:3},
      {path_id:2,path:'view:public-post-1',event:true,count:4},
      {path_id:3,path:'/private/visitor-info?secret=hidden',event:false,count:999,title:'Private information'},
      {path_id:4,path:'save:unknown-post',event:true,count:100},
    ],more:true});
    return response({hits:[{path_id:5,path:'save:public-post-2',event:true,count:2}],more:false});
  }});
  assert.equal(result.site.views,10);
  assert.equal(result.site.saves,5);
  assert.equal(result.posts[0].views,4);
  assert.equal(result.posts[1].saves,2);
  assert.equal(calls[0].url.searchParams.get('include_paths'),'/');
  assert.equal(calls[0].url.searchParams.get('path_by_name'),'true');
  assert.equal(calls[2].url.searchParams.get('exclude_paths'),'1,2,3,4');
  assert.ok(calls.every(call => call.options.headers.Authorization === `Bearer ${env.GOATCOUNTER_API_TOKEN}`));
  assert.ok(calls.every(call => call.options.redirect === 'error'));
  const publicJSON = JSON.stringify(result);
  for (const secret of [env.GOATCOUNTER_API_TOKEN,'private/visitor','unknown-post','Private information','raw']) assert.ok(!publicJSON.includes(secret));
});

test('failed or incomplete event measurement does not turn missing saves into zero',async () => {
  const result = await measureGoatCounter(posts,env,{now,noDelay:true,fetch:async url => url.pathname.endsWith('/total')
    ? response({total:14,total_events:0}) : {ok:false,status:403,json:async () => ({error:env.GOATCOUNTER_API_TOKEN})}});
  assert.equal(result.site.status,'partial');
  assert.equal(result.site.views,14);
  assert.equal(result.site.saves,null);
  assert.ok(result.posts.every(post => post.saves === null));
  assert.ok(!JSON.stringify(result).includes(env.GOATCOUNTER_API_TOKEN));
});

test('malformed counters are unavailable, not coerced to zero',async () => {
  for (const total of [{total:null,total_events:0},{total:'0',total_events:0},{total:-1,total_events:0},{total:2,total_events:3}]) {
    const result = await measureGoatCounter(posts,env,{now,noDelay:true,fetch:async () => response(total)});
    assert.equal(result.site.views,null);
    assert.equal(result.site.saves,null);
    assert.equal(result.site.status,'unavailable');
  }
});

test('counter origin validation prevents credentials from going to arbitrary hosts',async () => {
  assert.equal(goatCounterSite(env.GOATCOUNTER_SITE),env.GOATCOUNTER_SITE);
  for (const site of ['https://evil.example','https://example.goatcounter.com.evil.example','https://user:pass@example.goatcounter.com','http://example.goatcounter.com','https://example.goatcounter.com/?key=secret','https://example.goatcounter.com/count']) {
    assert.equal(goatCounterSite(site),null);
    let requested = false;
    const result = await measureGoatCounter(posts,{...env,GOATCOUNTER_SITE:site},{now,fetch:async () => { requested=true; }});
    assert.equal(result.site.status,'invalid_configuration');
    assert.equal(requested,false);
  }
});

test('measurement timestamps identify complete hours rather than pretending the latest half-hour was counted',() => {
  assert.equal(measurementPeriod(now).end,'2026-10-10T18:00:00.000Z');
  assert.equal(measurementPeriod(new Date('2026-11-10T19:30:00Z')).end,'2026-11-10T19:00:00.000Z');
});

test('social sanitizer preserves real zero while dropping provider bodies, histories, secrets and unknown labels',() => {
  const result = sanitizeSocial({measuredAt:now.toISOString(),rawBody:'private',token:'secret',posts:[{postId:'public-post-1',x:{status:'measured',metrics:{likes:0,impressions:12,secret:123,views:null,comments:-1},
    history:[{ip:'private'}],publication:{status:'published',providerPostId:'provider-public-id',url:'https://evil.example/?token=secret'}}}],
    channels:[{channelId:'public-channel',status:'measured',metrics:{followers:0,private_info:2}}]},now);
  assert.equal(result.posts[0].x.metrics.likes,0);
  assert.equal(result.channels[0].metrics.followers,0);
  assert.equal(result.status,'measured');
  const json = JSON.stringify(result);
  for (const unwanted of ['secret','private','history','url','rawBody']) assert.ok(!json.includes(unwanted));
  const unsupported = sanitizeSocial({posts:[{postId:'public-post-1',x:{status:'measured',metrics:{unknown_label:3}}}]},now);
  assert.equal(unsupported.posts[0].x.status,'unavailable');
  assert.equal(unsupported.status,'unavailable');
});

test('only latest receipts per post and platform are sent for measurement',() => {
  const result = latestSocialRecords([
    {postId:'public-post-1',createdAt:'2026-10-10T06:00:00Z',social:{x:{providerPostId:'old'},instagram:{providerPostId:'instagram'}}},
    {postId:'public-post-1',createdAt:'2026-10-10T07:00:00Z',social:{x:{providerPostId:'latest'}}},
  ]);
  assert.equal(result.length,1);
  assert.equal(result[0].social.x.providerPostId,'latest');
  assert.equal(result[0].social.instagram.providerPostId,'instagram');
});

async function browserAnalytics(config) {
  const scripts = [];
  const counted = [];
  const window = {};
  const context = {window,location:{pathname:'/while-you-sleep/'},document:{head:{append:script => scripts.push(script)},createElement:() => ({dataset:{}})},
    fetch:async () => response(config),URL,AbortController,setTimeout,clearTimeout};
  vm.runInNewContext(await readFile(new URL('../public/analytics.js',import.meta.url),'utf8'),context);
  window.wysAnalytics.save('public-post-1');
  await new Promise(resolve => setImmediate(resolve));
  if (scripts[0]) {
    window.goatcounter.count = event => counted.push(event || {page:window.goatcounter.path,referrer:window.goatcounter.referrer});
    scripts[0].onload();
  }
  return {window,scripts,counted};
}

test('browser does not load or send third-party tracking when counter configuration is absent',async () => {
  const browser = await browserAnalytics({provider:null,site:null});
  assert.equal(browser.scripts.length,0);
  assert.equal(browser.counted.length,0);
});

test('configured browser sends only canonical page names and public idea events',async () => {
  const browser = await browserAnalytics({provider:'goatcounter',site:env.GOATCOUNTER_SITE});
  assert.equal(browser.scripts[0].src,'https://gc.zgo.at/count.js');
  assert.equal(browser.counted[0].page,'/');
  assert.equal(browser.counted[0].referrer,'');
  assert.equal(browser.counted[1].path,'save:public-post-1');
  browser.window.wysAnalytics.view('public-post-1');
  browser.window.wysAnalytics.view('public-post-1');
  assert.equal(browser.counted.filter(event => event.path === 'view:public-post-1').length,1);
  browser.window.wysAnalytics.save('../private?token=secret');
  assert.ok(!JSON.stringify(browser.counted).includes('private'));
  assert.ok(!JSON.stringify(browser.window.goatcounter).includes(env.GOATCOUNTER_API_TOKEN));
});
