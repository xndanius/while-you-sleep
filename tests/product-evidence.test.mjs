import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PRODUCT_EVIDENCE_POLICY,PRODUCT_SELECTION_POLICY,selectProductLeads,enrichProductLeads,sourceEvidenceFetchOptions,recentProductAssessments} from '../lib/product-evidence.mjs';
import {hash,sha256,stableJSON,canonicalURL,writeJSON} from '../lib/storage.mjs';
import {emptySourceRegistry,applySourceTransition,createSourceScanReceipt,validateSourceScanReceipt} from '../lib/source-registry.mjs';
import {researchSnapshot} from '../scripts/research-snapshot.mjs';
import {DEMAND_SOURCE_CATALOG,parseDemandSourcePage,fetchDemandEvidence,demandEvidenceFingerprint} from '../lib/demand-sources.mjs';
import {fetchPublic} from '../lib/source-fetch.mjs';
import {writerResearchView} from '../lib/candidate-input.mjs';

const now='2026-10-11T15:00:00.000Z';
const capability='The product reads uploaded invoice documents, extracts structured fields, and exports CSV files for review. The operator chooses the documents and checks the result before sending records. It includes a command line interface and documented configuration; running it still requires a server, credentials and human approval. ';
const rules='<!-- scoring-policy:start -->\n```json\n{"weights":{"ease":1,"profit":1,"feasibility":1,"autonomy":1,"evidence":1},"publishThreshold":6}\n```\n<!-- scoring-policy:end -->\n';
function source(n,{productUrl,url=`https://products.example.org/tool-${n}`}={}){return {id:hash(canonicalURL(url)),url,title:`Tool ${n}`,text:'A title and short launch excerpt.',fetchedAt:now,...(productUrl?{productUrl}: {})};}
function origin(item,feedId='feed-a'){return {sourceId:item.id,url:item.url,productUrl:item.productUrl||item.url,feedIds:[feedId]};}
function page(url,text=capability.repeat(8),options={}){const maxBytes=options.maxBytes??2000000;return {url,text,status:200,contentType:options.contentType||'text/html',fetchedAt:now,maxBytes,bytes:Buffer.byteLength(text),truncated:false,redirects:[],robots:[{origin:new URL(url).origin,evaluatedUrl:url,allowed:true,status:404,state:'missing'}]};}
const fetchFixture=async(url,options)=>page(url,capability.repeat(8),options);
const demandJob=(id,text)=>({id:String(id),headline:'Administrator',occupation:{label:'Administratör'},salary_type:{concept_id:'oG8G_9cW_nRf'},publication_date:'2026-10-10T08:00:00',application_deadline:'2026-11-01',description:{text}});

function tedFixture(){
 const definition=DEMAND_SOURCE_CATALOG.find(source=>source.kind==='ted-service-demand'),body=JSON.stringify({notices:[{'publication-number':'721351-2026','publication-date':'2026-10-10+02:00','notice-type':'cn-standard','description-proc':{eng:'Process incoming invoices and prepare weekly payment reports.'},'deadline-date-lot':['2026-11-01+02:00']}],timedOut:false});
 const sources=parseDemandSourcePage(definition,page(definition.url,body,{contentType:'application/json'}));
 return {definition,body,sources,options:{sources,originMap:sources.map(source=>origin(source,definition.id)),learningSelection:{selectedSegment:'public_sector',demandSourceIds:[definition.id]},demandDefinitions:[definition],now:()=>Date.parse(now),limit:1,cooldownHours:3}};
}
const guardedTEDFetch=(url,options)=>fetchPublic(url,{...options,lookupHost:async()=>[{address:'8.8.8.8'}],robotsCache:new Map(),now:()=>Date.parse(now)});

test('TED writer enrichment preserves the exact anonymous POST adapter and GET robots guards',async t=>{
 const fixture=tedFixture(),calls=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url:String(url),init});if(String(url).endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /\n',{headers:{'content-type':'text/plain'}});assert.equal(String(url),fixture.definition.url);return new Response(fixture.body,{headers:{'content-type':'application/json'}});});
 const result=await enrichProductLeads({...fixture.options,fetchPage:guardedTEDFetch});
 assert.equal(result.enrichment.status,'completed');assert.equal(result.enrichment.fetched,1);assert.equal(result.enrichment.requests,1);assert.equal(calls.length,2);
 assert.equal(calls[0].init.method||'GET','GET');assert.equal(calls[0].init.body,undefined);assert.equal(calls[1].init.method,'POST');assert.equal(JSON.parse(calls[1].init.body).query,'publication-number=721351-2026');
 assert.ok(calls.every(call=>call.init.signal instanceof AbortSignal&&!call.init.signal.aborted));assert.equal(result.sources[0].id,fixture.sources[0].id);assert.equal(result.sources[0].evidenceKind,'demand-notice');assert.deepEqual(result.sources[0].evidenceFetch,{maxBytes:2000000,complete:true});
});

test('TED transport keeps byte limits, robots denials and the whole-enrichment timeout enforced',async t=>{
 const fixture=tedFixture();let mode;
 t.mock.method(globalThis,'fetch',async(url)=>{if(String(url).endsWith('/robots.txt'))return new Response(mode==='robots'?'User-agent: *\nDisallow: /\n':'User-agent: *\nAllow: /\n',{headers:{'content-type':'text/plain'}});if(mode==='timeout')return new Promise(()=>{});return new Response(mode==='bytes'?'x'.repeat(2000001):fixture.body,{headers:{'content-type':'application/json'}});});
 for(const [variant,code] of [['bytes','body_oversized'],['robots','robots_disallowed'],['timeout','product_evidence_timeout']]){
  mode=variant;const result=await enrichProductLeads({...fixture.options,fetchPage:guardedTEDFetch,...(variant==='timeout'?{timeBudgetMs:20}:{})});
  assert.equal(result.enrichment.status,'failed',variant);assert.equal(result.enrichment.fetched,0,variant);assert.equal(result.enrichment.observations[0].code,code,variant);assert.equal(result.sources[0].enriched,undefined,variant);
 }
});

function implementationFixture(){
 const definition=DEMAND_SOURCE_CATALOG[2],row=demandJob(111,'Registrera fakturor och sammanställa rapporter för granskning.'),demand=parseDemandSourcePage(definition,page(definition.url,JSON.stringify({hits:[row]}),{contentType:'application/json'}))[0];
 const repository={...source(50,{url:'https://github.com/public/invoice-reports'}),title:'Invoice reports workflow'},product={...source(51,{url:'https://documents.example.org/invoice-review'}),title:'Invoice review workflow'},unrelated={...source(52,{url:'https://calendar.example.org/calendar'}),title:'Meeting calendar'};
 const sources=[demand,repository,product,unrelated],originMap=[origin(demand,definition.id),...[repository,product,unrelated].map(item=>origin(item))];
 return {row,demand,repository,product,unrelated,options:{sources,originMap,learningSelection:{selectedSegment:'professional_services',demandSourceIds:[definition.id]},demandDefinitions:[definition],now:()=>Date.parse(now),limit:10,cooldownHours:3}};
}

test('two matching implementation references get fresh bounded docs without becoming extra assessed leads',async()=>{
 const f=implementationFixture(),calls=[],raw='https://raw.githubusercontent.com/public/invoice-reports/main/README.md';
 const result=await enrichProductLeads({...f.options,fetchPage:async(url,options)=>{calls.push({url,options});if(url===f.demand.url)return page(url,JSON.stringify(f.row),{...options,contentType:'application/json'});if(url==='https://api.github.com/repos/public/invoice-reports')return page(url,JSON.stringify({private:false,full_name:'public/invoice-reports'}),{...options,contentType:'application/json'});if(url.endsWith('/readme'))return page(url,JSON.stringify({type:'file',download_url:raw}),{...options,contentType:'application/json'});assert.ok([raw,f.product.url].includes(url),'Only task-matched original references may be fetched.');return page(url,capability.repeat(8),options);}});
 assert.equal(result.enrichment.selected,1);assert.equal(result.enrichment.observations.length,1);assert.equal(result.enrichment.observations[0].productUrl,f.demand.url);assert.equal(result.enrichment.supportingReferences.observations.length,2);assert.equal(result.enrichment.requests+result.enrichment.supportingReferences.requests,5);assert.ok(calls.length<=30);assert.ok(!calls.some(call=>call.url===f.unrelated.url));
 const documents=result.sources.filter(item=>item.enriched&&item.role!=='demand');assert.equal(documents.length,2);assert.ok(documents.some(item=>item.url===raw&&item.originSourceIds.includes(f.repository.id)));
 for(const document of documents){const independentOptions=sourceEvidenceFetchOptions(document);assert.equal(independentOptions.complete,true);assert.equal(independentOptions.maxBytes,document.evidenceKind==='github-readme'?350000:2000000);const fresh=await fetchFixture(document.url,independentOptions);assert.equal(fresh.url,document.url);assert.equal(fresh.maxBytes,independentOptions.maxBytes);}
 const view=writerResearchView({...result,learningSelection:f.options.learningSelection});assert.ok(view.sources.some(item=>item.id===hash(raw)));assert.ok(view.sources.filter(item=>item.role!=='demand').length<=8);assert.equal(view.enrichment.observations.length,1);
});

test('support documents share the original timeout and failed support does not erase fetched demand',async()=>{
 const f=implementationFixture(),started=Date.now();
 const result=await enrichProductLeads({...f.options,timeBudgetMs:20,fetchPage:async(url,options)=>url===f.demand.url?page(url,JSON.stringify(f.row),{...options,contentType:'application/json'}):new Promise(()=>{})});
 assert.ok(Date.now()-started<1000);assert.equal(result.enrichment.status,'completed');assert.equal(result.enrichment.fetched,1);assert.equal(result.enrichment.observations.length,1);assert.equal(result.enrichment.supportingReferences.observations.length,1);assert.equal(result.enrichment.supportingReferences.observations[0].code,'product_evidence_timeout');assert.ok(result.enrichment.requests+result.enrichment.supportingReferences.requests<=30);
});

test('ten demand candidates stay ten when support documentation is also retrieved',async()=>{
 const f=implementationFixture(),definition=f.options.demandDefinitions[0],rows=Array.from({length:12},(_,i)=>demandJob(111+i,'Registrera fakturor och sammanställa rapporter för granskning.')),demand=parseDemandSourcePage(definition,page(definition.url,JSON.stringify({hits:rows}),{contentType:'application/json'})),sources=[...demand,f.product,f.unrelated],byURL=new Map(demand.map((item,i)=>[item.url,rows[i]]));let requests=0;
 const result=await enrichProductLeads({...f.options,sources,originMap:[...demand.map(item=>origin(item,definition.id)),origin(f.product),origin(f.unrelated)],fetchPage:async(url,options)=>{requests++;assert.notEqual(url,f.unrelated.url);return byURL.has(url)?page(url,JSON.stringify(byURL.get(url)),{...options,contentType:'application/json'}):page(url,capability.repeat(8),options);}});
 assert.equal(result.enrichment.selected,10);assert.equal(result.enrichment.observations.length,10);assert.equal(result.enrichment.supportingReferences.observations.length,1);assert.equal(result.enrichment.requests+result.enrichment.supportingReferences.requests,requests);assert.ok(requests<=30);
});

test('demand retrieval prefers literal tasks to longer broad descriptions without assigning editorial scores',()=>{
 const def=DEMAND_SOURCE_CATALOG[2],rows=[demandJob(100,'Du är en strukturerad administratör med god servicekänsla. '.repeat(8)),demandJob(101,'Registrera dokument och arkivera inkommande underlag.\nSammanställa rapporter för granskning varje vecka.')];
 const items=parseDemandSourcePage(def,page(def.url,JSON.stringify({hits:rows}),{contentType:'application/json'}));
 const selection={selectedSegment:'professional_services',demandSourceIds:[def.id]},options={learningSelection:selection,demandDefinitions:[def],originMap:items.map(item=>origin(item,def.id)),limit:1};
 const selected=selectProductLeads(items,options);
 assert.equal(selected.length,1);assert.equal(selected[0].productUrl,items[1].url);assert.deepEqual(selected[0].selection.signals,['explicit-task-excerpt']);
 assert.ok(!('scoring' in selected[0])&&!('overall' in selected[0])&&!('pass' in selected[0]));assert.ok(!('scoring' in items[1]));
 assert.equal(selectProductLeads(items,{...options,recentAssessments:[{productUrl:items[1].url,assessedAt:now}],now})[0].productUrl,items[0].url);
});

test('lead selection is deterministic, bounded, diverse and excludes already published products',()=>{
 const items=Array.from({length:24},(_,n)=>source(n)),git=source(25,{productUrl:'https://github.com/public/invoices'});items.push(git);
 const origins=items.map((item,n)=>origin(item,n<20?'prolific-feed':'other-feed'));
 const previous=[{productUrl:items[0].url+'?utm_source=old'}],selected=selectProductLeads(items,{originMap:origins,previous});
 assert.equal(selected.length,10);assert.ok(selected.some(lead=>lead.productUrl===git.productUrl));assert.ok(!selected.some(lead=>lead.productUrl===items[0].url));assert.ok(selected.some(lead=>lead.originFeedIds.includes('other-feed')));assert.deepEqual(selected,selectProductLeads(items,{originMap:origins,previous}));
 assert.throws(()=>selectProductLeads(items,{limit:11}),/bounded/);assert.throws(()=>selectProductLeads(Array(801).fill(items[0])),/bounded/);
});

test('a repository-heavy scan gives concrete workflow documentation a real bounded and diverse first look',()=>{
 const repos=Array.from({length:30},(_,n)=>({...source(n,{productUrl:`https://github.com/public/repo-${n}`}),title:n<3?'AI agent email workflow':'Generic source repository',text:n<3?'Automates email review and exports CSV.':'An open source code collection.'}));
 const official=[{...source(31,{url:'https://workflow.example.org/ai'}),title:'AI workflow automation for invoices',text:'Automate business document extraction and vendor follow-ups.'},{...source(32,{url:'https://browser.example.org'}),title:'Browser agents',text:'Replay a browser workflow and review each recurring report.'},{...source(33,{url:'https://betalist.com/startups/receipt-tool'}),title:'Receipt tool',text:'Automatically extract receipts into CSV for review.'},{...source(34,{url:'https://simonwillison.net/2026/Oct/10/monitor'}),title:'Scheduled release alerts',text:'I built an hourly monitor to send an email when a release appears.'},{...source(35,{url:'https://huggingface.co/spaces/public/demo'}),title:'AI model demo',text:'An agent demo with a public model listing.'}];
 const items=[...repos,...official],origins=items.map((item,n)=>origin(item,n<30?'github-feed':`feed-${n}`)),selected=selectProductLeads(items,{originMap:origins});assert.equal(selected.length,10);assert.ok(selected.some(lead=>lead.productUrl===official[0].url));assert.ok(selected.some(lead=>lead.productUrl===official[1].url));assert.equal(new Set(selected.map(lead=>lead.selection.family)).size,5);assert.ok(selected.filter(lead=>lead.selection.family==='repository').length<12);assert.ok(selected[0].selection.signals.includes('repeatable-workflow'));assert.ok(selected.every(lead=>!('scoring' in lead)&&!('overall' in lead)&&!('pass' in lead)));assert.equal(selected[0].selection.version,2);
});

function completedHistory(productUrl='https://products.example.org/review'){
 const runId='loop-808-1',draft={runId,candidates:[{productUrl,sourceIds:['origin'],reason:'Explicitly refused after independent evidence.'}],posts:[],rejected:[]},sources=[{id:hash(canonicalURL(productUrl)),url:canonicalURL(productUrl),productUrl,text:capability.repeat(2),enriched:true,evidenceKind:'product-page',evidenceFetch:{maxBytes:2000000,complete:true},fetchedAt:'2026-10-11T14:20:00.000Z',verifiedAt:'2026-10-11T14:20:00.000Z'}],context={runId,draftSha256:sha256(stableJSON(draft)),rulesSha256:'b'.repeat(64),sourceSnapshotSha256:sha256(stableJSON(sources)),scoringPolicy:{policySha256:'d'.repeat(64)},sources},proof={schema:1,completed:true,contractVersion:1,runId,checkerRunId:runId+'-independent-check',decision:'no_supported_candidate',completedAt:'2026-10-11T14:30:00.000Z',draftSha256:context.draftSha256,contextSha256:sha256(stableJSON(context)),rulesSha256:context.rulesSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,policySha256:context.scoringPolicy.policySha256},run={id:runId,type:'loop',assessmentOutcome:'completed',operationalFailures:[],checkedAssessment:proof},research={id:runId,runId,enrichment:{status:'completed',observations:[{productUrl,status:'fetched',fetchedAt:'2026-10-11T14:20:00.000Z'}]}};return {runs:[run],drafts:[draft],research:[research],contexts:[context],now};
}

test('fresh guarded demand metadata makes a completed refusal eligible for the existing cooldown',async()=>{
 const def=DEMAND_SOURCE_CATALOG[2],row=demandJob(100,'Registrera dokument för granskning.'),original=parseDemandSourcePage(def,page(def.url,JSON.stringify({hits:[row]}),{contentType:'application/json'}))[0];
 const at='2026-10-11T14:20:00.000Z',fresh=await fetchDemandEvidence({...original,productUrl:'https://forged.example.org'},{definition:def,fetchPage:async url=>({...page(url,JSON.stringify(row),{contentType:'application/json'}),fetchedAt:at})});
 assert.equal(fresh.productUrl,original.url);assert.ok(fresh.text.length<300);
 const history=completedHistory(original.url),context=history.contexts[0],proof=history.runs[0].checkedAssessment;
 context.sources=[fresh];context.sourceSnapshotSha256=sha256(stableJSON(context.sources));proof.sourceSnapshotSha256=context.sourceSnapshotSha256;proof.contextSha256=sha256(stableJSON(context));
 const recent=recentProductAssessments(history);assert.equal(recent.length,1);assert.equal(recent[0].productUrl,original.url);
 assert.equal(selectProductLeads([original],{recentAssessments:recent,now}).length,0);
 assert.equal(recentProductAssessments({...history,now:'2026-10-12T14:30:00.000Z'}).length,0);
});

test('recent refusal memory binds a completed exact draft and fetched primary evidence, then expires honestly',()=>{
 const history=completedHistory(),recent=recentProductAssessments(history);assert.deepEqual(recent,[{productUrl:'https://products.example.org/review',assessedAt:'2026-10-11T14:30:00.000Z',runId:'loop-808-1'}]);const items=[source(1,{url:recent[0].productUrl}),source(2)],selected=selectProductLeads(items,{recentAssessments:recent,now});assert.deepEqual(selected.map(item=>item.productUrl),[items[1].url]);assert.equal(selectProductLeads(items,{recentAssessments:recent,now:'2026-10-12T14:30:00.000Z'}).length,2);assert.deepEqual(recentProductAssessments({...history,now:'2026-10-12T14:30:00.000Z'}),[]);
 for(const change of [h=>h.runs[0].assessmentOutcome='incomplete',h=>h.runs[0].operationalFailures=[{stage:'fetch'}],h=>h.runs[0].checkedAssessment.draftSha256='0'.repeat(64),h=>h.drafts[0].candidates[0].productUrl='https://forged.example.org',h=>delete h.runs[0].checkedAssessment,h=>delete h.research[0].enrichment,h=>h.research[0].enrichment.observations[0].status='failed',h=>h.research[0].enrichment.observations[0].fetchedAt='2026-10-11T14:40:00.000Z']){const changed=structuredClone(history);change(changed);assert.deepEqual(recentProductAssessments(changed),[]);}
 assert.throws(()=>recentProductAssessments({runs:Array(PRODUCT_SELECTION_POLICY.maxHistoryRecords+1).fill(history.runs[0])}),/bound/);
});

test('cooldown requires the exact checked context and an actually fresh enriched primary source',()=>{
 for(const change of [h=>h.contexts=[],h=>h.contexts[0].sources[0].text='Changed after the check.',h=>h.contexts[0].sources[0].enriched=false,h=>h.contexts[0].sources[0].productUrl='https://different.example.org/tool',h=>h.contexts[0].sources[0].verifiedAt='2026-10-11T14:40:00.000Z',h=>h.contexts[0].sources[0].evidenceFetch.complete=false]){const h=completedHistory();change(h);assert.deepEqual(recentProductAssessments(h),[]);}
 const h=completedHistory();h.contexts[0].sources[0].enriched=false;h.contexts[0].sourceSnapshotSha256=sha256(stableJSON(h.contexts[0].sources));h.runs[0].checkedAssessment.sourceSnapshotSha256=h.contexts[0].sourceSnapshotSha256;h.runs[0].checkedAssessment.contextSha256=sha256(stableJSON(h.contexts[0]));assert.deepEqual(recentProductAssessments(h),[]);
});

test('assessment cooldown is canonical, deduplicated and never mutates evidence or source origins',async()=>{
 const history=completedHistory('https://products.example.org/review?utm_source=duplicate'),item=source(1,{url:'https://products.example.org/review'}),before=stableJSON(item),recent=recentProductAssessments(history);let calls=0;
 const result=await enrichProductLeads({sources:[item],originMap:[origin(item)],recentAssessments:recent,now:()=>Date.parse(now),fetchPage:async()=>{calls++;throw Error('Should not fetch a recently assessed product.');}});assert.equal(calls,0);assert.equal(result.enrichment.status,'no_new_leads');assert.equal(stableJSON(item),before);assert.equal(result.sources[0].id,item.id);assert.equal(recent.length,1);assert.deepEqual(Object.keys(recent[0]).sort(),['assessedAt','productUrl','runId']);
});

test('lead identity retains distinct frozen product tuples and unions only matching origins',()=>{
 const item=source(1,{url:'https://launches.example.org/item/1',productUrl:'https://products.example.org/first'}),origins=[origin(item,'feed-a'),{...origin(item,'feed-b'),productUrl:'https://products.example.org/second'}];
 const selected=selectProductLeads([item],{originMap:origins});assert.equal(selected.length,2);assert.deepEqual(selected.find(lead=>lead.productUrl.endsWith('/first')).originFeedIds,['feed-a']);assert.deepEqual(selected.find(lead=>lead.productUrl.endsWith('/second')).originFeedIds,['feed-b']);
});

test('product enrichment adds substantial guarded capability text without changing discovery identity',async()=>{
 const listing=source(1,{url:'https://launches.example.org/item/1',productUrl:'https://products.example.org/tool'}),origins=[origin(listing)],before=stableJSON({listing,origins}),calls=[];
 const result=await enrichProductLeads({sources:[listing],originMap:origins,fetchPage:async(url,options)=>{calls.push({url,options});return fetchFixture(url,options);},now:()=>Date.parse(now)});
 assert.equal(result.enrichment.status,'completed');assert.equal(result.enrichment.fetched,1);assert.equal(result.enrichment.failed,0);assert.equal(result.sources.length,2);assert.equal(result.sources[0].id,listing.id);assert.equal(result.sources[0].text,listing.text);
 const evidence=result.sources[1];assert.equal(evidence.id,hash(listing.productUrl));assert.ok(evidence.text.length>1200);assert.deepEqual(evidence.originSourceIds,[listing.id]);assert.equal(evidence.productUrl,listing.productUrl);assert.equal(evidence.evidenceKind,'product-page');assert.deepEqual(evidence.evidenceFetch,{maxBytes:2000000,complete:true});assert.equal(calls[0].options.complete,true);assert.equal(calls[0].options.maxBytes,2000000);assert.equal(stableJSON({listing,origins}),before);assert.match(evidence.evidenceNote,/does not establish a deployed runtime/);
});

test('same primary URL upgrades text once and keeps the original excerpt and feed IDs',async()=>{
 const item={...source(1),originFeedIds:['feed-a']};const result=await enrichProductLeads({sources:[item],originMap:[origin(item)],fetchPage:fetchFixture});assert.equal(result.sources.length,1);assert.equal(result.sources[0].id,item.id);assert.equal(result.sources[0].feedExcerpt,item.text);assert.deepEqual(result.sources[0].originFeedIds,['feed-a']);assert.ok(result.sources[0].text.length>item.text.length);
});

test('homepage request serialization keeps canonical identity while validating real guarded response URLs',async()=>{
 const item=source(1,{url:canonicalURL('https://products.example.org/')}),result=await enrichProductLeads({sources:[item],originMap:[origin(item)],fetchPage:async(url,options)=>page(new URL(url).toString(),capability.repeat(8),options)});assert.equal(result.enrichment.fetched,1);assert.equal(result.sources.length,1);assert.equal(result.sources[0].url,'https://products.example.org');assert.equal(result.sources[0].id,item.id);
});

test('fresh checker and publisher fetch policies use the same fixed complete page or README budgets',()=>{
 assert.deepEqual(sourceEvidenceFetchOptions(source(1)),{});assert.deepEqual(sourceEvidenceFetchOptions({enriched:true,evidenceKind:'product-page',evidenceFetch:{maxBytes:2000000,complete:true}}),{maxBytes:2000000,complete:true});assert.deepEqual(sourceEvidenceFetchOptions({enriched:true,evidenceKind:'github-readme',evidenceFetch:{maxBytes:350000,complete:true}}),{maxBytes:350000,complete:true});
 for(const value of [{enriched:true},{enriched:true,evidenceKind:'unknown',evidenceFetch:{maxBytes:2000000,complete:true}},{enriched:true,evidenceKind:'github-readme',evidenceFetch:{maxBytes:2000000,complete:true}},{enriched:true,evidenceKind:'product-page',evidenceFetch:{maxBytes:2000000,complete:false}},{enriched:true,evidenceKind:'product-page',evidenceFetch:{maxBytes:2000000,complete:true,fetchImpl:'untrusted'}}])assert.throws(()=>sourceEvidenceFetchOptions(value),/fixed fetch policy/);
});

test('GitHub enrichment reads only public metadata and its exact README URL under complete byte budgets',async()=>{
 const item=source(1,{productUrl:'https://github.com/public/invoices'}),raw='https://raw.githubusercontent.com/public/invoices/main/README.md',calls=[],body='# Invoice toolkit\n'+capability.repeat(8)+'\n```sh\nnever-run-this-command\n```';
 const result=await enrichProductLeads({sources:[item],originMap:[origin(item)],fetchPage:async(url,options)=>{calls.push({url,options});return page(url,url.endsWith('/readme')?JSON.stringify({type:'file',download_url:raw}):url.startsWith('https://api.github.com/')?JSON.stringify({private:false,full_name:'public/invoices'}):body,{...options,contentType:url.startsWith('https://api.github.com/')?'application/json':'text/plain'});}});
 assert.deepEqual(calls.map(call=>call.url),['https://api.github.com/repos/public/invoices','https://api.github.com/repos/public/invoices/readme',raw]);assert.ok(calls.every(call=>call.options.complete&&call.options.maxBytes===350000));assert.equal(result.enrichment.requests,3);assert.equal(result.enrichment.fetched,1);const evidence=result.sources.find(value=>value.enriched);assert.equal(evidence.id,hash(raw));assert.equal(evidence.url,raw);assert.equal(evidence.productUrl,item.productUrl);assert.deepEqual(evidence.originSourceIds,[item.id]);assert.equal(evidence.evidenceKind,'github-readme');assert.ok(evidence.text.includes('never-run-this-command'));
});

test('private repositories, repository mismatches and non-repository README URLs fail explicitly',async()=>{
 const item=source(1,{productUrl:'https://github.com/public/invoices'});
 for(const variant of ['private','mismatch','foreign','wrong-path','not-file']){
  const calls=[],result=await enrichProductLeads({sources:[item],fetchPage:async(url,options)=>{calls.push(url);const metadata={private:variant!=='private'?false:true,full_name:variant==='mismatch'?'someone/else':'public/invoices'},readme={type:variant==='not-file'?'directory':'file',download_url:variant==='foreign'?'https://unrelated.example.org/readme':variant==='wrong-path'?'https://raw.githubusercontent.com/someone/else/main/README.md':'https://raw.githubusercontent.com/public/invoices/main/README.md'};return page(url,JSON.stringify(url.endsWith('/readme')?readme:metadata),{...options,contentType:'application/json'});}});
  assert.equal(result.enrichment.status,'failed',variant);assert.equal(result.enrichment.fetched,0);assert.equal(result.enrichment.failed,1);assert.ok(calls.length<=2);assert.equal(result.sources.length,1);
 }
});

test('guarded evidence rejects denials, challenges, incomplete bodies and inconsistent URL or byte metadata',async()=>{
 const item=source(1);
 const mutate=[p=>p.robots=[],p=>p.robots[0].allowed=false,p=>p.robots[0].evaluatedUrl='https://unrelated.example.org/page',p=>p.url='https://unrelated.example.org/page',p=>p.truncated=true,p=>delete p.status,p=>delete p.fetchedAt,p=>p.maxBytes=350000,p=>p.bytes=2000001,p=>p.contentType='application/octet-stream',p=>p.contentType='application/json',p=>p.text='<title>Sign in</title>'+capability.repeat(8),p=>p.text='<input type="password">'+capability.repeat(8),p=>p.text='A short listing.'];
 for(const change of mutate){const result=await enrichProductLeads({sources:[item],fetchPage:async(url,options)=>{const value=page(url,capability.repeat(8),options);change(value);return value;}});assert.equal(result.enrichment.status,'failed');assert.equal(result.enrichment.fetched,0);assert.equal(result.enrichment.failed,1);assert.equal(result.enrichment.observations[0].status,'failed');assert.ok(result.enrichment.observations[0].code);assert.equal(result.sources[0].text,item.text);}
});

test('concurrency and whole-word excerpts are bounded independently of input size',async()=>{
 const items=Array.from({length:20},(_,n)=>source(n)),calls=[];let active=0,maxActive=0;
 const result=await enrichProductLeads({sources:items,fetchPage:async(url,options)=>{active++;maxActive=Math.max(maxActive,active);calls.push(url);await new Promise(resolve=>setTimeout(resolve,2));active--;return page(url,capability.repeat(40),options);}});
 assert.equal(calls.length,10);assert.ok(maxActive<=3);assert.equal(result.enrichment.fetched,10);for(const value of result.sources.filter(value=>value.enriched)){assert.ok(value.text.length<=8000);assert.equal(value.evidenceExcerpted,true);assert.ok((capability.repeat(40)).startsWith(value.text));assert.equal((capability.repeat(40))[value.text.length],' ');}
});

test('an unresponsive evidence fetch is bounded and distinguishes failures from no new leads',async()=>{
 const item=source(1),started=Date.now(),result=await enrichProductLeads({sources:[item],timeBudgetMs:20,fetchPage:()=>new Promise(()=>{})});assert.ok(Date.now()-started<1000);assert.equal(result.enrichment.status,'failed');assert.equal(result.enrichment.attempted,1);assert.equal(result.enrichment.fetched,0);assert.equal(result.enrichment.failed,1);assert.equal(result.enrichment.observations[0].code,'product_evidence_timeout');
 let fetched=false;const empty=await enrichProductLeads({sources:[item],previous:[{productUrl:item.url}],fetchPage:async()=>{fetched=true;throw Error('Must not fetch.');}});assert.equal(fetched,false);assert.equal(empty.enrichment.status,'no_new_leads');assert.equal(empty.enrichment.attempted,0);assert.equal(empty.enrichment.failed,0);
});

function validation(url,itemCount){return {publicHttps:true,robotsAllowed:true,readable:true,robots:[{origin:new URL(url).origin,evaluatedUrl:url,robotsUrl:new URL('/robots.txt',url).toString(),status:404,state:'missing',allowed:true,contentType:'text/plain',fetchedAt:now,redirects:[]}],redirects:[],httpStatus:200,contentType:'application/rss+xml',resolvedUrl:url,fetchedAt:now,maxBytes:2000000,truncated:false,parserVersion:'public-sources-v1',itemCount};}
async function snapshotFixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'wys-enrichment-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const url='https://feeds.example.org/feed',definition={id:hash(url),name:'Public feed',url,kind:'rss'},registry=applySourceTransition(emptySourceRegistry(),{definition,toStatus:'probation',reason:'Hosted guarded seed admission passed.',validation:validation(url,3),howAdded:'seed',now});await writeJSON(path.join(root,'data','sources','registry.json'),registry);await fs.writeFile(path.join(root,'RULES.md'),rules);const sources=[{...source(1,{productUrl:'https://github.com/public/invoices'}),title:'AI invoice workflow automation'},source(2),source(3)],result={sources,observations:[{feedId:definition.id,url,status:'ok',itemCount:3,fetchedAt:now,message:'Guarded parse passed.',validation:validation(url,3)}],originMap:sources.map(item=>origin(item,definition.id))},env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'xndanius/while-you-sleep',GITHUB_RUN_ID:'701',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'b'.repeat(40),SOURCE_HEAD_SHA:'a'.repeat(40)};return {root,registry,definition,result,env};}

test('hosted snapshot freezes original receipt before appended README evidence and preserves its exact fingerprint',async t=>{
 const f=await snapshotFixture(t),original=stableJSON(f.result),runId='loop-701-1';let beforeEnrich;
 const result=await researchSnapshot({root:f.root,runId,env:f.env,now,learningEnabled:false,scan:async()=>f.result,enrich:async options=>{beforeEnrich=JSON.parse(await fs.readFile(path.join(f.root,'data','source-scans',runId+'.json'),'utf8'));return enrichProductLeads({...options,limit:1,fetchPage:async(url,budget)=>page(url,url.endsWith('/readme')?JSON.stringify({type:'file',download_url:'https://raw.githubusercontent.com/public/invoices/main/README.md'}):url.startsWith('https://api.github.com/')?JSON.stringify({private:false,full_name:'public/invoices'}):capability.repeat(8),{...budget,contentType:url.startsWith('https://api.github.com/')?'application/json':'text/plain'})});}});
 const expected=createSourceScanReceipt({runId,registry:f.registry,...f.result,now,producer:{definitions:[f.definition],repository:f.env.GITHUB_REPOSITORY,runId:f.env.GITHUB_RUN_ID,runAttempt:1,workflow:'loop.yml',stage:'pre_model',headSha:f.env.SOURCE_HEAD_SHA}});
 assert.deepEqual(validateSourceScanReceipt(result.receipt),[]);assert.deepEqual(result.receipt,expected);assert.deepEqual(beforeEnrich,expected);assert.equal(result.source_scan_sha256,sha256(stableJSON(expected)));assert.equal(result.receipt.sources.length,3);assert.equal(result.receipt.observations[0].itemCount,3);assert.equal(result.snapshot.sources.length,4);assert.equal(result.snapshot.enrichment.fetched,1);assert.equal(result.snapshot.scheduleStatus,'completed');assert.equal(stableJSON(f.result),original);
});

test('a wholly failed enrichment preserves the scan receipt but makes a loop operationally failed',async t=>{
 const f=await snapshotFixture(t),result=await researchSnapshot({root:f.root,runId:'loop-701-1',env:f.env,now,learningEnabled:false,scan:async()=>f.result,enrich:options=>enrichProductLeads({...options,fetchPage:async()=>{throw Object.assign(new Error('Robots rules refuse this source.'),{stage:'robots',code:'robots_disallowed'});}})});assert.equal(result.snapshot.scheduleStatus,'failed');assert.equal(result.snapshot.enrichment.fetched,0);assert.equal(result.snapshot.enrichment.failed,3);assert.equal(result.receipt.sources.length,3);assert.match(result.source_scan_sha256,/^[a-f0-9]{64}$/);assert.equal(result.snapshot.sources.length,3);
});

test('standalone snapshots keep their original source scan contract and do not request product enrichment',async t=>{
 const f=await snapshotFixture(t),result=await researchSnapshot({root:f.root,runId:'research-701-1',env:f.env,now,scan:async()=>f.result});assert.equal(result.snapshot.enrichment.status,'not_requested');assert.equal(result.snapshot.sources.length,3);assert.equal(result.receipt.producer.workflow,'research.yml');assert.equal(result.receipt.producer.stage,'research');assert.equal(result.snapshot.scheduleStatus,'completed');
});


test('only changed substantive demand evidence reopens a cooled notice, never a published one',()=>{
 const def=DEMAND_SOURCE_CATALOG[2],items=parseDemandSourcePage(def,page(def.url,JSON.stringify({hits:[demandJob(111,'Registrera dokument för granskning och arkivering.')] }),{contentType:'application/json'}));
 const original=items[0],recentAssessments=[{productUrl:original.url,assessedAt:now,demandEvidenceSha256:demandEvidenceFingerprint(original)}],options={recentAssessments,now,learningSelection:{selectedSegment:'professional_services',demandSourceIds:[def.id]},demandDefinitions:[def],originMap:[origin(original,def.id)]};
 assert.equal(selectProductLeads(items,options).length,0);
 assert.equal(selectProductLeads([{...original,fetchedAt:'2026-10-11T15:01:00.000Z'}],options).length,0);
 const changed={...original,text:original.text+' Sammanställa fakturaunderlag för granskning.'};
 assert.equal(selectProductLeads([changed],options).length,1);assert.equal(selectProductLeads([changed],{...options,previous:[{productUrl:original.url}]}).length,0);
 assert.equal(selectProductLeads([changed],{...options,recentAssessments:[{productUrl:original.url,assessedAt:now}]}).length,0,'an unproven legacy fingerprint cannot claim changed evidence');
});
