import test from 'node:test';
import assert from 'node:assert/strict';
import {DEMAND_SOURCE_CATALOG,DEMAND_DISCOVERY_CATALOG,sourceRole} from '../lib/demand-sources.mjs';
import {sourceSeedCatalog} from '../lib/source-catalog.mjs';
import {DISCUSSION_SOURCE_CATALOG,isCurrentResearchSource,isJobOrTenderSource} from '../lib/discussion-sources.mjs';
import {discoverSourceProposals,sourceProposalAvailable} from '../scripts/source-registry.mjs';

const now=new Date('2026-10-19T08:00:00.000Z'),policy={weights:{ease:1,profit:1,feasibility:1,autonomy:1,evidence:1},threshold:6};
test('exhausted historical seeds and zero prior passes still produce three untried public discussion probes',async()=>{
 const registry={sources:sourceSeedCatalog.filter(source=>!isCurrentResearchSource(source)).map(source=>({...source,status:'probation'})),exclusions:[]},before=JSON.stringify(registry);
 const proposals=await discoverSourceProposals({registry,attributions:[],currentPolicy:policy,now,fetchPage:async()=>{throw new Error('Fresh fixed candidates need no speculative page fetch.');}});
 assert.equal(proposals.length,3);assert.ok(proposals.every(source=>sourceRole(source)==='demand'));assert.ok(proposals.every(source=>DISCUSSION_SOURCE_CATALOG.some(candidate=>candidate.id===source.id)));assert.ok(proposals.every(source=>!isJobOrTenderSource(source)));assert.equal(new Set(proposals.map(source=>source.id)).size,3);assert.equal(JSON.stringify(registry),before);
 assert.deepEqual(await discoverSourceProposals({registry,attributions:[],currentPolicy:policy,now,fetchPage:async()=>{throw new Error('Must stay cheap.');}}),proposals);
 assert.ok(DEMAND_DISCOVERY_CATALOG.length>=8);assert.ok(DEMAND_SOURCE_CATALOG.some(isJobOrTenderSource),'historical adapters remain available for receipt verification');
});
test('a prior failed probe can be checked again after seven days while recent failures and retired entries stay blocked',()=>{
 const source=DEMAND_DISCOVERY_CATALOG[0],registry={sources:[],exclusions:[{url:source.url,checkedAt:'2026-10-12T08:00:00.000Z'}]},before=JSON.stringify(registry);
 assert.equal(sourceProposalAvailable(source,registry,{now}),true);assert.equal(sourceProposalAvailable(source,registry,{now:new Date(now.getTime()-1)}),false);assert.equal(JSON.stringify(registry),before);
 assert.equal(sourceProposalAvailable(source,{...registry,exclusions:[...registry.exclusions,{url:source.url,checkedAt:'2026-10-18T08:00:00.000Z'}]},{now}),false);
 for(const status of ['probation','active','retired'])assert.equal(sourceProposalAvailable(source,{sources:[{...source,status}],exclusions:[]},{now}),false);
});
test('historical successful sources cannot reintroduce unvetted feeds into discussion-only discovery',async()=>{
 const source=DEMAND_SOURCE_CATALOG.find(source=>source.kind==='woocommerce-demand'),registry={sources:[{...source,status:'probation'}],exclusions:[]},calls=[];
 const proposals=await discoverSourceProposals({registry,attributions:[],currentPolicy:policy,catalog:[],demandCatalog:[],stats:{bySource:{[source.id]:{yield:{successfulScans:1}}}},now,fetchPage:async url=>{calls.push(url);return {url,text:'<link rel="alternate" type="application/rss+xml" href="/new-public-feed.xml"><link rel="alternate" type="application/rss+xml" href="https://foreign.example.org/feed.xml">'};}});
 assert.deepEqual(calls,[]);assert.deepEqual(proposals,[]);assert.equal(sourceRole(source),'demand','historical source authority remains readable');
});
