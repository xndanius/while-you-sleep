import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {APIFY_ACTORS,apifyAvailability,apifyArtifactProducer,canonicalApifyPostURL,normalizeApifyPosts,apifyJSON,reserveApifyBatch,collectApifyPool,loadApifyPool,validateApifyPoolProof,rereadApifyEvidence,apifyBudget,apifyHealthFromReceipts} from '../lib/apify-sources.mjs';
import {runApifySources} from '../scripts/collect-apify-sources.mjs';
const now=new Date('2026-10-19T08:00:00Z'),task='Every week I manually copy customer invoices into spreadsheets and check unpaid balances.';
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
async function temp(t){const root=await mkdtemp(path.join(os.tmpdir(),'apify-provider-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
function fixture({platform='reddit',rows,seen=[]}={}){let cap;const cfg=APIFY_ACTORS[platform][0];return async(url,options)=>{
 const u=new URL(url);seen.push({url:String(url),options});
 if(u.pathname.startsWith('/v2/acts/'))return json({data:{id:cfg.id,notice:'NONE',modifiedAt:now.toISOString(),pricingInfos:[{pricingModel:'PAY_PER_EVENT',startedAt:'2026-01-01T00:00:00Z'}]}});
 if(options.method==='POST'){cap=Number(u.searchParams.get('maxTotalChargeUsd'));return json({data:{id:'ActorRun12345',actId:cfg.id,status:'SUCCEEDED',defaultDatasetId:'Dataset12345',finishedAt:now.toISOString(),usageTotalUsd:.001,options:{maxTotalChargeUsd:cap}}});}
 if(u.pathname.startsWith('/v2/actor-runs/'))return json({data:{id:'ActorRun12345',actId:cfg.id,status:'SUCCEEDED',defaultDatasetId:'Dataset12345',finishedAt:now.toISOString(),usageTotalUsd:.001,options:{maxTotalChargeUsd:cap}}});
 return json(rows||[{url:'https://www.reddit.com/r/smallbusiness/comments/abc123/invoices/',title:'How do you handle weekly invoice administration?',selftext:task,subreddit:'smallbusiness',created_utc:now.getTime()/1000-3600,author:'Never retain this account',author_fullname:'Never retain this profile'}]);
 };}
test('missing token does no network or ledger writes; raw official proof alone takes precedence',async t=>{
 const root=await temp(t);let calls=0;const r=await collectApifyPool({root,runId:'loop-1-1',env:{},now,fetchImpl:()=>{calls++;throw new Error('No live calls');}});assert.equal(calls,0);assert.equal(r.items.length,0);assert.deepEqual(await readdir(root),[]);
 assert.equal(apifyAvailability({APIFY_TOKEN:'fixture',XAI_API_KEY:'fixture'})[1].enabled,false);assert.equal(apifyAvailability({APIFY_TOKEN:'fixture',XAI_API_KEY:'fixture'})[1].reason,'official_primary_unavailable_until_validated');assert.equal(apifyAvailability({APIFY_TOKEN:'fixture',XAI_API_KEY:'fixture'},{officialPrimaryPlatforms:['x']})[1].reason,'official_provider_preferred');
});
test('bounded collector commits reservation before paid POST and stores five safe fields only',async t=>{
 const root=await temp(t),seen=[];let persisted=false;const raw=fixture({seen});const r=await collectApifyPool({root,runId:'loop-123-1',env:{APIFY_TOKEN:'fixture-token',GITHUB_ACTIONS:'true'},platforms:['reddit'],now,persistReservation:async({file,receipt})=>{assert.equal(JSON.parse(await readFile(path.join(root,file),'utf8')).id,receipt.id);persisted=true;},fetchImpl:async(u,o)=>{assert.equal(persisted,true);return raw(u,o);}});
 assert.equal(r.items.length,1);const paid=seen.find(c=>c.options.method==='POST'),u=new URL(paid.url);assert.equal(u.searchParams.get('restartOnError'),'false');assert.equal(Number(u.searchParams.get('maxItems')),25);assert.ok(Number(u.searchParams.get('maxTotalChargeUsd'))<=.20);assert.equal(paid.options.redirect,'manual');assert.deepEqual(Object.keys(r.items[0].post).sort(),['community','date','excerpt','title','url']);assert.equal(r.items[0].post.url,'https://www.reddit.com/comments/abc123');
 const disk=await readFile(path.join(root,r.items[0].poolPath),'utf8');assert.equal(/fixture-token|Never retain|author|profile/i.test(disk),false);assert.equal(r.items[0].post.excerpt,task);assert.equal(await validateApifyPoolProof(root,r.items[0].proof,{definitionId:r.items[0].proof.definitionId,postUrl:r.items[0].post.url,now}),true);
 const duplicate=await collectApifyPool({root,runId:'loop-456-1',env:{APIFY_TOKEN:'fixture-token'},platforms:['reddit'],now,fetchImpl:()=>{throw new Error('No duplicate calls');}});assert.equal(duplicate.health[0].reason,'apify_batch_already_reserved');
 const independent=await rereadApifyEvidence(root,r.items[0].post.url,{now:new Date(now.getTime()+3600_000),fetchImpl:()=>{throw new Error('No checker network');}});assert.equal(independent.capturedAt,now.toISOString());assert.equal(independent.independentlyReadAt,'2026-10-19T09:00:00.000Z');assert.equal(independent.providerDatasetReread,false);assert.equal(independent.livePostRefetched,false);
 assert.deepEqual(await loadApifyPool(root,{now:new Date(now.getTime()+9*3600_000)}),[]);
 const posts=JSON.parse(disk);posts[0].excerpt='Invented demand';await writeFile(path.join(root,r.items[0].poolPath),JSON.stringify(posts));assert.equal(await validateApifyPoolProof(root,r.items[0].proof,{postUrl:r.items[0].post.url,now}),false);
});
test('failed/unknown requests consume day slots and monthly reservations; never retry an uncertain POST',async t=>{
 const root=await temp(t);let paid=0;for(const hour of [0,6,12,18]){const at=new Date(`2026-10-19T${String(hour).padStart(2,'0')}:00:00Z`);await collectApifyPool({root,runId:`loop-${hour+1}-1`,env:{APIFY_TOKEN:'fixture',APIFY_MONTHLY_BUDGET_USD:'10'},platforms:['reddit'],now:at,fetchImpl:async(u,o)=>{if(o.method==='POST'){paid++;throw new Error('uncertain private response fixture');}return json({data:{id:APIFY_ACTORS.reddit[0].id,notice:'NONE',modifiedAt:at.toISOString(),pricingInfos:[{pricingModel:'PAY_PER_EVENT',startedAt:'2026-01-01T00:00:00Z'}]}});}});}
 assert.ok(paid<=4);const cap=await reserveApifyBatch({root,platform:'reddit',runId:'loop-extra-1',kind:'retry',now:new Date('2026-10-19T20:00:00Z')});assert.equal(cap.allowed,false);assert.equal(cap.reason,'apify_daily_item_cap');const budget=await apifyBudget(root,{now});assert.ok(budget.usedOrReservedUsd>0);assert.ok(budget.usedOrReservedUsd<=10);
 const denied=await reserveApifyBatch({root,platform:'x',runId:'loop-budget-1',now,monthlyBudgetUsd:0});assert.equal(denied.reason,'apify_monthly_budget_cap');assert.equal((await readdir(path.join(root,'data/apify-reservations'))).length,4);
});
test('two empty or failed batches select the one backup and put the source on probation',()=>{
 const rows=[{kind:'collection',platform:'x',status:'failed',retained:0,actorIndex:0,finishedAt:'2026-10-19T01:00:00Z',reason:'unavailable'},{kind:'collection',platform:'x',status:'succeeded',retained:0,actorIndex:0,finishedAt:'2026-10-19T07:00:00Z',reason:'empty'}];const h=apifyHealthFromReceipts(rows).find(r=>r.platform==='x');assert.equal(h.status,'probation');assert.equal(h.actorIndex,1);assert.equal(h.consecutiveEmptyOrFailed,2);
});
test('private profiles, mock posts, personal details, jobs and launch descriptions cannot become pool demand',()=>{
 assert.equal(canonicalApifyPostURL('https://x.com/some_handle/status/123456789','x'),'https://x.com/i/status/123456789');assert.throws(()=>canonicalApifyPostURL('https://www.indiehackers.com/product/example','indiehackers'));
 const base={url:'https://x.com/handle/status/123456789',text:task,createdAt:now.toISOString(),lang:'en'};assert.equal(normalizeApifyPosts('x',[base],{now})[0].excerpt,task);for(const row of [{...base,isMock:true},{...base,text:task+' Contact person@example.invalid'},{...base,text:task+' @a_handle'}])assert.deepEqual(normalizeApifyPosts('x',[row],{now}),[]);
 assert.deepEqual(normalizeApifyPosts('producthunt',[{url:'https://www.producthunt.com/posts/example',name:'Example product',description:task}],{now}),[]);
 const ph=normalizeApifyPosts('producthunt',[{url:'https://www.producthunt.com/posts/example',name:'Example product',comments:[{id:'123',text:task,createdAt:now.toISOString(),author:{username:'discard'}}]}],{now});assert.equal(ph[0].url,'https://www.producthunt.com/posts/example?comment=123');assert.equal(JSON.stringify(ph).includes('discard'),false);
});
test('provider transport blocks alternate paths, token query strings, redirects and oversized data',async()=>{
 let calls=0;for(const endpoint of ['https://attacker.invalid/v2/acts/example','https://api.apify.com/v2/users/me','https://api.apify.com/v2/acts/a?token=private'])await assert.rejects(apifyJSON(endpoint,{fetchImpl:()=>calls++}),/fixed public scope/);assert.equal(calls,0);await assert.rejects(apifyJSON('https://api.apify.com/v2/acts/test',{fetchImpl:async()=>new Response('private',{status:302})}),/credentials withheld/);
});
test('the actual hosted research job is trusted and absent-token status is safe, visible and complete',async t=>{
 const producer={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'xndanius/while-you-sleep',GITHUB_REF:'refs/heads/main',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW_REF:'xndanius/while-you-sleep/.github/workflows/research.yml@refs/heads/main',GITHUB_JOB:'research',GITHUB_SHA:'a'.repeat(40)};assert.equal(apifyArtifactProducer(producer).job,'research');assert.throws(()=>apifyArtifactProducer({...producer,GITHUB_JOB:'writer'}));
 const root=await temp(t),output=path.join(root,'output');await runApifySources({root,runId:'research-123-1',env:{GITHUB_OUTPUT:output},now,fetchImpl:()=>{throw new Error('Never call a live actor in tests');}});const status=JSON.parse(await readFile(path.join(root,'data/apify/status.json'),'utf8'));assert.equal(status.status,'disabled');assert.equal(status.health.length,4);assert.ok(status.health.every(row=>row.reason==='awaiting_apify_token'&&row.status==='disabled'));assert.equal(status.budget.limitUsd,10);assert.match(await readFile(output,'utf8'),/apify_committed=false\ncommitted=false/);
});
