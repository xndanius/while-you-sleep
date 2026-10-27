import test from 'node:test';
import assert from 'node:assert/strict';
import {DISCUSSION_SOURCE_CATALOG,discussionExcerpt,makeDiscussionSource} from '../lib/discussion-sources.mjs';

// Each real quote is under 25 words and copied from the saved bounded
// primary-body probe, not fetched here. Surrounding text is synthetic.
const cases=[
 {name:'Make invoice mapping',url:'https://community.make.com/t/118145',quote:'I cannot map array data for dynamic amount of invoice rows to the HTTP POST module’s “invoice rows” section.'},
 {name:'n8n order connections',url:'https://community.n8n.io/t/324685',quote:'I want to understand how n8n can help connect restaurant order systems, customer notifications, and delivery updates.'},
];
const opening='I am new to this workflow and would appreciate some help.';
const now='2026-10-27T10:00:00.000Z';

for(const item of cases)test(`${item.name} outranks a generic opening without changing its literal words`,()=>{
 const raw=opening+'\n'+item.quote,before=raw;
 assert.ok(item.quote.split(/\s+/).length<25);assert.ok(item.quote.length<=200);
 const excerpt=discussionExcerpt(raw);assert.equal(excerpt,item.quote);assert.ok(raw.includes(excerpt));assert.ok(excerpt.length<=200);assert.equal(raw,before);
});

test('integration excerpt ranking stays within the complete literal 200-character window',()=>{
 const raw=[cases[0].quote.slice(0,-1),...Array(20).fill('Additional synthetic invoice mapping context')].join(' '),excerpt=discussionExcerpt(raw);
 assert.ok(excerpt.length>cases[0].quote.length&&excerpt.length<=200);assert.ok(raw.startsWith(excerpt));assert.ok(excerpt.startsWith(cases[0].quote.slice(0,-1)));
 const paragraphs=`<p>${opening}</p><p>${cases[1].quote}</p>`;
 assert.equal(discussionExcerpt(paragraphs),cases[1].quote,'Markup separators cannot splice the task into its generic opening.');
});

test('private mapping and connection blocks remain omitted rather than redacted into evidence',()=>{
 for(const privateBlock of ['I map customer invoice records for person@example.invalid every day','I connect customer notifications for username private_profile every morning']){
  assert.equal(discussionExcerpt(privateBlock),null);
  const raw=privateBlock+'\n'+cases[1].quote,excerpt=discussionExcerpt(raw);assert.equal(excerpt,cases[1].quote);assert.ok(raw.includes(excerpt));assert.doesNotMatch(excerpt,/person@|private_profile/);
 }
});

test('equally ranked mapping and connection tasks retain their original order',()=>{
 for(const order of [cases,[...cases].reverse()])assert.equal(discussionExcerpt(order.map(item=>item.quote).join('\n')),order[0].quote);
});

test('mapping priority does not admit a mapping-only one-off error without a request or recurring chore',()=>{
 const definition=DISCUSSION_SOURCE_CATALOG.find(source=>source.community==='Make community');
 const source=makeDiscussionSource(definition,{url:cases[0].url,title:'Invoice mapping error in the HTTP module',excerpt:cases[0].quote,date:now},{fetchedAt:now});
 assert.equal(source,null,'A selected mapping sentence is not automatic demand admission.');
 const ordinary=makeDiscussionSource(definition,{url:cases[0].url,title:'Daily invoice review',excerpt:'Every morning I manually review invoice rows and prepare a report for human approval.',date:now},{fetchedAt:now});
 assert.ok(ordinary,'Existing recurring-chore admission remains supported.');
});
