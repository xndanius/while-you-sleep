import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DISCUSSION_IMPLEMENTATION_CATALOG,selectDiscussionImplementationReferences,discussionImplementationReference,extractDiscussionImplementationEvidence} from '../lib/discussion-implementation.mjs';
import {stableJSON} from '../lib/storage.mjs';

const record=async id=>JSON.parse(await readFile(new URL(`../data/check-context/${id}.json`,import.meta.url),'utf8'));
const email=async()=>structuredClone((await record('loop-40510493857-1')).sources.find(source=>source.url==='https://community.n8n.io/t/324902'));
const make=async()=>structuredClone((await record('loop-40493906767-1')).sources.find(source=>source.url==='https://community.make.com/t/118145'));
const ids=sources=>sources.map(source=>source.implementationReferenceId);

// Sanitized literal sections from the parent's guarded 2026-10-27 probe.
// Only the HTML wrapper is synthetic. These excerpts establish capabilities,
// not a successful execution, customer demand, or a score.
const sections={
 'n8n-if-conditions-v1':'Use the If node to split a workflow conditionally based on comparison operations. Add conditions Create comparison Conditions for your If node.',
 'n8n-code-data-v1':"The Code node lets you run your own JavaScript or Python inside a workflow, so you can transform data or add logic the built-in nodes don't cover.",
 'make-mapping-arrays-v1':"If you map the array's Recipient name item, it will appear in the field like this: The number between the square brackets is an index that determines which element of the array will be used. Leaving it empty defaults to the first element.",
};

test('the frozen email task now receives If and Code references from validated original-post spans',async()=>{
 const source=await email(),before=stableJSON(source),references=selectDiscussionImplementationReferences([source]);
 assert.deepEqual(ids(references),['n8n-if-conditions-v1','n8n-code-data-v1']);
 assert.equal(source.text.includes('Code Node'),false,'The useful node names are outside the short task anchor.');
 assert.ok(source.nativeReadingContext.spans.some(span=>span.text.includes('Code Node')));
 assert.deepEqual(references.map(ref=>ref.url),['https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.if','https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.code']);
 for(const reference of references){
  assert.equal(reference.role,'building');assert.equal(reference.demand,false);assert.deepEqual(reference.originSourceIds,[]);
  assert.deepEqual(reference.supportsDemandSourceIds,[source.id]);assert.ok(discussionImplementationReference(reference,{demandSources:[source]}));
 }
 assert.equal(stableJSON(source),before,'Selection does not alter the source identity, evidence or historical scores.');
});

test('a corrupted native packet cannot choose a reference even when its title names both nodes',async()=>{
 const source=await email();
 for(const mutate of [s=>s.nativeReadingContext.packetSha256='0'.repeat(64),s=>s.nativeReadingContext.topicId++,s=>s.nativeReadingContext.spans[0].text+=' Code Node IF Node']){
  const changed=structuredClone(source);changed.title='Code Node and IF Node in an email workflow';mutate(changed);
  assert.deepEqual(selectDiscussionImplementationReferences([changed]),[]);
 }
});

test('reference matching requires concrete task cues and never treats ordinary if or Node.js as an If/Code node',async()=>{
 const source=await email();delete source.nativeReadingContext;
 for(const [title,text] of [['A general discussion','We discuss if some workflow ideas might help a team with its work.'],['Writing code','We would like to write code Node.js for a general software project.']]){
  assert.deepEqual(selectDiscussionImplementationReferences([{...source,title,text}]),[]);
 }
 const conditional={...source,title:'Conditional routing',text:'We need conditional branching to route incoming message records to the appropriate path.'};
 assert.deepEqual(ids(selectDiscussionImplementationReferences([conditional])),['n8n-if-conditions-v1']);
});

test('Make array mapping gets its exact official reference without changing the historical task',async()=>{
 const source=await make(),before=stableJSON(source),references=selectDiscussionImplementationReferences([source]);
 assert.deepEqual(ids(references),['make-mapping-arrays-v1']);
 assert.equal(references[0].url,'https://help.make.com/mapping-arrays');
 assert.deepEqual(references[0].supportsDemandSourceIds,[source.id]);assert.equal(stableJSON(source),before);
 const unrelated={...source,title:'A workflow request',text:'We want to map the locations of the service providers on a local area map.'};
 assert.deepEqual(selectDiscussionImplementationReferences([unrelated]),[]);
});

test('the two-reference cap prefers a newly covered task over a second reference for the same task',async()=>{
 const sources=[await email(),await make()],before=stableJSON(sources),references=selectDiscussionImplementationReferences(sources);
 assert.equal(references.length,2);assert.deepEqual(ids(references),['n8n-if-conditions-v1','make-mapping-arrays-v1']);
 assert.deepEqual(new Set(references.flatMap(ref=>ref.supportsDemandSourceIds)),new Set(sources.map(source=>source.id)));
 assert.equal(stableJSON(sources),before);assert.deepEqual(selectDiscussionImplementationReferences(sources,{limit:0}),[]);
 assert.deepEqual(selectDiscussionImplementationReferences(sources,{limit:3}),[]);
});

test('the existing counting and Make error references retain their exact identities and order',async()=>{
 const [countContext,errorContext]=await Promise.all([record('loop-39385312239-1'),record('loop-39374061587-1')]);
 const sources=[countContext.sources.find(source=>source.url==='https://community.n8n.io/t/322808'),errorContext.sources.find(source=>source.url==='https://community.make.com/t/117567')];
 assert.deepEqual(ids(selectDiscussionImplementationReferences(sources)),['n8n-summarize-records-v1','make-existing-workflow-errors-v1']);
});

test('each new reference extracts its own literal capability section and rejects wrong, generic or private evidence',async()=>{
 const sources=[await email(),await make()];
 for(const referenceId of Object.keys(sections)){
  const reference=selectDiscussionImplementationReferences(referenceId.startsWith('n8n-')?[sources[0]]:[sources[1]]).find(item=>item.implementationReferenceId===referenceId);
  assert.ok(reference);const literal=sections[referenceId],raw=`<html><nav>Documentation navigation</nav><article><h1>Official documentation</h1><p>${literal}</p></article></html>`;
  const extracted=extractDiscussionImplementationEvidence(reference,raw,{demandSources:sources});
  assert.equal(extracted?.text,literal);assert.equal(extracted.evidenceExtraction.retainedCharacters,literal.length);
  assert.ok(extracted.text.length>=100&&extracted.text.length<=8000);
  assert.equal(extractDiscussionImplementationEvidence(reference,'<article><p>Read this general documentation overview to learn about workflow concepts and all available tools, options, and settings.</p></article>',{demandSources:sources}),null);
  const wrong=sections[referenceId==='n8n-code-data-v1'?'n8n-if-conditions-v1':'n8n-code-data-v1'];
  assert.equal(extractDiscussionImplementationEvidence(reference,`<article><p>${wrong}</p></article>`,{demandSources:sources}),null);
  assert.equal(extractDiscussionImplementationEvidence(reference,`<article><p>${literal} Contact person@example.invalid.</p></article>`,{demandSources:sources}),null);
  assert.equal(extractDiscussionImplementationEvidence({...reference,url:reference.url+'?untrusted=1'},raw,{demandSources:sources}),null);
  assert.equal(extractDiscussionImplementationEvidence(reference,raw,{demandSources:[]}),null);
 }
 assert.equal(DISCUSSION_IMPLEMENTATION_CATALOG.length,9);
});
