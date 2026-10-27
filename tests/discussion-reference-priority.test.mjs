import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stableJSON} from '../lib/storage.mjs';
import {DISCUSSION_SOURCE_CATALOG} from '../lib/discussion-sources.mjs';
import {enrichDiscussionLeads} from '../lib/product-evidence.mjs';
import {selectDiscussionImplementationReferences,discussionImplementationReference,extractDiscussionImplementationEvidence} from '../lib/discussion-implementation.mjs';

const load=async()=>JSON.parse(await readFile(new URL('../data/check-context/loop-40549856676-1.json',import.meta.url)));
const ids=references=>references.map(row=>row.implementationReferenceId);
const plain=source=>{const copy=structuredClone(source);delete copy.nativeReadingContext;return copy;};
const arrayURL='https://help.make.com/mapping-arrays';
const ifURL='https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.if';
// Existing public capability excerpts, wrapped in synthetic HTML for offline
// transport tests. Neither excerpt proves execution or invoice/tax correctness.
const arrayText="If you map the array's Recipient name item, it will appear in the field like this: The number between the square brackets is an index that determines which element of the array will be used. Leaving it empty defaults to the first element.";
const ifText='Use the If node to split a workflow conditionally based on comparison operations. Add conditions Create comparison Conditions for your If node.';

test('frozen 40549856676 selects array mapping and If within two slots, without changing evidence or decisions',async()=>{
 const context=await load(),before=stableJSON(context),demands=context.sources.filter(row=>row.role==='demand');
 const references=selectDiscussionImplementationReferences(demands),invoice=demands.find(row=>row.url.endsWith('/118145'));
 assert.deepEqual(ids(references),['n8n-if-conditions-v1','make-mapping-arrays-v1']);
 assert.deepEqual(references.find(row=>row.url===arrayURL).supportsDemandSourceIds,[invoice.id]);
 assert.ok(references.every(row=>row.implementationSelectionVersion===2));
 assert.equal(references.length,2);assert.equal(selectDiscussionImplementationReferences(demands,{limit:3}).length,0);
 assert.ok(invoice.nativeReadingContext.spans.some(row=>row.text.includes('Error messages or input/output bundles')));
 assert.equal(stableJSON(context),before,'No source, receipt, score or historical quote is rewritten.');
});

test('template labels, titles and separate spans do not invent a Make error-handling task',async()=>{
 const context=await load(),invoice=context.sources.find(row=>row.url.endsWith('/118145'));
 for(const text of [
  'Please describe the business task. Error messages or input/output bundles Screenshots (scenario flow, module settings, errors)',
  'My existing workflow maps invoice rows. What is the error message (if any)?',
  'I need to map array data into invoice rows. Screenshots (scenario flow, module settings, errors)',
 ]){
  const source={...plain(invoice),title:'Broken scenario: errors',text};
  assert.ok(!ids(selectDiscussionImplementationReferences([source])).includes('make-existing-workflow-errors-v1'));
 }
 const packet=structuredClone(invoice);
 // The actual frozen packet already supplies the cross-span false conjunction:
 // "module" in the task, "errors" only in labels in the example span.
 assert.deepEqual(ids(selectDiscussionImplementationReferences([packet])),['make-mapping-arrays-v1']);
 const corrupted=structuredClone(invoice);corrupted.nativeReadingContext.spans[1].text+=' retry the broken scenario';
 assert.deepEqual(selectDiscussionImplementationReferences([corrupted]),[]);
});

test('specific array operation wins equal coverage while real debugging and separate tasks retain coverage',async()=>{
 const context=await load(),invoice=context.sources.find(row=>row.url.endsWith('/118145'));
 const both={...plain(invoice),title:'Invoice mapping',text:'Please help fix my existing Make scenario: I need to map array data into invoice rows.'};
 assert.deepEqual(ids(selectDiscussionImplementationReferences([both],{limit:1})),['make-mapping-arrays-v1']);
 const debug={...plain(context.sources.find(row=>row.url.endsWith('/118000'))),text:'Can someone help debug my existing Make scenario? The workflow fails during execution.'};
 assert.deepEqual(ids(selectDiscussionImplementationReferences([debug])),['make-existing-workflow-errors-v1']);
 const selected=selectDiscussionImplementationReferences([both,debug]);
 assert.deepEqual(ids(selected),['make-existing-workflow-errors-v1','make-mapping-arrays-v1']);
 assert.ok(selected.some(row=>row.supportsDemandSourceIds.includes(debug.id)));
 assert.ok(selected.some(row=>row.url===arrayURL&&row.supportsDemandSourceIds.includes(both.id)));
});

test('old reference receipts remain verifiable; new bindings reject boilerplate on independent reread',async()=>{
 const context=await load(),invoice=context.sources.find(row=>row.url.endsWith('/118145'));
 const old=context.sources.find(row=>row.implementationReferenceId==='make-existing-workflow-errors-v1');
 assert.ok(discussionImplementationReference(old,{demandSources:[invoice]}),'Historical contract is unchanged.');
 assert.equal(discussionImplementationReference({...old,implementationSelectionVersion:2},{demandSources:[invoice]}),null);
 const selected=selectDiscussionImplementationReferences([invoice])[0];
 assert.ok(discussionImplementationReference(selected,{demandSources:[invoice]}));
 assert.equal(discussionImplementationReference({...selected,implementationSelectionVersion:3},{demandSources:[invoice]}),null);
 const lost={...plain(invoice),title:'Map arrays to invoice rows',text:'Please describe the business task. Error messages or input/output bundles'};
 assert.equal(discussionImplementationReference(selected,{demandSources:[lost]}),null,'A matching title cannot replace lost fresh task evidence.');
});

test('real enrichment path attempts the relevant array URL and carries strict binding to independent extraction',async()=>{
 const context=await load(),sources=context.sources.filter(row=>row.url.endsWith('/118145')||row.url.endsWith('/324902')),before=stableJSON(sources);
 const calls=[],now='2026-10-27T17:23:40.000Z';
 const definitions=sources.map(source=>DISCUSSION_SOURCE_CATALOG.find(row=>row.id===source.registrySourceId));
 const result=await enrichDiscussionLeads({sources,originMap:sources.map(source=>({sourceId:source.id,url:source.url,productUrl:source.url,feedIds:[source.registrySourceId]})),demandDefinitions:definitions,learningSelection:{selectionStrategy:'discussion-first-v1',demandSourceIds:definitions.map(row=>row.id),eligibleSegments:[...new Set(sources.map(row=>row.segment))]},now:()=>Date.parse(now),fetchPage:async(url,options)=>{
  calls.push(url);
  const source=sources.find(row=>url===row.url+'.json');
  assert.ok(source||url===arrayURL||url===ifURL,'No unrelated reference or extra request is allowed.');
  // Reconstructed synthetic transport around the exact frozen safe spans.
  const text=source?JSON.stringify({id:source.nativeReadingContext.topicId,title:source.title,created_at:source.postedAt,post_stream:{posts:[{id:source.nativeReadingContext.postId,post_number:1,created_at:source.nativeReadingContext.postCreatedAt,updated_at:source.nativeReadingContext.postUpdatedAt,cooked:source.nativeReadingContext.spans.map(row=>row.text).join('\n')}]}}):`<article><p>${url===arrayURL?arrayText:ifText}</p></article>`;
  return {url,text,status:200,contentType:source?'application/json':'text/html',fetchedAt:now,bytes:Buffer.byteLength(text),maxBytes:options.maxBytes,truncated:false,redirects:[],robots:[{origin:new URL(url).origin,evaluatedUrl:url,robotsUrl:new URL('/robots.txt',url).href,status:404,state:'missing',allowed:true,contentType:'text/plain',fetchedAt:now}]};
 }});
 assert.equal(result.enrichment.fetched,2);assert.equal(result.enrichment.supportingReferences.maximum,2);
 assert.deepEqual(calls.filter(url=>!url.endsWith('.json')),[ifURL,arrayURL]);
 const references=result.sources.filter(row=>row.role==='building'),demands=result.sources.filter(row=>row.role==='demand');
 assert.equal(references.length,2);assert.ok(references.every(row=>row.implementationSelectionVersion===2));
 const array=references.find(row=>row.url===arrayURL);
 assert.equal(array.text,arrayText);
 const independentlyRead=extractDiscussionImplementationEvidence(array,`<article><p>${arrayText}</p></article>`,{demandSources:demands});
 assert.equal(independentlyRead.text,array.text);assert.deepEqual(independentlyRead.evidenceExtraction,array.evidenceExtraction);
 assert.equal(extractDiscussionImplementationEvidence(array,`<article><p>${ifText}</p></article>`,{demandSources:demands}),null);
 assert.equal(stableJSON(sources),before);
});
