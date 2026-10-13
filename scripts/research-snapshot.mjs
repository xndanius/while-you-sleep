import {promises as fs} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {scanSourceDefinitions,sourceDefinitions,sourceRole} from '../lib/research.mjs';
import {ROOT,writeJSON,id,safeError,sha256,stableJSON} from '../lib/storage.mjs';
import {parseScoringPolicy} from '../lib/scoring.mjs';
import {readPublicSourceRegistry,loadSourceRegistryData,registryDefinitions,createSourceScanReceipt} from '../lib/source-registry.mjs';
import {validateCurationReceipts} from '../lib/curation.mjs';
import {trustedScheduledMetadata} from './prepare-scheduled-job.mjs';
import {enrichProductLeads} from '../lib/product-evidence.mjs';
import {candidateHistory} from '../lib/candidate-input.mjs';
import {loadLearningState,loadDemandFeedAvailability,selectLearningTargets} from '../lib/learning.mjs';
import {retainSafeBuildingScan,retainSafeBuildingEnrichment} from '../lib/research-privacy.mjs';
import {privateArtifactReasons} from '../lib/privacy.mjs';

export async function registryInput(root=ROOT,now=new Date()){
 const currentPolicy=parseScoringPolicy(await fs.readFile(path.join(root,'RULES.md'),'utf8'));
 const read=async directory=>{let files;try{files=await fs.readdir(path.join(root,'data',directory));}catch(error){if(error.code==='ENOENT')return [];throw error;}return Promise.all(files.filter(file=>file.endsWith('.json')).map(file=>fs.readFile(path.join(root,'data',directory,file),'utf8').then(JSON.parse)));};
 const [posts,curations]=await Promise.all([read('posts'),read('curations')]);
 if(validateCurationReceipts(curations,{posts}).length)throw new Error('Curation attribution input is invalid.');
 const picks=curations.filter(receipt=>receipt.outcome==='picked').map(receipt=>receipt.pick);
 return {...await loadSourceRegistryData({root,posts,picks,currentPolicy,now}),posts,picks,currentPolicy};
}
export async function researchSnapshot({root=ROOT,runId,env=process.env,scan=scanSourceDefinitions,enrich=null,learningEnabled=true,now=new Date()}={}){
 const registry=await readPublicSourceRegistry(root),input=registry.initializedAt?await registryInput(root,now):null;
 const history=enrich?await candidateHistory(root,now):{recentAssessments:[]};
 let definitions=input?registryDefinitions(registry,input.stats):sourceDefinitions.map(({id,name,url,kind})=>({id,name,url,kind})),learningSelection=null;
 if(learningEnabled&&runId.startsWith('loop-')&&env.GITHUB_ACTIONS==='true'){
  const scoreboard=await loadLearningState({root,registry,posts:input?.posts||[],now}),availability=await loadDemandFeedAvailability({root,registry,recentAssessments:history.recentAssessments,now});learningSelection=selectLearningTargets({runId,registry,scoreboard,posts:input?.posts||[],availability,now,producer:{repository:env.GITHUB_REPOSITORY,runId:env.GITHUB_RUN_ID,runAttempt:Number(env.GITHUB_RUN_ATTEMPT),workflow:'loop.yml',stage:'pre_model',headSha:env.SOURCE_HEAD_SHA||env.GITHUB_SHA}});
  const demand=(registry.sources||[]).filter(source=>learningSelection.demandSourceIds.includes(source.id)).map(({id,name,url,kind})=>({id,name,url,kind}));definitions=[...demand,...definitions.filter(source=>sourceRole(source)==='building').slice(0,20-demand.length)];
  await writeJSON(path.join(root,'data','learning-selection',runId+'.json'),learningSelection,{immutable:true});
  // Preserve the search decision even if the subsequent guarded scan fails.
  if(env.GITHUB_OUTPUT)await fs.appendFile(env.GITHUB_OUTPUT,`learning_selection_sha256=${sha256(stableJSON(learningSelection))}\nsource_scan_head_sha=${learningSelection.producer.headSha}\n`);
 }
 const result=retainSafeBuildingScan(await scan(definitions),definitions),originalSources=result.sources,health=result.observations;
 if(privateArtifactReasons(result).length)throw new Error('Strict privacy guard refused research scan evidence before storage.');
 let receipt=null;
 // Local tests never mint hosted provenance. Upload this exact file before Codex.
 if(env.GITHUB_ACTIONS==='true'){
  receipt=createSourceScanReceipt({runId,registry,...result,now,producer:{definitions,repository:env.GITHUB_REPOSITORY,runId:env.GITHUB_RUN_ID,runAttempt:Number(env.GITHUB_RUN_ATTEMPT),workflow:runId.startsWith('loop-')?'loop.yml':'research.yml',stage:runId.startsWith('loop-')?'pre_model':'research',headSha:env.SOURCE_HEAD_SHA||env.GITHUB_SHA}});
  if(privateArtifactReasons(receipt).length)throw new Error('Strict privacy guard refused the source scan receipt before storage.');
  await writeJSON(path.join(root,'data','source-scans',runId+'.json'),receipt,{immutable:true});
 }
 // The feed receipt fingerprints exactly the original scan. Added documentation
 // never changes its feed item counts, original IDs, URLs or attribution tuples.
 const enriched=enrich?await enrich({sources:originalSources,originMap:result.originMap,previous:input?.posts||[],recentAssessments:history.recentAssessments,...(learningSelection?{learningSelection,demandDefinitions:definitions}: {}),now:()=>Date.now()}):{sources:originalSources,enrichment:{schema:1,status:'not_requested',selected:0,attempted:0,fetched:0,failed:0,observations:[]}};
 const retained=retainSafeBuildingEnrichment(enriched.sources,result,definitions),sources=retained.sources,scheduling=trustedScheduledMetadata('research',runId.startsWith('research-')?env:{GITHUB_EVENT_NAME:env.GITHUB_EVENT_NAME});
 const enrichmentFailed=enrich&&enriched.enrichment.status==='failed';
 const snapshot={id:runId,runId,createdAt:new Date(now).toISOString(),sources,health,enrichment:enriched.enrichment,...(result.privacyOmissions?{privacyOmissions:result.privacyOmissions}: {}),...(retained.privacyOmissions?{enrichmentPrivacyOmissions:retained.privacyOmissions}: {}),...(learningSelection?{learningSelection}: {}),...scheduling,scheduleStatus:originalSources.length>=3&&sources.length>=3&&!enrichmentFailed?'completed':'failed',githubRunUrl:env.GITHUB_SERVER_URL&&env.GITHUB_REPOSITORY&&env.GITHUB_RUN_ID?`${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`:null};
 if(privateArtifactReasons(snapshot).length)throw new Error('Strict privacy guard refused research evidence before storage.');
 await writeJSON(path.join(root,'data','research',runId+'.json'),snapshot,{immutable:true});
 return {snapshot,receipt,learningSelection,learning_selection_sha256:learningSelection?sha256(stableJSON(learningSelection)):'',source_scan_sha256:receipt?sha256(stableJSON(receipt)):'',source_scan_head_sha:receipt?.producer.headSha||''};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const runId=process.argv[2]||id('loop'),result=await researchSnapshot({runId,enrich:runId.startsWith('loop-')?enrichProductLeads:null});if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,`source_scan_sha256=${result.source_scan_sha256}\nsource_scan_head_sha=${result.source_scan_head_sha}\nlearning_selection_sha256=${result.learning_selection_sha256}\n`);console.log(JSON.stringify({runId,path:`data/research/${runId}.json`,sources:result.snapshot.sources.length,failedFeeds:result.snapshot.health.filter(record=>record.status==='failed').length,enrichment:{status:result.snapshot.enrichment.status,selected:result.snapshot.enrichment.selected,attempted:result.snapshot.enrichment.attempted,fetched:result.snapshot.enrichment.fetched,failed:result.snapshot.enrichment.failed}}));if(result.snapshot.scheduleStatus==='failed')process.exitCode=1;}catch(error){console.error(safeError(error));process.exitCode=1;}
}
