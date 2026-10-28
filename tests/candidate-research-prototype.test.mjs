import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {researchDossiers,planResearchContinuation,pickResearchContinuation} from '../prototypes/candidate-research.mjs';
import {DISCUSSION_SOURCE_CATALOG} from '../lib/discussion-sources.mjs';
import {enrichDiscussionLeads,recentProductAssessments} from '../lib/product-evidence.mjs';
import {stableJSON} from '../lib/storage.mjs';

const directories={run:'runs',draft:'drafts',context:'check-context',manifest:'checks',research:'research',scan:'source-scans',learning:'learning'};
const bundle=async id=>Object.fromEntries(await Promise.all(Object.entries(directories).map(async([key,dir])=>[key,JSON.parse(await readFile(new URL(`../data/${dir}/loop-${id}-1.json`,import.meta.url)))])));
const target=(b,suffix)=>researchDossiers(b).find(row=>row.source.url.endsWith(suffix));
const readyAt=b=>Date.parse(b.run.checkedAssessment.completedAt)+b.research.learningSelection.researchPolicy.cooldownHours*3600000+1;
function selection(b,now=readyAt(b)){
 const sources=b.context.sources.filter(row=>row.role==='demand').map(row=>structuredClone(row));
 return {sources,originMap:sources.map(source=>({sourceId:source.id,url:source.url,productUrl:source.url,feedIds:[source.registrySourceId]})),demandDefinitions:DISCUSSION_SOURCE_CATALOG.filter(row=>b.research.learningSelection.demandSourceIds.includes(row.id)),learningSelection:b.research.learningSelection,previous:[],now,cooldownHours:b.research.learningSelection.researchPolicy.cooldownHours};
}

// Fixed before implementation: development CSV407348; regression holdouts are
// invoice405498 and image/booking/vague407435. They are known historical cases,
// not previously unseen or blinded evidence of general quality improvement.
test('development case persists exact CSV plan, limitations, evidence and proof hashes',async()=>{
 const b=await bundle('40734809732'),before=stableJSON(b),d=target(b,'/325109');
 assert.deepEqual(d.referenceRequests.map(x=>x.implementationReferenceId),['n8n-csv-extraction-v1','n8n-persistent-deduplication-v1']);
 assert.deepEqual(d.candidate,b.draft.candidates.find(x=>x.productUrl===d.source.url));
 assert.deepEqual(d.unresolved,d.candidate.experimentPlan.unverified);
 assert.deepEqual(d.source,b.context.sources.find(x=>x.id===d.assignment.demandSourceId));
 assert.equal(d.status,'proposed_research');assert.equal(d.candidate.experimentPlan.status,'proposed');
 const temp=await mkdtemp(path.join(tmpdir(),'wys-research-dossier-'));
 try{await writeFile(path.join(temp,'dossier.json'),JSON.stringify(d));assert.deepEqual(JSON.parse(await readFile(path.join(temp,'dossier.json'))),d);}finally{await rm(temp,{recursive:true,force:true});}
 assert.equal(stableJSON(b),before);assert.deepEqual(researchDossiers(b),researchDossiers(b),'Planning is idempotent and does not consume an attempt.');
});

test('held-out invoice gap chooses array mapping, not its already supplied generic error handler',async()=>{
 const b=await bundle('40549856676'),d=target(b,'/118145');
 assert.deepEqual(d.referenceRequests.map(x=>x.implementationReferenceId),['make-mapping-arrays-v1']);
 assert.equal(planResearchContinuation(d,b,{selectionInput:selection(b)}).status,'ready_for_scheduled_research');
});

test('held-out image, booking and vague fragments do not acquire invented catalog capabilities',async()=>{
 const b=await bundle('40743503809'),rows=researchDossiers(b);
 for(const suffix of ['/118271','/325081']){const d=target(b,suffix);assert.equal(d.coverage,'no_catalog_match');assert.deepEqual(planResearchContinuation(d,b,{selectionInput:selection(b)}).referenceRequests,[]);}
 for(const suffix of ['id=50278264','id=50274358','id=50257159'])assert.equal(rows.some(row=>row.source.url.endsWith(suffix)),false);
 const image=target(b,'/118271');assert.equal(image.source.nativeReadingContext.retainedCharacters,986);assert.equal(image.source.nativeReadingContext.omittedCharacters,0);
 assert.equal(pickResearchContinuation(b,{selectionInput:selection(b)}).plan.status,'unresolved');
});

test('ordinary cooldown, source eligibility and published identity remain authoritative',async()=>{
 const b=await bundle('40734809732'),d=target(b,'/325109');
 const during=selection(b,Date.parse(b.run.checkedAssessment.completedAt)+60000);
 assert.equal(planResearchContinuation(d,b,{selectionInput:during}).status,'not_currently_eligible');
 const after=selection(b),result=pickResearchContinuation(b,{selectionInput:after});
 assert.equal(result.dossier.id,d.id);assert.equal(result.plan.referenceRequests.length,2);assert.equal(result.plan.maximumReferences,2);
 assert.equal(planResearchContinuation(d,b,{selectionInput:{...after,previous:[{productUrl:d.source.url}]}}).status,'not_currently_eligible');
 assert.equal(planResearchContinuation(d,b,{selectionInput:{...after,sources:after.sources.filter(row=>row.id!==d.source.id)}}).status,'not_currently_eligible');
 assert.throws(()=>planResearchContinuation(d,b,{selectionInput:{...after,cooldownHours:1}}));
 for(const now of [NaN,Infinity,'not-a-time',undefined])assert.throws(()=>planResearchContinuation(d,b,{selectionInput:{...after,now}}));
 assert.equal(result.plan.advisoryOnly,true);assert.equal(result.plan.currentSelectionVerified,false);
});

test('a changed chore matching the same references cannot reuse the old dossier or gap',async()=>{
 const b=await bundle('40734809732'),d=target(b,'/325109'),input=selection(b);
 const current=input.sources.find(x=>x.id===d.source.id);
 current.text='We parse CSV files for invoice reconciliation. Our workflow processes the same file twice, so duplicate records appear across executions.';
 current.taskExcerpts=[current.text];delete current.nativeReadingContext;
 const result=planResearchContinuation(d,b,{selectionInput:input});
 assert.equal(result.status,'changed_evidence');assert.deepEqual(result.referenceRequests,[]);assert.equal(result.priorityProductUrl,null);
});

test('changed bound records, source kind, native packet, unknown output fields and arbitrary URLs fail closed',async()=>{
 const original=await bundle('40734809732');
 for(const mutate of [b=>b.draft.candidates[0].experimentPlan.output+=' Changed.',b=>b.context.sources[0].text+=' Changed.',b=>b.manifest.completedAssessment.completed=false,b=>b.run.status='no_post_unverified',b=>b.research.sources[0].demandKind='manual_service',b=>b.learning.samples[0].reward=1,b=>b.context.sources.find(s=>s.nativeReadingContext).nativeReadingContext.spans[0].start++]){
  const b=structuredClone(original);mutate(b);assert.throws(()=>researchDossiers(b));
 }
 const d=target(original,'/325109');
 for(const mutate of [x=>x.referenceRequests[0].url='https://example.com/arbitrary',x=>x.referenceRequests.push(x.referenceRequests[0]),x=>x.candidate.scoring.criteria.ease.value=10,x=>x.candidate.experimentPlan.status='executed',x=>x.unresolved=['No remaining uncertainty'],x=>x.extra='invented']){
  const changed=structuredClone(d);mutate(changed);assert.throws(()=>planResearchContinuation(changed,original,{selectionInput:selection(original)}));
 }
});

test('a real later independent packet closes the invoice documentation gap without claiming a passed idea',async()=>{
 const old=await bundle('40549856676'),later=await bundle('40600573853'),d=target(old,'/118145');
 const current=selection(old,Date.parse(later.run.checkedAssessment.completedAt)+1);
 const outcome=planResearchContinuation(d,old,{selectionInput:current,laterBundles:[later,later]});
 assert.equal(outcome.status,'evidence_available');assert.equal(outcome.attemptRunId,later.run.id);assert.deepEqual(outcome.referenceRequests,[]);
 assert.equal(later.run.status,'completed_no_post');assert.deepEqual(later.run.published,[]);
 const forged=structuredClone(later);forged.context.sources[0].text+=' Changed.';
 assert.equal(planResearchContinuation(d,old,{selectionInput:current,laterBundles:[forged]}).status,'ready_for_scheduled_research','An invalid receipt cannot consume a research attempt.');
 assert.equal(planResearchContinuation(d,old,{selectionInput:selection(old),laterBundles:[later]}).status,'ready_for_scheduled_research','A receipt from the future cannot consume an attempt.');
});

test('fixture-only scheduled research performs bounded new documentation reads, rather than rewriting the old plan',async()=>{
 const b=await bundle('40734809732'),d=target(b,'/325109'),original=stableJSON(b),input=selection(b),plan=planResearchContinuation(d,b,{selectionInput:input}),calls=[];
 assert.equal(b.context.sources.filter(x=>x.role==='building').length,0);
 const now=new Date(input.now).toISOString(),csvURL=plan.referenceRequests[0].url,dedupeURL=plan.referenceRequests[1].url;
 const task='I need to parse CSV files into JSON rows for recurring reports. My workflow processes the same file twice, so duplicate records appear across executions.';
 const csv='Extract From CSV reads the supplied file and outputs records in JSON row form. This is synthetic test documentation, not proof of actual workflow execution.';
 const dedupe='Remove Items Processed in Previous Executions compares current records with previous executions. Keep Items Where: Value Is New. Value to Dedupe On selects the unique ID from input records. This is synthetic test documentation.';
 const fetchPage=async(url,options)=>{
  calls.push(url);let text,contentType='text/html';
  if(url===d.source.url+'.json'){text=JSON.stringify({id:325109,title:d.source.title,created_at:d.source.postedAt,post_stream:{posts:[{id:606999,post_number:1,created_at:d.source.postedAt,updated_at:d.source.postedAt,cooked:`<p>${task}</p>`}]}});contentType='application/json';}
  else{assert.ok([csvURL,dedupeURL].includes(url));text=`<article><p>${url===csvURL?csv:dedupe}</p></article>`;}
  return {url,text,status:200,contentType,fetchedAt:now,bytes:Buffer.byteLength(text),maxBytes:options.maxBytes,truncated:false,redirects:[],robots:[{origin:new URL(url).origin,evaluatedUrl:url,robotsUrl:new URL('/robots.txt',url).toString(),status:200,state:'parsed',allowed:true,contentType:'text/plain',fetchedAt:now}]};
 };
 const result=await enrichDiscussionLeads({...input,sources:[d.source],originMap:input.originMap.filter(x=>x.sourceId===d.source.id),fetchPage});
 assert.equal(result.enrichment.fetched,1);assert.equal(result.enrichment.supportingReferences?.observations.length,2);assert.equal(calls.length,3);assert.deepEqual(calls.slice(1),[csvURL,dedupeURL]);
 const added=result.sources.filter(x=>x.role==='building');assert.equal(added.length,2);assert.ok(added.some(x=>x.text.includes('JSON row')));assert.ok(added.some(x=>x.text.includes('unique ID')));
 assert.equal(stableJSON(b),original);assert.equal(d.candidate.experimentPlan.status,'proposed');assert.deepEqual(b.run.published,[]);
});
