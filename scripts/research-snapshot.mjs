import {promises as fs} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {scanSourceDefinitions,sourceDefinitions,sourceRole} from '../lib/research.mjs';
import {ROOT,writeJSON,id,safeError,sha256,stableJSON} from '../lib/storage.mjs';
import {parseScoringPolicy} from '../lib/scoring.mjs';
import {readPublicSourceRegistry,loadSourceRegistryData,registryDefinitions,createSourceScanReceipt} from '../lib/source-registry.mjs';
import {validateCurationReceipts} from '../lib/curation.mjs';
import {trustedScheduledMetadata} from './prepare-scheduled-job.mjs';
import {enrichProductLeads,enrichBuilderFallback,enrichMixedRecoveryBatch,enrichDiscussionLeads} from '../lib/product-evidence.mjs';
import {candidateHistory} from '../lib/candidate-input.mjs';
import {loadLearningState,loadDemandFeedAvailability,selectLearningTargets,validResearchPolicy} from '../lib/learning.mjs';
import {retainSafeBuildingScan,retainSafeBuildingEnrichment} from '../lib/research-privacy.mjs';
import {privateArtifactReasons} from '../lib/privacy.mjs';
import {createNoFreshLeadsReceipt} from '../lib/no-fresh-leads.mjs';
import {loadSocialDemandArtifact} from '../lib/social-demand.mjs';
import {loadApifyPool,validateApifyPoolProof} from '../lib/apify-sources.mjs';
import {readProviderEvidence} from '../lib/provider-evidence.mjs';
import {discussionSourceDefinition,makeDiscussionSource,createProviderSourceValidation} from '../lib/discussion-sources.mjs';
import {CANDIDATE_PLAN_VERSION} from '../lib/candidate-plan.mjs';
import {loadDiscussionDiscovery} from '../lib/discussion-discovery.mjs';
import {readBoundedJSON} from '../lib/source-registry.mjs';
import {verifyContinuationIntent,startContinuation} from '../lib/research-continuation.mjs';

// Provider pools have their own immutable control proof. They never pass through
// our HTTP fetcher and never impersonate a robots-allowed public response.
export async function scanWithProviderPools({root,definitions,scan=scanSourceDefinitions,env={},now=new Date(),poolLoader=loadApifyPool,proofValidator=validateApifyPoolProof}={}){
 const providerDefinitions=definitions.filter(source=>discussionSourceDefinition(source)?.kind==='provider-discussion'),publicDefinitions=definitions.filter(source=>!providerDefinitions.includes(source));
 const result=await scan(publicDefinitions);if(!providerDefinitions.length)return result;
 const platforms=providerDefinitions.map(source=>discussionSourceDefinition(source).platform),pool=await poolLoader(root,{now,platforms,maxAgeHours:8});
 for(const definition of providerDefinitions){
  const known=discussionSourceDefinition(definition),entries=[];
  for(const entry of pool.filter(entry=>entry.platform===known.platform).slice(0,20)){
   if(!await proofValidator(root,entry.proof,{definitionId:known.id,postUrl:entry.post.url,now,maxAgeHours:8}))continue;
   const source=makeDiscussionSource(known,entry.post,{fetchedAt:entry.capturedAt});if(!source)continue;
   source.providerEvidence={...entry.proof,capturedAt:entry.capturedAt};entries.push({source,post:entry.post,proof:entry.proof});
  }
  if(entries.length){const validation=createProviderSourceValidation(known,entries,{fetchedAt:new Date(now).toISOString()});result.sources.push(...entries.map(entry=>entry.source));result.originMap.push(...entries.map(({source})=>({sourceId:source.id,url:source.url,productUrl:source.url,feedIds:[known.id]})));result.observations.push({feedId:known.id,url:known.url,status:'ok',itemCount:entries.length,fetchedAt:new Date(now).toISOString(),message:'Sanitized public discussion pool verified against immutable provider receipts. Capture times remain explicit.',validation});}
  else result.observations.push({feedId:known.id,url:known.url,status:'failed',itemCount:0,fetchedAt:new Date(now).toISOString(),code:'provider_pool_unavailable',message:'No current verified provider pool is available; no public fetch, primary evidence or approval was invented.'});
 }
 return result;
}

export function recoveryBuildingDefinitions(registry,limit,ranked=registryDefinitions(registry)){
 const useful=source=>['active','probation'].includes(source.status)&&sourceRole(source)==='building',primary=registry.sources.filter(source=>useful(source)&&source.kind==='n8n-workflows'&&/invoice|document/i.test(source.name+' '+source.url)),remaining=ranked.filter(source=>sourceRole(source)==='building'),seen=new Set();
 return [...primary,...remaining].filter(source=>{if(seen.has(source.id))return false;seen.add(source.id);return true;}).slice(0,Math.max(0,Math.min(20,limit))).map(({id,name,url,kind})=>({id,name,url,kind}));
}

export async function registryInput(root=ROOT,now=new Date()){
 const currentPolicy=parseScoringPolicy(await fs.readFile(path.join(root,'RULES.md'),'utf8'));
 const read=async directory=>{let files;try{files=await fs.readdir(path.join(root,'data',directory));}catch(error){if(error.code==='ENOENT')return [];throw error;}return Promise.all(files.filter(file=>file.endsWith('.json')).map(file=>fs.readFile(path.join(root,'data',directory,file),'utf8').then(JSON.parse)));};
 const [posts,curations]=await Promise.all([read('posts'),read('curations')]);
 if(validateCurationReceipts(curations,{posts}).length)throw new Error('Curation attribution input is invalid.');
 const picks=curations.filter(receipt=>receipt.outcome==='picked').map(receipt=>receipt.pick);
 return {...await loadSourceRegistryData({root,posts,picks,currentPolicy,now}),posts,picks,currentPolicy};
}
export async function researchSnapshot({root=ROOT,runId,env=process.env,scan=scanSourceDefinitions,enrich=null,learningEnabled=true,researchPolicy=null,discussionOnly=env.DISCUSSION_ONLY==='true',providerFetch=null,now=new Date()}={}){
 const registry=await readPublicSourceRegistry(root),input=registry.initializedAt?await registryInput(root,now):null;
 let socialDiscovery=null;
 if(env.SOCIAL_DEMAND_PATH||env.EXPECTED_SOCIAL_DEMAND_SHA){
  const expectedProducer={repository:env.GITHUB_REPOSITORY,runId:env.GITHUB_RUN_ID,runAttempt:Number(env.GITHUB_RUN_ATTEMPT),workflow:runId.startsWith('loop-')?'loop.yml':'research.yml',job:'social_research',stage:'trusted_api_retrieval',headSha:env.EXPECTED_SOCIAL_DEMAND_HEAD_SHA};
  const file=path.resolve(root,env.SOCIAL_DEMAND_PATH||''),relative=path.relative(root,file);if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Official social discovery must be inside the trusted artifact workspace.');
  const social=await loadSocialDemandArtifact({file,runId,phase:'research',expectedSha256:env.EXPECTED_SOCIAL_DEMAND_SHA,expectedProducer});
  socialDiscovery={schema:1,primaryEvidence:false,artifactSha256:env.EXPECTED_SOCIAL_DEMAND_SHA,producer:social.producer,health:social.health,hints:social.sources.slice(0,20).map(source=>({id:source.id,url:source.url,title:source.title,text:source.text,segment:source.segment||null,publicEvidenceUrls:source.publicEvidenceUrls||[],evidenceAuthority:source.evidenceAuthority})),reason:'Officially retrieved discovery hints only. Publication still requires separately fetched vetted public demand evidence; these hints cannot serve as primary factual quotes or earn source credit.'};
 }
 const history=enrich?await candidateHistory(root,now):{recentAssessments:[]};
 let definitions=input?registryDefinitions(registry,input.stats,{discussionOnly}):sourceDefinitions.map(({id,name,url,kind})=>({id,name,url,kind})),learningSelection=null;
 if(learningEnabled&&runId.startsWith('loop-')&&env.GITHUB_ACTIONS==='true'){
  if(!researchPolicy){const {loadWatchdogHealth}=await import('../lib/watchdog.mjs');researchPolicy=(await loadWatchdogHealth({root,now})).researchPolicy;}
  if(!validResearchPolicy(researchPolicy))throw new Error('Trusted watchdog research policy is invalid.');
  const recentAssessments=history.recentAssessments.filter(item=>Date.parse(item.assessedAt)>new Date(now).getTime()-researchPolicy.cooldownHours*3600000);
  const scoreboard=await loadLearningState({root,registry,posts:input?.posts||[],now}),availability=researchPolicy.fallbackEnabled?null:await loadDemandFeedAvailability({root,registry,recentAssessments,now});learningSelection=selectLearningTargets({runId,registry,scoreboard,posts:input?.posts||[],availability,researchPolicy,discussionOnly,now,producer:{repository:env.GITHUB_REPOSITORY,runId:env.GITHUB_RUN_ID,runAttempt:Number(env.GITHUB_RUN_ATTEMPT),workflow:'loop.yml',stage:'pre_model',headSha:env.SOURCE_HEAD_SHA||env.GITHUB_SHA}});
  const demand=(registry.sources||[]).filter(source=>learningSelection.demandSourceIds.includes(source.id)).map(({id,name,url,kind})=>({id,name,url,kind}));definitions=[...demand,...(learningSelection.selectionStrategy==='mixed-recovery-v1'?recoveryBuildingDefinitions(registry,20-demand.length,definitions):definitions.filter(source=>sourceRole(source)==='building').slice(0,20-demand.length))];
  await writeJSON(path.join(root,'data','learning-selection',runId+'.json'),learningSelection,{immutable:true});
  // Preserve the search decision even if the subsequent guarded scan fails.
  if(env.GITHUB_OUTPUT)await fs.appendFile(env.GITHUB_OUTPUT,`learning_selection_sha256=${sha256(stableJSON(learningSelection))}\nsource_scan_head_sha=${learningSelection.producer.headSha}\n`);
 }
 const result=retainSafeBuildingScan(await scanWithProviderPools({root,definitions,scan,env,now}),definitions),originalSources=result.sources,health=result.observations;
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
 const providerReader=providerFetch||(source=>readProviderEvidence(root,source,{now:new Date(now)}));
 const enrichRunner=enrich===enrichProductLeads?(learningSelection?.selectionStrategy==='discussion-first-v1'?enrichDiscussionLeads:learningSelection?.selectionStrategy==='mixed-recovery-v1'?enrichMixedRecoveryBatch:enrich):enrich;
 const discovery=enrichRunner&&learningSelection?.selectionStrategy==='discussion-first-v1'?await loadDiscussionDiscovery(root,{currentSources:originalSources,currentOriginMap:result.originMap,definitions,selection:learningSelection,now}):{sources:originalSources,originMap:result.originMap,provenance:null};
 const selectionInput={sources:discovery.sources,originMap:discovery.originMap,previous:input?.posts||[],recentAssessments:history.recentAssessments,...(learningSelection?{learningSelection,demandDefinitions:definitions}: {}),...(researchPolicy?{limit:researchPolicy.maxLeads,cooldownHours:researchPolicy.cooldownHours}:{}),now:()=>new Date(now).getTime()};
 let continuation=null;
 if(env.EXPECTED_RESEARCH_INTENT_SHA&&learningSelection?.selectionStrategy==='discussion-first-v1'){
  const intent=await readBoundedJSON(path.join(root,'data/research-intents',runId+'.json'));
  await verifyContinuationIntent(root,intent,{runId,expectedSha256:env.EXPECTED_RESEARCH_INTENT_SHA,headSha:env.SOURCE_HEAD_SHA||env.GITHUB_SHA});
  continuation=await startContinuation({root,intent,scan:receipt,selection:learningSelection,selectionInput});
 }
 let enriched=enrichRunner?await enrichRunner({...selectionInput,...(providerReader?{providerFetch:providerReader}:{}),...(continuation?{priorityProductUrl:continuation.priorityProductUrl,onLeadEvent:continuation.onLeadEvent,onReferenceEvent:continuation.onReferenceEvent,referencePriority:continuation.referencePriority}:{})}):{sources:originalSources,enrichment:{schema:1,status:'not_requested',selected:0,attempted:0,fetched:0,failed:0,observations:[]}};
 if(enrich===enrichProductLeads&&!['mixed-recovery-v1','discussion-first-v1'].includes(learningSelection?.selectionStrategy)&&researchPolicy?.fallbackEnabled&&enriched.enrichment.status==='no_new_leads')enriched=await enrichBuilderFallback({initial:enriched,sources:originalSources,originMap:result.originMap,previous:input?.posts||[],recentAssessments:history.recentAssessments,learningSelection,demandDefinitions:definitions,now:()=>new Date(now).getTime(),limit:researchPolicy.maxLeads,cooldownHours:researchPolicy.cooldownHours});
 const retained=retainSafeBuildingEnrichment(enriched.sources,result,definitions),sources=retained.sources,scheduling=trustedScheduledMetadata('research',runId.startsWith('research-')?env:{GITHUB_EVENT_NAME:env.GITHUB_EVENT_NAME});
 if(enriched.enrichment.recoveryBatch)enriched.enrichment.recoveryBatch.leadAssignments=enriched.enrichment.recoveryBatch.leadAssignments.filter(item=>sources.some(source=>source.id===item.demandSourceId&&source.role==='demand'&&source.enriched===true)&&sources.some(source=>source.enriched===true&&[source.productUrl,source.url].includes(item.productUrl)));
 if(enriched.enrichment.discussionBatch)enriched.enrichment.discussionBatch.leadAssignments=enriched.enrichment.discussionBatch.leadAssignments.filter(item=>sources.some(source=>source.id===item.demandSourceId&&source.role==='demand'&&source.discussionMetadataVersion===1&&source.enriched===true&&source.url===item.productUrl));
 const enrichmentFailed=enrich&&enriched.enrichment.status==='failed';
 const candidatePlanContract=learningSelection?.selectionStrategy==='discussion-first-v1'?{candidatePlanVersion:CANDIDATE_PLAN_VERSION}:{};
 const snapshot={id:runId,runId,createdAt:new Date(now).toISOString(),sources,health,enrichment:enriched.enrichment,...candidatePlanContract,...(discovery.provenance?.records.length?{discoveryCarryover:discovery.provenance}:{}),...(result.privacyOmissions?{privacyOmissions:result.privacyOmissions}: {}),...(retained.privacyOmissions?{enrichmentPrivacyOmissions:retained.privacyOmissions}: {}),...(learningSelection?{learningSelection}: {}),...(researchPolicy?{researchPolicy}:{}),...(socialDiscovery?{socialDiscovery}:{}),...scheduling,scheduleStatus:(learningSelection?.selectionStrategy==='discussion-first-v1'?sources.some(source=>source.enriched===true&&source.discussionMetadataVersion===1):originalSources.length>=3&&sources.length>=3)&&!enrichmentFailed?'completed':'failed',githubRunUrl:env.GITHUB_SERVER_URL&&env.GITHUB_REPOSITORY&&env.GITHUB_RUN_ID?`${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`:null};
 if(privateArtifactReasons(snapshot).length)throw new Error('Strict privacy guard refused research evidence before storage.');
 await writeJSON(path.join(root,'data','research',runId+'.json'),snapshot,{immutable:true});
 const noFreshLeads=receipt&&learningSelection&&env.LOOP_SCHEDULING_SHA?createNoFreshLeadsReceipt({runId,schedulingSha256:env.LOOP_SCHEDULING_SHA,scan:receipt,selection:learningSelection,snapshot,now}):null;
 if(noFreshLeads)await writeJSON(path.join(root,'data/no-fresh-leads',runId+'.json'),noFreshLeads,{immutable:true});
 return {snapshot,receipt,learningSelection,noFreshLeads,no_fresh_leads_sha256:noFreshLeads?sha256(stableJSON(noFreshLeads)):'',research_sha256:sha256(stableJSON(snapshot)),learning_selection_sha256:learningSelection?sha256(stableJSON(learningSelection)):'',source_scan_sha256:receipt?sha256(stableJSON(receipt)):'',source_scan_head_sha:receipt?.producer.headSha||''};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const runId=process.argv[2]||id('loop'),result=await researchSnapshot({runId,enrich:runId.startsWith('loop-')?enrichProductLeads:null});if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,`source_scan_sha256=${result.source_scan_sha256}\nsource_scan_head_sha=${result.source_scan_head_sha}\nlearning_selection_sha256=${result.learning_selection_sha256}\nresearch_sha256=${result.research_sha256}\nno_fresh_leads_sha256=${result.no_fresh_leads_sha256}\n`);console.log(JSON.stringify({runId,path:`data/research/${runId}.json`,sources:result.snapshot.sources.length,failedFeeds:result.snapshot.health.filter(record=>record.status==='failed').length,enrichment:{status:result.snapshot.enrichment.status,selected:result.snapshot.enrichment.selected,attempted:result.snapshot.enrichment.attempted,fetched:result.snapshot.enrichment.fetched,failed:result.snapshot.enrichment.failed}}));if(result.snapshot.scheduleStatus==='failed'&&!result.noFreshLeads)process.exitCode=1;}catch(error){console.error(safeError(error));process.exitCode=1;}
}
