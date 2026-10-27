import test from 'node:test';
import assert from 'node:assert/strict';
import {DISCUSSION_SOURCE_CATALOG,DISCUSSION_PROVIDER_CATALOG,discussionTaskExample,validDiscussionTaskExample,parseDiscussionSourcePage,makeDiscussionSource} from '../lib/discussion-sources.mjs';
import {fetchDemandEvidence,demandEvidenceFingerprint} from '../lib/demand-sources.mjs';
import {discussionEvidenceReasons,sourceQuoteOccurs} from '../lib/evidence-contract.mjs';
import {SCORING_KEYS,checkScoringApproval,weightedOverall,parseScoringPolicy} from '../lib/scoring.mjs';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {enrichProductLeads} from '../lib/product-evidence.mjs';

// Only these two short spans are real. The page structure, metadata and
// surrounding text are synthetic offline fixtures, not new source evidence.
const task='I cannot map array data for dynamic amount of invoice rows to the HTTP POST module’s “invoice rows” section.';
const example='“Hinta 0% (from Ostettu tuote)”: [ 390.4382470119522, 79.6812749003984 ]';
const exampleHtml='<p>“Hinta 0% (from Ostettu tuote)”: [</p><p>390.4382470119522,</p><p>79.6812749003984 ]</p>';
const body=`<p>${task}</p>${exampleHtml}`,url='https://community.make.com/t/118145';
const definition=DISCUSSION_SOURCE_CATALOG.find(row=>row.community==='Make community');
const now='2026-10-27T10:00:00.000Z',later='2026-10-27T10:01:00.000Z';
function page(raw,fetchedAt=now){const text=JSON.stringify({id:118145,title:'How can I map invoice rows?',created_at:now,post_stream:{posts:[{post_number:1,cooked:raw},{post_number:2,cooked:'A reply must not become the original post.'}]}});return {url:url+'.json',text,bytes:Buffer.byteLength(text),status:200,contentType:'application/json',fetchedAt,maxBytes:2000000,truncated:false,redirects:[],robots:[{origin:'https://community.make.com',evaluatedUrl:url+'.json',robotsUrl:'https://community.make.com/robots.txt',status:404,state:'missing',allowed:true,contentType:'text/plain',fetchedAt}]};}
function parsed(raw=body){return parseDiscussionSourcePage(definition,page(raw),{expectedUrl:url})[0];}
async function fresh(raw=body,source=parsed(),fetchedAt=later){let reads=0;const result=await fetchDemandEvidence(source,{definition,fetchPage:async(requested,options)=>{reads++;assert.equal(requested,url+'.json');assert.equal(options.complete,true);return page(raw,fetchedAt);}});assert.equal(reads,1);return result;}

test('native original-post extraction preserves the literal named array and unchanged task fingerprint within 200 characters',async()=>{
 assert.equal(task.length,108);assert.equal(example.length,72);assert.equal(task.length+example.length,180);
 const input=parsed(),without=parsed(`<p>${task}</p>`),record=await fresh();
 assert.deepEqual(discussionTaskExample(body,task),{version:1,text:example,sha256:sha256(example)});assert.deepEqual(input.taskExample,{version:1,text:example,sha256:sha256(example)});
 assert.equal(record.id,without.id);assert.equal(record.text,task);assert.deepEqual(record.taskExcerpts,[task]);assert.equal(demandEvidenceFingerprint(record),demandEvidenceFingerprint(without));assert.equal(sha256(record.text),sha256(without.text));
 assert.equal(validDiscussionTaskExample(record),true);assert.deepEqual(discussionEvidenceReasons(record,{definition,asOf:later}),[]);assert.equal(record.verifiedAt,later);assert.equal(record.taskExample.text,example);
 assert.equal(body.includes(example),false,'Adjacent paragraph markup requires only whitespace normalization.');
 assert.equal(body.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').includes(example),true,'The example is one complete normalized span, not stitched selected values.');
});

test('fresh reconstruction replaces a changed example and removes a missing one instead of carrying old evidence',async()=>{
 const original=await fresh(),before=stableJSON(original),changedBody=body.replace('79.6812749003984','80.5');
 const changed=await fresh(changedBody,original,'2026-10-27T10:02:00.000Z');assert.equal(changed.text,task);assert.notEqual(changed.taskExample.sha256,original.taskExample.sha256);assert.equal(changed.taskExample.text,example.replace('79.6812749003984','80.5'));
 assert.equal(sourceQuoteOccurs(changed,'79.6812749003984'),false);assert.equal(sourceQuoteOccurs(changed,'80.5'),true);
 const missing=await fresh(`<p>${task}</p>`,original,'2026-10-27T10:03:00.000Z');assert.equal(missing.taskExample,undefined);assert.equal(sourceQuoteOccurs(missing,example),false);assert.equal(missing.text,original.text);assert.deepEqual(missing.taskExcerpts,original.taskExcerpts);assert.equal(stableJSON(original),before);
 const replyOnly=page(`<p>${task}</p>`);const raw=JSON.parse(replyOnly.text);raw.post_stream.posts[1].cooked=exampleHtml;replyOnly.text=JSON.stringify(raw);assert.equal(parseDiscussionSourcePage(definition,replyOnly)[0].taskExample,undefined);
});

test('actual enrichment merge cannot retain an old example absent from the freshly reconstructed post',async()=>{
 const original=await fresh(),before=stableJSON(original);
 for(const raw of [`<p>${task}</p>`,body.replace('79.6812749003984','80.5')]){
  const result=await enrichProductLeads({sources:[original],originMap:[{sourceId:original.id,url,productUrl:url,feedIds:[definition.id]}],learningSelection:{selectedSegment:original.segment,demandSourceIds:[definition.id]},demandDefinitions:[definition],now:()=>Date.parse('2026-10-27T10:02:00.000Z'),fetchPage:async requested=>{assert.equal(requested,url+'.json');return page(raw,'2026-10-27T10:02:00.000Z');}});
  assert.equal(result.enrichment.status,'completed',JSON.stringify(result.enrichment.observations));assert.equal(result.enrichment.fetched,1);
  const merged=result.sources.find(source=>source.id===original.id);assert.equal(merged.text,task);assert.deepEqual(merged.taskExcerpts,[task]);assert.equal(sourceQuoteOccurs(merged,'79.6812749003984'),false);
  if(raw===`<p>${task}</p>`)assert.equal(merged.taskExample,undefined);else assert.equal(merged.taskExample.text,example.replace('79.6812749003984','80.5'));
 }
 assert.equal(stableJSON(original),before);
});

test('example extraction respects the shared budget, privacy and complete numeric-array shape',()=>{
 const exactBudgetTask=task+' Additional context.';assert.equal(exactBudgetTask.length+example.length,200);assert.equal(discussionTaskExample(`<p>${exactBudgetTask}</p>${exampleHtml}`,exactBudgetTask)?.text,example);
 assert.equal(discussionTaskExample(`<p>${exactBudgetTask}x</p>${exampleHtml}`,exactBudgetTask+'x'),null);
 for(const raw of ['“Email person@example.invalid”: [ 1, 2 ]','“Customer_id”: [ 1, 2 ]','“Phone”: [ 1, 2 ]','“Values”: [ 1, "private" ]','“Values”: [ NaN, 2 ]','“Values”: [ 1, Infinity ]','[ 1, 2 ]','“Values”: [ 1, <p>intervening sentence</p> 2 ]'])assert.equal(discussionTaskExample(`<p>${task}</p>${raw}`,task),null,raw);
 assert.equal(discussionTaskExample('No numeric input is present.',task),null);assert.equal(discussionTaskExample(body,undefined),null);
});

test('sensitive label variants and colons cannot bypass extraction or forged-record validation',async()=>{
 const original=await fresh();
 for(const label of ['patient_ids','user_id','AccountNumber','phone_numbers','access_token','x:patient','x:email','x:token','api_key','Customer-ID',String.raw`\u0070atient`,String.raw`\u0075ser_id`,String.raw`access_\u0074oken`]){
  const text=`“${label}”: [ 1, 2 ]`;
  assert.equal(discussionTaskExample(`<p>${task}</p><p>${text}</p>`,task),null,`Extraction must reject ${label}`);
  const forged={...original,taskExample:{version:1,text,sha256:sha256(text)}};
  assert.equal(validDiscussionTaskExample(forged),false,`A matching hash must not admit ${label}`);
 }
});

test('malformed example records fail shape, hash and budget checks without changing optional legacy absence',async()=>{
 const original=await fresh();assert.equal(validDiscussionTaskExample({...original,taskExample:undefined}),true);
 for(const mutate of [s=>s.taskExample.version=2,s=>s.taskExample.sha256='0'.repeat(64),s=>s.taskExample.extra='untrusted',s=>s.taskExample.text+=' ',s=>s.taskExample=null,s=>s.taskExample=[],s=>s.text+='x'.repeat(21),s=>{s.taskExample.text='“Person”: [ 1, 2 ]';s.taskExample.sha256=sha256(s.taskExample.text);}]){
  const changed=structuredClone(original);mutate(changed);assert.equal(validDiscussionTaskExample(changed),false,mutate.toString());assert.equal(sourceQuoteOccurs(changed,example),false);
 }
});

test('only correctly stamped native examples enter quote support, never RSS or provider copies',async()=>{
 const original=await fresh();
 for(const mutate of [s=>delete s.verifiedAt,s=>s.id='f'.repeat(24),s=>s.role='building',s=>s.enriched=false,s=>s.evidenceFetch.complete=false,s=>s.verifiedAt=now]){const changed=structuredClone(original);mutate(changed);assert.equal(sourceQuoteOccurs(changed,example),false,mutate.toString());}
 const rss={...page(body),url:definition.url,contentType:'application/rss+xml',text:`<rss><channel><item><title>How can I map invoice rows?</title><link>${url}</link><pubDate>${now}</pubDate><description><![CDATA[${body}]]></description></item></channel></rss>`};
 assert.equal(parseDiscussionSourcePage(definition,rss)[0].taskExample,undefined);
 const providerDefinition=DISCUSSION_PROVIDER_CATALOG.find(row=>row.platform==='reddit');
 const provider=makeDiscussionSource(providerDefinition,{url:'https://www.reddit.com/comments/abc12',title:'How can I map invoice rows?',text:task,date:now},{fetchedAt:now});
 Object.assign(provider,{taskExample:structuredClone(original.taskExample),enriched:true,evidenceKind:'discussion-post',verifiedAt:later,providerProofVerified:true,livePostRefetched:false,evidenceFetch:{provider:true,complete:true},providerEvidence:{provider:'apify',platform:'reddit',definitionId:providerDefinition.id,receiptId:'fixture',poolHash:'a'.repeat(64),postHash:'b'.repeat(64),capturedAt:now}});
 assert.equal(sourceQuoteOccurs(provider,example),false);assert.ok(discussionEvidenceReasons(provider,{definition:providerDefinition,asOf:later}).length);
});

test('quotes match wholly inside either span and normalization never joins the spans',async()=>{
 const source=await fresh(),normalize=value=>value.replace(/\s+/g,' ').toLowerCase();
 assert.equal(sourceQuoteOccurs(source,task),true);assert.equal(sourceQuoteOccurs(source,example),true);assert.equal(sourceQuoteOccurs(source,example.toUpperCase()),false);assert.equal(sourceQuoteOccurs(source,example.toUpperCase(),{normalize}),true);
 const crossing=task.slice(-24)+' '+example.slice(0,25);assert.equal(sourceQuoteOccurs(source,crossing),false);assert.equal(sourceQuoteOccurs(source,crossing,{normalize}),false);assert.equal(sourceQuoteOccurs(source,''),false);
});

test('strict scoring may cite an actual input example without changing scores, threshold or unsupported ceilings',async()=>{
 const source=await fresh(),policy=parseScoringPolicy('# Fixture\n<!-- scoring-policy:start -->\n```json\n{"weights":{"ease":1,"profit":1,"feasibility":1,"autonomy":1,"evidence":1},"publishThreshold":6}\n```\n<!-- scoring-policy:end -->');
 const criteria=Object.fromEntries(SCORING_KEYS.map(key=>[key,{value:4,reason:key==='profit'?'Hypothesis: no buyer payment is established.':'Synthetic limited input-shape examination only.',sourceIds:[source.id]}]));
 const checks=SCORING_KEYS.map(criterion=>({criterion,supported:true,maxSupportedScore:4,reason:criterion==='profit'?'Hypothesis: no customer payment is established.':'The literal fixture supports only this bounded input observation.',sourceId:source.id,evidenceQuote:['ease','feasibility'].includes(criterion)?example:task}));
 const before=stableJSON({criteria,policy,source});assert.deepEqual(checkScoringApproval(criteria,checks,[source],{sourceIds:[source.id]}),[]);assert.equal(weightedOverall(criteria,policy.weights),4);assert.equal(policy.threshold,6);assert.equal(stableJSON({criteria,policy,source}),before);
 const unsupported=structuredClone(checks);unsupported[0].maxSupportedScore=3;assert.ok(checkScoringApproval(criteria,unsupported,[source],{sourceIds:[source.id]}).length);
 const forged=structuredClone(source);forged.taskExample.sha256='0'.repeat(64);assert.ok(checkScoringApproval(criteria,checks,[forged],{sourceIds:[source.id]}).some(reason=>/quote/.test(reason)));
 const absent={...source};delete absent.taskExample;assert.ok(checkScoringApproval(criteria,checks,[absent],{sourceIds:[source.id]}).some(reason=>/quote/.test(reason)));
});
