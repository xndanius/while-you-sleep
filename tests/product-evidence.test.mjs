import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PRODUCT_EVIDENCE_POLICY,selectProductLeads,enrichProductLeads,sourceEvidenceFetchOptions} from '../lib/product-evidence.mjs';
import {hash,sha256,stableJSON,canonicalURL,writeJSON} from '../lib/storage.mjs';
import {emptySourceRegistry,applySourceTransition,createSourceScanReceipt,validateSourceScanReceipt} from '../lib/source-registry.mjs';
import {researchSnapshot} from '../scripts/research-snapshot.mjs';

const now='2026-10-11T15:00:00.000Z';
const capability='The product reads uploaded invoice documents, extracts structured fields, and exports CSV files for review. The operator chooses the documents and checks the result before sending records. It includes a command line interface and documented configuration; running it still requires a server, credentials and human approval. ';
const rules='<!-- scoring-policy:start -->\n```json\n{"weights":{"ease":1,"profit":1,"feasibility":1,"autonomy":1,"evidence":1},"publishThreshold":6}\n```\n<!-- scoring-policy:end -->\n';
function source(n,{productUrl,url=`https://products.example.org/tool-${n}`}={}){return {id:hash(canonicalURL(url)),url,title:`Tool ${n}`,text:'A title and short launch excerpt.',fetchedAt:now,...(productUrl?{productUrl}: {})};}
function origin(item,feedId='feed-a'){return {sourceId:item.id,url:item.url,productUrl:item.productUrl||item.url,feedIds:[feedId]};}
function page(url,text=capability.repeat(8),options={}){const maxBytes=options.maxBytes??2000000;return {url,text,status:200,contentType:options.contentType||'text/html',fetchedAt:now,maxBytes,bytes:Buffer.byteLength(text),truncated:false,redirects:[],robots:[{origin:new URL(url).origin,evaluatedUrl:url,allowed:true,status:404,state:'missing'}]};}
const fetchFixture=async(url,options)=>page(url,capability.repeat(8),options);

test('lead selection is deterministic, bounded, diverse and excludes already published products',()=>{
 const items=Array.from({length:24},(_,n)=>source(n)),git=source(25,{productUrl:'https://github.com/public/invoices'});items.push(git);
 const origins=items.map((item,n)=>origin(item,n<20?'prolific-feed':'other-feed'));
 const previous=[{productUrl:items[0].url+'?utm_source=old'}],selected=selectProductLeads(items,{originMap:origins,previous});
 assert.equal(selected.length,12);assert.equal(selected[0].productUrl,git.productUrl);assert.ok(!selected.some(lead=>lead.productUrl===items[0].url));assert.ok(selected.some(lead=>lead.originFeedIds.includes('other-feed')));assert.deepEqual(selected,selectProductLeads(items,{originMap:origins,previous}));
 assert.throws(()=>selectProductLeads(items,{limit:13}),/bounded/);assert.throws(()=>selectProductLeads(Array(801).fill(items[0])),/bounded/);
});

test('lead identity retains distinct frozen product tuples and unions only matching origins',()=>{
 const item=source(1,{url:'https://launches.example.org/item/1',productUrl:'https://products.example.org/first'}),origins=[origin(item,'feed-a'),{...origin(item,'feed-b'),productUrl:'https://products.example.org/second'}];
 const selected=selectProductLeads([item],{originMap:origins});assert.equal(selected.length,2);assert.deepEqual(selected.find(lead=>lead.productUrl.endsWith('/first')).originFeedIds,['feed-a']);assert.deepEqual(selected.find(lead=>lead.productUrl.endsWith('/second')).originFeedIds,['feed-b']);
});

test('product enrichment adds substantial guarded capability text without changing discovery identity',async()=>{
 const listing=source(1,{url:'https://launches.example.org/item/1',productUrl:'https://products.example.org/tool'}),origins=[origin(listing)],before=stableJSON({listing,origins}),calls=[];
 const result=await enrichProductLeads({sources:[listing],originMap:origins,fetchPage:async(url,options)=>{calls.push({url,options});return fetchFixture(url,options);},now:()=>Date.parse(now)});
 assert.equal(result.enrichment.status,'completed');assert.equal(result.enrichment.fetched,1);assert.equal(result.enrichment.failed,0);assert.equal(result.sources.length,2);assert.equal(result.sources[0].id,listing.id);assert.equal(result.sources[0].text,listing.text);
 const evidence=result.sources[1];assert.equal(evidence.id,hash(listing.productUrl));assert.ok(evidence.text.length>1200);assert.deepEqual(evidence.originSourceIds,[listing.id]);assert.equal(evidence.productUrl,listing.productUrl);assert.equal(evidence.evidenceKind,'product-page');assert.deepEqual(evidence.evidenceFetch,{maxBytes:2000000,complete:true});assert.equal(calls[0].options.complete,true);assert.equal(calls[0].options.maxBytes,2000000);assert.equal(stableJSON({listing,origins}),before);assert.match(evidence.evidenceNote,/does not establish a deployed runtime/);
});

test('same primary URL upgrades text once and keeps the original excerpt and feed IDs',async()=>{
 const item={...source(1),originFeedIds:['feed-a']};const result=await enrichProductLeads({sources:[item],originMap:[origin(item)],fetchPage:fetchFixture});assert.equal(result.sources.length,1);assert.equal(result.sources[0].id,item.id);assert.equal(result.sources[0].feedExcerpt,item.text);assert.deepEqual(result.sources[0].originFeedIds,['feed-a']);assert.ok(result.sources[0].text.length>item.text.length);
});

test('homepage request serialization keeps canonical identity while validating real guarded response URLs',async()=>{
 const item=source(1,{url:canonicalURL('https://products.example.org/')}),result=await enrichProductLeads({sources:[item],originMap:[origin(item)],fetchPage:async(url,options)=>page(new URL(url).toString(),capability.repeat(8),options)});assert.equal(result.enrichment.fetched,1);assert.equal(result.sources.length,1);assert.equal(result.sources[0].url,'https://products.example.org');assert.equal(result.sources[0].id,item.id);
});

test('fresh checker and publisher fetch policies use the same fixed complete page or README budgets',()=>{
 assert.deepEqual(sourceEvidenceFetchOptions(source(1)),{});assert.deepEqual(sourceEvidenceFetchOptions({enriched:true,evidenceKind:'product-page',evidenceFetch:{maxBytes:2000000,complete:true}}),{maxBytes:2000000,complete:true});assert.deepEqual(sourceEvidenceFetchOptions({enriched:true,evidenceKind:'github-readme',evidenceFetch:{maxBytes:350000,complete:true}}),{maxBytes:350000,complete:true});
 for(const value of [{enriched:true},{enriched:true,evidenceKind:'unknown',evidenceFetch:{maxBytes:2000000,complete:true}},{enriched:true,evidenceKind:'github-readme',evidenceFetch:{maxBytes:2000000,complete:true}},{enriched:true,evidenceKind:'product-page',evidenceFetch:{maxBytes:2000000,complete:false}},{enriched:true,evidenceKind:'product-page',evidenceFetch:{maxBytes:2000000,complete:true,fetchImpl:'untrusted'}}])assert.throws(()=>sourceEvidenceFetchOptions(value),/fixed fetch policy/);
});

test('GitHub enrichment reads only public metadata and its exact README URL under complete byte budgets',async()=>{
 const item=source(1,{productUrl:'https://github.com/public/invoices'}),raw='https://raw.githubusercontent.com/public/invoices/main/README.md',calls=[],body='# Invoice toolkit\n'+capability.repeat(8)+'\n```sh\nnever-run-this-command\n```';
 const result=await enrichProductLeads({sources:[item],originMap:[origin(item)],fetchPage:async(url,options)=>{calls.push({url,options});return page(url,url.endsWith('/readme')?JSON.stringify({type:'file',download_url:raw}):url.startsWith('https://api.github.com/')?JSON.stringify({private:false,full_name:'public/invoices'}):body,{...options,contentType:url.startsWith('https://api.github.com/')?'application/json':'text/plain'});}});
 assert.deepEqual(calls.map(call=>call.url),['https://api.github.com/repos/public/invoices','https://api.github.com/repos/public/invoices/readme',raw]);assert.ok(calls.every(call=>call.options.complete&&call.options.maxBytes===350000));assert.equal(result.enrichment.requests,3);assert.equal(result.enrichment.fetched,1);const evidence=result.sources.find(value=>value.enriched);assert.equal(evidence.id,hash(raw));assert.equal(evidence.url,raw);assert.equal(evidence.productUrl,item.productUrl);assert.deepEqual(evidence.originSourceIds,[item.id]);assert.equal(evidence.evidenceKind,'github-readme');assert.ok(evidence.text.includes('never-run-this-command'));
});

test('private repositories, repository mismatches and non-repository README URLs fail explicitly',async()=>{
 const item=source(1,{productUrl:'https://github.com/public/invoices'});
 for(const variant of ['private','mismatch','foreign','wrong-path','not-file']){
  const calls=[],result=await enrichProductLeads({sources:[item],fetchPage:async(url,options)=>{calls.push(url);const metadata={private:variant!=='private'?false:true,full_name:variant==='mismatch'?'someone/else':'public/invoices'},readme={type:variant==='not-file'?'directory':'file',download_url:variant==='foreign'?'https://unrelated.example.org/readme':variant==='wrong-path'?'https://raw.githubusercontent.com/someone/else/main/README.md':'https://raw.githubusercontent.com/public/invoices/main/README.md'};return page(url,JSON.stringify(url.endsWith('/readme')?readme:metadata),{...options,contentType:'application/json'});}});
  assert.equal(result.enrichment.status,'failed',variant);assert.equal(result.enrichment.fetched,0);assert.equal(result.enrichment.failed,1);assert.ok(calls.length<=2);assert.equal(result.sources.length,1);
 }
});

test('guarded evidence rejects denials, challenges, incomplete bodies and inconsistent URL or byte metadata',async()=>{
 const item=source(1);
 const mutate=[p=>p.robots=[],p=>p.robots[0].allowed=false,p=>p.robots[0].evaluatedUrl='https://unrelated.example.org/page',p=>p.url='https://unrelated.example.org/page',p=>p.truncated=true,p=>delete p.status,p=>delete p.fetchedAt,p=>p.maxBytes=350000,p=>p.bytes=2000001,p=>p.contentType='application/octet-stream',p=>p.contentType='application/json',p=>p.text='<title>Sign in</title>'+capability.repeat(8),p=>p.text='<input type="password">'+capability.repeat(8),p=>p.text='A short listing.'];
 for(const change of mutate){const result=await enrichProductLeads({sources:[item],fetchPage:async(url,options)=>{const value=page(url,capability.repeat(8),options);change(value);return value;}});assert.equal(result.enrichment.status,'failed');assert.equal(result.enrichment.fetched,0);assert.equal(result.enrichment.failed,1);assert.equal(result.enrichment.observations[0].status,'failed');assert.ok(result.enrichment.observations[0].code);assert.equal(result.sources[0].text,item.text);}
});

test('concurrency and whole-word excerpts are bounded independently of input size',async()=>{
 const items=Array.from({length:20},(_,n)=>source(n)),calls=[];let active=0,maxActive=0;
 const result=await enrichProductLeads({sources:items,fetchPage:async(url,options)=>{active++;maxActive=Math.max(maxActive,active);calls.push(url);await new Promise(resolve=>setTimeout(resolve,2));active--;return page(url,capability.repeat(40),options);}});
 assert.equal(calls.length,12);assert.ok(maxActive<=3);assert.equal(result.enrichment.fetched,12);for(const value of result.sources.filter(value=>value.enriched)){assert.ok(value.text.length<=8000);assert.equal(value.evidenceExcerpted,true);assert.ok((capability.repeat(40)).startsWith(value.text));assert.equal((capability.repeat(40))[value.text.length],' ');}
});

test('an unresponsive evidence fetch is bounded and distinguishes failures from no new leads',async()=>{
 const item=source(1),started=Date.now(),result=await enrichProductLeads({sources:[item],timeBudgetMs:20,fetchPage:()=>new Promise(()=>{})});assert.ok(Date.now()-started<1000);assert.equal(result.enrichment.status,'failed');assert.equal(result.enrichment.attempted,1);assert.equal(result.enrichment.fetched,0);assert.equal(result.enrichment.failed,1);assert.equal(result.enrichment.observations[0].code,'product_evidence_timeout');
 let fetched=false;const empty=await enrichProductLeads({sources:[item],previous:[{productUrl:item.url}],fetchPage:async()=>{fetched=true;throw Error('Must not fetch.');}});assert.equal(fetched,false);assert.equal(empty.enrichment.status,'no_new_leads');assert.equal(empty.enrichment.attempted,0);assert.equal(empty.enrichment.failed,0);
});

function validation(url,itemCount){return {publicHttps:true,robotsAllowed:true,readable:true,robots:[{origin:new URL(url).origin,evaluatedUrl:url,robotsUrl:new URL('/robots.txt',url).toString(),status:404,state:'missing',allowed:true,contentType:'text/plain',fetchedAt:now,redirects:[]}],redirects:[],httpStatus:200,contentType:'application/rss+xml',resolvedUrl:url,fetchedAt:now,maxBytes:2000000,truncated:false,parserVersion:'public-sources-v1',itemCount};}
async function snapshotFixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'wys-enrichment-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const url='https://feeds.example.org/feed',definition={id:hash(url),name:'Public feed',url,kind:'rss'},registry=applySourceTransition(emptySourceRegistry(),{definition,toStatus:'probation',reason:'Hosted guarded seed admission passed.',validation:validation(url,3),howAdded:'seed',now});await writeJSON(path.join(root,'data','sources','registry.json'),registry);await fs.writeFile(path.join(root,'RULES.md'),rules);const sources=[source(1,{productUrl:'https://github.com/public/invoices'}),source(2),source(3)],result={sources,observations:[{feedId:definition.id,url,status:'ok',itemCount:3,fetchedAt:now,message:'Guarded parse passed.',validation:validation(url,3)}],originMap:sources.map(item=>origin(item,definition.id))},env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'xndanius/while-you-sleep',GITHUB_RUN_ID:'701',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'b'.repeat(40),SOURCE_HEAD_SHA:'a'.repeat(40)};return {root,registry,definition,result,env};}

test('hosted snapshot freezes original receipt before appended README evidence and preserves its exact fingerprint',async t=>{
 const f=await snapshotFixture(t),original=stableJSON(f.result),runId='loop-701-1';let beforeEnrich;
 const result=await researchSnapshot({root:f.root,runId,env:f.env,now,scan:async()=>f.result,enrich:async options=>{beforeEnrich=JSON.parse(await fs.readFile(path.join(f.root,'data','source-scans',runId+'.json'),'utf8'));return enrichProductLeads({...options,limit:1,fetchPage:async(url,budget)=>page(url,url.endsWith('/readme')?JSON.stringify({type:'file',download_url:'https://raw.githubusercontent.com/public/invoices/main/README.md'}):url.startsWith('https://api.github.com/')?JSON.stringify({private:false,full_name:'public/invoices'}):capability.repeat(8),{...budget,contentType:url.startsWith('https://api.github.com/')?'application/json':'text/plain'})});}});
 const expected=createSourceScanReceipt({runId,registry:f.registry,...f.result,now,producer:{definitions:[f.definition],repository:f.env.GITHUB_REPOSITORY,runId:f.env.GITHUB_RUN_ID,runAttempt:1,workflow:'loop.yml',stage:'pre_model',headSha:f.env.SOURCE_HEAD_SHA}});
 assert.deepEqual(validateSourceScanReceipt(result.receipt),[]);assert.deepEqual(result.receipt,expected);assert.deepEqual(beforeEnrich,expected);assert.equal(result.source_scan_sha256,sha256(stableJSON(expected)));assert.equal(result.receipt.sources.length,3);assert.equal(result.receipt.observations[0].itemCount,3);assert.equal(result.snapshot.sources.length,4);assert.equal(result.snapshot.enrichment.fetched,1);assert.equal(result.snapshot.scheduleStatus,'completed');assert.equal(stableJSON(f.result),original);
});

test('a wholly failed enrichment preserves the scan receipt but makes a loop operationally failed',async t=>{
 const f=await snapshotFixture(t),result=await researchSnapshot({root:f.root,runId:'loop-701-1',env:f.env,now,scan:async()=>f.result,enrich:options=>enrichProductLeads({...options,fetchPage:async()=>{throw Object.assign(new Error('Robots rules refuse this source.'),{stage:'robots',code:'robots_disallowed'});}})});assert.equal(result.snapshot.scheduleStatus,'failed');assert.equal(result.snapshot.enrichment.fetched,0);assert.equal(result.snapshot.enrichment.failed,3);assert.equal(result.receipt.sources.length,3);assert.match(result.source_scan_sha256,/^[a-f0-9]{64}$/);assert.equal(result.snapshot.sources.length,3);
});

test('standalone snapshots keep their original source scan contract and do not request product enrichment',async t=>{
 const f=await snapshotFixture(t),result=await researchSnapshot({root:f.root,runId:'research-701-1',env:f.env,now,scan:async()=>f.result});assert.equal(result.snapshot.enrichment.status,'not_requested');assert.equal(result.snapshot.sources.length,3);assert.equal(result.receipt.producer.workflow,'research.yml');assert.equal(result.receipt.producer.stage,'research');assert.equal(result.snapshot.scheduleStatus,'completed');
});
