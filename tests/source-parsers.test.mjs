import test from 'node:test';
import assert from 'node:assert/strict';
import {hash,canonicalURL} from '../lib/storage.mjs';
import {parseSourcePage,validateSource,scanSourceDefinitions,sourceSeedCatalog,sourceDefinitions,inferSourceKind,extractPublicFeedLinks,plainText} from '../lib/research.mjs';
const now='2026-10-11T12:00:00.000Z';
const definition=(kind,url='https://example.com/feed')=>({id:hash(canonicalURL(url)),name:'Public test source',url,kind});
function page(text,url='https://example.com/feed',contentType='text/html'){
 return {text,url,status:200,fetchedAt:now,contentType,truncated:false,maxBytes:2000000,redirects:[],robots:[{origin:new URL(url).origin,evaluatedUrl:url,robotsUrl:new URL('/robots.txt',url).toString(),status:404,state:'missing',allowed:true}]};
}
const rss=(url='https://product.example.com/one')=>`<?xml version="1.0"?><rss version="2.0"><channel><title>Public</title><item><title>Receipt parser</title><link>${url}</link><description><![CDATA[Extracts receipts &amp; exports CSV. Human review is required.]]></description></item></channel></rss>`;

test('all original and requested seeds have canonical fixed IDs; no source is locally pre-admitted',()=>{
 assert.equal(sourceDefinitions.length,13);assert.equal(sourceSeedCatalog.length,30);assert.equal(new Set(sourceSeedCatalog.map(value=>value.id)).size,30);
 for(const value of sourceSeedCatalog){assert.equal(value.id,hash(canonicalURL(value.url)));assert.ok(value.reason);assert.equal(value.eligible,undefined);}
 for(const name of ['SaaS','microsaas','indiehackers','automation','LocalLLaMA','ChatGPTCoding'])assert.ok(sourceSeedCatalog.some(value=>value.name===`Reddit · r/${name}`));
 assert.ok(sourceSeedCatalog.some(value=>value.kind==='unparsed-listing'));assert.ok(sourceSeedCatalog.some(value=>value.url==='https://github.com/trending'));
});

test('RSS and Atom parse complete bounded feeds and preserve contiguous literal evidence text',()=>{
 const items=parseSourcePage(definition('rss'),page(rss()));assert.equal(items.length,1);assert.equal(items[0].text,'Extracts receipts & exports CSV. Human review is required.');
 const atom='<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Agent note</title><link rel="self" href="https://example.com/internal"/><link rel="alternate" href="https://example.com/note"/><content type="html">A literal &amp; bounded maker statement.</content></entry></feed>';
 assert.equal(parseSourcePage(definition('rss'),page(atom))[0].url,'https://example.com/note');
 for(const bad of [rss().slice(0,-8),'<rss><channel><item><title>No URL</title></item></channel></rss>','<!DOCTYPE rss [<!ENTITY x "injected">]><rss><channel/></rss>'])assert.throws(()=>parseSourcePage(definition('rss'),page(bad)));
 assert.throws(()=>parseSourcePage(definition('rss'),{...page(rss()),truncated:true}),/complete response/);
 const large=rss().replace('Extracts receipts','x'.repeat(400000)+' Extracts receipts');assert.equal(parseSourcePage(definition('rss'),page(large))[0].text.length,1200);
 assert.equal(plainText('An apostrophe: &#39; and invalid &#x110000; remain attributable.'),"An apostrophe: ' and invalid &#x110000; remain attributable.");
});

test('XML URLs decode predefined and numerical references exactly once, and namespaced Atom entries parse',()=>{
 const escaped=rss('https://example.com/product?a=1&amp;b=2&#38;c=3&#x26;d=4&amp;lt;=literal');
 const item=parseSourcePage(definition('rss'),page(escaped))[0],url=new URL(item.url);
 assert.deepEqual([...url.searchParams.keys()],['a','b','c','d','lt;']);assert.equal(url.searchParams.get('b'),'2');assert.equal(url.searchParams.has('amp;b'),false);assert.equal(url.searchParams.has('<'),false);
 const atom='<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:entry><atom:title>Prefixed note</atom:title><atom:link rel="alternate" href="https://example.com/note?a=1&amp;b=2"/><atom:content>Public maker &amp; bounded evidence.</atom:content></atom:entry></atom:feed>';
 const prefixed=parseSourcePage(definition('rss'),page(atom))[0];assert.equal(prefixed.title,'Prefixed note');assert.equal(prefixed.url,'https://example.com/note?a=1&b=2');assert.equal(prefixed.text,'Public maker & bounded evidence.');
 assert.throws(()=>parseSourcePage(definition('rss'),page(rss('https://example.com/'+'x'.repeat(5000)))),/no readable public item/);
});

test('HN JSON and Launch HN HTML expose product references without importing navigation links',()=>{
 const hn=parseSourcePage(definition('hn','https://hn.algolia.com/api/v1/search'),page(JSON.stringify({hits:[{objectID:'123',title:'Show HN: Receipt parser',url:'https://product.example.com/',story_text:'Human review remains.'},{objectID:'bad',title:'Ignore this'}]})));
 assert.equal(hn[0].url,'https://news.ycombinator.com/item?id=123');assert.equal(hn[0].productUrl,'https://product.example.com');
 const html='<a href="login">Login</a><tr class="athing submission" id="456"><td><span class="titleline"><a href="https://product.example.com/new">Launch HN: New tool</a><span class="sitebit">maker</span></span></td></tr>';
 const launch=parseSourcePage(definition('hn-launches','https://news.ycombinator.com/launches'),page(html,'https://news.ycombinator.com/launches'));
 assert.equal(launch.length,1);assert.equal(launch[0].url,'https://news.ycombinator.com/item?id=456');assert.equal(launch[0].productUrl,'https://product.example.com/new');
});

test('GitHub only parses repository h2 links inside Box-row cards and retains maker description',()=>{
 const html='<nav><a href="/apps/github-actions">Wrong</a></nav><article class="Box-row"><h2><a href="/maker/receipt">maker / receipt</a></h2><p>Extract receipts for human review.</p><a href="/login">Star</a></article><article class="other"><h2><a href="/fake/not-a-card">Ignore</a></h2></article>';
 const items=parseSourcePage(definition('github-trending','https://github.com/trending'),page(html,'https://github.com/trending'));
 assert.equal(items.length,1);assert.equal(items[0].url,'https://github.com/maker/receipt');assert.match(items[0].text,/Extract receipts for human review/);assert.match(items[0].text,/not proof/);
});

test('HF compact public Spaces never implies a running service from listing metadata',()=>{
 const raw=[{id:'maker/receipt',private:false,sdk:'gradio',tags:['receipt'],runtime:{stage:'RUNNING'}},{id:'maker/private',private:true},{id:'bad/multiple/parts',private:false},{id:'maker/unknown'}];
 const items=parseSourcePage(definition('hf-spaces','https://huggingface.co/api/spaces'),page(JSON.stringify(raw),'https://huggingface.co/api/spaces','application/json'));
 assert.equal(items.length,1);assert.equal(items[0].productUrl,'https://huggingface.co/spaces/maker/receipt');assert.match(items[0].text,/does not establish working runtime/);assert.equal(items[0].runtime,undefined);
});

test('BetaList and YC directory parse only concrete product paths; empty YC shell and Microlaunch reject',()=>{
 const beta='<a href="/browse/saas">Filter</a><a href="/promotions/id/visit">Ad</a><a href="/startups/receipt">Receipt tool</a><a href="/startups/receipt">Duplicate</a><script>const fake = \'<a href="/startups/fake">Fake</a>\';</script>';
 const items=parseSourcePage(definition('betalist','https://betalist.com'),page(beta,'https://betalist.com/'));assert.equal(items.length,1);assert.equal(items[0].url,'https://betalist.com/startups/receipt');
 const yc='<a href="/companies/receipt">Receipt company</a><a href="/companies/industry/ai">Industry</a><a href="https://other.example.com/companies/fake">Other host</a>';
 assert.equal(parseSourcePage(definition('yc-directory','https://www.ycombinator.com/companies/industry/artificial-intelligence'),page(yc,'https://www.ycombinator.com/companies/industry/artificial-intelligence')).length,1);
 assert.throws(()=>parseSourcePage(definition('yc-launches','https://www.ycombinator.com/launches'),page('<html><title>YC</title><script>loadCredentialedSearch()</script></html>','https://www.ycombinator.com/launches')),/no readable public item/);
 assert.throws(()=>parseSourcePage(definition('unparsed-listing','https://microlaunch.net'),page('<html>Navigation only.</html>','https://microlaunch.net')),/remains unadmitted/);
 const cards='<div class="flex startup-row"><a class="absolute inset-0" href="/startups/songpilot"></a><div><span class="font-medium text-gray-900">SongPilot</span><span class="text-gray-500">Run your music career with distribution, marketing, and AI help</span></div></div><a href="/startups/songpilot">SongPilot</a><div class="startup-row"><a href="/startups/receipt"></a><span class="font-medium">Receipt</span><span class="text-gray-500">Receipts for human review</span></div>';
 const parsedCards=parseSourcePage(definition('betalist','https://betalist.com'),page(cards,'https://betalist.com/'));assert.equal(parsedCards.length,2);assert.equal(parsedCards[0].title,'SongPilot');assert.match(parsedCards[0].text,/distribution, marketing, and AI help/);assert.equal(parsedCards[1].title,'Receipt');
});

test('generic public HTML uses the observed final URL; login pages and arbitrary JSON do not pass',()=>{
 const html='<html><title>Official receipt product</title><body>'+('Receipts are extracted for review and export. '.repeat(12))+'</body></html>';
 const items=parseSourcePage(definition('html','https://example.com/start'),page(html,'https://example.com/final'));assert.equal(items[0].url,'https://example.com/final');assert.equal(items[0].id,hash('https://example.com/final'));
 assert.throws(()=>parseSourcePage(definition('html'),page('<html><title>Log in</title><input type="password"/>'+html+'</html>')),/login/);
 for(const label of ['Login','Signin','Sign in','Log in'])assert.throws(()=>parseSourcePage(definition('html'),page(html.replace('Official receipt product',label))),/login/);
 assert.throws(()=>parseSourcePage(definition('json-feed'),page('{"items":[{"url":"https://example.com/a"}]}')),/supported public JSON Feed/);
 const json={version:'https://jsonfeed.org/version/1.1',items:[{id:'a',title:'Receipt',url:'https://example.com/a',content_text:'Literal public maker evidence.'}]};assert.equal(parseSourcePage(definition('json-feed'),page(JSON.stringify(json)))[0].text,'Literal public maker evidence.');
});

test('admission fails without explicit robots evidence, complete parser items or fixed adapter identity',async()=>{
 const valid=await validateSource(definition('rss'),{fetchPage:async()=>page(rss()),now:()=>Date.parse(now)});assert.equal(valid.eligible,true);assert.equal(valid.validation.robotsAllowed,true);assert.equal(valid.validation.itemCount,1);
 for(const [raw,value] of [[definition('rss'),{...page(rss()),robots:[]}],[definition('rss'),{...page(rss()),robots:[{allowed:false}]}],[definition('rss'),{...page(rss()),truncated:true}],[{...definition('rss'),id:'forged'},page(rss())],[{...definition('rss'),kind:'eval'},page(rss())]]){
  const result=await validateSource(raw,{fetchPage:async()=>value});assert.equal(result.eligible,false);assert.ok(result.reason);assert.deepEqual(result.sampleItems,[]);
 }
});

test('dynamic scan records per-feed counts before cross-feed dedupe and unions exact trusted origins',async()=>{
 const definitions=[definition('rss','https://example.com/a-feed'),definition('rss','https://example.com/b-feed')];
 const result=await scanSourceDefinitions(definitions,{fetchPage:async url=>page(rss(),url),now:()=>Date.parse(now)});
 assert.equal(result.sources.length,1);assert.deepEqual(result.observations.map(value=>value.itemCount),[1,1]);assert.equal(result.originMap.length,1);assert.deepEqual(result.originMap[0].feedIds,definitions.map(value=>value.id));assert.deepEqual(result.sources[0].originFeedIds,definitions.map(value=>value.id));
 assert.equal(result.originMap[0].sourceId,hash('https://product.example.com/one'));assert.equal(result.originMap[0].url,'https://product.example.com/one');
 await assert.rejects(scanSourceDefinitions(Array(41).fill(definitions[0])),/at most 40/);
});

test('conflicting product references retain separate frozen origin tuples without source ID duplication',async()=>{
 const definitions=[definition('hn','https://hn.algolia.com/api/v1/search?query=a'),definition('hn','https://hn.algolia.com/api/v1/search?query=b')];
 const result=await scanSourceDefinitions(definitions,{fetchPage:async url=>page(JSON.stringify({hits:[{objectID:'123',title:'Show HN: Receipt',url:url.includes('query=a')?'https://maker.example.com/a':'https://maker.example.com/b'}]}),url),now:()=>Date.parse(now)});
 assert.equal(result.sources.length,1);assert.equal(result.originMap.length,2);assert.equal(result.originMap[0].sourceId,result.originMap[1].sourceId);assert.equal(result.originMap[0].url,result.originMap[1].url);assert.deepEqual(result.originMap.map(value=>value.productUrl),['https://maker.example.com/a','https://maker.example.com/b']);
 assert.deepEqual(result.originMap.map(value=>value.feedIds),definitions.map(value=>[value.id]));assert.deepEqual(result.sources[0].originFeedIds,[definitions[0].id]);
});

test('feed discovery uses at most three literal same-origin alternate links and a fixed kind inference',()=>{
 const raw='<link rel="alternate" type="application/rss+xml" href="/feed"><link rel="alternate" type="application/atom+xml" href="https://other.example.com/atom"><link rel="alternate" type="application/feed+json" href="/feed.json"><link rel="alternate" type="application/rss+xml" href="http://example.com/insecure"><link rel="alternate" type="application/rss+xml" href="/second"><link rel="alternate" type="application/rss+xml" href="/fourth">';
 assert.deepEqual(extractPublicFeedLinks(page(raw,'https://example.com/home')),[{url:'https://example.com/feed',kind:'rss'},{url:'https://example.com/feed.json',kind:'json-feed'},{url:'https://example.com/second',kind:'rss'}]);
 assert.equal(inferSourceKind('https://github.com/trending'),'github-trending');assert.equal(inferSourceKind('https://example.com/feed'),'rss');assert.equal(inferSourceKind('https://example.com/docs'),'html');
 assert.deepEqual(extractPublicFeedLinks(page('<script>'+raw+'</script><link rel="alternate" type="application/rss+xml" data-href="/fake" href="/real">','https://example.com/home')),[{url:'https://example.com/real',kind:'rss'}]);
});
