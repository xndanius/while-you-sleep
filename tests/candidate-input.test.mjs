import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {candidateHistory,writerResearchView,writerReadiness,selectBuildingReferences} from '../lib/candidate-input.mjs';
import {sha256,stableJSON} from '../lib/storage.mjs';

test('writer view keeps selected discovery and primary evidence without rewriting the immutable snapshot',()=>{
 const snapshot={sources:[{id:'discovery',text:'Launch title'},{id:'primary',text:'Documented operation'},{id:'unrelated',text:'Irrelevant news'}],enrichment:{status:'completed',observations:[{productUrl:'https://example.com/tool',originSourceIds:['discovery'],evidenceIds:['primary']}]}};
 const before=stableJSON(snapshot),view=writerResearchView(snapshot);assert.deepEqual(view.sources.map(row=>row.id),['discovery','primary']);assert.equal(stableJSON(snapshot),before);assert.equal(view.enrichment,snapshot.enrichment);assert.equal(view.writerView.originalSourceCount,3);assert.equal(writerResearchView({...snapshot,enrichment:{status:'not_requested'}}).sources.length,3);
});
test('recent writer memory distinguishes provisional ratings and refuses an altered draft',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'wys-candidate-memory-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const runId='loop-999-1',draft={runId,candidates:[{title:'A documented task',productUrl:'https://example.com/tool',reason:'Unproved demand.',scoring:{criteria:{profit:{value:4,reason:'Hypothesis: demand unproved.'}}}}],posts:[]},run={id:runId,assessmentOutcome:'completed',operationalFailures:[],checkedAssessment:{completed:true,completedAt:'2026-10-11T16:00:00.000Z',draftSha256:sha256(stableJSON(draft))}};
 for(const [directory,record] of [['runs',run],['drafts',draft]]){await fs.mkdir(path.join(root,'data',directory),{recursive:true});await fs.writeFile(path.join(root,'data',directory,runId+'.json'),JSON.stringify(record));}
 let history=await candidateHistory(root,'2026-10-11T17:00:00.000Z');assert.equal(history.rejections.length,1);assert.match(history.rejections[0].ratingStatus,/provisional/);assert.equal(history.rejections[0].primaryEvidenceFetched,false);assert.deepEqual(history.recentAssessments,[]);
 draft.candidates[0].reason='Altered';await fs.writeFile(path.join(root,'data','drafts',runId+'.json'),JSON.stringify(draft));assert.equal((await candidateHistory(root,'2026-10-11T17:00:00.000Z')).rejections.length,0);assert.equal((await candidateHistory(root,'2026-10-12T17:00:00.000Z')).rejections.length,0);
});

const demand={id:'notice',url:'https://jobsearch.api.jobtechdev.se/ad/123',role:'demand',demand:true,title:'Paid administrator role',text:'Hantera fakturering och dokumentation.',taskExcerpts:['Hantera fakturering och dokumentation.']};
const reference=(id,host,title)=>({id,url:`https://${host}/${id}`,role:'building',title,text:title});

test('English support, merchant operations and marketing chores select matching references without unrelated filler',()=>{
 const support=reference('ticket-replies','support.example','Support ticket triage and customer replies'),orders=reference('inventory-tracker','orders.example','Inventory and shipping tracker'),marketing=reference('crm-campaigns','marketing.example','CRM campaign assistant'),unrelated=reference('recipe-book','recipes.example','Recipe collection');
 const sources=[unrelated,support,orders,marketing];
 for(const [task,expected] of [['Triage support tickets and draft customer replies',support],['Track orders, inventory and shipping status',orders],['Update CRM campaigns and marketing lists',marketing]]){
  assert.deepEqual(selectBuildingReferences(sources,[{taskExcerpts:[task]}],{limit:2,matchedOnly:true}),[expected]);
 }
 assert.deepEqual(selectBuildingReferences(sources,[{taskExcerpts:['Do a general service']}],{limit:2,matchedOnly:true}),[]);
});

test('shipping requests do not select invoice-email references from a generic order mention',()=>{
 const invoice={...reference('invoice-email','invoice.example','Invoice emails and payment reminders'),text:'Read an email in order to prepare invoice payment reminders.'},shipping=reference('shipment-tracker','shipping.example','Track shipping rates and shipment status'),source={taskExcerpts:['I need to assign shipping rates to custom locations using comma-separated lists']};
 assert.deepEqual(selectBuildingReferences([invoice,shipping],[source],{limit:2,matchedOnly:true}),[shipping]);
});

test('late relevant building references replace unrelated early items without changing source identity or the eight-item bound',()=>{
 const unrelated=Array.from({length:8},(_,i)=>reference('support-'+i,'news.example','Customer support inbox'));
 const invoice=reference('invoice-ocr','n8n.example','Extract invoice data from PDF documents');
 const document=reference('document-api','docs.example','Document parsing API');
 const sources=[...unrelated,invoice,document,demand],before=structuredClone(sources);
 const selected=selectBuildingReferences(sources,[demand]);
 assert.equal(selected.length,8);assert.equal(selected[0],invoice);assert.equal(selected[1],document);
 assert.ok(selected.every(source=>sources.includes(source)&&source!==demand));
 assert.deepEqual(sources,before);assert.deepEqual(selectBuildingReferences(sources,[demand]),selected);
 assert.equal(selectBuildingReferences(sources,[demand],{limit:100}).length,8);
});

test('relevant source-host diversity comes before a third matching reference from one host',()=>{
 const dominant=Array.from({length:9},(_,i)=>reference('invoice-document-'+i,'one.example','Invoice document extraction'));
 const other=reference('invoice-api','two.example','Invoice API');
 const selected=selectBuildingReferences([...dominant,other],[demand]);
 assert.deepEqual(selected.slice(0,3),[dominant[0],dominant[1],other]);
 assert.equal(selected.length,8);assert.equal(new Set(selected).size,8);
});

test('writer matches only selected demand notices and keeps the immutable snapshot intact',()=>{
 const unrelated={...demand,id:'unselected',taskExcerpts:['Planera möten och bokningar.']};
 const meeting=reference('calendar','meet.example','Meeting calendar appointments');
 const invoice=reference('invoice','invoice.example','Invoice extraction');
 const snapshot={sources:[unrelated,meeting,invoice,demand],learningSelection:{selectedSegment:'professional_services'},enrichment:{status:'completed',observations:[{originSourceIds:['notice'],evidenceIds:['notice']}]}};
 const view=writerResearchView(snapshot);
 assert.deepEqual(view.sources,[demand,invoice,meeting]);assert.equal(snapshot.sources[0],unrelated);
 assert.match(view.writerView.note,/establish no customer demand/);
 assert.deepEqual(writerResearchView({...snapshot,learningSelection:null}).sources,[demand]);
 const notRequested={...snapshot,enrichment:{status:'not_requested'}};assert.equal(writerResearchView(notRequested),notRequested);
});

test('no recognizable demand task keeps the existing bounded order; zero capacity stays empty',()=>{
 const sources=Array.from({length:10},(_,i)=>reference('source-'+i,'one.example','General implementation'));
 assert.deepEqual(selectBuildingReferences(sources,[]),sources.slice(0,8));
 assert.deepEqual(selectBuildingReferences(sources,[demand],{limit:0}),[]);
});

test('task-specific references beat body-only catalog matches and record does not match recordings',()=>{
 const catalog={...reference('catalog','catalog.example','Large tool catalog'),text:'Includes invoice document tools.'};
 const recording=reference('recordings','video.example','Screen recordings for support');
 const direct=Array.from({length:8},(_,i)=>reference('invoice-'+i,'tools.example','Invoice workflow'));
 assert.deepEqual(selectBuildingReferences([catalog,recording,...direct],[demand]),direct);
 const records={...demand,taskExcerpts:['Organize records for review.']};
 const filing=reference('filing','files.example','Document filing');
 assert.deepEqual(selectBuildingReferences([recording,filing],[records],{limit:1}),[filing]);
});


test('missing selected demand cannot spend a writer model call or fabricate an empty assessment',()=>{
 const options={demandRequired:true},source={...demand,segment:'professional_services',demand:true},snapshot={learningSelection:{selectedSegment:'professional_services'},sources:[source],enrichment:{observations:[{status:'fetched',evidenceIds:[source.id]}]}};
 assert.equal(writerReadiness(snapshot,options).ready,true);
 for(const bad of [{...snapshot,learningSelection:{selectedSegment:null}},{...snapshot,sources:[{...source,role:'building'}]},{...snapshot,enrichment:{observations:[{status:'failed',evidenceIds:[]}]}},{...snapshot,sources:[{...source,segment:'education'}]}]){assert.equal(writerReadiness(bad,options).ready,false);assert.match(writerReadiness(bad,options).reason,/without a model call/);}
 assert.equal(writerReadiness({},{}).ready,true,'legacy non-demand runs retain their existing path');
});
