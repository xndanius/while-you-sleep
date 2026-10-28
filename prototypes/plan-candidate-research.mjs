// Explicit local replay only. This script is not invoked by any workflow.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pickResearchContinuation} from './candidate-research.mjs';
import {DISCUSSION_SOURCE_CATALOG} from '../lib/discussion-sources.mjs';
import {stableJSON,sha256} from '../lib/storage.mjs';

const [runId,at,output]=process.argv.slice(2);
if(!/^loop-[1-9]\d{0,15}-[1-9]\d{0,3}$/.test(runId||'')||!at||!Number.isFinite(Date.parse(at))||!output)throw new Error('Usage: node prototypes/plan-candidate-research.mjs loop-RUN-ATTEMPT ISO-TIME OUTPUT.json');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),bundle={};
for(const [key,dir] of Object.entries({run:'runs',draft:'drafts',context:'check-context',manifest:'checks',research:'research',scan:'source-scans',learning:'learning'}))bundle[key]=JSON.parse(await readFile(path.join(root,'data',dir,runId+'.json'),'utf8'));
const sources=bundle.context.sources.filter(row=>row.role==='demand');
const result=pickResearchContinuation(bundle,{selectionInput:{sources,originMap:sources.map(source=>({sourceId:source.id,url:source.url,productUrl:source.url,feedIds:[source.registrySourceId]})),demandDefinitions:DISCUSSION_SOURCE_CATALOG.filter(row=>bundle.research.learningSelection.demandSourceIds.includes(row.id)),learningSelection:bundle.research.learningSelection,previous:[],now:Date.parse(at),cooldownHours:bundle.research.learningSelection.researchPolicy.cooldownHours}});
const record={mode:'local_frozen_replay',evaluatedAt:at,...result,limits:'No live discovery, scheduling, model invocation, fresh evidence or publication is performed by this script.'};
const bytes=stableJSON(record)+'\n',target=path.resolve(output);
await mkdir(path.dirname(target),{recursive:true});
try{await writeFile(target,bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST'||await readFile(target,'utf8')!==bytes)throw error;}
console.log(JSON.stringify({output:target,sha256:sha256(bytes),dossierId:result.dossier?.id||null,gapId:result.dossier?.gapId||null,status:result.plan.status,requestedReferences:result.plan.referenceRequests.length}));
