import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stableJSON} from '../lib/storage.mjs';
import {enrichDiscussionLeads} from '../lib/product-evidence.mjs';
import {DISCUSSION_SOURCE_CATALOG} from '../lib/discussion-sources.mjs';
import {selectDiscussionImplementationReferences,discussionImplementationReference,extractDiscussionImplementationEvidence} from '../lib/discussion-implementation.mjs';

const load=async()=>JSON.parse(await readFile(new URL('../data/check-context/loop-40529047678-1.json',import.meta.url)));
const refs=sources=>selectDiscussionImplementationReferences(sources).map(ref=>ref.implementationReferenceId);
const plain=source=>{const value=structuredClone(source);delete value.nativeReadingContext;return value;};

test('the actual eight-post batch covers order summaries and resume fields within the unchanged two-reference cap',async()=>{
 const context=await load(),sources=context.sources.filter(source=>source.role==='demand'),before=stableJSON(context);
 const selected=selectDiscussionImplementationReferences(sources);
 assert.deepEqual(selected.map(ref=>ref.implementationReferenceId),['n8n-summarize-records-v1','n8n-resume-schema-v1']);
 assert.deepEqual(selected.map(ref=>ref.supportsDemandSourceIds),[['bd365fd1a282ac04aa03e211'],['bb41e49c777b7f2a0ce9505b']]);
 assert.ok(selected.every(ref=>ref.role==='building'&&ref.demand===false&&ref.originSourceIds.length===0));
 assert.equal(stableJSON(context),before,'Frozen observations, scores, and provenance remain unchanged.');
});

test('order summary matching requires an actual recurring order-state task, not titles or generic reports',async()=>{
 const context=await load(),source=context.sources.find(row=>row.url.endsWith('/324888'));
 assert.deepEqual(refs([source]),['n8n-summarize-records-v1']);
 for(const text of ['We discuss daily reports and ideas for the future.','Daily reports: Generate summaries of server error logs.','Generate summaries of completed orders for a one-off presentation.']){
  assert.deepEqual(refs([{...plain(source),text}]),[]);
 }
 const corrupted=structuredClone(source);corrupted.nativeReadingContext.spans[0].text+=' Daily reports';
 assert.deepEqual(refs([corrupted]),[]);
 assert.deepEqual(refs([{...source,nativeReadingContext:{spans:{}}}]),[]);
 const hn={...plain(context.sources.find(row=>row.url.includes('50254751'))),text:source.text};
 assert.deepEqual(refs([hn]),[],'The n8n order reference keeps its ecosystem boundary.');
});

test('resume schema reference needs literal transfer of resume facts into forms, and cannot prove a hosting review',async()=>{
 const context=await load(),source=context.sources.find(row=>row.url.includes('50254751'));
 assert.deepEqual(refs([source]),['n8n-resume-schema-v1']);
 for(const text of ['I need general career advice and help with my resume.','I fill forms for a generic business process.','I collect resumes for roles and applications.','Tomorrow I will resume filling forms after the scheduled break.'])assert.deepEqual(refs([{...source,text}]),[]);
 assert.deepEqual(refs([context.sources.find(row=>row.url.includes('50260093'))]),[]);
});

test('service offers do not consume reference reads but their historical reference identities still validate',async()=>{
 const context=await load(),demands=context.sources.filter(row=>row.role==='demand'),old=context.sources.find(row=>row.implementationReferenceId==='make-existing-workflow-errors-v1');
 assert.ok(discussionImplementationReference(old,{demandSources:demands}));
 const offered=demands.filter(row=>old.supportsDemandSourceIds.includes(row.id));
 assert.equal(offered.length,2);assert.deepEqual(refs(offered),[]);
 const buyer={...plain(offered[0]),title:'Help with a broken Make scenario',text:'Can someone help debug my existing Make scenario? I can pay fixed-price or hourly for help fixing this workflow.'};
 assert.deepEqual(refs([buyer]),['make-existing-workflow-errors-v1'],'A buyer offering payment is not a service advertisement.');
});

test('status summary evidence retains Count and grouping in one safe literal range',async()=>{
 const context=await load(),source=context.sources.find(row=>row.url.endsWith('/324888'));
 const reference=selectDiscussionImplementationReferences([source])[0];
 const count='Count: Count the total number of values in your input data. This synthetic fixture describes a numerical operation on supplied rows.';
 const grouping='Fields to Split By. This synthetic grouping example uses group by with the supplied status column, without claiming any execution.';
 const raw=`<article><p>${count}</p><h2>Grouping settings</h2><p>${grouping}</p></article>`;
 const extracted=extractDiscussionImplementationEvidence(reference,raw,{demandSources:[source]});
 assert.ok(extracted?.text.includes(count));assert.ok(extracted.text.includes(grouping));
 assert.equal(extractDiscussionImplementationEvidence(reference,`<article><p>${count}</p></article>`,{demandSources:[source]}),null);
 assert.equal(extractDiscussionImplementationEvidence(reference,`<article><p>${count}</p><p>Contact person@example.invalid for private details.</p><p>${grouping}</p></article>`,{demandSources:[source]}),null,'Unsafe gaps cannot be skipped or stitched.');
 for(const gap of ['Created by Alice Smith, an independent technical writer.','Last updated yesterday.'])assert.equal(extractDiscussionImplementationEvidence(reference,`<html><nav>Navigation</nav><article><p>${count}</p><p>${gap}</p><p>${grouping}</p></article></html>`,{demandSources:[source]}),null,'Profile and metadata gaps are boundaries, not connective evidence.');
 for(const tag of ['div','aside'])assert.equal(extractDiscussionImplementationEvidence(reference,`<html><nav>Navigation</nav><article><p>${count}</p><${tag}>Created by Alice Smith, an independent technical writer.</${tag}><p>${grouping}</p></article></html>`,{demandSources:[source]}),null,'Unparsed wrappers cannot hide profile material in a retained range.');
 assert.equal(extractDiscussionImplementationEvidence(reference,`<html><nav>Navigation</nav><article><p>${count}</p><aside>Alice Smith, technical writer.</aside><p>${grouping}</p></article></html>`,{demandSources:[source]}),null,'Extended ranges do not absorb unexplained text between parsed blocks.');
 assert.equal(extractDiscussionImplementationEvidence(reference,`<article><p>${count}</p><p>Last updated yesterday.</p><p>${grouping}</p></article>`,{demandSources:[source]}),null,'The whole-document fast path respects the same metadata boundaries.');
});

test('resume reference retains both text input and schema controls; it cannot claim reliable extraction or live form submission',async()=>{
 const context=await load(),source=context.sources.find(row=>row.url.includes('50254751'));
 const reference=selectDiscussionImplementationReferences([source])[0];
 const input='This synthetic fixture describes input text to extract information for an operator-supplied schema. It makes no claim about accuracy.';
 const schema='Define using JSON Schema. The operator describes permitted output fields; this fixture supplies no browser or application integration.';
 const raw=`<article><p>${input}</p><p>${schema}</p></article>`;
 const extracted=extractDiscussionImplementationEvidence(reference,raw,{demandSources:[source]});
 assert.ok(extracted?.text.includes(input));assert.ok(extracted.text.includes(schema));
 assert.equal(extractDiscussionImplementationEvidence(reference,`<article><p>${input}</p></article>`,{demandSources:[source]}),null);
 assert.equal(extractDiscussionImplementationEvidence(reference,raw,{demandSources:[]}),null);
 assert.equal(extractDiscussionImplementationEvidence({...reference,url:reference.url+'?other=1'},raw,{demandSources:[source]}),null);
});

test('actual pre-model enrichment and independent extraction retain the same Count-plus-grouping range',async()=>{
 const context=await load(),source=context.sources.find(row=>row.url.endsWith('/324888'));
 const definition=DISCUSSION_SOURCE_CATALOG.find(row=>row.id===source.registrySourceId),calls=[];
 const now='2026-10-27T16:00:00.000Z';
 const raw='<html><nav>Unrelated navigation</nav><article><p>Count: Count the total number of values in your input data. This synthetic fixture describes a numerical operation on supplied rows.</p><h2>Grouping settings</h2><p>Fields to Split By. This synthetic grouping example uses group by with the supplied status column, without claiming any execution.</p></article></html>';
 const result=await enrichDiscussionLeads({sources:[source],originMap:[{sourceId:source.id,url:source.url,productUrl:source.url,feedIds:[definition.id]}],demandDefinitions:[definition],learningSelection:{selectionStrategy:'discussion-first-v1',demandSourceIds:[definition.id],eligibleSegments:[source.segment]},now:()=>Date.parse(now),fetchPage:async(url,options)=>{
  calls.push(url);
  const discussion=url===source.url+'.json';
  assert.ok(discussion||url==='https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.summarize');
  const text=discussion?JSON.stringify({id:324888,title:source.title,created_at:source.postedAt,post_stream:{posts:[{post_number:1,cooked:source.text}]}}):raw;
  return {url,text,status:200,contentType:discussion?'application/json':'text/html',fetchedAt:now,bytes:Buffer.byteLength(text),maxBytes:options.maxBytes,truncated:false,redirects:[],robots:[{origin:new URL(url).origin,evaluatedUrl:url,robotsUrl:new URL('/robots.txt',url).href,status:404,state:'missing',allowed:true,contentType:'text/plain',fetchedAt:now}]};
 }});
 const reference=result.sources.find(row=>row.implementationReferenceId==='n8n-summarize-records-v1'),demands=result.sources.filter(row=>row.role==='demand');
 assert.equal(calls.length,2);assert.equal(result.enrichment.supportingReferences.observations[0].status,'fetched');
 assert.ok(reference.text.includes('Fields to Split By'));
 const fresh=extractDiscussionImplementationEvidence(reference,raw,{demandSources:demands});
 assert.equal(reference.text,fresh.text);
 assert.deepEqual(reference.evidenceExtraction,fresh.evidenceExtraction);
});
