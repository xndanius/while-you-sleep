import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {recentProductAssessments,selectProductLeads,enrichDiscussionLeads,sourceEvidenceFetchOptions} from '../lib/product-evidence.mjs';
import {demandEvidenceFingerprint} from '../lib/demand-sources.mjs';
import {DISCUSSION_SOURCE_CATALOG} from '../lib/discussion-sources.mjs';
import {hash,sha256} from '../lib/storage.mjs';
import {DISCUSSION_IMPLEMENTATION_CATALOG,selectDiscussionImplementationReferences,discussionImplementationReference,hasDiscussionImplementationReference,extractDiscussionImplementationEvidence} from '../lib/discussion-implementation.mjs';
import {extractImplementationEvidence} from '../lib/implementation-evidence.mjs';
import {plainText} from '../lib/research.mjs';

const historicalId='loop-39385312239-1';
const record=async directory=>JSON.parse(await readFile(new URL(`../data/${directory}/${historicalId}.json`,import.meta.url),'utf8'));
const now='2026-10-20T07:25:00.000Z';
const summarizeURL='https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.summarize';
const makeErrorsURL='https://help.make.com/Overview-of-error-handling';
function publicPage(url,text,{maxBytes,contentType='text/html',robotsAllowed=true}={}){
 return {url,text,status:200,contentType,fetchedAt:now,bytes:Buffer.byteLength(text),maxBytes,truncated:false,redirects:[],robots:[{origin:new URL(url).origin,evaluatedUrl:url,robotsUrl:new URL('/robots.txt',url).toString(),status:200,state:'parsed',allowed:robotsAllowed,contentType:'text/plain',fetchedAt:now}]};
}
async function discussionFixture(){
 const contexts=await Promise.all([historicalId,'loop-39374061587-1'].map(async id=>JSON.parse(await readFile(new URL(`../data/check-context/${id}.json`,import.meta.url),'utf8'))));
 const sources=[contexts[0].sources.find(source=>source.url==='https://community.n8n.io/t/322808'),contexts[1].sources.find(source=>source.url==='https://community.make.com/t/117567')].map(source=>structuredClone(source));
 const definitions=sources.map(source=>DISCUSSION_SOURCE_CATALOG.find(row=>row.id===source.registrySourceId));
 return {sources,originMap:sources.map(source=>({sourceId:source.id,url:source.url,productUrl:source.url,feedIds:[source.registrySourceId]})),demandDefinitions:definitions,learningSelection:{selectionStrategy:'discussion-first-v1',demandSourceIds:definitions.map(row=>row.id),eligibleSegments:[...new Set(sources.map(source=>source.segment))]},now:()=>Date.parse(now)};
}
// Sanitized literal option text from the guarded public docs, in its real list
// shape. The unrelated paragraph is deliberately the generic extractor's pick.
const countHTML='<html><nav>Documentation</nav><main><h1>Summarize node</h1><ul><li><strong>Count</strong>: Count the total number of values in your input data.</li><li><strong>Count Unique</strong>: Count the number of unique values in your input data.</li></ul><p>Each Split in a Separate Item creates a separate output item for each split key so subsequent workflow nodes can process the summary.</p></main></html>';
const makeHTML='<main><p>Error handlers process errors during a scenario execution. Configure an error handler to resolve the incomplete execution before the scenario continues running on its schedule.</p></main>';
function fixtureFetcher(sources,calls,{blockedDocs=false,unrelatedDocs=false}={}){
 return async(url,options)=>{
  calls.push(url);
  const source=sources.find(source=>url===source.url+'.json');
  if(source)return publicPage(url,JSON.stringify({id:Number(source.url.split('/').at(-1)),title:source.title,created_at:source.postedAt,post_stream:{posts:[{post_number:1,cooked:source.text}]}}),{...options,contentType:'application/json'});
  assert.ok([summarizeURL,makeErrorsURL].includes(url),'Only the two exact fixed docs may be fetched.');
  const raw=unrelatedDocs?'<main><p>This documentation creates output items for the next workflow step. Configure the operation to process the input and then return the result.</p></main>':url===summarizeURL?countHTML:makeHTML;
  return publicPage(url,raw,{...options,robotsAllowed:!blockedDocs});
 };
}

test('actual independently verified discussion fingerprints preserve unchanged cooldown and reopen changed text only',async()=>{
 const [run,draft,context,research]=await Promise.all(['runs','drafts','check-context','research'].map(record));
 const now=Date.parse(run.checkedAssessment.completedAt)+60000;
 const source=context.sources.find(source=>source.url==='https://community.n8n.io/t/322808');
 assert.equal(source.evidenceKind,'discussion-post');
 const history=recentProductAssessments({runs:[run],drafts:[draft],contexts:[context],research:[research],now});
 const assessment=history.find(item=>item.productUrl===source.url);
 assert.ok(assessment,'The immutable completed run supplies exact trusted assessment provenance.');
 assert.equal(assessment.demandEvidenceSha256,sha256(source.text));
 const definition=DISCUSSION_SOURCE_CATALOG.find(row=>row.id===source.registrySourceId);
 const options={originMap:[{sourceId:source.id,url:source.url,productUrl:source.url,feedIds:[definition.id]}],recentAssessments:history,learningSelection:{selectionStrategy:'discussion-first-v1',demandSourceIds:[definition.id],eligibleSegments:[source.segment]},demandDefinitions:[definition],now,cooldownHours:3};
 assert.equal(selectProductLeads([source],options).length,0);
 assert.equal(selectProductLeads([{...source,fetchedAt:new Date(now).toISOString(),verifiedAt:new Date(now).toISOString()}],options).length,0,'A timestamp refresh does not create new task evidence.');
 const text='Our support team needs the native n8n workflow to count open tickets by queue and email a daily total for review.';
 const changed={...source,text,taskExcerpts:[text]};
 assert.notEqual(demandEvidenceFingerprint(changed),assessment.demandEvidenceSha256);
 assert.equal(selectProductLeads([changed],options).length,1);
 assert.equal(selectProductLeads([changed],{...options,previous:[{productUrl:source.url}]}).length,0,'Changed text never overrides published URL novelty.');
 for(const mutate of [value=>value.sources[0].text+=' Changed after verification.',value=>value.sources[0].verifiedAt='2099-01-01T00:00:00.000Z']){
  const tampered=structuredClone(context);mutate(tampered);
  assert.deepEqual(recentProductAssessments({runs:[run],drafts:[draft],contexts:[tampered],research:[research],now}),[]);
 }
});

test('fixed catalog validation rejects URL, identity, role, origins and task binding forgeries',async()=>{
 const fixture=await discussionFixture(),references=selectDiscussionImplementationReferences(fixture.sources);
 assert.equal(references.length,2);assert.equal(DISCUSSION_IMPLEMENTATION_CATALOG.length,8);
 for(const source of references){assert.ok(discussionImplementationReference(source,{demandSources:fixture.sources}));assert.equal(hasDiscussionImplementationReference(source),true);}
 const source=references[0];
 for(const mutate of [value=>value.url+='?arbitrary=1',value=>value.productUrl=makeErrorsURL,value=>value.id='f'.repeat(24),value=>value.role='demand',value=>value.demand=true,value=>value.implementationReferenceVersion=2,value=>value.implementationReferenceId='untrusted',value=>value.originSourceIds=['a'.repeat(24)],value=>delete value.originSourceIds,value=>value.supportsDemandSourceIds=[],value=>value.supportsDemandSourceIds=['f'.repeat(24)],value=>value.supportsDemandSourceIds.push(value.supportsDemandSourceIds[0])]){
  const forged=structuredClone(source);mutate(forged);
  assert.equal(discussionImplementationReference(forged,{demandSources:fixture.sources}),null);
 }
 for(const marker of [{implementationReferenceId:'untrusted'},{implementationReferenceVersion:1},{supportsDemandSourceIds:source.supportsDemandSourceIds}]){
  assert.equal(hasDiscussionImplementationReference(marker),true);assert.throws(()=>sourceEvidenceFetchOptions(marker),/exact fixed catalog/);
 }
 assert.deepEqual(selectDiscussionImplementationReferences(fixture.sources.map(source=>({...source,title:'A public workflow idea',text:'Our team would like a tool to prepare a weekly inventory report for review.'}))),[]);
 assert.deepEqual(selectDiscussionImplementationReferences(fixture.sources.map(source=>({...source,enriched:false}))),[]);
 assert.deepEqual(selectDiscussionImplementationReferences(fixture.sources,{limit:3}),[]);
 assert.equal(discussionImplementationReference(source,{demandSources:fixture.sources.filter(demand=>!source.supportsDemandSourceIds.includes(demand.id))}),null);
});

test('count documentation retains its literal list section with full-page hashes, and unrelated sections fail closed',async()=>{
 const fixture=await discussionFixture(),source=selectDiscussionImplementationReferences(fixture.sources)[0];
 assert.match(extractImplementationEvidence(countHTML).text,/Split in a Separate Item/);
 const extracted=extractDiscussionImplementationEvidence(source,countHTML),normalized=plainText(countHTML);
 assert.ok(extracted);assert.match(extracted.text,/Count\s*:\s*Count the total number/);assert.doesNotMatch(extracted.text,/Split in a Separate Item/);
 assert.equal(extracted.text,normalized.slice(extracted.evidenceExtraction.start,extracted.evidenceExtraction.end));
 assert.equal(extracted.evidenceExtraction.rawSha256,sha256(countHTML));assert.equal(extracted.evidenceExtraction.normalizedSha256,sha256(normalized));assert.ok(extracted.text.length>=100);
 assert.equal(extractDiscussionImplementationEvidence(source,'<main><p>Each Split in a Separate Item creates a separate output item for each split key so subsequent workflow nodes can process the summary.</p></main>'),null);
 const unsafeCount=countHTML.replace('Count the total','Email person@example.org to Count the total');assert.equal(extractDiscussionImplementationEvidence(source,unsafeCount),null);
 assert.equal(extractDiscussionImplementationEvidence({...source,url:'https://example.org/arbitrary'},countHTML),null);
});

test('blocked robots and unrelated implementation text leave demand leads intact and add no evidence',async()=>{
 for(const options of [{blockedDocs:true},{unrelatedDocs:true}]){
  const fixture=await discussionFixture(),calls=[],result=await enrichDiscussionLeads({...fixture,fetchPage:fixtureFetcher(fixture.sources,calls,options)});
  assert.equal(result.enrichment.fetched,2);assert.equal(result.enrichment.discussionBatch.leadAssignments.length,2);
  assert.equal(result.enrichment.supportingReferences.observations.length,2);assert.ok(result.enrichment.supportingReferences.observations.every(row=>row.status==='failed'));
  assert.equal(result.sources.filter(source=>source.role==='building').length,0);assert.ok(calls.length<=30);
 }
});

test('fixed and existing support share one global two-reference limit',async()=>{
 const fixture=await discussionFixture(),demand=fixture.sources[0];
 demand.text='Can a native n8n workflow count the open support tickets, then find how many of those are urgent?';demand.taskExcerpts=[demand.text];
 const url='https://docs.example.com/support-tickets',legacy={id:hash(url),url,title:'Support tickets documentation',text:'Process support tickets with the documented workflow and return the result for review.',role:'building'},calls=[];
 const read=fixtureFetcher(fixture.sources,calls);
 const result=await enrichDiscussionLeads({...fixture,sources:[...fixture.sources,legacy],fetchPage:async(input,options)=>{if(input===url){calls.push(input);return publicPage(input,'Process support tickets with a documented workflow that retrieves the records, prepares a structured summary and sends the result for review.',options);}return read(input,options);}});
 assert.equal(result.enrichment.selected,2);assert.equal(result.enrichment.supportingReferences.observations.length,2);
 assert.equal(result.enrichment.supportingReferences.requests,2);assert.ok(calls.includes(url));assert.ok(calls.includes(summarizeURL));assert.ok(!calls.includes(makeErrorsURL));assert.ok(calls.length<=30);
});

test('fixed documentation shares the whole-enrichment timeout and cannot erase freshly fetched discussions',async()=>{
 const fixture=await discussionFixture(),calls=[],read=fixtureFetcher(fixture.sources,calls),started=Date.now();
 const result=await enrichDiscussionLeads({...fixture,timeBudgetMs:30,fetchPage:(url,options)=>url.endsWith('.json')?read(url,options):new Promise(()=>{})});
 assert.ok(Date.now()-started<1000);assert.equal(result.enrichment.fetched,2);assert.equal(result.enrichment.discussionBatch.leadAssignments.length,2);
 assert.equal(result.enrichment.supportingReferences.observations.length,1);assert.equal(result.enrichment.supportingReferences.observations[0].status,'failed');assert.equal(result.enrichment.supportingReferences.observations[0].code,'product_evidence_timeout');assert.equal(result.sources.filter(source=>source.role==='building').length,0);
});

test('a discussion-only registry retrieves matched implementation docs without adding leads or origins',async()=>{
 const fixture=await discussionFixture(),calls=[],original=structuredClone(fixture.sources),originMap=structuredClone(fixture.originMap);
 assert.ok(fixture.sources.every(source=>source.role==='demand'));
 const result=await enrichDiscussionLeads({...fixture,fetchPage:fixtureFetcher(fixture.sources,calls)});
 assert.equal(result.enrichment.selected,2);
 assert.equal(result.enrichment.fetched,2);
 assert.equal(result.enrichment.discussionBatch.leadAssignments.length,2);
 assert.equal(result.enrichment.supportingReferences?.observations.length,2);
 assert.equal(result.enrichment.supportingReferences.requests,2);
 assert.equal(result.enrichment.requests,2,'Support requests are kept separate from candidate requests.');
 assert.deepEqual(calls.filter(url=>!url.endsWith('.json')).sort(),[summarizeURL,makeErrorsURL].sort());
 assert.deepEqual(fixture.sources,original);assert.deepEqual(fixture.originMap,originMap);
 const support=result.sources.filter(source=>source.role==='building');
 assert.equal(support.length,2);
 for(const source of support){assert.equal(source.demand,false);assert.equal(source.evidenceKind,'product-page');assert.equal(source.enriched,true);assert.deepEqual(source.originSourceIds,[]);assert.equal(source.implementationReferenceVersion,1);assert.equal(source.supportsDemandSourceIds.length,1);assert.ok(fixture.sources.some(demand=>source.supportsDemandSourceIds.includes(demand.id)));}
 assert.equal(result.sources.filter(source=>source.role==='demand').length,2);
});
