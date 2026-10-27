import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {recentProductAssessments,selectProductLeads} from '../lib/product-evidence.mjs';
import {candidateHistory} from '../lib/candidate-input.mjs';
import {DISCUSSION_SOURCE_CATALOG,demandEvidenceFingerprint,unchangedDemandEvidence} from '../lib/demand-sources.mjs';
import {sha256,stableJSON} from '../lib/storage.mjs';

const priorId='loop-40502878381-1',currentId='loop-40510493857-1',sourceId='b00708562d0e2aeefbf5e0c1';
const read=async(directory,id)=>JSON.parse(await fs.readFile(new URL(`../data/${directory}/${id}.json`,import.meta.url),'utf8'));
async function fixture(){
 const [run,draft,research,context,scan,learning,check,current,discovery]=await Promise.all([read('runs',priorId),read('drafts',priorId),read('research',priorId),read('check-context',priorId),read('source-scans',priorId),read('learning',priorId),read('checks',priorId),read('research',currentId),read('research','research-40505534209-1')]);
 const source=discovery.sources.find(item=>item.id===sourceId),origin=discovery.enrichment?.originMap||scan.originMap;
 const options={originMap:origin,learningSelection:current.learningSelection,demandDefinitions:DISCUSSION_SOURCE_CATALOG,now:current.createdAt,cooldownHours:3};
 return {history:{runs:[run],drafts:[draft],research:[research],contexts:[context],scans:[scan],learning:[learning],checks:[check],now:current.createdAt},source,options};
}

test('unchanged RSS and primary representations do not reopen the actual assessed n8n discussion',async()=>{
 const {history,source,options}=await fixture(),before=stableJSON(history),recent=recentProductAssessments(history),prior=recent.find(item=>item.productUrl===source.url);
 assert.ok(prior);assert.notEqual(prior.demandEvidenceSha256,demandEvidenceFingerprint(source));
 assert.equal(prior.discoveryEvidenceSha256,demandEvidenceFingerprint(source));
 assert.equal(selectProductLeads([source],{...options,recentAssessments:recent}).length,0);
 assert.equal(stableJSON(history),before,'Historical scan, learning and checked records remain unchanged.');
 const changed={...source,text:source.text+' A new request also asks to archive matching messages each day.'};changed.taskExcerpts=[changed.text];
 assert.equal(selectProductLeads([changed],{...options,recentAssessments:recent}).length,1,'An actual changed discovery excerpt retains the existing reopening rule.');
 const expires=new Date(Date.parse(prior.assessedAt)+3*3600000).toISOString();
 assert.equal(selectProductLeads([source],{...options,recentAssessments:recent,now:expires}).length,1,'The unchanged three-hour boundary still expires normally.');
});

test('historical discovery hashes require the matching independently bound scan and selection',async()=>{
 const {history,source}=await fixture();
 const forSource=h=>recentProductAssessments(h).find(item=>item.productUrl===source.url);
 assert.ok(forSource(history).discoveryEvidenceSha256);
 for(const change of [h=>h.scans=[],h=>h.learning=[],h=>h.checks=[],h=>h.learning[0].schema=999,h=>h.learning[0].runSha256='0'.repeat(64),h=>h.learning[0].checksSha256=null,h=>h.learning[0].scanSha256='0'.repeat(64),h=>delete h.learning[0].scanSha256,h=>h.learning[0].selectionSha256='0'.repeat(64),h=>h.learning[0].contextSha256='0'.repeat(64),h=>h.scans[0].sources.find(s=>s.id===sourceId).textSha256='0'.repeat(64)]){
  const changed=structuredClone(history);change(changed);assert.equal(forSource(changed)?.discoveryEvidenceSha256,undefined,change.toString());
 }
 const foreign=structuredClone(history);foreign.scans[0].producer.headSha='b'.repeat(40);foreign.learning[0].scanSha256=sha256(stableJSON(foreign.scans[0]));
 assert.equal(forSource(foreign)?.discoveryEvidenceSha256,undefined);
 const wrongRegistry=structuredClone(history);wrongRegistry.scans[0].registrySha256='0'.repeat(64);wrongRegistry.learning[0].scanSha256=sha256(stableJSON(wrongRegistry.scans[0]));
 assert.equal(forSource(wrongRegistry)?.discoveryEvidenceSha256,undefined);
 assert.equal(unchangedDemandEvidence({demandEvidenceSha256:'a'.repeat(64),discoveryEvidenceSha256:'not-a-hash'},'not-a-hash'),false);
 assert.equal(unchangedDemandEvidence({},'a'.repeat(64)),true,'Legacy missing evidence cannot assert a change.');
});

test('candidate history loads the existing frozen discovery receipt without retaining its text again',async t=>{
 const {history,source}=await fixture(),root=await fs.mkdtemp(path.join(os.tmpdir(),'wys-discovery-history-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const [directory,records] of Object.entries({runs:history.runs,drafts:history.drafts,research:history.research,'check-context':history.contexts,'source-scans':history.scans,learning:history.learning,checks:history.checks})){
  await fs.mkdir(path.join(root,'data',directory),{recursive:true});await fs.writeFile(path.join(root,'data',directory,priorId+'.json'),JSON.stringify(records[0]));
 }
 const result=await candidateHistory(root,history.now),prior=result.recentAssessments.find(item=>item.productUrl===source.url);
 assert.equal(prior.discoveryEvidenceSha256,demandEvidenceFingerprint(source));
 assert.equal(Object.hasOwn(prior,'text'),false);assert.equal(Object.hasOwn(prior,'feedExcerpt'),false);
});
