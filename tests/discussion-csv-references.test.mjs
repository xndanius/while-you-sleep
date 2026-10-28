import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stableJSON} from '../lib/storage.mjs';
import {selectDiscussionImplementationReferences,discussionImplementationReference,extractDiscussionImplementationEvidence} from '../lib/discussion-implementation.mjs';

const load=async()=>JSON.parse(await readFile(new URL('../data/check-context/loop-40734809732-1.json',import.meta.url)));
const ids=rows=>rows.map(row=>row.implementationReferenceId);
const plain=source=>{const value=structuredClone(source);delete value.nativeReadingContext;return value;};
const csvID='n8n-csv-extraction-v1',dedupeID='n8n-persistent-deduplication-v1';
// Prose and HTML are synthetic around documented option names and semantics.
// No supplied workflow or source code is executed by these tests.
const csvText='This synthetic fixture selects Extract From CSV. It outputs records in JSON row form after decoding a supplied file; it does not prove workflow execution.';
const genericIntro='The file utility supports general conversions and preprocessing of supplied data. This introduction does not identify a CSV operation or explain its result.';
const csvHTML=`<article><h1>Extract From File</h1><p>${genericIntro}</p><p>${csvText}</p></article>`;
const dedupeStart='This fixture describes Remove Items Processed in Previous Executions. The operation compares current records against previous executions.';
const dedupeKey='For Value Is New, choose a unique ID in the configured input fields; this test fixture does not demonstrate runtime behavior.';
const dedupeHTML=`<article><h1>Remove Duplicates</h1><p>${dedupeStart}</p><h2>Parameters</h2><ul><li>Keep Items Where: Select how n8n decides which items to keep. Value Is New: n8n removes items if their value matches items from earlier executions.</li><li>Value to Dedupe On: The input field or fields to compare. ${dedupeKey}</li></ul></article>`;

test('frozen407348 CSV log task gets both missing operation references in its unchanged two-slot budget',async()=>{
 const context=await load(),before=stableJSON(context),demands=context.sources.filter(row=>row.role==='demand');
 assert.equal(context.sources.filter(row=>row.role==='building').length,0,'The real cycle had no implementation references.');
 const source=demands.find(row=>row.url.endsWith('/325109')),references=selectDiscussionImplementationReferences(demands);
 assert.deepEqual(ids(references),[csvID,dedupeID]);
 assert.equal(references.length,2);assert.ok(references.every(row=>row.supportsDemandSourceIds.length===1&&row.supportsDemandSourceIds[0]===source.id&&row.implementationSelectionVersion===2));
 for(const ref of references)assert.ok(discussionImplementationReference(ref,{demandSources:demands}));
 assert.equal(stableJSON(context),before);
});

test('body-based CSV and repeat processing matches reject titles, export direction and ordinary repeated words',async()=>{
 const source=(await load()).sources.find(row=>row.url.endsWith('/325109'));
 for(const text of [
  'Our team discusses CSV formats in a general planning meeting.',
  'We export a CSV file for review.',
  'The word file appears twice in this sentence, and again in an example.',
  'A workflow diagram repeats the word file twice.',
 ])assert.deepEqual(ids(selectDiscussionImplementationReferences([{...plain(source),title:'Parse CSV and remove duplicate files across executions',text}])),[]);
 assert.deepEqual(ids(selectDiscussionImplementationReferences([{...plain(source),text:'I need to parse a CSV file into rows for a reviewable table.'}])),[csvID]);
 assert.deepEqual(ids(selectDiscussionImplementationReferences([{...plain(source),text:'Our workflow processes the same file twice, so we need to stop duplicate imports.'}])),[dedupeID]);
 assert.deepEqual(ids(selectDiscussionImplementationReferences([{...plain(source),text:'We need to remove duplicate records across workflow executions using the record identifier.'}])),[dedupeID]);
 assert.deepEqual(ids(selectDiscussionImplementationReferences([{...plain(source),text:'What I can help with: parse CSV files and remove duplicate records across executions.'}])),[]);
 const corrupted=structuredClone(source);corrupted.nativeReadingContext.spans[0].text+=' Parse CSV files.';
 assert.deepEqual(selectDiscussionImplementationReferences([corrupted]),[]);
});

test('new operation references preserve independent task binding and distinct-task coverage',async()=>{
 const context=await load(),source=context.sources.find(row=>row.url.endsWith('/325109'));
 const oldContext=JSON.parse(await readFile(new URL('../data/check-context/loop-40510493857-1.json',import.meta.url))),email=oldContext.sources.find(row=>row.url.endsWith('/324902'));
 const references=selectDiscussionImplementationReferences([source,email]);
 assert.equal(references.length,2);assert.equal(new Set(references.flatMap(row=>row.supportsDemandSourceIds)).size,2,'Do not spend both slots on one task when another task can be covered.');
 const csv=selectDiscussionImplementationReferences([source]).find(row=>row.implementationReferenceId===csvID);
 assert.equal(discussionImplementationReference(csv,{demandSources:[{...plain(source),text:'We need to export reviewed table data as CSV.'}]}),null);
 assert.equal(extractDiscussionImplementationEvidence(csv,csvHTML,{demandSources:[email]}),null);
});

test('CSV evidence retains its defining CSV to JSON row operation rather than a generic file introduction',async()=>{
 const source=(await load()).sources.find(row=>row.url.endsWith('/325109')),reference=selectDiscussionImplementationReferences([source]).find(row=>row.implementationReferenceId===csvID);
 const result=extractDiscussionImplementationEvidence(reference,csvHTML,{demandSources:[source]});
 assert.ok(result?.text.includes(csvText));assert.ok(result.text.length>=100);
 assert.equal(extractDiscussionImplementationEvidence(reference,`<article><p>${genericIntro}</p></article>`,{demandSources:[source]}),null);
 assert.equal(extractDiscussionImplementationEvidence(reference,dedupeHTML,{demandSources:[source]}),null);
 assert.equal(extractDiscussionImplementationEvidence(reference,csvHTML.replace(csvText,csvText.replace('outputs','outputs person@example.invalid')),{demandSources:[source]}),null);
});

test('persistent deduplication evidence keeps previous-execution mode plus its unique identity requirement',async()=>{
 const source=(await load()).sources.find(row=>row.url.endsWith('/325109')),reference=selectDiscussionImplementationReferences([source]).find(row=>row.implementationReferenceId===dedupeID);
 const result=extractDiscussionImplementationEvidence(reference,dedupeHTML,{demandSources:[source]});
 assert.ok(result?.text.includes(dedupeStart));assert.ok(result.text.includes('Value to Dedupe On'));assert.ok(result.text.includes(dedupeKey));
 assert.equal(extractDiscussionImplementationEvidence(reference,`<article><p>${dedupeStart}</p></article>`,{demandSources:[source]}),null,'A mode name without key semantics is insufficient.');
 assert.equal(extractDiscussionImplementationEvidence(reference,dedupeHTML.replace(dedupeKey,'Choose any field without a defined comparison key.'),{demandSources:[source]}),null);
 assert.equal(extractDiscussionImplementationEvidence(reference,dedupeHTML.replace('Items Processed in Previous Executions','Items Repeated Within Current Input'),{demandSources:[source]}),null,'Within-input deduplication cannot claim persistence.');
 assert.equal(extractDiscussionImplementationEvidence(reference,csvHTML,{demandSources:[source]}),null);
 assert.equal(extractDiscussionImplementationEvidence(reference,dedupeHTML.replace('<h2>Parameters</h2>','<p>Contact person@example.invalid.</p><h2>Parameters</h2>'),{demandSources:[source]}),null,'Unsafe gaps cannot be skipped to manufacture a complete range.');
});
