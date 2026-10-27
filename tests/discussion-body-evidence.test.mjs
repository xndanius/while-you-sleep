import test from 'node:test';
import assert from 'node:assert/strict';
import {DISCUSSION_SOURCE_CATALOG,parseDiscussionSourcePage,discussionExcerpt} from '../lib/discussion-sources.mjs';
import {fetchDemandEvidence} from '../lib/demand-sources.mjs';
import {writerResearchView} from '../lib/candidate-input.mjs';
import {discussionEvidenceReasons} from '../lib/evidence-contract.mjs';
import {stableJSON} from '../lib/storage.mjs';

const now='2026-10-27T13:00:00.000Z',definition=DISCUSSION_SOURCE_CATALOG.find(source=>source.community==='Hacker News Show HN');
const title='Show HN: Invoice tracking with CSV import and no bank login';
const body='Every week I manually match paid invoice rows against exported bank records and need a tool to flag the unmatched rows for review.';
function page(data){return {url:definition.url,text:JSON.stringify(data),fetchedAt:now,truncated:false,status:200,robots:[{allowed:true}],contentType:'application/json'};}

test('HN titles without independent body text cannot consume admitted discussion slots',()=>{
 const hits=[{objectID:'100',title,story_text:null,created_at:now},{objectID:'101',title,story_text:'',created_at:now},{objectID:'102',title,story_text:title,created_at:now},{objectID:'104',title,story_text:title.toLowerCase(),created_at:now},{objectID:'103',title,story_text:`<h1>${title}</h1><p>${body}</p>`,created_at:now}];
 const before=stableJSON(hits),sources=parseDiscussionSourcePage(definition,page({hits}));
 assert.deepEqual(sources.map(source=>source.url),['https://news.ycombinator.com/item?id=103']);
 assert.equal(sources[0].text,body);assert.equal(stableJSON(hits),before);
 for(const text of [null,'',title])assert.throws(()=>parseDiscussionSourcePage(definition,page({id:100,title,text,created_at:now}),{expectedUrl:'https://news.ycombinator.com/item?id=100',requireBody:true}),error=>error.code==='no_eligible_demand_tasks');
});

test('a fresh exact HN lookup needs real safe body text and cannot substitute child comments',async()=>{
 const source=parseDiscussionSourcePage(definition,page({hits:[{objectID:'103',title,story_text:body,created_at:now}]}))[0];
 let calls=0;
 await assert.rejects(fetchDemandEvidence(source,{definition,fetchPage:async requested=>{calls++;assert.equal(requested,'https://hn.algolia.com/api/v1/items/103');return {...page({id:103,title,text:null,created_at:now,children:[{text:body,author:'synthetic-user'}]}),url:requested};}}),error=>error.code==='no_eligible_demand_tasks');
 assert.equal(calls,1);
 const fresh=await fetchDemandEvidence(source,{definition,fetchPage:async requested=>({...page({id:103,title,text:body,created_at:now}),url:requested})});
 assert.equal(fresh.text,body);assert.equal(fresh.verifiedAt,now);
 assert.equal(fresh.discussionBodyVersion,1);assert.deepEqual(discussionEvidenceReasons(fresh,{definition,asOf:now}),[]);
 const legacy={...source};delete legacy.discussionBodyVersion;
 const old=await fetchDemandEvidence(legacy,{definition,fetchPage:async requested=>({...page({id:103,title,text:null,created_at:now}),url:requested})});
 assert.equal(old.discussionBodyVersion,undefined);assert.equal(old.text,title,'A sealed legacy reader retains its historical contract.');
 const forged={...old,discussionBodyVersion:1};assert.ok(discussionEvidenceReasons(forged,{definition,asOf:now}).length);
 let invalidCalls=0;await assert.rejects(fetchDemandEvidence({...fresh,discussionBodyVersion:2},{definition,fetchPage:async()=>{invalidCalls++;}}));assert.equal(invalidCalls,0);
 assert.equal(discussionExcerpt(`<h1>${title}</h1><p>${body}</p>`,{excludeText:title}),body);
});

test('unreadable discussion texts leave the writer view while their failure receipts remain intact',()=>{
 const good={id:'good',role:'demand',text:body},failed={id:'failed',role:'demand',text:'A title from a source whose primary request returned HTTP 403.'};
 const observations=[{status:'fetched',productUrl:'https://example.org/good',originSourceIds:['good'],evidenceIds:['good']},{status:'failed',productUrl:'https://example.org/failed',originSourceIds:['failed'],evidenceIds:[],code:'source_http_error',reason:'Public source returned HTTP 403.'}];
 const snapshot={sources:[good,failed],enrichment:{status:'completed',discussionBatch:{version:1},observations}},before=stableJSON(snapshot),view=writerResearchView(snapshot);
 assert.deepEqual(view.sources,[good]);assert.deepEqual(view.enrichment.observations,observations);assert.equal(stableJSON(snapshot),before);
 assert.deepEqual(writerResearchView({...snapshot,enrichment:{...snapshot.enrichment,discussionBatch:undefined}}).sources,[good,failed],'Legacy view behavior stays unchanged.');
});
