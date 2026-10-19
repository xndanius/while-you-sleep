import test from 'node:test';
import assert from 'node:assert/strict';
import {DEMAND_SOURCE_CATALOG,DEMAND_DISCOVERY_CATALOG,sourceRole} from '../lib/demand-sources.mjs';
import {sourceSeedCatalog} from '../lib/source-catalog.mjs';
import {discoverSourceProposals,sourceProposalAvailable} from '../scripts/source-registry.mjs';

const now=new Date('2026-10-19T08:00:00.000Z'),policy={weights:{ease:1,profit:1,feasibility:1,autonomy:1,evidence:1},threshold:6};
test('exhausted original seeds and zero prior passes still produce three untried public demand probes',async()=>{
 const registry={sources:sourceSeedCatalog.map(source=>({...source,status:'probation'})),exclusions:[]};
 const proposals=await discoverSourceProposals({registry,attributions:[],currentPolicy:policy,now,fetchPage:async()=>{throw new Error('Fresh fixed candidates need no speculative page fetch.');}});
 assert.equal(proposals.length,3);assert.ok(proposals.every(source=>sourceRole(source)==='demand'));assert.ok(proposals.every(source=>DEMAND_DISCOVERY_CATALOG.some(candidate=>candidate.id===source.id)));assert.equal(new Set(proposals.map(source=>source.id)).size,3);
 assert.deepEqual(await discoverSourceProposals({registry,attributions:[],currentPolicy:policy,now,fetchPage:async()=>{throw new Error('Must stay cheap.');}}),proposals);
 assert.ok(DEMAND_DISCOVERY_CATALOG.length>=8);assert.ok(DEMAND_DISCOVERY_CATALOG.every(source=>!sourceSeedCatalog.some(seed=>seed.id===source.id)),'future probes are not silently admitted by operator bootstrap');
});
test('a prior failed probe can be checked again after seven days while recent failures and retired entries stay blocked',()=>{
 const source=DEMAND_DISCOVERY_CATALOG[0],registry={sources:[],exclusions:[{url:source.url,checkedAt:'2026-10-12T08:00:00.000Z'}]},before=JSON.stringify(registry);
 assert.equal(sourceProposalAvailable(source,registry,{now}),true);assert.equal(sourceProposalAvailable(source,registry,{now:new Date(now.getTime()-1)}),false);assert.equal(JSON.stringify(registry),before);
 assert.equal(sourceProposalAvailable(source,{...registry,exclusions:[...registry.exclusions,{url:source.url,checkedAt:'2026-10-18T08:00:00.000Z'}]},{now}),false);
 for(const status of ['probation','active','retired'])assert.equal(sourceProposalAvailable(source,{sources:[{...source,status}],exclusions:[]},{now}),false);
});
test('continued alternate-feed discovery uses successful demand origins but grants no unvetted demand role',async()=>{
 const source=DEMAND_SOURCE_CATALOG.find(source=>source.kind==='woocommerce-demand'),registry={sources:[{...source,status:'probation'}],exclusions:[]},calls=[];
 const proposals=await discoverSourceProposals({registry,attributions:[],currentPolicy:policy,catalog:[],demandCatalog:[],stats:{bySource:{[source.id]:{yield:{successfulScans:1}}}},now,fetchPage:async url=>{calls.push(url);return {url,text:'<link rel="alternate" type="application/rss+xml" href="/new-public-feed.xml"><link rel="alternate" type="application/rss+xml" href="https://foreign.example.org/feed.xml">'};}});
 assert.deepEqual(calls,['https://wordpress.org/']);assert.equal(proposals.length,1);assert.equal(proposals[0].url,'https://wordpress.org/new-public-feed.xml');assert.equal(proposals[0].kind,'rss');assert.equal(sourceRole(proposals[0]),'building');
});
