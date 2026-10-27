import test from 'node:test';
import assert from 'node:assert/strict';
import {DISCUSSION_SOURCE_CATALOG,DISCUSSION_PROVIDER_CATALOG,makeDiscussionSource,parseDiscussionSourcePage} from '../lib/discussion-sources.mjs';
import {buildNativeReadingContext,nativeReadingContextReasons,normalizeNativePost} from '../lib/native-reading-context.mjs';
import {fetchDemandEvidence,demandEvidenceFingerprint} from '../lib/demand-sources.mjs';
import {discussionEvidenceReasons,sourceQuoteOccurs} from '../lib/evidence-contract.mjs';
import {enrichProductLeads} from '../lib/product-evidence.mjs';
import {privateArtifactReasons} from '../lib/privacy.mjs';
import {SCORING_KEYS,checkScoringApproval,weightedOverall,parseScoringPolicy} from '../lib/scoring.mjs';
import {sha256,stableJSON} from '../lib/storage.mjs';

// The task and short array are previously supplied public spans. Everything
// else, including body details, identities and dates, is an offline fixture.
const task='I cannot map array data for dynamic amount of invoice rows to the HTTP POST module’s “invoice rows” section.';
const example='“Hinta 0% (from Ostettu tuote)”: [ 390.4382470119522, 79.6812749003984 ]';
const exampleHtml='<p>“Hinta 0% (from Ostettu tuote)”: [</p><p>390.4382470119522,</p><p>79.6812749003984 ]</p>';
const detail='The first input has two amounts and two tax categories. The second input has the corresponding item descriptions in the same order. The desired result has one object for each position, with an amount, a description and its tax category together.';
const tail='A batch can contain a different number of positions each time. The amounts are decimal numbers and the descriptions are plain text. The example illustrates the input shape only; no implementation or successful execution is supplied.';
const raw=`<p>${task}</p><p>${detail}</p>${exampleHtml}<p>${tail}</p>`;
const multiRaw=raw.replace(exampleHtml,`<pre>{ ${example} }</pre>`)+`<p>${'Additional background is supplied for this synthetic fixture. '.repeat(30)}</p>`;
const definition=DISCUSSION_SOURCE_CATALOG.find(item=>item.community==='Make community');
const topicId=118145,postId=990001,url=`https://community.make.com/t/${topicId}`;
const createdAt='2026-10-27T08:00:00.000Z',now='2026-10-27T10:00:00.000Z',later='2026-10-27T10:01:00.000Z';
function page(body=raw,{fetchedAt=now,first={},topic={},identified=true}={}){
 const post={post_number:1,cooked:body,...(identified?{id:postId,topic_id:topicId,created_at:createdAt,updated_at:null}:{}),...first};
 const data={id:topicId,title:'How can I map invoice rows?',created_at:createdAt,post_stream:{posts:[post,{id:postId+1,post_number:2,cooked:'This reply is not evidence from the original post.',created_at:createdAt}]},...topic};
 const text=JSON.stringify(data);
 return {url:url+'.json',text,bytes:Buffer.byteLength(text),status:200,contentType:'application/json',fetchedAt,maxBytes:2000000,truncated:false,redirects:[],robots:[{origin:'https://community.make.com',evaluatedUrl:url+'.json',robotsUrl:'https://community.make.com/robots.txt',status:404,state:'missing',allowed:true,contentType:'text/plain',fetchedAt}]};
}
function parsed(body=raw,options={}){return parseDiscussionSourcePage(definition,page(body,options),{expectedUrl:url})[0];}
async function fresh(body=raw,{source=parsed(),...options}={}){
 let reads=0;const result=await fetchDemandEvidence(source,{definition,includeNativeReadingContext:true,fetchPage:async(requested,fetchOptions)=>{reads++;assert.equal(requested,url+'.json');assert.equal(fetchOptions.complete,true);return page(body,{fetchedAt:later,...options});}});assert.equal(reads,1);return result;
}
function buildArguments(body=raw){const response=page(body);return {source:makeDiscussionSource(definition,{url,title:'How can I map invoice rows?',text:task,date:createdAt},{fetchedAt:now}),raw:body,topicId,postId,postNumber:1,postCreatedAt:createdAt,postUpdatedAt:null,responseUrl:response.url,responseText:response.text,fetchedAt:now};}
function reseal(packet){const {packetSha256,...payload}=packet;packet.packetSha256=sha256(stableJSON(payload));return packet;}

test('identified native first posts retain bounded literal reading spans with exact versioned provenance',async()=>{
 const response=page(),source=await fresh(),packet=source.nativeReadingContext,normalized=normalizeNativePost(raw);
 assert.ok(packet);assert.equal(packet.version,2);assert.equal(packet.normalizationVersion,'discourse-visible-text-v2');
 assert.deepEqual(Object.keys(packet).sort(),['version','normalizationVersion','topicUrl','topicId','postId','postNumber','postUrl','postCreatedAt','postUpdatedAt','fetchedAt','responseUrl','responseSha256','normalizedSha256','normalizedLength','retainedCharacters','omittedCharacters','spans','packetSha256'].sort());
 assert.equal(packet.topicUrl,url);assert.equal(packet.topicId,topicId);assert.equal(packet.postId,postId);assert.equal(packet.postNumber,1);
 assert.equal(packet.postCreatedAt,createdAt);assert.equal(packet.postUpdatedAt,null);assert.equal(packet.fetchedAt,later);assert.equal(packet.responseUrl,url+'.json');
 assert.equal(packet.responseSha256,sha256(page(raw,{fetchedAt:later}).text));assert.equal(packet.normalizedSha256,sha256(normalized));assert.equal(packet.normalizedLength,normalized.length);
 assert.ok(packet.spans.length>=1&&packet.spans.length<=4);assert.ok(packet.retainedCharacters>200&&packet.retainedCharacters<=1200);
 assert.equal(packet.retainedCharacters,packet.spans.reduce((sum,span)=>sum+span.text.length,0));assert.equal(packet.omittedCharacters,normalized.length-packet.retainedCharacters);
 let end=-1;for(const span of packet.spans){assert.deepEqual(Object.keys(span).sort(),['kind','start','end','text','sha256'].sort());assert.ok(['task','context','example'].includes(span.kind));assert.ok(span.start>=end);assert.equal(span.end-span.start,span.text.length);assert.equal(normalized.slice(span.start,span.end),span.text);assert.equal(span.sha256,sha256(span.text));end=span.end;}
 assert.ok(packet.spans.some(span=>span.text.includes(task)));assert.ok(packet.spans.some(span=>span.text.includes(example)));
 assert.equal(source.text,task);assert.ok(source.text.length<=200);assert.deepEqual(source.taskExcerpts,[task]);assert.equal(source.taskExample,undefined);
 assert.equal(demandEvidenceFingerprint(source),demandEvidenceFingerprint(parsed(`<p>${task}</p>`,{identified:false})));
 const {packetSha256,...payload}=packet;assert.equal(packetSha256,sha256(stableJSON(payload)));assert.deepEqual(nativeReadingContextReasons(source),[]);assert.deepEqual(discussionEvidenceReasons(source,{definition,asOf:later}),[]);assert.deepEqual(privateArtifactReasons(source),[]);
 assert.equal(JSON.stringify(packet).includes(response.text),false,'The full response is fingerprinted, never persisted as a packet body.');
});

test('normalization uses visible contiguous text and never persists private blocks or split numeric examples',async()=>{
 const privateBlock='Please contact operator@example.invalid for an individual account.';
 const sensitiveArray='“patient_ids”: [ 1, 2 ]';
 const body=`<script>hidden script token</script><style>hidden style token</style><p>${task}</p><p>${privateBlock}</p><p>${sensitiveArray}</p>${exampleHtml}<p>${detail}</p>`;
 const source=await fresh(body),packet=source.nativeReadingContext,normalized=normalizeNativePost(body);
 assert.equal(normalized.includes('hidden script token'),false);assert.equal(normalized.includes('hidden style token'),false);
 assert.ok(packet.spans.some(span=>span.text.includes(example)));assert.equal(JSON.stringify(packet).includes(privateBlock),false);assert.equal(JSON.stringify(packet).includes(sensitiveArray),false);
 assert.equal(sourceQuoteOccurs(source,privateBlock),false);assert.equal(sourceQuoteOccurs(source,sensitiveArray),false);assert.equal(sourceQuoteOccurs(source,example),true);
 for(const span of packet.spans){assert.equal(normalized.slice(span.start,span.end),span.text);assert.deepEqual(privateArtifactReasons(span.text),[]);}
 const largeArray='“Long input”: [ '+Array.from({length:240},(_,index)=>(10000+index)+'.25').join(', ')+' ]';
 const large=await fresh(`<p>${task}</p><p>${largeArray}</p><p>${detail}</p>`);
 assert.ok(large.nativeReadingContext.retainedCharacters<=1200);assert.equal(large.nativeReadingContext.spans.some(span=>span.text.includes('“Long input”')),false,'An over-budget numeric example must be omitted whole.');
 assert.equal(sourceQuoteOccurs(large,largeArray.slice(0,150)),false);
});

test('1200 normalized characters fit and 1201 remain bounded without changing the task excerpt',async()=>{
 for(const length of [1200,1201]){
  const body=`<p>${task}</p><p>${'x'.repeat(length-task.length-1)}</p>`;
  assert.equal(normalizeNativePost(body).length,length);
  const source=await fresh(body),packet=source.nativeReadingContext;
  assert.equal(packet.normalizedLength,length);assert.ok(packet.retainedCharacters<=1200);assert.equal(packet.retainedCharacters,packet.spans.reduce((sum,span)=>sum+span.text.length,0));assert.equal(packet.omittedCharacters,length-packet.retainedCharacters);
  if(length===1200){assert.equal(packet.retainedCharacters,1200);assert.equal(packet.spans.length,1);assert.equal(packet.omittedCharacters,0);}else{assert.ok(packet.omittedCharacters>=1);assert.ok(packet.spans.every(span=>span.text.length<=1200));}
  assert.equal(source.text,task);assert.deepEqual(source.taskExcerpts,[task]);assert.equal(sourceQuoteOccurs(source,task),true);
 }
});

test('nested hidden containers stay excluded while aria-hidden false and ordinary data attributes remain visible',async()=>{
 const hidden='<div hidden><div>Hidden nested child.</div>Hidden outer tail.</div><div aria-hidden="true"><p>Hidden aria child.</p></div><div hidden="false">Hidden boolean false.</div><div style="display:none"><span>Hidden style child.</span></div>';
 const visible='<div aria-hidden="false"><span>Visible aria false.</span></div><div data-hidden="true">Visible data attribute.</div><p>Visible end.</p>';
 const body=`<p>${task}</p>${hidden}${visible}`;
 assert.equal(normalizeNativePost(body),`${task} Visible aria false. Visible data attribute. Visible end.`);
 const source=await fresh(body);assert.equal(sourceQuoteOccurs(source,'Visible aria false.'),true);assert.equal(sourceQuoteOccurs(source,'Visible data attribute.'),true);
 for(const phrase of ['Hidden nested child.','Hidden outer tail.','Hidden aria child.','Hidden boolean false.','Hidden style child.'])assert.equal(sourceQuoteOccurs(source,phrase),false,phrase);
});

test('entity normalization decodes once and preserves escaped literal text in validated spans',async()=>{
 const encoded='The literal &amp;quot;sample&amp;quot; label contains &lt;not-a-tag&gt; and &#38;quot;another&#38;quot;.';
 const visible='The literal &quot;sample&quot; label contains <not-a-tag> and &quot;another&quot;.';
 assert.equal(normalizeNativePost(`<p>${encoded}</p>`),visible);
 const body=`<p>${task}</p><p>${encoded}</p><div class="lightbox-wrapper"><span>Lightbox filename preview must be excluded.</span></div>`;
 const source=await fresh(body);assert.equal(sourceQuoteOccurs(source,visible),true);assert.equal(sourceQuoteOccurs(source,'"sample"'),false);assert.equal(sourceQuoteOccurs(source,'Lightbox filename preview must be excluded.'),false);assert.deepEqual(nativeReadingContextReasons(source),[]);
 const span=source.nativeReadingContext.spans.find(item=>item.text.includes(visible));assert.ok(span);assert.equal(normalizeNativePost(body).slice(span.start,span.end),span.text);
});

test('single-quoted, unquoted and escaped sensitive keys are omitted and independently rejected if forged',async()=>{
 const examples=["{ 'patient_ids': [ 1, 2 ] }",'{ user_id: [ 1, 2 ] }','{ api_key: [ 1, 2 ] }','{ "em\\u0061il": [ 1, 2 ] }','{ "client": [ 1, 2 ] }',"{ 'customer': [ 1, 2 ] }",'{ owner: [ 1, 2 ] }','{ "client_id": [ 1, 2 ] }','{ "customerIdentifier": [ 1, 2 ] }','{ "owner_uuid": [ 1, 2 ] }'];
 for(const exampleText of examples){
  const source=await fresh(`<p>${task}</p><pre>${exampleText}</pre><p>${detail}</p>`);
  assert.equal(sourceQuoteOccurs(source,exampleText),false,exampleText);assert.equal(JSON.stringify(source.nativeReadingContext.spans).includes(exampleText),false,exampleText);
  const forged=structuredClone(source),packet=forged.nativeReadingContext,text=task+' '+exampleText;
  packet.spans=[{kind:'context',start:0,end:text.length,text,sha256:sha256(text)}];packet.normalizedLength=text.length;packet.normalizedSha256=sha256(text);packet.retainedCharacters=text.length;packet.omittedCharacters=0;reseal(packet);
  assert.ok(nativeReadingContextReasons(forged).length,exampleText);assert.equal(sourceQuoteOccurs(forged,exampleText),false,exampleText);
 }
});

test('a named signoff omits its entire block and separate signature line without retaining the name',async()=>{
 for(const signature of ['<p>This whole closing block is omitted. Thank you in advance, Alice</p>','<p>Thank you in advance,</p><p>Alice</p>','<p>Best, Alice</p>','<p>Alice</p>','<p>Alice Smith.</p>','<p>ALICE SMITH</p>','<p>— Alice Smith</p>','<p>Alice Smith | Operations</p>','<p>alice smith</p>']){
  const source=await fresh(`<p>${task}</p><p>${detail}</p>${signature}`);
  assert.equal(JSON.stringify(source.nativeReadingContext).toLowerCase().includes('alice'),false,signature);assert.equal(sourceQuoteOccurs(source,normalizeNativePost(signature)),false,signature);assert.equal(sourceQuoteOccurs(source,'Thank you in advance,'),false);assert.equal(sourceQuoteOccurs(source,'This whole closing block is omitted.'),false);assert.equal(sourceQuoteOccurs(source,detail),true);
 }
});

test('exceeding the native paragraph bound falls back to the unchanged short source after one request',async()=>{
 const body=`<p>${task}</p>`+'<p>Supplemental input context.</p>'.repeat(401);
 assert.equal(buildNativeReadingContext(buildArguments(body)),null);
 const source=await fresh(body);assert.equal(source.nativeReadingContext,undefined);assert.equal(source.text,task);assert.deepEqual(source.taskExcerpts,[task]);assert.deepEqual(discussionEvidenceReasons(source,{definition,asOf:later}),[]);
});

test('an incomplete outer object retains its complete inner object and all three arrays without inventing closing text',async()=>{
 const inner='{ "Amounts": [ 10.25, 20.5 ], "Tax rates": [ 0, 20 ], "Item codes": [ 101, 102 ] }';
 const incomplete='{ "record": '+inner;
 const body=`<p>${task}</p><pre>${incomplete}</pre><p>${'Additional background for the synthetic incomplete-object fixture. '.repeat(30)}</p>`;
 const source=await fresh(body),packet=source.nativeReadingContext,normalized=normalizeNativePost(body);
 assert.ok(normalized.length>1200);assert.ok(packet.spans.some(span=>span.kind==='example'&&span.text===inner));assert.equal(sourceQuoteOccurs(source,inner),true);assert.equal(sourceQuoteOccurs(source,incomplete+' }'),false);
 for(const values of ['[ 10.25, 20.5 ]','[ 0, 20 ]','[ 101, 102 ]'])assert.equal(sourceQuoteOccurs(source,values),true);
 assert.equal(Object.keys(JSON.parse(inner)).length,3);for(const span of packet.spans)assert.equal(normalized.slice(span.start,span.end),span.text);
});

test('the pure builder refuses missing, foreign or non-original provenance and a missing task anchor',()=>{
 const args=buildArguments();assert.ok(buildNativeReadingContext(args));
 for(const change of [{postId:null},{topicId:topicId+1},{postNumber:2},{postCreatedAt:null},{postCreatedAt:'invalid'},{postUpdatedAt:false},{postUpdatedAt:0},{postUpdatedAt:''},{responseUrl:'https://community.make.com/t/999.json'},{responseText:'{}'},{raw:'A different body does not contain the selected task.'}]){
  assert.equal(buildNativeReadingContext({...args,...change}),null,JSON.stringify(change));
 }
 for(const mutate of [data=>data.id++,data=>data.post_stream.posts[0].id++,data=>data.post_stream.posts[0].post_number=2,data=>data.post_stream.posts[0].created_at=now,data=>data.post_stream.posts[0].updated_at=now,data=>data.post_stream.posts[0].cooked=`<p>${task}</p>`,data=>delete data.post_stream.posts[0].created_at]){
  const data=JSON.parse(args.responseText);mutate(data);assert.equal(buildNativeReadingContext({...args,responseText:JSON.stringify(data)}),null,mutate.toString());
 }
});

test('ambiguous original posts fail the actual native fetch after exactly one guarded request',async()=>{
 const response=page(),data=JSON.parse(response.text);data.post_stream.posts.push({...data.post_stream.posts[0],id:postId+2,cooked:`<p>${task}</p><p>A conflicting original body.</p>`});response.text=JSON.stringify(data);response.bytes=Buffer.byteLength(response.text);
 assert.equal(buildNativeReadingContext({...buildArguments(),responseText:response.text}),null);
 let reads=0;await assert.rejects(fetchDemandEvidence(parsed(),{definition,fetchPage:async(requested,options)=>{reads++;assert.equal(requested,url+'.json');assert.equal(options.complete,true);return response;}}),/unambiguous public first post/);assert.equal(reads,1);
});

test('present packets reject malformed shapes, inconsistent hashes, offsets, budgets and mixed versions',async()=>{
 const source=await fresh(multiRaw);assert.ok(source.nativeReadingContext.spans.length>=2);
 const mutations=[
  p=>p.version=1,p=>p.normalizationVersion='discourse-visible-text-v1',p=>p.topicUrl='https://community.make.com/t/999',p=>p.topicId++,p=>p.postId=0,p=>p.postNumber=2,p=>p.postUrl='https://community.make.com/t/118145/2',p=>delete p.fetchedAt,p=>p.responseUrl='https://community.make.com/t/999.json',p=>p.responseSha256='bad',p=>p.normalizedSha256='bad',p=>p.normalizedLength=-1,p=>p.retainedCharacters++,p=>p.omittedCharacters=-1,p=>p.extra='unexpected',
  p=>p.postUpdatedAt=false,p=>p.postUpdatedAt=0,p=>p.postUpdatedAt='',
  p=>p.spans[0].start=-1,p=>p.spans[0].end++,p=>p.spans[0].sha256='0'.repeat(64),p=>p.spans[0].extra=true,p=>p.spans[0].kind='author',p=>p.spans.push(...Array(4).fill(p.spans[0])),p=>p.spans[1].start=p.spans[0].start,
 ];
 for(const mutate of mutations){const changed=structuredClone(source);mutate(changed.nativeReadingContext);reseal(changed.nativeReadingContext);assert.ok(nativeReadingContextReasons(changed).length,mutate.toString());assert.ok(discussionEvidenceReasons(changed,{definition,asOf:later}).length,mutate.toString());assert.equal(sourceQuoteOccurs(changed,detail),false,mutate.toString());}
 const hashChanged=structuredClone(source);hashChanged.nativeReadingContext.packetSha256='0'.repeat(64);assert.ok(nativeReadingContextReasons(hashChanged).length);
 const privateChanged=structuredClone(source),privatePacket=privateChanged.nativeReadingContext,privateSpan=privatePacket.spans[1];privateSpan.text='Please email operator@example.invalid for assistance.';privateSpan.end=privateSpan.start+privateSpan.text.length;privateSpan.sha256=sha256(privateSpan.text);privatePacket.retainedCharacters=privatePacket.spans.reduce((sum,span)=>sum+span.text.length,0);privatePacket.omittedCharacters=privatePacket.normalizedLength-privatePacket.retainedCharacters;reseal(privatePacket);assert.ok(nativeReadingContextReasons(privateChanged).length);assert.equal(sourceQuoteOccurs(privateChanged,privateSpan.text),false);
 const oversized=structuredClone(source),budget=oversized.nativeReadingContext,anchor=budget.spans[0],text='x'.repeat(1200);budget.spans=[anchor,{kind:'context',start:anchor.end+1,end:anchor.end+1+text.length,text,sha256:sha256(text)}];budget.normalizedLength=budget.spans[1].end;budget.retainedCharacters=anchor.text.length+text.length;budget.omittedCharacters=budget.normalizedLength-budget.retainedCharacters;reseal(budget);assert.ok(nativeReadingContextReasons(oversized).length);
 for(const packet of [null,[],{},'body'])assert.ok(nativeReadingContextReasons({...source,nativeReadingContext:packet}).length);
 const mixed={...source,taskExample:{version:1,text:example,sha256:sha256(example)}};assert.ok(nativeReadingContextReasons(mixed).length);assert.ok(discussionEvidenceReasons(mixed,{definition,asOf:later}).length);
 const aliased={...source,feedExcerpt:'A different legacy discovery excerpt would expand the retained reading budget.'};assert.ok(nativeReadingContextReasons(aliased).length);assert.ok(discussionEvidenceReasons(aliased,{definition,asOf:later}).length);assert.equal(sourceQuoteOccurs(aliased,detail),false);
});

test('native reading packets cannot widen provider or discovery excerpts and v1 history remains valid',async()=>{
 const source=await fresh(),legacy=await fresh(`<p>${task}</p>${exampleHtml}`,{identified:false});
 assert.equal(legacy.nativeReadingContext,undefined);assert.deepEqual(legacy.taskExample,{version:1,text:example,sha256:sha256(example)});assert.deepEqual(nativeReadingContextReasons(legacy),[]);assert.deepEqual(discussionEvidenceReasons(legacy,{definition,asOf:later}),[]);assert.equal(sourceQuoteOccurs(legacy,example),true);
 const rss=page();rss.url=definition.url;rss.contentType='application/rss+xml';rss.text=`<rss><channel><item><title>How can I map invoice rows?</title><link>${url}</link><pubDate>${createdAt}</pubDate><description><![CDATA[${raw}]]></description></item></channel></rss>`;
 const discovery=parseDiscussionSourcePage(definition,rss)[0];assert.equal(discovery.nativeReadingContext,undefined);assert.ok(discovery.text.length<=200);
 const providerDefinition=DISCUSSION_PROVIDER_CATALOG.find(item=>item.platform==='reddit');
 const provider=makeDiscussionSource(providerDefinition,{url:'https://www.reddit.com/comments/abc12',title:'How can I map invoice rows?',text:task,date:createdAt},{fetchedAt:now});provider.nativeReadingContext=structuredClone(source.nativeReadingContext);
 assert.ok(provider.text.length<=200);assert.ok(nativeReadingContextReasons(provider).length);assert.equal(sourceQuoteOccurs(provider,detail),false);
 const hnDefinition=DISCUSSION_SOURCE_CATALOG.find(item=>item.kind==='hn-discussion'),foreign={...source,registrySourceId:hnDefinition.id};assert.ok(discussionEvidenceReasons(foreign,{definition:hnDefinition,asOf:later}).length);assert.equal(sourceQuoteOccurs(foreign,detail),false);
});

test('fresh original-post reads replace changed packets and remove unavailable packets through actual enrichment',async()=>{
 const original=await fresh(),before=stableJSON(original),changedRaw=raw.replace('two tax categories','three tax categories');
 const changed=await fresh(changedRaw,{source:original});assert.notEqual(changed.nativeReadingContext.packetSha256,original.nativeReadingContext.packetSha256);assert.notEqual(changed.nativeReadingContext.normalizedSha256,original.nativeReadingContext.normalizedSha256);assert.equal(changed.text,original.text);assert.deepEqual(changed.taskExcerpts,original.taskExcerpts);
 const missing=await fresh(`<p>${task}</p>`,{source:original,identified:false});assert.equal(missing.nativeReadingContext,undefined);
 const result=await enrichProductLeads({sources:[original],originMap:[{sourceId:original.id,url,productUrl:url,feedIds:[definition.id]}],learningSelection:{selectedSegment:original.segment,demandSourceIds:[definition.id]},demandDefinitions:[definition],now:()=>Date.parse(later),fetchPage:async requested=>{assert.equal(requested,url+'.json');return page(`<p>${task}</p>`,{fetchedAt:later,identified:false});}});
 assert.equal(result.enrichment.status,'completed',JSON.stringify(result.enrichment.observations));assert.equal(result.enrichment.fetched,1);const merged=result.sources.find(item=>item.id===original.id);assert.equal(merged.nativeReadingContext,undefined);assert.equal(sourceQuoteOccurs(merged,detail),false);assert.equal(merged.text,task);assert.equal(stableJSON(original),before);
 const legacy={...await fresh(`<p>${task}</p>${exampleHtml}`,{identified:false}),feedExcerpt:'A distinct stale discovery body. '.repeat(50)},legacyBefore=stableJSON(legacy);let reads=0;
 const upgraded=await enrichProductLeads({sources:[legacy],originMap:[{sourceId:legacy.id,url,productUrl:url,feedIds:[definition.id]}],learningSelection:{selectedSegment:legacy.segment,demandSourceIds:[definition.id]},demandDefinitions:[definition],now:()=>Date.parse(later),fetchPage:async requested=>{reads++;assert.equal(requested,url+'.json');return page(raw,{fetchedAt:later});}});
 assert.equal(upgraded.enrichment.status,'completed',JSON.stringify(upgraded.enrichment.observations));assert.equal(reads,1);const upgradedSource=upgraded.sources.find(item=>item.id===legacy.id);assert.equal(upgradedSource.nativeReadingContext.version,2);assert.equal(Object.hasOwn(upgradedSource,'feedExcerpt'),false);assert.equal(Object.hasOwn(upgradedSource,'taskExample'),false);assert.deepEqual(nativeReadingContextReasons(upgradedSource),[]);assert.deepEqual(discussionEvidenceReasons(upgradedSource,{definition,asOf:later}),[]);assert.equal(upgradedSource.text,task);assert.deepEqual(upgradedSource.taskExcerpts,[task]);assert.equal(JSON.stringify(upgradedSource).includes('distinct stale discovery body'),false);assert.equal(stableJSON(legacy),legacyBefore);
});

test('additional reading quotes must stay wholly inside one valid literal span',async()=>{
 const source=await fresh(multiRaw),packet=source.nativeReadingContext,normalize=value=>value.replace(/\s+/g,' ').toLowerCase();assert.ok(packet.spans.length>=2);
 assert.equal(sourceQuoteOccurs(source,detail),true);assert.equal(sourceQuoteOccurs(source,detail.toUpperCase()),false);assert.equal(sourceQuoteOccurs(source,detail.toUpperCase(),{normalize}),true);
 const a=packet.spans[0],b=packet.spans[1],crossing=a.text.slice(-20)+' '+b.text.slice(0,20);assert.equal(sourceQuoteOccurs(source,crossing),false);assert.equal(sourceQuoteOccurs(source,crossing,{normalize}),false);
 const stale={...source,verifiedAt:'2026-10-27T09:59:00.000Z'};assert.ok(discussionEvidenceReasons(stale,{definition,asOf:later}).length);assert.equal(sourceQuoteOccurs(stale,detail),false);
});

test('expanded reading supports literal score checks while all score ceilings and the threshold remain unchanged',async()=>{
 const source=await fresh(),policy=parseScoringPolicy('# Fixture\n<!-- scoring-policy:start -->\n```json\n{"weights":{"ease":1,"profit":1,"feasibility":1,"autonomy":1,"evidence":1},"publishThreshold":6}\n```\n<!-- scoring-policy:end -->');
 const criteria=Object.fromEntries(SCORING_KEYS.map(key=>[key,{value:4,reason:key==='profit'?'Hypothesis: no customer payment is established.':'Only the supplied input shape is established.',sourceIds:[source.id]}]));
 const checks=SCORING_KEYS.map(criterion=>({criterion,supported:true,maxSupportedScore:4,reason:criterion==='profit'?'Hypothesis: no customer payment is established.':'The literal input description supports only this limited observation.',sourceId:source.id,evidenceQuote:criterion==='feasibility'?detail:task}));
 const before=stableJSON({criteria,policy,source});assert.deepEqual(checkScoringApproval(criteria,checks,[source],{sourceIds:[source.id]}),[]);assert.equal(weightedOverall(criteria,policy.weights),4);assert.equal(policy.threshold,6);assert.equal(stableJSON({criteria,policy,source}),before);
 const unsupported=structuredClone(checks);unsupported[0].maxSupportedScore=3;assert.ok(checkScoringApproval(criteria,unsupported,[source],{sourceIds:[source.id]}).length);
 const absent={...source};delete absent.nativeReadingContext;assert.ok(checkScoringApproval(criteria,checks,[absent],{sourceIds:[source.id]}).some(reason=>/quote/.test(reason)));
});

test('default refresh follows the sealed body version and rejects corrupt v2 before retrieval',async()=>{
 const legacy=parsed(raw,{identified:false});let reads=0;
 const fetchPage=async requested=>{reads++;assert.equal(requested,url+'.json');return page(raw,{fetchedAt:later});};
 const old=await fetchDemandEvidence(legacy,{definition,fetchPage});assert.equal(old.nativeReadingContext,undefined);assert.equal(reads,1);
 const upgraded=await fetchDemandEvidence(legacy,{definition,fetchPage,includeNativeReadingContext:true});assert.ok(upgraded.nativeReadingContext);assert.equal(reads,2);
 const current=await fetchDemandEvidence(upgraded,{definition,fetchPage});assert.ok(current.nativeReadingContext);assert.equal(reads,3);
 const corrupt=structuredClone(current);corrupt.nativeReadingContext.packetSha256='0'.repeat(64);
 await assert.rejects(fetchDemandEvidence(corrupt,{definition,fetchPage}),/fingerprint/);assert.equal(reads,3);
});
