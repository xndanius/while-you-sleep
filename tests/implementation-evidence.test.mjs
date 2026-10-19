import test from 'node:test';
import assert from 'node:assert/strict';
import {extractImplementationEvidence,IMPLEMENTATION_EXCERPT_VERSION} from '../lib/implementation-evidence.mjs';
import {plainText} from '../lib/research.mjs';
import {privateArtifactReasons} from '../lib/privacy.mjs';
import {sha256} from '../lib/storage.mjs';

const paragraph='The workflow extracts invoice fields from uploaded documents and exports structured rows for review. It sends a draft to the operator, who checks each amount and approves the result before records are updated. The documented setup connects the input folder to a parser and a review queue; access credentials and human approval remain necessary. ';

test('a complete literal capability paragraph survives while a separate contact/profile footer is omitted wholesale',()=>{
 const raw=`<main><p>${paragraph}</p><h2>Community</h2><p>Follow @private_contact for the creator profile and more information.</p></main>`,result=extractImplementationEvidence(raw);
 assert.ok(result);assert.equal(result.text,paragraph.trim());assert.deepEqual(privateArtifactReasons(result),[]);assert.doesNotMatch(result.text,/@private_contact|creator profile/);assert.ok(plainText(raw).includes(result.text));
 const metadata=result.evidenceExtraction;assert.equal(metadata.version,IMPLEMENTATION_EXCERPT_VERSION);assert.equal(metadata.rawSha256,sha256(raw));assert.equal(metadata.normalizedSha256,sha256(plainText(raw)));assert.equal(plainText(raw).slice(metadata.start,metadata.end),result.text);assert.equal(metadata.omittedBlocks,2);assert.equal(metadata.unsafeBlocks,1);assert.equal(metadata.omittedCharacters,plainText(raw).length-result.text.length);
});

test('an unsafe capability paragraph is refused rather than redacted or joined across an unsafe gap',()=>{
 const unsafe=`<p>${paragraph} The required operator is @private_contact.</p><p>${'A general page with background information and navigation. '.repeat(8)}</p>`;
 assert.equal(extractImplementationEvidence(unsafe),null);
 assert.equal(extractImplementationEvidence(`<p>${paragraph} Contact <private@example.org> for the required account.</p>`),null);
 const gap='<p>The workflow extracts invoice fields for operator review.</p><p>Ask @private_contact for access.</p><p>It exports approved records into a spreadsheet for weekly reporting.</p>';
 assert.equal(extractImplementationEvidence(gap),null);
});

test('README and independent fresh checks select the identical contiguous capability section',()=>{
 const raw='# Invoice workflow\n\n'+paragraph+'\n\n## Creator\n\nContact @private_contact for the creator profile.',writer=extractImplementationEvidence(raw),checker=extractImplementationEvidence(raw,{maxCharacters:8000,minCharacters:100});
 assert.ok(writer);assert.deepEqual(checker,writer);assert.ok(plainText(raw).includes(writer.text));assert.doesNotMatch(writer.text,/@private_contact/);
 const adjacent='<p>The workflow extracts invoice fields from documents and places them into a draft review queue.</p><p>'+paragraph+'</p><p>Creator @private_contact</p>';
 assert.deepEqual(extractImplementationEvidence(adjacent,{minCharacters:100}),extractImplementationEvidence(adjacent));
});

test('workflow titles and creator preambles are not padded into a short useful capability paragraph',()=>{
 const useful='This workflow monitors an invoice inbox, extracts document fields, creates draft vendor bills for review and archives the original files. Human approval remains required.';
 const raw=`<nav><p>Automate business processes and connect all your applications. ${'A general product navigation introduction. '.repeat(4)}</p></nav><h1>Process invoice emails</h1><p>Created by</p><span>Example Creator</span><p>Last update</p><p>Last update 4 months ago</p><p>Categories</p><p>Invoice Processing</p><p>AI Summarization</p><p>Share</p><h2>Quick overview</h2><p>${useful}</p><p>Follow @private_contact</p>`,result=extractImplementationEvidence(raw);
 assert.equal(result.text,useful);assert.doesNotMatch(result.text,/Created by|Example Creator|Quick overview|Last update|AI Summarization/);assert.deepEqual(result,extractImplementationEvidence(raw,{maxCharacters:8000,minCharacters:100}));
});
