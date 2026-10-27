import test from 'node:test';
import assert from 'node:assert/strict';
import {DISCUSSION_SOURCE_CATALOG,DISCUSSION_PROVIDER_CATALOG,discussionScanItemLimit,parseDiscussionSourcePage} from '../lib/discussion-sources.mjs';
import {validateSource} from '../lib/research.mjs';
import {emptySourceRegistry,validEmptyDemandScan,createSourceScanReceipt,validateSourceScanReceipt} from '../lib/source-registry.mjs';
import {stableJSON,hash,sha256} from '../lib/storage.mjs';

const now='2026-10-27T10:00:00.000Z',hn=DISCUSSION_SOURCE_CATALOG.find(row=>row.kind==='hn-discussion');
const text='Every morning I manually reconcile customer invoices and prepare a report for human review.';
const eligible=index=>({objectID:String(800000+index),title:'Ask HN: A tool for daily invoice review?',story_text:text,created_at:now,author:'MUST_NOT_RETAIN'});
const unrelated=index=>({...eligible(index),title:'A quiet afternoon beside a lake',story_text:'The trees and clouds looked beautiful during the afternoon walk.'});
const page=(definition,body,type='application/json')=>({url:definition.url,text:body,status:200,contentType:type,fetchedAt:now,maxBytes:2000000,truncated:false,redirects:[],robots:[{origin:new URL(definition.url).origin,evaluatedUrl:definition.url,robotsUrl:new URL('/robots.txt',definition.url).toString(),status:404,state:'missing',allowed:true,contentType:'text/plain',fetchedAt:now}]});
const hnPage=rows=>page(hn,JSON.stringify({hits:rows}));
function emptyError(definition,value){let failure;try{parseDiscussionSourcePage(definition,value);}catch(error){failure=error;}assert.equal(failure?.code,'no_eligible_demand_tasks');return failure;}
const observation=(definition,result)=>({feedId:definition.id,url:definition.url,status:'empty',itemCount:0,fetchedAt:now,message:result.reason,code:result.code,validation:result.validation});
function receipt(definition,result){return createSourceScanReceipt({runId:'loop-246810-1',registry:emptySourceRegistry(),sources:[],observations:[observation(definition,result)],originMap:[],producer:{definitions:[definition],repository:'xndanius/while-you-sleep',runId:'246810',runAttempt:1,workflow:'loop.yml',stage:'pre_model',headSha:'a'.repeat(40)},now});}
function rssPage(definition,rows){
 const origin=new URL(definition.url).origin;
 const postUrl=index=>definition.kind==='wordpress-discussion'?`${origin}/support/topic/fixture-${index}`:definition.kind==='stackexchange-discussion'?`${origin}/questions/${800000+index}/fixture`:`${origin}/t/${800000+index}`;
 return page(definition,'<rss><channel>'+rows.map((row,index)=>`<item><title>${row.title}</title><link>${postUrl(index)}</link><pubDate>${row.created_at}</pubDate><description><![CDATA[${row.story_text}]]></description></item>`).join('')+'</channel></rss>','application/rss+xml');
}

test('only exact fixed HN definitions examine forty raw hits; retained records remain capped at twenty',()=>{
 for(const definition of DISCUSSION_SOURCE_CATALOG.filter(row=>row.kind==='hn-discussion')){assert.equal(new URL(definition.url).searchParams.get('hitsPerPage'),'40');assert.equal(discussionScanItemLimit(definition),40);}
 for(const format of ['rss','atom','unrecognized'])assert.equal(discussionScanItemLimit(hn,format),20,'Only the fixed HN JSON response may use forty raw rows.');
 for(const definition of [...DISCUSSION_SOURCE_CATALOG.filter(row=>row.kind!=='hn-discussion'),...DISCUSSION_PROVIDER_CATALOG])assert.equal(discussionScanItemLimit(definition),20);
 for(const definition of [{...hn,id:'f'.repeat(24)},{...hn,url:'https://attacker.invalid/api'},null,{}])assert.equal(discussionScanItemLimit(definition),20,'A claimed HN kind alone must not widen a source.');
 const rows=Array.from({length:40},(_,index)=>eligible(index)),before=stableJSON(rows),sources=parseDiscussionSourcePage(hn,hnPage(rows));
 assert.equal(sources.length,20);assert.deepEqual(sources.map(row=>row.id),rows.slice(0,20).map(row=>hash(`https://news.ycombinator.com/item?id=${row.objectID}`)));assert.equal(stableJSON(rows),before);
 for(const source of sources){assert.equal(source.text,text);assert.ok(source.text.length<=200);assert.equal(source.role,'demand');assert.equal(source.demandKind,'community_request');assert.equal(Object.hasOwn(source,'author'),false);assert.equal(JSON.stringify(source).includes('MUST_NOT_RETAIN'),false);}
});

test('eligible HN hits at rows twenty-one through forty survive rejected earlier hits',()=>{
 const rows=Array.from({length:40},(_,index)=>index<20?unrelated(index):eligible(index)),sources=parseDiscussionSourcePage(hn,hnPage(rows));
 assert.equal(sources.length,20);assert.equal(sources[0].url,`https://news.ycombinator.com/item?id=${rows[20].objectID}`);assert.equal(sources.at(-1).url,`https://news.ycombinator.com/item?id=${rows[39].objectID}`);
});

test('an eligible forty-first HN hit is never read or admitted',()=>{
 const rows=Array.from({length:40},(_,index)=>unrelated(index));rows.push(eligible(40));
 const failure=emptyError(hn,hnPage(rows));assert.deepEqual(failure.emptyFeed,{schema:1,format:'json',examinedItems:40,eligibleItems:0});
});

test('the larger HN window retains privacy, advert, hiring, one-off error and age exclusions',()=>{
 const controls=[
  row=>({...row,title:'Ask HN: Contact person@example.invalid for invoices',story_text:'Contact person@example.invalid to review customer invoices every morning.'}),
  row=>({...row,title:'Ask HN: Who is hiring?',story_text:text}),
  row=>({...row,title:'Hiring: customer support administrator',story_text:text}),
  row=>({...row,title:'Invitation to tender for invoice processing',story_text:text}),
  row=>({...row,title:'Customer export crashes after the update',story_text:'My customer export is broken after the latest software update.'}),
  row=>({...row,created_at:'2026-09-01T10:00:00.000Z'}),
  row=>({...row,created_at:'2026-10-30T10:00:00.000Z'}),
 ];
 const rows=Array.from({length:40},(_,index)=>controls[index%controls.length](eligible(index)));
 assert.equal(emptyError(hn,hnPage(rows)).emptyFeed.examinedItems,40);
 rows[39]=eligible(39);const sources=parseDiscussionSourcePage(hn,hnPage(rows));assert.equal(sources.length,1);assert.equal(sources[0].url,'https://news.ycombinator.com/item?id=800039');assert.equal(sources[0].text,text);
});

test('other discussion adapters still examine only their first twenty raw rows',()=>{
 const rows=Array.from({length:21},(_,index)=>index===20?eligible(index):unrelated(index));
 for(const definition of DISCUSSION_SOURCE_CATALOG.filter(row=>['discourse-discussion','wordpress-discussion'].includes(row.kind))){const failure=emptyError(definition,rssPage(definition,rows));assert.equal(failure.emptyFeed.examinedItems,20);}
 const api=DISCUSSION_SOURCE_CATALOG.find(row=>row.url.startsWith('https://api.stackexchange.com/'));
 const body={items:rows.map((row,index)=>({link:`https://softwarerecs.stackexchange.com/questions/${800000+index}/fixture`,title:row.title,body:row.story_text,creation_date:Date.parse(row.created_at)/1000})),quota_remaining:100};
 assert.equal(emptyError(api,page(api,JSON.stringify(body))).emptyFeed.examinedItems,20);
});

test('forty empty HN hits retain truthful validation and immutable scan receipts',async()=>{
 const raw=hnPage(Array.from({length:40},(_,index)=>unrelated(index)));let reads=0;
 const result=await validateSource(hn,{allowEmpty:true,now,fetchPage:async url=>{reads++;assert.equal(url,hn.url);return raw;}});
 assert.equal(reads,1);assert.equal(result.eligible,false);assert.equal(result.scanReadableEmpty,true);assert.equal(result.code,'no_eligible_demand_tasks');assert.deepEqual(result.sampleItems,[]);assert.deepEqual(result.validation.emptyFeed,{schema:1,format:'json',examinedItems:40,eligibleItems:0});
 assert.equal(validEmptyDemandScan(observation(hn,result),hn),true);const scan=receipt(hn,result);assert.deepEqual(validateSourceScanReceipt(scan),[]);assert.equal(scan.observations[0].validation.emptyFeed.examinedItems,40);assert.deepEqual(scan.sources,[]);assert.deepEqual(scan.originMap,[]);
 const forged=structuredClone(scan);forged.observations[0].validation.emptyFeed.examinedItems=41;
 assert.equal(validEmptyDemandScan(forged.observations[0],hn),false);assert.ok(validateSourceScanReceipt(forged).length);assert.equal(scan.observations[0].validation.emptyFeed.examinedItems,40);
 for(const format of ['rss','atom'])for(const examinedItems of [21,40,41]){
  const otherFormat=structuredClone(scan);Object.assign(otherFormat.observations[0].validation.emptyFeed,{format,examinedItems});
  assert.equal(validEmptyDemandScan(otherFormat.observations[0],hn),false,'An HN identity does not widen RSS/Atom exhaustion bounds.');assert.ok(validateSourceScanReceipt(otherFormat).length);
 }
 const nonAdmission=await validateSource(hn,{allowEmpty:false,now,fetchPage:async()=>raw});assert.equal(nonAdmission.eligible,false);assert.equal(nonAdmission.scanReadableEmpty,false);
});

test('historical empty HN counts through twenty remain valid while other-feed count twenty-one is refused',async()=>{
 for(const examined of [0,1,20]){
  const result=await validateSource(hn,{allowEmpty:true,now,fetchPage:async()=>hnPage(Array.from({length:examined},(_,index)=>unrelated(index)))});
  assert.equal(result.scanReadableEmpty,true);assert.equal(result.validation.emptyFeed.examinedItems,examined);assert.equal(validEmptyDemandScan(observation(hn,result),hn),true);assert.deepEqual(validateSourceScanReceipt(receipt(hn,result)),[]);
 }
 const definition=DISCUSSION_SOURCE_CATALOG.find(row=>row.kind==='discourse-discussion'),value=rssPage(definition,Array.from({length:20},(_,index)=>unrelated(index))),result=await validateSource(definition,{allowEmpty:true,now,fetchPage:async()=>value});
 assert.equal(validEmptyDemandScan(observation(definition,result),definition),true);const scan=receipt(definition,result),before=sha256(stableJSON(scan));scan.observations[0].validation.emptyFeed.examinedItems=21;
 assert.equal(validEmptyDemandScan(scan.observations[0],definition),false);assert.ok(validateSourceScanReceipt(scan).length);assert.notEqual(sha256(stableJSON(scan)),before);
});
