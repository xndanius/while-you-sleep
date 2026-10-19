import test from 'node:test';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {DISCUSSION_SOURCE_CATALOG,DISCUSSION_PROVIDER_CATALOG,discussionExcerpt,makeDiscussionSource,discussionPostURL,parseDiscussionSourcePage,createProviderSourceValidation,validProviderSourceValidation} from '../lib/discussion-sources.mjs';
import {fetchDemandEvidence,DEMAND_SOURCE_CATALOG} from '../lib/demand-sources.mjs';
import {hash} from '../lib/storage.mjs';
import {validateSource} from '../lib/research.mjs';
import {emptySourceRegistry,applySourceTransition,registryDefinitions,validEmptyDemandScan,createSourceScanReceipt,validateSourceScanReceipt} from '../lib/source-registry.mjs';
import {discussionOnlyRetirements,discoverSourceProposals,admitProviderPoolSources} from '../scripts/source-registry.mjs';
const now='2026-10-19T12:00:00.000Z',ask=DISCUSSION_SOURCE_CATALOG[0],n8n=DISCUSSION_SOURCE_CATALOG.find(source=>source.url==='https://community.n8n.io/latest.rss');
function page(url,text,type='application/json'){return {url,text,status:200,contentType:type,fetchedAt:now,maxBytes:2000000,truncated:false,redirects:[],robots:[{origin:new URL(url).origin,evaluatedUrl:url,robotsUrl:new URL('/robots.txt',url).toString(),status:404,state:'missing',allowed:true,contentType:'text/plain',fetchedAt:now}]};}
function admission(definition){return {publicHttps:true,robotsAllowed:true,readable:true,robots:page(definition.url,'').robots,redirects:[],httpStatus:200,contentType:'application/rss+xml',resolvedUrl:definition.url,fetchedAt:now,maxBytes:2000000,truncated:false,parserVersion:'public-sources-v2',itemCount:1};}
const problem='I need a tool to reconcile customer invoices against my daily spreadsheet.';
const post={url:'https://news.ycombinator.com/item?id=33',title:'Ask HN: a tool for daily invoices?',excerpt:problem,date:now};
test('all discussion providers reject job adverts, unrelated text and one-off bug reports while retaining actual business chores',()=>{
 const providers=[{definition:ask,url:post.url},{definition:DISCUSSION_PROVIDER_CATALOG.find(source=>source.platform==='reddit'),url:'https://www.reddit.com/comments/abc12'}];
 for(const {definition,url} of providers){
  const admit=(title,excerpt=problem)=>makeDiscussionSource(definition,{url,title,excerpt,date:now},{fetchedAt:now});
  for(const title of ['Ask HN: Who is hiring?','Who wants to be hired?','We are hiring a customer support administrator','Hiring: customer support administrator','Job opening: invoice administrator','Invitation to tender for invoice processing','Request for proposals: document service'])assert.equal(admit(title),null,title);
  assert.equal(admit('Error when connecting my workflow','I cannot connect my workflow because an error appeared today.'),null);
  assert.equal(admit('Webhook crashes after update','The webhook throws a fatal error after I updated the application.'),null);
  assert.equal(admit('How can I fix this bug?','My customer order export is broken after the latest update.'),null);
  assert.equal(admit('Workflow crashes when manually triggered','The application is broken when I manually trigger the webhook.'),null);
  assert.equal(admit('A pleasant afternoon in the park','The clouds looked beautiful while I walked beside the river.'),null);
  assert.ok(admit('How do you track hiring paperwork?','Every week I manually consolidate interview notes in a spreadsheet.'));
  assert.ok(admit('Order export crashes during our daily process','Every day I manually copy customer orders into a spreadsheet.'));
  assert.ok(admit('Bug reports need a better tool','I need a tool to collect customer bug reports into one support queue.'));
  assert.ok(admit('Show HN: a service to reconcile invoices','I built a service to match customer invoices against bank records.'));
 }
});
test('discussion adapters retain one bounded public excerpt and omit all author/profile data',()=>{
 const data={hits:[{objectID:'33',title:post.title,story_text:`<p>Contact @someone for help.</p><p>${problem}</p>`,created_at:now,author:'DO_NOT_RETAIN',profile:'PRIVATE'}]};
 const [source]=parseDiscussionSourcePage(ask,page(ask.url,JSON.stringify(data)));assert.equal(source.text,problem);assert.equal(source.text.length<=200,true);assert.equal(source.demandEvidence.kind,'community_request');assert.equal(source.community,'Hacker News Ask HN');assert.equal(JSON.stringify(source).includes('DO_NOT_RETAIN'),false);assert.equal(JSON.stringify(source).includes('@someone'),false);
 const long='I need a tool to reconcile invoices '+('against daily customer spreadsheets '.repeat(20));assert.ok(discussionExcerpt(long).length<=200);assert.ok(long.startsWith(discussionExcerpt(long)));
});
test('Discourse RSS and exact first-post JSON share stable public topic identity',async()=>{
 const rss=`<rss><channel><item><title>How to automate invoices?</title><link>https://community.n8n.io/t/invoices/333</link><pubDate>${now}</pubDate><description><![CDATA[<p>${problem}</p>]]></description></item></channel></rss>`;
 const [source]=parseDiscussionSourcePage(n8n,page(n8n.url,rss,'application/rss+xml'));assert.equal(source.url,'https://community.n8n.io/t/333');
 const fetched=await fetchDemandEvidence(source,{definition:n8n,fetchPage:async url=>{assert.equal(url,'https://community.n8n.io/t/333.json');return page(url,JSON.stringify({id:333,slug:'invoices',title:'How to automate invoices?',created_at:now,post_stream:{posts:[{post_number:1,cooked:`<p>${problem}</p>`,username:'DO_NOT_RETAIN'}]}}));}});assert.equal(fetched.id,source.id);assert.equal(fetched.text,problem);assert.equal(fetched.verifiedAt,now);
});
test('empty complete discussion JSON and RSS are clean immutable no-item observations',async()=>{
 for(const [definition,body,type] of [[ask,JSON.stringify({hits:[]}),'application/json'],[n8n,'<rss><channel><title>Forum</title></channel></rss>','application/rss+xml']]){
  const result=await validateSource(definition,{fetchPage:async url=>page(url,body,type),now,allowEmpty:true});assert.equal(result.scanReadableEmpty,true);assert.equal(result.code,'no_eligible_demand_tasks');assert.equal(validEmptyDemandScan({status:'empty',code:result.code,itemCount:0,validation:result.validation},definition),true);
 }
});
test('official Software Recommendations API handles safe questions and obeys backoff',()=>{
 const definition=DISCUSSION_SOURCE_CATALOG.find(source=>source.url.startsWith('https://api.stackexchange.com/'));
 const data={items:[{link:'https://softwarerecs.stackexchange.com/questions/123/invoice-tool',title:'Tool for invoice reconciliation',body:`<p>${problem}</p>`,creation_date:Date.parse(now)/1000,owner:{display_name:'DO_NOT_RETAIN'}}],quota_remaining:50};
 assert.equal(parseDiscussionSourcePage(definition,page(definition.url,JSON.stringify(data)))[0].text,problem);
 assert.throws(()=>parseDiscussionSourcePage(definition,page(definition.url,JSON.stringify({...data,backoff:30}))),error=>error.code==='source_api_backoff');
});
test('new research and source discovery exclude jobs and tenders while preserving history',async()=>{
 let registry=emptySourceRegistry();for(const definition of [ask,DEMAND_SOURCE_CATALOG[2]])registry=applySourceTransition(registry,{definition,toStatus:'probation',reason:'Guarded public fixture admission.',validation:admission(definition),now});
 assert.deepEqual(registryDefinitions(registry).map(source=>source.id),[ask.id]);assert.equal(registry.sources.length,2);assert.deepEqual(discussionOnlyRetirements(registry).map(row=>row.sourceId),[DEMAND_SOURCE_CATALOG[2].id]);
 const proposals=await discoverSourceProposals({registry,catalog:[DEMAND_SOURCE_CATALOG[0],...DISCUSSION_SOURCE_CATALOG],demandCatalog:[],now});assert.ok(proposals.length<=3);assert.ok(proposals.every(source=>source.kind.endsWith('-discussion')));
});
test('provider paths require typed immutable pool proof and never own-fetch',async()=>{
 const definition=DISCUSSION_PROVIDER_CATALOG.find(source=>source.platform==='x'),safe={url:'https://x.com/i/status/123',community:'X',title:'Tool for invoice reconciliation',excerpt:problem,date:now},source=makeDiscussionSource(definition,safe,{fetchedAt:now});assert.equal(discussionPostURL(definition,'https://x.com/some_handle/status/123'),safe.url);
 const proof={provider:'apify',platform:'x',definitionId:definition.id,receiptId:'apify-test-1',poolHash:'a'.repeat(64),postHash:'b'.repeat(64)},validation=createProviderSourceValidation(definition,[{source,proof}],{fetchedAt:now});assert.equal(validProviderSourceValidation(validation,definition),true);assert.equal(validProviderSourceValidation({...validation,definitionId:ask.id}),false);
 let fetches=0;const result=await validateSource(definition,{fetchPage:async()=>{fetches++;throw Error('Must never call');},now});assert.equal(result.code,'provider_unavailable');assert.equal(fetches,0);
 await assert.rejects(fetchDemandEvidence(source,{definition,fetchPage:async()=>{fetches++;}}));assert.equal(fetches,0);
 const fresh=await fetchDemandEvidence(source,{definition,providerFetch:async()=>({post:safe,proof,capturedAt:now,independentlyReadAt:'2026-10-19T12:01:00.000Z',independentlyReread:true})});assert.equal(fresh.fetchedAt,now);assert.equal(fresh.verifiedAt,'2026-10-19T12:01:00.000Z');assert.equal(fresh.livePostRefetched,false);
 const registry=applySourceTransition(emptySourceRegistry(),{definition,toStatus:'probation',reason:'Verified immutable provider fixture.',validation,now});
 const scan=createSourceScanReceipt({runId:'loop-999-1',registry,sources:[source],observations:[{feedId:definition.id,url:definition.url,status:'ok',itemCount:1,fetchedAt:now,message:'Immutable provider proof verified.',validation}],originMap:[{sourceId:source.id,url:source.url,productUrl:source.url,feedIds:[definition.id]}],producer:{definitions:[definition],repository:'xndanius/while-you-sleep',runId:'999',runAttempt:1,workflow:'loop.yml',stage:'pre_model',headSha:'a'.repeat(40)},now});assert.deepEqual(validateSourceScanReceipt(scan),[]);scan.observations[0].validation.items[0].url='https://x.com/i/status/124';assert.ok(validateSourceScanReceipt(scan).length);
});

test('hosted provider seeds require token, exact proof and nonempty pool, then commit one reason per approved scope',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'discussion-provider-seed-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const git=(...args)=>{const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};git('init','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.com');await fs.writeFile(path.join(root,'README.md'),'Public provider fixture.');git('add','README.md');git('commit','-m','Initial fixture');
 const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'xndanius/while-you-sleep',GITHUB_RUN_ID:'999',GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW_REF:'xndanius/while-you-sleep/.github/workflows/research.yml@refs/heads/main'},args={root,runId:'research-999-1',env,now,push:false};
 assert.equal((await admitProviderPoolSources({...args,loadPool:async()=>{throw Error('Disabled provider must stay cheap.');}})).committed,false);
 const enabled={...args,env:{...env,APIFY_TOKEN:'fixture'}};assert.equal((await admitProviderPoolSources({...enabled,loadPool:async()=>[]})).committed,false);
 const definition=DISCUSSION_PROVIDER_CATALOG.find(source=>source.platform==='reddit'),post={url:'https://www.reddit.com/comments/abc12',community:'Reddit r/smallbusiness',date:now,title:'How to reconcile daily invoices?',excerpt:problem},proof={provider:'apify',platform:'reddit',definitionId:definition.id,receiptId:'apify-fixture-1',poolHash:'a'.repeat(64),postHash:'b'.repeat(64)},pool=[{platform:'reddit',post,proof,capturedAt:now}];
 assert.equal((await admitProviderPoolSources({...enabled,loadPool:async()=>pool,validateProof:async()=>false})).committed,false);
 const result=await admitProviderPoolSources({...enabled,loadPool:async()=>pool,validateProof:async(_root,_proof,{definitionId,postUrl,maxAgeHours})=>definitionId===definition.id&&postUrl===post.url&&maxAgeHours===8});assert.equal(result.committed,true);assert.equal(result.changeIds.length,1);assert.equal(git('rev-list','--count','HEAD'),'2');
 const registry=JSON.parse(await fs.readFile(path.join(root,'data/sources/registry.json'),'utf8'));assert.equal(registry.sources[0].kind,'provider-discussion');assert.equal(registry.sources[0].status,'probation');assert.equal(registry.sources[0].howAdded,'seed');assert.equal(await fs.stat(path.join(root,'data/source-discovery')).then(()=>true).catch(()=>false),false);
 assert.equal((await admitProviderPoolSources({...enabled,loadPool:async()=>pool,validateProof:async()=>true})).committed,false);await assert.rejects(admitProviderPoolSources({...enabled,env:{...enabled.env,GITHUB_WORKFLOW_REF:'xndanius/while-you-sleep/.github/workflows/loop.yml@refs/heads/main'}}),/non-model research/);
});
