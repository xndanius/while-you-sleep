import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DISCUSSION_SOURCE_CATALOG,DISCUSSION_PROVIDER_CATALOG,makeDiscussionSource} from '../lib/discussion-sources.mjs';
import {createSourceScanReceipt,applySourceTransition,emptySourceRegistry} from '../lib/source-registry.mjs';
import {hash,sha256,stableJSON} from '../lib/storage.mjs';
import {DISCUSSION_DISCOVERY_POLICY,discussionDiscoveryReasons,loadDiscussionDiscovery,verifyDiscussionDiscovery} from '../lib/discussion-discovery.mjs';
import {researchSnapshot} from '../scripts/research-snapshot.mjs';
import {enrichDiscussionLeads} from '../lib/product-evidence.mjs';
import {writerReadiness} from '../lib/candidate-input.mjs';
import {deriveLearningReceipt} from '../lib/learning.mjs';

const now=new Date('2026-10-27T14:00:00.000Z'),definition=DISCUSSION_SOURCE_CATALOG.find(row=>row.kind==='hn-discussion');
const simple=({id,name,url,kind})=>({id,name,url,kind});
const definitions=[simple(definition)],selection={demandSourceIds:[definition.id],eligibleSegments:definition.segments};
const options=extra=>({currentSources:[],currentOriginMap:[],definitions,selection,now,...extra});
const body='Every week I manually copy invoice rows into a report and need a tool to prepare the same output.';
async function workspace(t){const root=await mkdtemp(path.join(os.tmpdir(),'wys-discussion-discovery-'));t.after(()=>rm(root,{recursive:true,force:true}));for(const dir of ['research','source-scans'])await mkdir(path.join(root,'data',dir),{recursive:true});return root;}
function source(number,{text=body,fetchedAt='2026-10-27T13:00:01.000Z',title='How can I automate weekly invoice reports?'}={}){return {...makeDiscussionSource(definition,{url:`https://news.ycombinator.com/item?id=${number}`,title,text,postedAt:'2026-10-27T10:00:00.000Z'},{fetchedAt}),originFeedIds:[definition.id]};}
function validation(count,fetchedAt){const origin=new URL(definition.url).origin;return {publicHttps:true,robotsAllowed:true,readable:true,robots:[{origin,evaluatedUrl:definition.url,robotsUrl:origin+'/robots.txt',status:404,state:'missing',allowed:true,contentType:'text/plain',fetchedAt}],redirects:[],httpStatus:200,contentType:'application/json',resolvedUrl:definition.url,fetchedAt,maxBytes:2000000,truncated:false,parserVersion:'public-sources-v2',itemCount:count};}
async function pair(root,{number=900,createdAt='2026-10-27T13:00:00.000Z',sources=[source(900)],snapshotChange,scanChange}={}){
 const runId=`research-${number}-1`,fetchedAt=sources[0]?.fetchedAt||createdAt,observations=[{feedId:definition.id,url:definition.url,status:'ok',itemCount:sources.length,fetchedAt,message:'Synthetic offline public source fixture.',validation:validation(sources.length,fetchedAt)}],originMap=sources.map(row=>({sourceId:row.id,url:row.url,productUrl:row.productUrl,feedIds:[definition.id]}));
 const scan=createSourceScanReceipt({runId,registry:{schema:1},sources,observations,originMap,producer:{definitions,repository:'xndanius/while-you-sleep',runId:String(number),runAttempt:1,workflow:'research.yml',stage:'research',headSha:'a'.repeat(40)},now:new Date(createdAt)});
 const snapshot={id:runId,runId,createdAt,sources,health:observations,enrichment:{schema:1,status:'not_requested',selected:0,attempted:0,fetched:0,failed:0,observations:[]}};
 snapshotChange?.(snapshot);scanChange?.(scan);
 const paths={snapshot:path.join(root,'data','research',runId+'.json'),scan:path.join(root,'data','source-scans',runId+'.json')};
 await writeFile(paths.snapshot,JSON.stringify(snapshot));await writeFile(paths.scan,JSON.stringify(scan));return {snapshot,scan,paths};
}
async function reseal(value){value.scan.sourceSnapshotSha256=sha256(stableJSON(value.snapshot.sources));value.scan.sources=value.snapshot.sources.map(row=>({id:row.id,url:row.url,productUrl:row.productUrl,textSha256:sha256(row.text),taskEvidence:{version:2,count:1}}));value.scan.sourcesSha256=sha256(stableJSON(value.scan.sources));value.scan.originMap=value.snapshot.sources.map(row=>({sourceId:row.id,url:row.url,productUrl:row.productUrl,feedIds:[definition.id]}));await writeFile(value.paths.snapshot,JSON.stringify(value.snapshot));await writeFile(value.paths.scan,JSON.stringify(value.scan));}

test('carryover retains original discovery text and time with verifiable separate provenance',async t=>{
 const root=await workspace(t),f=await pair(root),before=await Promise.all(Object.values(f.paths).map(file=>readFile(file,'utf8'))),result=await loadDiscussionDiscovery(root,options());
 assert.equal(result.sources.length,1);assert.deepEqual(result.sources[0],{...f.snapshot.sources[0],discussionBodyVersion:1});assert.equal(result.sources[0].fetchedAt,'2026-10-27T13:00:01.000Z');assert.equal(result.sources[0].enriched,undefined);
 assert.deepEqual(result.originMap,f.scan.originMap);assert.equal(result.provenance.records.length,1);assert.equal(result.provenance.records[0].observedAt,result.sources[0].fetchedAt);assert.equal(result.provenance.records[0].sourceSnapshotSha256,f.scan.sourceSnapshotSha256);assert.equal(result.provenance.records[0].sourceScanSha256,sha256(stableJSON(f.scan)));
 assert.deepEqual(discussionDiscoveryReasons(result.provenance),[]);assert.deepEqual(await verifyDiscussionDiscovery(root,result.provenance,options()),[]);
 assert.deepEqual(await Promise.all(Object.values(f.paths).map(file=>readFile(file,'utf8'))),before);
});

test('current records win, otherwise the newest valid historical body wins',async t=>{
 const root=await workspace(t),old=source(901),fresh=source(901,{text:'Every day I manually prepare invoice reports and need a tool that copies the same rows.',fetchedAt:'2026-10-27T13:20:01.000Z'});
 await pair(root,{number:901,sources:[old]});await pair(root,{number:902,createdAt:'2026-10-27T13:20:00.000Z',sources:[fresh]});
 assert.deepEqual((await loadDiscussionDiscovery(root,options())).sources,[{...fresh,discussionBodyVersion:1}]);
 const current={...fresh,text:'Current scan text is authoritative.'},origin={sourceId:current.id,url:current.url,productUrl:current.url,feedIds:[definition.id]},result=await loadDiscussionDiscovery(root,options({currentSources:[current],currentOriginMap:[origin]}));
 assert.deepEqual(result.sources,[current]);assert.deepEqual(result.originMap,[origin]);assert.deepEqual(result.provenance,{version:1,records:[]});
});

test('missing, changed, stale, future, non-standalone and forged pairs supply no carryover',async t=>{
 for(const mode of ['missing','hash','time','stale','future','producer','loop','enriched']){
  const root=await workspace(t),f=await pair(root);
  if(mode==='missing')await rm(f.paths.scan);
  if(mode==='hash'){f.snapshot.sources[0].text+=' Changed.';await writeFile(f.paths.snapshot,JSON.stringify(f.snapshot));}
  if(mode==='time'){f.scan.createdAt='2026-10-27T12:59:59.000Z';await writeFile(f.paths.scan,JSON.stringify(f.scan));}
  if(mode==='stale'){f.snapshot.createdAt=f.scan.createdAt='2026-10-26T12:00:00.000Z';await writeFile(f.paths.snapshot,JSON.stringify(f.snapshot));await writeFile(f.paths.scan,JSON.stringify(f.scan));}
  if(mode==='future'){f.snapshot.createdAt=f.scan.createdAt='2026-10-27T15:00:00.000Z';await writeFile(f.paths.snapshot,JSON.stringify(f.snapshot));await writeFile(f.paths.scan,JSON.stringify(f.scan));}
  if(mode==='producer'){f.scan.producer.workflow='loop.yml';await writeFile(f.paths.scan,JSON.stringify(f.scan));}
  if(mode==='loop'){f.snapshot.id='loop-900-1';await writeFile(f.paths.snapshot,JSON.stringify(f.snapshot));}
  if(mode==='enriched'){f.snapshot.enrichment.status='completed';await writeFile(f.paths.snapshot,JSON.stringify(f.snapshot));}
  assert.equal((await loadDiscussionDiscovery(root,options())).sources.length,0,mode);
 }
});

test('title-only, oversized, profile, provider, enriched and expanded records are not discovery bodies',async t=>{
 for(const mode of ['title','title-prefix','large','profile','provider','enriched','native','example','feedExcerpt','task']){
  const root=await workspace(t),f=await pair(root),s=f.snapshot.sources[0];
  if(mode==='title')s.text=s.title;
  if(mode==='title-prefix'){s.title='How can I automate weekly invoice reports with different forms and output formats?';s.text='How can I automate weekly invoice reports';}
  if(mode==='large')s.text=body.repeat(3);
  if(mode==='profile'){s.url='https://news.ycombinator.com/user?id=person';s.productUrl=s.url;s.id=hash(s.url);}
  if(mode==='provider')s.providerEvidence={provider:'apify'};
  if(mode==='enriched')s.enriched=true;
  if(mode==='native')s.nativeReadingContext={version:2};
  if(mode==='example')s.taskExample={version:1,text:'[1,2]',sha256:'a'.repeat(64)};
  if(mode==='feedExcerpt')s.feedExcerpt=body;
  if(mode==='task')s.taskExcerpts=['A different task.'];
  await reseal(f);assert.equal((await loadDiscussionDiscovery(root,options())).sources.length,0,mode);
 }
});

test('only currently selected native definitions may supply carryover',async t=>{
 const root=await workspace(t);await pair(root);
 for(const changed of [{definitions:[{...definitions[0],status:'retired'}]},{selection:{...selection,demandSourceIds:[]}},{definitions:[{...definitions[0],url:'https://example.com/feed'}]},{definitions:[{...definitions[0],kind:'provider-discussion'}]},{definitions:[DISCUSSION_PROVIDER_CATALOG[0]],selection:{demandSourceIds:[DISCUSSION_PROVIDER_CATALOG[0].id]}}])assert.equal((await loadDiscussionDiscovery(root,options(changed))).sources.length,0);
 assert.equal((await loadDiscussionDiscovery(root,options({definitions:[{...definitions[0],status:'probation'}]}))).sources.length,1);
});

test('bounded regular files are required; symlinks and oversized JSON are rejected',async t=>{
 for(const mode of ['snapshot-link','scan-link','oversized','directory-link']){
  const root=await workspace(t),f=await pair(root);
  if(mode.endsWith('-link')&&mode!=='directory-link'){const file=mode==='snapshot-link'?f.paths.snapshot:f.paths.scan,copy=file+'.copy';await writeFile(copy,await readFile(file));await rm(file);await symlink(copy,file);}
  if(mode==='oversized')await writeFile(f.paths.snapshot,' '.repeat(DISCUSSION_DISCOVERY_POLICY.maxFileBytes+1));
  if(mode==='directory-link'){await rm(path.join(root,'data','research'),{recursive:true});await mkdir(path.join(root,'other'));await writeFile(path.join(root,'other','research-900-1.json'),JSON.stringify(f.snapshot));await symlink(path.join(root,'other'),path.join(root,'data','research'),'dir');}
  assert.equal((await loadDiscussionDiscovery(root,options())).sources.length,0,mode);
 }
});

test('carryover and total source limits remain fixed, with at most 48 recent snapshot pairs',async t=>{
 const root=await workspace(t);
 for(let group=0;group<5;group++){const createdAt=`2026-10-27T13:${String(group).padStart(2,'0')}:00.000Z`,fetchedAt=createdAt.replace(':00.000Z',':01.000Z');await pair(root,{number:1000+group,createdAt,sources:Array.from({length:20},(_,i)=>source(10000+group*20+i,{fetchedAt}))});}
 const result=await loadDiscussionDiscovery(root,options());assert.equal(result.sources.length,80);assert.equal(result.provenance.records.length,80);
 const full=Array.from({length:799},(_,i)=>({id:String(i),url:`https://example.com/${i}`}));assert.equal((await loadDiscussionDiscovery(root,options({currentSources:full}))).sources.length,800);
 const root2=await workspace(t);for(let i=1;i<=49;i++)await pair(root2,{number:2000+i,sources:[source(20000+i)]});
 const capped=await loadDiscussionDiscovery(root2,options());assert.equal(capped.provenance.records.length,48);assert.equal(capped.sources.some(s=>s.url.endsWith('=20001')),false);
});

test('saved provenance detects missing originals, tampering and malformed inventories',async t=>{
 const root=await workspace(t),f=await pair(root),result=await loadDiscussionDiscovery(root,options());
 for(const mutate of [r=>r.textSha256='b'.repeat(64),r=>r.sourceSnapshotSha256='b'.repeat(64),r=>r.sourceScanSha256='b'.repeat(64),r=>r.observedAt='2026-10-27T13:00:02.000Z',r=>r.sourceRunId='research-999-1',r=>r.feedIds=['b'.repeat(24)]]){const p=structuredClone(result.provenance);mutate(p.records[0]);assert.ok((await verifyDiscussionDiscovery(root,p,options())).length);}
 for(const p of [null,{version:2,records:[]},{version:1,records:[],extra:1},{version:1,records:[...result.provenance.records,...result.provenance.records]},{version:1,records:[{...result.provenance.records[0],sourceId:'b'.repeat(24)}]},{version:1,records:[{...result.provenance.records[0],url:'https://news.ycombinator.com/user?id=person'}]}])assert.ok(discussionDiscoveryReasons(p).length);
 await rm(f.paths.scan);assert.ok((await verifyDiscussionDiscovery(root,result.provenance,options())).length);
 assert.deepEqual(await verifyDiscussionDiscovery(root,{version:1,records:[]},options()),[]);
});

test('research keeps current scan counts exact and fetches a carried original before writer readiness',async t=>{
 const root=await workspace(t),historical=source(981);await pair(root,{number:981,sources:[historical]});
 await mkdir(path.join(root,'data','sources'));await writeFile(path.join(root,'RULES.md'),await readFile(new URL('../RULES.md',import.meta.url)));
 const registry=applySourceTransition(emptySourceRegistry(),{definition:definitions[0],toStatus:'probation',reason:'Synthetic offline source admission.',validation:validation(1,'2026-10-27T12:00:00.000Z'),howAdded:'seed',now:new Date('2026-10-27T12:00:00.000Z')});
 await writeFile(path.join(root,'data','sources','registry.json'),JSON.stringify(registry));
 const current=source(982,{fetchedAt:'2026-10-27T14:00:01.000Z'}),origins=[{sourceId:current.id,url:current.url,productUrl:current.url,feedIds:[definition.id]}],calls=[];
 const result=await researchSnapshot({root,runId:'loop-982-1',now,discussionOnly:true,researchPolicy:{mode:'repair',widened:true,fallbackEnabled:true,maxLeads:10,cooldownHours:3},env:{GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'xndanius/while-you-sleep',GITHUB_RUN_ID:'982',GITHUB_RUN_ATTEMPT:'1',SOURCE_HEAD_SHA:'a'.repeat(40)},scan:async()=>({sources:[current],originMap:origins,observations:[{feedId:definition.id,url:definition.url,status:'ok',itemCount:1,fetchedAt:current.fetchedAt,message:'One current synthetic source.',validation:validation(1,current.fetchedAt)}]}),enrich:async options=>{
  assert.equal(options.sources.length,2);assert.equal(options.sources.find(s=>s.id===historical.id).enriched,undefined);
  return enrichDiscussionLeads({...options,fetchPage:async requested=>{calls.push(requested);const row=requested.endsWith('/981')?historical:current,data=JSON.stringify({id:Number(new URL(row.url).searchParams.get('id')),title:row.title,text:row.text,created_at:row.postedAt}),origin=new URL(requested).origin;return {url:requested,text:data,status:200,bytes:Buffer.byteLength(data),contentType:'application/json',fetchedAt:'2026-10-27T14:00:02.000Z',maxBytes:2000000,truncated:false,redirects:[],robots:[{origin,evaluatedUrl:requested,robotsUrl:origin+'/robots.txt',status:404,state:'missing',allowed:true,contentType:'text/plain',fetchedAt:'2026-10-27T14:00:02.000Z'}]};}});
 }});
 assert.equal(result.receipt.sources.length,1);assert.equal(result.receipt.observations[0].itemCount,1);assert.deepEqual(result.receipt.originMap,origins);
 assert.equal(result.receipt.sourceSnapshotSha256,sha256(stableJSON([current])));
 assert.equal(result.snapshot.discoveryCarryover.records[0].sourceId,historical.id);assert.equal(result.snapshot.discoveryCarryover.records[0].observedAt,historical.fetchedAt);
 assert.ok(calls.includes('https://hn.algolia.com/api/v1/items/981'));assert.equal(result.snapshot.sources.find(s=>s.id===historical.id).enriched,true);
 assert.equal(writerReadiness(result.snapshot,{demandRequired:true,now:'2026-10-27T14:01:00.000Z'}).ready,true);
});

test('a completed carried candidate without current scan origin keeps learning unknown with null reward',async()=>{
 const runId='loop-40510493857-1',load=folder=>readFile(new URL(`../data/${folder}/${runId}.json`,import.meta.url),'utf8').then(JSON.parse);
 const [run,selected,draft,context,manifest,originalScan]=await Promise.all(['runs','learning-selection','drafts','check-context','checks','source-scans'].map(load));
 const candidate=draft.candidates[0],carried=context.sources.find(s=>s.id===candidate.demandEvidence.sourceIds[0]);
 const current=source(983,{fetchedAt:'2026-10-27T13:00:01.000Z'}),scan=createSourceScanReceipt({runId,registry:{schema:1},sources:[current],observations:[{feedId:definition.id,url:definition.url,status:'ok',itemCount:1,fetchedAt:current.fetchedAt,message:'Synthetic current source only.',validation:validation(1,current.fetchedAt)}],originMap:[{sourceId:current.id,url:current.url,productUrl:current.url,feedIds:[definition.id]}],producer:{...originalScan.producer,definitions},now:new Date(originalScan.createdAt)});
 scan.registrySha256=selected.registrySha256;
 context.discoveryCarryover={version:1,records:[{sourceId:carried.id,url:carried.url,textSha256:sha256(carried.text),observedAt:carried.fetchedAt,sourceRunId:'research-900-1',sourceSnapshotSha256:'a'.repeat(64),sourceScanSha256:'b'.repeat(64),feedIds:[carried.registrySourceId]}]};
 const contextHash=sha256(stableJSON(context));manifest.completedAssessment.contextSha256=contextHash;run.checkedAssessment.contextSha256=contextHash;
 const result=deriveLearningReceipt({run,selection:selected,scan,draft,context,manifest,expectedSelectionSha256:sha256(stableJSON(selected)),expectedScanSha256:sha256(stableJSON(scan)),expectedDraftSha256:sha256(stableJSON(draft)),expectedContextSha256:contextHash});
 assert.equal(result.outcome,'assessed');assert.equal(result.samples.length,1);assert.equal(result.samples[0].status,'unknown');assert.equal(result.samples[0].reward,null);assert.deepEqual(result.samples[0].sourceIds,[]);
 assert.match(result.samples[0].reason,/no current-scan source attribution/);
});
