import test from 'node:test';
import assert from 'node:assert/strict';
import {robotsDecision,parseRobots,ROBOTS_CACHE_MS} from '../lib/robots.mjs';
import {fetchPublic,validateURL,EVIDENCE_MAX_BYTES,FEED_MAX_BYTES} from '../lib/source-fetch.mjs';

const text=(body,status=200,type='text/plain',headers={})=>new Response(body,{status,headers:{'content-type':type,...headers}});
function harness(entries={},dns=()=>[{address:'93.184.216.34',family:4}]){
 const calls=[],lookups=[];let time=Date.parse('2026-10-11T12:00:00Z');
 const options={robotsCache:new Map(),now:()=>time,lookupHost:async host=>{lookups.push(host);return dns(host);},fetchImpl:async(raw,settings)=>{
  const url=new URL(raw);calls.push({url:url.toString(),settings});
  const result=entries[url.toString()];if(result instanceof Error)throw result;if(typeof result==='function')return result(url,settings);if(result)return result();
  return url.pathname==='/robots.txt'?text('',404):text('A readable public source contains enough material to support a bounded experiment. '.repeat(3));
 }};
 return {calls,lookups,options,advance:duration=>{time+=duration;}};
}

test('robots combines matching groups, uses wildcard fallback and preserves empty-rule boundaries',()=>{
 const rules='User-agent: *\nDisallow: /wild\nUser-agent: WhileYouSleep\nDisallow:\nSitemap: https://example.com/sitemap.xml\nUser-agent: AnotherBot\nDisallow: /other\nUser-agent: WHILEYOUSLEEP\nDisallow: /ours\nAllow: /ours/open\n';
 assert.equal(robotsDecision(rules,'https://example.com/wild').allowed,true);
 assert.equal(robotsDecision(rules,'https://example.com/other').allowed,true);
 assert.equal(robotsDecision(rules,'https://example.com/ours').allowed,false);
 assert.equal(robotsDecision(rules,'https://example.com/ours/open').allowed,true);
 assert.equal(robotsDecision(rules,'https://example.com/wild','DifferentCrawler').allowed,false);
 assert.equal(parseRobots('User-agent: *\nSitemap: https://example.com/\nDisallow: /blocked').rules.length,1);
});

test('robots compares case-sensitive path and query, percent octets, wildcards and Allow ties',()=>{
 const check=(rule,url)=>robotsDecision('User-agent: *\n'+rule,url).allowed;
 assert.equal(check('Disallow: /*?since=*','https://github.com/trending?since=daily'),false);
 assert.equal(check('Disallow: /*?since=*','https://github.com/trending'),true);
 assert.equal(check('Disallow: /Private','https://example.com/private'),true);
 assert.equal(check('Disallow: /%70rivate','https://example.com/private/x'),false);
 assert.equal(check('Disallow: /café','https://example.com/caf%C3%A9'),false);
 assert.equal(check('Disallow: /a%2Fb','https://example.com/a%2Fb'),false);
 assert.equal(check('Disallow: /a%2Fb','https://example.com/a/b'),true);
 assert.equal(check('Disallow: /literal%2A','https://example.com/literal*'),false);
 assert.equal(check('Disallow: /exact$','https://example.com/exact/long'),true);
 assert.equal(check('Disallow: /same\nAllow: /same','https://example.com/same'),true);
 assert.equal(check('Disallow: /a*bbbb\nAllow: /a%2Fb*','https://example.com/a%2Fbbbbb'),false,'encoded triplets count as one octet; a shorter Allow must not win');
});

test('robots wildcards have bounded literal matching, including adversarial repeated stars and suffix overlap',()=>{
 const evil='/'+'*a'.repeat(18)+'c$',target='https://example.com/'+'a'.repeat(100)+'b';
 const started=performance.now();assert.equal(robotsDecision('User-agent: *\nDisallow: '+evil,target).allowed,true);assert.ok(performance.now()-started<1000);
 const cases=[['/a*b*c$','/abbcc',false],['/a*b*c$','/abbcc/extra',true],['/a*ab$','/aab',false],['/a*ab$','/ab',true],['/a*b','/ab/extra',false],['/*','/any',false],['/*.gif$','/a.gif?x=1',true],['/*.gif$','/a.gif',false]];
 for(const [pattern,path,allowed] of cases)assert.equal(robotsDecision('User-agent: *\nDisallow: '+pattern,'https://example.com'+path).allowed,allowed,pattern+' vs '+path);
 const expensive='User-agent: *\n'+('Disallow: /*missing\n'.repeat(400));
 assert.throws(()=>robotsDecision(expensive,'https://example.com/'+'a'.repeat(4000)),error=>error.code==='robots_match_budget'&&error.stage==='robots');
 assert.throws(()=>robotsDecision(' '.repeat(524289),'https://example.com/'),error=>error.code==='robots_body_oversized');
});

test('robots disallow prevents the source request and exposes the actual evaluated URL',async()=>{
 const h=harness({'https://example.com/robots.txt':()=>text('User-agent: *\nDisallow: /private')});
 await assert.rejects(fetchPublic('https://example.com/private',h.options),error=>error.code==='robots_disallowed'&&error.validation.evaluatedUrl==='https://example.com/private');
 assert.deepEqual(h.calls.map(call=>call.url),['https://example.com/robots.txt']);
});

test('each source redirect checks destination DNS and destination robots before requesting evidence',async()=>{
 const h=harness({'https://example.com/start':()=>text('',302,'text/plain',{location:'https://other.example.com/blocked'}),'https://other.example.com/robots.txt':()=>text('User-agent: *\nDisallow: /blocked')});
 await assert.rejects(fetchPublic('https://example.com/start',h.options),error=>error.code==='robots_disallowed');
 assert.ok(h.lookups.includes('other.example.com'));assert.equal(h.calls.some(call=>call.url==='https://other.example.com/blocked'),false);
 const privateHop=harness({'https://example.com/start':()=>text('',302,'text/plain',{location:'https://metadata.example.com/latest'})},host=>[{address:host==='metadata.example.com'?'169.254.169.254':'93.184.216.34',family:4}]);
 await assert.rejects(fetchPublic('https://example.com/start',privateHop.options),/private address/);assert.equal(privateHop.calls.some(call=>call.url.includes('metadata.example.com')),false);
});

test('robots follows five guarded redirects across origins and keeps rules scoped to initial origin',async()=>{
 const entries={'https://example.com/robots.txt':()=>text('',301,'text/plain',{location:'https://robots.example.net/r1'})};
 for(let index=1;index<5;index++)entries[`https://robots.example.net/r${index}`]=()=>text('',302,'text/plain',{location:`/r${index+1}`});
 entries['https://robots.example.net/r5']=()=>text('User-agent: *\nDisallow: /secret');
 const h=harness(entries);await assert.rejects(fetchPublic('https://example.com/secret',h.options),error=>error.code==='robots_disallowed'&&error.validation.origin==='https://example.com'&&error.validation.redirects.length===5);
 assert.equal(h.calls.some(call=>call.url==='https://example.com/secret'),false);
});

test('ambiguous or unreachable robots fail closed; only missing 404 or 410 permits access',async()=>{
 for(const status of [401,403,429,500,503]){
  const h=harness({'https://example.com/robots.txt':()=>text('not permission',status)});
  await assert.rejects(fetchPublic('https://example.com/page',h.options),error=>error.code==='robots_unavailable');assert.equal(h.calls.length,1);
 }
 for(const type of ['text/html','application/json']){
  const h=harness({'https://example.com/robots.txt':()=>text('<html>challenge</html>',200,type)});await assert.rejects(fetchPublic('https://example.com/page',h.options),/robots.txt/);assert.equal(h.calls.length,1);
 }
 const oversized=harness({'https://example.com/robots.txt':()=>text(' '.repeat(524289))});await assert.rejects(fetchPublic('https://example.com/page',oversized.options),/complete 524288-byte/);
 const offline=harness({'https://example.com/robots.txt':new Error('Network unavailable')});await assert.rejects(fetchPublic('https://example.com/page',offline.options),/Network unavailable/);
 for(const status of [404,410]){const h=harness({'https://example.com/robots.txt':()=>text('',status)});const page=await fetchPublic('https://example.com/page',h.options);assert.equal(page.robots[0].allowed,true);assert.equal(page.robots[0].state,'missing');}
});

test('robots cache expires within twenty-four hours and shares concurrent origin lookups',async()=>{
 const h=harness({'https://example.com/robots.txt':()=>text('User-agent: *\nAllow: /')});
 await Promise.all([fetchPublic('https://example.com/a',h.options),fetchPublic('https://example.com/b',h.options)]);
 assert.equal(h.calls.filter(call=>call.url.endsWith('/robots.txt')).length,1);
 h.advance(ROBOTS_CACHE_MS+1);await fetchPublic('https://example.com/c',h.options);assert.equal(h.calls.filter(call=>call.url.endsWith('/robots.txt')).length,2);
});

test('evidence truncation is explicit while complete feeds up to two MB remain valid and oversize rejects',async()=>{
 const big='x'.repeat(EVIDENCE_MAX_BYTES+100),h=harness({'https://example.com/big':()=>text(big)});
 const evidence=await fetchPublic('https://example.com/big',h.options);assert.equal(evidence.bytes,EVIDENCE_MAX_BYTES);assert.equal(evidence.truncated,true);
 const complete=await fetchPublic('https://example.com/big',{...h.options,maxBytes:FEED_MAX_BYTES,complete:true});assert.equal(complete.text,big);assert.equal(complete.truncated,false);
 const excessive=harness({'https://example.com/huge':()=>text('x'.repeat(FEED_MAX_BYTES+1))});await assert.rejects(fetchPublic('https://example.com/huge',{...excessive.options,maxBytes:FEED_MAX_BYTES,complete:true}),error=>error.code==='body_oversized');
 const exact=harness({'https://example.com/exact':()=>text('x'.repeat(FEED_MAX_BYTES))});assert.equal((await fetchPublic('https://example.com/exact',{...exact.options,maxBytes:FEED_MAX_BYTES,complete:true})).truncated,false);
});

test('URL guards reject credentials, HTTP, unusual ports and all private or mapped private DNS answers',async()=>{
 for(const raw of ['http://example.com','https://u:p@example.com','https://example.com:444','https://localhost','https://sub.internal'])await assert.rejects(validateURL(raw,{lookupHost:async()=>{throw new Error('Must reject before DNS.');}}));
 for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.1.1','192.168.1.1','172.16.1.1','::1','0:0:0:0:0:0:0:1','fd00::1','fe80::1','ff02::1','::ffff:7f00:1'])await assert.rejects(validateURL('https://example.com',{lookupHost:async()=>[{address}]}),/private address/);
 await assert.rejects(validateURL('https://example.com',{lookupHost:async()=>[{address:'93.184.216.34'},{address:'10.0.0.2'}]}),/private address/);
 const h=harness({'https://example.com/a':()=>text('binary',200,'application/octet-stream')});await assert.rejects(fetchPublic('https://example.com/a',h.options),error=>error.code==='unreadable_type');
 assert.ok(h.calls.every(call=>!Object.keys(call.settings.headers).some(key=>/authorization|cookie/i.test(key))));
 await assert.rejects(validateURL('https://example.com/'+'a'.repeat(4096),{lookupHost:async()=>{throw new Error('Must reject before DNS.');}}),error=>error.code==='invalid_url');
});

test('read-only platform abort errors retain a safe fetch failure instead of throwing while replacing message',async()=>{
 const error=new DOMException('A bounded source request timed out.','TimeoutError');const h=harness({'https://example.com/tender':error});
 await assert.rejects(fetchPublic('https://example.com/tender',h.options),failure=>failure.code==='source_unavailable'&&failure.stage==='fetch'&&!failure.message.includes('Cannot set property'));
});
