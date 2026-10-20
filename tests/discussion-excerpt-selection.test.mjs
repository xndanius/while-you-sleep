import test from 'node:test';
import assert from 'node:assert/strict';
import {DISCUSSION_SOURCE_CATALOG,discussionExcerpt,makeDiscussionSource,parseDiscussionSourcePage} from '../lib/discussion-sources.mjs';
import {fetchDemandEvidence} from '../lib/demand-sources.mjs';

test('discussion excerpts retain a later concrete chore instead of an introductory intent sentence',()=>{
 const intro='I am new to automation and looking for guidance.';
 const chore='Each morning I manually copy approved invoice rows from a spreadsheet into our accounting system and reconcile the totals.';
 assert.equal(discussionExcerpt(intro+'\n'+chore),chore);
});

test('discussion excerpts choose one literal task block with stable ordering, without stitching sentences',()=>{
 const intro='I would appreciate help finding the right software for our business.';
 const first='Every week I manually collect customer receipts into a spreadsheet.';
 const second='Every week I manually collect customer invoices into a spreadsheet.';
 const html=`<p>${intro}</p><p>${first}</p><p>${second}</p>`;
 assert.equal(discussionExcerpt(html),first);
 assert.equal(discussionExcerpt([intro,second,first].join('\n')),second);
 assert.equal(discussionExcerpt(html).includes(second),false);
});

test('feed discovery and independent exact-post retrieval retain the same later stated chore',async()=>{
 const definition=DISCUSSION_SOURCE_CATALOG.find(source=>source.url==='https://community.n8n.io/latest.rss');
 const now='2026-10-20T08:00:00.000Z',intro='I am new to automation and looking for guidance.';
 const chore='Each morning I manually copy approved invoice rows from a spreadsheet into our accounting system and reconcile the totals.';
 const body=`<p>${intro}</p><p>${chore}</p>`,url='https://community.n8n.io/t/321';
 const page=(url,text)=>({url,text,status:200,contentType:url.endsWith('.json')?'application/json':'application/rss+xml',fetchedAt:now,maxBytes:2000000,truncated:false,redirects:[],robots:[{origin:new URL(url).origin,evaluatedUrl:url,robotsUrl:new URL('/robots.txt',url).toString(),status:404,state:'missing',allowed:true,contentType:'text/plain',fetchedAt:now}]});
 const rss=`<rss><channel><item><title>How do you handle invoice rows?</title><link>${url}</link><pubDate>${now}</pubDate><description><![CDATA[${body}]]></description></item></channel></rss>`;
 const [source]=parseDiscussionSourcePage(definition,page(definition.url,rss));
 assert.equal(source.text,chore);
 let reads=0;
 const fresh=await fetchDemandEvidence(source,{definition,fetchPage:async requested=>{
  reads++;assert.equal(requested,url+'.json');
  return page(requested,JSON.stringify({id:321,slug:'invoices',title:source.title,created_at:now,post_stream:{posts:[{post_number:1,cooked:body}]}}));
 }});
 assert.equal(reads,1);assert.equal(fresh.id,source.id);assert.equal(fresh.text,chore);
 assert.deepEqual(fresh.taskExcerpts,[chore]);assert.equal(fresh.verifiedAt,now);
});

test('unsafe task blocks cannot win selection, leak their contents or make unrelated source text admissible',()=>{
 const harmless='The clouds looked beautiful while I walked beside the river.';
 const unsafe='Each morning I manually copy invoices for @private_person from a spreadsheet into our accounting system';
 assert.equal(discussionExcerpt(harmless+'\n'+unsafe),harmless);
 const definition=DISCUSSION_SOURCE_CATALOG[0],now='2026-10-20T08:00:00.000Z';
 assert.equal(makeDiscussionSource(definition,{url:'https://news.ycombinator.com/item?id=321',title:'A pleasant afternoon in the park',text:harmless+'\n'+unsafe,date:now},{fetchedAt:now}),null);
 assert.equal(discussionExcerpt(unsafe),null);
});

test('vague-only discussions keep the existing literal bounded fallback without inventing a chore',()=>{
 const generic='I am new to automation and looking for guidance.';
 assert.equal(discussionExcerpt(generic),generic);
 assert.equal(discussionExcerpt('A short greeting.\n'+generic),generic);
});

test('long literal task blocks still stop at a whole-word boundary within the existing character cap',()=>{
 const chore='Every morning I manually copy customer invoice summaries for the café '+('into our accounting spreadsheet 📄 '.repeat(12)).trim();
 const excerpt=discussionExcerpt('I am new to automation and looking for guidance.\n'+chore);
 assert.ok(excerpt.length>=25&&excerpt.length<=200);
 assert.ok(chore.startsWith(excerpt));
 assert.ok(/\s/.test(chore[excerpt.length]));
 assert.equal(/[\uD800-\uDBFF]$/.test(excerpt),false);
});
