import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {hash,sha256,stableJSON,writeJSON} from '../lib/storage.mjs';
import {DEMAND_SOURCE_CATALOG} from '../lib/demand-sources.mjs';
import {retainSafeBuildingScan,retainSafeBuildingEnrichment} from '../lib/research-privacy.mjs';
import {privateArtifactReasons} from '../lib/privacy.mjs';
import {emptySourceRegistry,applySourceTransition,createSourceScanReceipt,validateSourceScanReceipt} from '../lib/source-registry.mjs';
import {researchSnapshot} from '../scripts/research-snapshot.mjs';
import {guardPrivateArtifacts} from '../scripts/guard-private-artifacts.mjs';
import {selectProductLeads,PRODUCT_EVIDENCE_POLICY} from '../lib/product-evidence.mjs';

const now='2026-10-12T12:00:00.000Z',rules=await fs.readFile(new URL('../RULES.md',import.meta.url),'utf8');
const building={id:hash('https://feeds.example.org/building'),name:'Public building references',url:'https://feeds.example.org/building',kind:'rss'};
const known=DEMAND_SOURCE_CATALOG.find(row=>row.kind==='jobtech-demand'&&row.segments.includes('professional_services'));
const demand={id:hash(known.url),name:known.name,url:known.url,kind:known.kind};
const definitions=[demand,building];
function validation(url,itemCount){return {publicHttps:true,robotsAllowed:true,readable:true,robots:[{origin:new URL(url).origin,evaluatedUrl:url,robotsUrl:new URL('/robots.txt',url).toString(),status:404,state:'missing',allowed:true,contentType:'text/plain',fetchedAt:now,redirects:[]}],redirects:[],httpStatus:200,contentType:'application/json',resolvedUrl:url,fetchedAt:now,maxBytes:2000000,truncated:false,parserVersion:'public-sources-v1',itemCount};}
function record(url,text,extras={}){return {id:hash(url),url,title:'Public evidence',publisher:'Public source',text,fetchedAt:now,...extras};}
function fixture(){
 const safeBuilding=record('https://tools.example.org/records','Exact building quote: extract structured office records and route a draft for human review.',{originFeedIds:[building.id]});
 const unsafeBuilding=record('https://tools.example.org/unused','Unused newsletter text names @fictionalhandle in a profile attribution.',{originFeedIds:[building.id]});
 const demandItems=[1,2].map(index=>record(`https://jobsearch.api.jobtechdev.se/ad/${index}`,'You will catalogue office records and maintain the administration register.',{role:'demand',demand:true,segment:'professional_services',registrySourceId:demand.id,originFeedIds:[demand.id]}));
 const sources=[...demandItems,safeBuilding,unsafeBuilding],originMap=sources.map(source=>({sourceId:source.id,url:source.url,productUrl:null,feedIds:source.originFeedIds}));
 const observations=definitions.map(definition=>({feedId:definition.id,url:definition.url,status:'ok',itemCount:2,fetchedAt:now,message:'Guarded public parse passed.',validation:validation(definition.url,2)}));
 let registry=emptySourceRegistry();for(const definition of definitions)registry=applySourceTransition(registry,{definition,toStatus:'probation',reason:'Guarded admission passed.',validation:validation(definition.url,2),howAdded:'seed',now});
 return {sources,originMap,observations,registry,safeBuilding,unsafeBuilding,demandItems};
}
const scanOnly=f=>({sources:f.sources,originMap:f.originMap,observations:f.observations});
function receipt(f,result=retainSafeBuildingScan(scanOnly(f),definitions)){return createSourceScanReceipt({runId:'loop-501-1',registry:f.registry,...result,now,producer:{definitions,repository:'xndanius/while-you-sleep',runId:'501',runAttempt:1,workflow:'loop.yml',stage:'pre_model',headSha:'a'.repeat(40)}});}

test('whole unsafe unused building rows are omitted while exact demand and safe quotes remain unchanged',()=>{
 const f=fixture(),before=stableJSON(f),retained=retainSafeBuildingScan(scanOnly(f),definitions);
 assert.equal(stableJSON(f),before);assert.equal(retained.sources.length,3);assert.deepEqual(retained.sources,[...f.demandItems,f.safeBuilding]);assert.equal(retained.sources[2],f.safeBuilding);assert.equal(retained.sources[0],f.demandItems[0]);assert.deepEqual(privateArtifactReasons(retained),[]);
 assert.deepEqual(retained.privacyOmissions.byFeed,[{feedId:building.id,fetchedItemCount:2,retainedItemCount:1,omittedItemCount:1,categories:[{category:'username_pattern',count:1}]}]);
 assert.equal(retained.privacyOmissions.fetchedItemCount,4);assert.equal(retained.privacyOmissions.retainedItemCount,3);assert.equal(retained.privacyOmissions.omittedItemCount,1);assert.ok(!stableJSON(retained).includes('fictionalhandle'));assert.ok(!stableJSON(retained).includes(f.unsafeBuilding.url));assert.equal(retainSafeBuildingScan(retained,definitions),retained);
 const selected=selectProductLeads(retained.sources,{originMap:retained.originMap,learningSelection:{selectedSegment:'professional_services',demandSourceIds:[demand.id]},demandDefinitions:definitions});assert.equal(selected.length,2);assert.ok(selected.every(row=>row.demandDefinition.id===demand.id));assert.equal(PRODUCT_EVIDENCE_POLICY.maxLeads,12);
});

test('privacy omission receipt seals retained evidence while preserving actual parsed counts and rejects counter tampering',()=>{
 const f=fixture(),retained=retainSafeBuildingScan(scanOnly(f),definitions),scan=receipt(f,retained);assert.deepEqual(validateSourceScanReceipt(scan),[]);assert.equal(scan.sourceSnapshotSha256,sha256(stableJSON(retained.sources)));assert.equal(scan.sources.length,3);assert.equal(scan.observations[1].itemCount,2);assert.equal(scan.observations[1].validation.itemCount,2);assert.equal(scan.observations[1].retainedItemCount,1);assert.equal(scan.originMap.length,3);
 for(const mutate of [row=>row.privacyOmissions.omittedItemCount=0,row=>row.observations[1].retainedItemCount=2,row=>row.privacyOmissions.byFeed[0].feedId=demand.id,row=>row.privacyOmissions.byFeed[0].categories[0].category='unknown',row=>row.privacyOmissions.byFeed[0].title='Forbidden extra metadata',row=>delete row.privacyOmissions]){const bad=structuredClone(scan);mutate(bad);assert.ok(validateSourceScanReceipt(bad).length);}
});

test('unsafe demand and unknown-origin records are never silently omitted as building references',()=>{
 const f=fixture();f.demandItems[0].text+=' Contact @fictionalhandle.';const retained=retainSafeBuildingScan(scanOnly(f),definitions);assert.ok(retained.sources.includes(f.demandItems[0]));assert.ok(privateArtifactReasons(retained).length);
 const unknown=record('https://unknown.example.org/page','Contact @fictionalhandle.');const unbound=retainSafeBuildingScan({...f,sources:[unknown],originMap:[]},definitions);assert.equal(unbound.sources[0],unknown);assert.ok(privateArtifactReasons(unbound).length);
});

test('loop and standalone snapshots store only safe complete rows and pass the same pre-model privacy guard',async t=>{
 for(const kind of ['loop','research']){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'wys-retained-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const f=fixture();await fs.writeFile(path.join(root,'RULES.md'),rules);await writeJSON(path.join(root,'data','sources','registry.json'),f.registry);
  const runId=`${kind}-501-1`,env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'xndanius/while-you-sleep',GITHUB_RUN_ID:'501',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'a'.repeat(40)};
  const result=await researchSnapshot({root,runId,now,env,learningEnabled:false,scan:async()=>scanOnly(f)});assert.equal(result.snapshot.scheduleStatus,'completed');assert.deepEqual(result.snapshot.sources,[...f.demandItems,f.safeBuilding]);assert.deepEqual(validateSourceScanReceipt(result.receipt),[]);assert.equal(result.receipt.sourceSnapshotSha256,sha256(stableJSON(result.snapshot.sources)));assert.equal(result.source_scan_sha256,sha256(stableJSON(result.receipt)));assert.equal((await guardPrivateArtifacts({root,runId,phase:'scan',env:{}})).safe,true);
  for(const directory of ['research','source-scans']){const text=await fs.readFile(path.join(root,'data',directory,runId+'.json'),'utf8');assert.ok(!text.includes('fictionalhandle'));assert.ok(!text.includes(f.unsafeBuilding.url));}
 }
});

test('unsafe fresh building evidence is wholly discarded, while unsafe demand fails before snapshot or scan storage',async t=>{
 const f=fixture(),scan=retainSafeBuildingScan(scanOnly(f),definitions),unsafe=record('https://docs.example.org/new','Read this building document from @fictionalhandle.',{originSourceIds:[f.safeBuilding.id],enriched:true});
 const filtered=retainSafeBuildingEnrichment([...scan.sources,unsafe],scan,definitions);assert.deepEqual(filtered.sources,scan.sources);assert.equal(filtered.privacyOmissions.uniqueOmittedRecords,1);assert.ok(!stableJSON(filtered).includes(unsafe.url));assert.deepEqual(privateArtifactReasons(filtered),[]);
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'wys-strict-demand-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'RULES.md'),rules);await writeJSON(path.join(root,'data','sources','registry.json'),f.registry);f.demandItems[0].text+=' Contact @fictionalhandle.';
 await assert.rejects(researchSnapshot({root,runId:'loop-501-1',now,learningEnabled:false,scan:async()=>scanOnly(f),env:{GITHUB_ACTIONS:'true'}}),/Strict privacy guard refused research scan evidence before storage/);
 for(const directory of ['research','source-scans'])await assert.rejects(fs.access(path.join(root,'data',directory,'loop-501-1.json')),/ENOENT/);
});
