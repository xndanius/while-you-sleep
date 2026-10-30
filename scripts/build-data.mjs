import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ROOT, records, readJSON, writeJSON, safeError,hash } from '../lib/storage.mjs';
import { INITIAL_RULES, schedule, previousLocalTime } from '../lib/config.mjs';
import { verifyPublishedPost } from '../lib/validation.mjs';
import { effectiveUsageRecords,effectiveModelExecution,usageCostSummary,usageCountersComplete } from '../lib/usage.mjs';
import { schedulerProof,standaloneResearchRecords } from '../lib/scheduler-proof.mjs';
import { publicationSlotStatus } from '../lib/slot-status.mjs';
import { writeSiteArtifacts,publicPostURL } from '../lib/site-artifacts.mjs';
import { trustedClockTick } from '../lib/clock-provenance.mjs';
import { parseScoringPolicy,hydrateScoring } from '../lib/scoring.mjs';
import { renderCard } from '../lib/card.mjs';
import { curationStatus,validatedCurationPicks,readCurationRecords } from '../lib/curation.mjs';
import { versionBrowserAssets } from '../lib/browser-assets.mjs';
import { sourceDefinitions } from '../lib/research.mjs';
import { renderMethodology } from '../lib/methodology.mjs';
import {loadSourceRegistryState} from '../lib/source-registry.mjs';
import {normalizedSourceView} from '../lib/source-presentation.mjs';
import {codeFreezeStatus} from '../lib/code-freeze.mjs';
import {loadLearningState} from '../lib/learning.mjs';
import {loadWatchdogHealth} from '../lib/watchdog.mjs';

const clockDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
const clockRunURL=value=>typeof value==='string'&&/^https:\/\/github\.com\/xndanius\/while-you-sleep\/actions\/runs\/\d+$/.test(value)?value:null;
async function hostedClockRecord(){
  const directory=path.join(ROOT,'data','clock');
  let state={};
  try{state=await readJSON(path.join(directory,'state.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
  let files=[];
  try{files=await fs.readdir(path.join(directory,'ticks'));}catch(error){if(error.code!=='ENOENT')throw error;}
  // Clock files are produced by the deterministic clock jobs, outside every
  // model artifact allowlist. Physical filenames bind the immutable tick IDs.
  const ticks=(await Promise.all(files.filter(file=>/^clock-\d+-\d+\.json$/.test(file)).map(async file=>{
    const tick=await readJSON(path.join(directory,'ticks',file));
    return tick.id===file.slice(0,-5)&&trustedClockTick(tick)?tick:null;
  }))).filter(Boolean).sort((a,b)=>b.tickedAt.localeCompare(a.tickedAt));
  const latest=ticks[0];
  const dispatches=(latest?.dispatches||[]).filter(record=>['loop.yml','research.yml','measure.yml','improve.yml','curate.yml'].includes(record.workflow)&&clockRunURL(record.githubRunUrl)===`https://github.com/xndanius/while-you-sleep/actions/runs/${record.runId}`).map(record=>({workflow:record.workflow,githubRunUrl:record.githubRunUrl,requestedAt:clockDate(record.requestedAt)}));
  return {clock:{phase:['waiting','ticking','queued','fenced'].includes(state.phase)?state.phase:'not_started',lastTickAt:latest?.tickedAt||clockDate(state.lastTickAt),nextTickAt:clockDate(state.nextTickAt),claimedAt:clockDate(state.claimedAt),fencedAt:clockDate(state.fencedAt),runtimeUpdatedAt:clockDate(state.runtimeUpdatedAt)||clockDate(state.claimedAt)||clockDate(state.lastTickAt),runtimeSource:'committed-fallback',clockRunUrl:clockRunURL(state.clockRunUrl),lastTickRunUrl:clockRunURL(latest?.githubRunUrl),waitMinutes:Number.isInteger(state.waitMinutes)&&state.waitMinutes>0?state.waitMinutes:15,dispatches},ticks};
}

try{
  const [allPosts,rawRuns,research,rawVersions,rejections,publications,measurements,rawUsageRecords,scheduler,reservations,outcomes]=await Promise.all(['posts','runs','research','versions','rejections','publications','measurements','usage','scheduler','slot-reservations','slot-outcomes'].map(records));
  const usageRecords=effectiveUsageRecords(rawUsageRecords);
  const usageByRun=new Map(usageRecords.map(record=>[record.runId,record]));
  const runs=rawRuns.map(run=>{const usage=usageByRun.get(run.id)||run.usage;return {...run,modelExecuted:effectiveModelExecution(run,usage),usage};});
  const versions=rawVersions.map(version=>({...version,usage:usageByRun.get(version.id)||version.usage}));
  const posts=allPosts.filter(verifyPublishedPost).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt));
  if(posts.length!==allPosts.length)throw new Error('A committed post failed checker provenance or content-integrity validation.');
  const baseURL=(process.env.PUBLIC_BASE_URL||'https://xndanius.github.io/while-you-sleep').replace(/\/$/,'');
  const {styleVersion,versionHTML}=await versionBrowserAssets(ROOT);
  // Original records must pass their publication hash before a score sidecar
  // can be joined. Derived presentation never rewrites that original record.
  const currentScoringPolicy=parseScoringPolicy(await fs.readFile(path.join(ROOT,'RULES.md'),'utf8'));
  const scoreSidecars=new Map();
  const scoredPosts=await Promise.all(posts.map(async post=>{
    publicPostURL(baseURL,post.id); // Validate the file ID before reading its sidecar.
    let sidecar=null;
    try{sidecar=await readJSON(path.join(ROOT,'data','scores',post.id+'.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(sidecar)scoreSidecars.set(post.id,sidecar);
    return {...post,scoring:hydrateScoring(post,sidecar,currentScoringPolicy)};
  }));
  let metrics;try{metrics=await readJSON(path.join(ROOT,'metrics.json'));}catch(error){if(error.code==='ENOENT')metrics={site:{status:'not_connected',views:null,saves:null},social:{status:'not_connected'},measuredAt:null};else throw error;}
  if(metrics.social?.provider!=='zapier')metrics={...metrics,social:{provider:'zapier',status:'not_connected',posts:[],channels:[],measuredAt:metrics.measuredAt||null,reason:'LinkedIn relay metrics have not been connected.'}};
  const postMetrics=metrics.posts||metrics.social?.posts||[];
  const hydrated=scoredPosts.map(post=>({...post,imageUrl:`./cards/${post.id}.jpg`,publicUrl:publicPostURL(baseURL,post.id),metrics:{views:postMetrics.find(m=>m.postId===post.id)?.views??null,saves:postMetrics.find(m=>m.postId===post.id)?.saves??null}}));
  const improvementRuns=versions.filter(v=>v.evaluations).map(v=>({id:v.id,type:'improve',status:v.status,startedAt:v.startedAt||v.createdAt,finishedAt:v.createdAt,eventName:v.eventName,clock:v.clock,jobKey:v.jobKey,scheduledAt:v.scheduledAt,scheduleStatus:v.scheduleStatus,githubRunUrl:v.githubRunUrl||null,version:v.id,usage:v.usage||{inputTokens:null,outputTokens:null,costUsd:null},steps:[{stage:'improve',status:v.status,at:v.createdAt,message:`${v.change} ${(v.reasons?.length?v.reasons.join(' '):v.reason)||''}`,baselineScore:v.baselineScore,challengerScore:v.challengerScore}]}));
  const sortedRuns=[...runs,...measurements,...improvementRuns].sort((a,b)=>(b.finishedAt||b.startedAt).localeCompare(a.finishedAt||a.startedAt));
  const sortedResearch=research.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const healthMap=new Map();
  for(const snapshot of sortedResearch)for(const health of snapshot.health||[])if(health.name!=='X'&&!healthMap.has(health.name))healthMap.set(health.name,health);
  const candidates=(await records('candidates')).reduce((n,r)=>n+(r.candidates?.length||0),0);
  const zeroModelIds=new Set(usageRecords.filter(record=>usageCountersComplete(record)&&record.coverage.observedModelJobs===0).map(record=>record.runId));
  const scoringRunIds=new Set(usageRecords.filter(record=>record.workflowKind==='score'&&!zeroModelIds.has(record.runId)).map(record=>record.runId));
  const modelRunCount=runs.filter(run=>run.modelExecuted!==false).length+improvementRuns.filter(run=>!zeroModelIds.has(run.id)).length+scoringRunIds.size;
  const stats={published:posts.length,candidates,rejected:rejections.length,views:metrics.site?.views??null,saves:metrics.site?.saves??null,...usageCostSummary(usageRecords,modelRunCount)};
  // Loop research files cross a model workspace; only the standalone no-model
  // research job can contribute scheduler metadata from this collection.
  const trustedResearch=await standaloneResearchRecords(path.join(ROOT,'data','research'));
  const {clock,ticks}=await hostedClockRecord();
  const proof=schedulerProof([...scheduler,...trustedResearch,...measurements,...versions],runs,posts,ticks);
  const lastLoop=runs.filter(run=>run.type==='loop'&&run.modelExecuted!==false).sort((a,b)=>(b.startedAt||'').localeCompare(a.startedAt||''))[0];
  const status={state:posts.length?proof.state==='publication_observed'?'running':proof.state==='unverified'?'schedule_unverified':proof.state:'awaiting_first_cloud_run',hosted:true,engine:lastLoop?.engine==='assistant-orchestrated'?'Assistant-managed research and independent review':'GitHub Actions + official openai/codex-action',lastResearchAt:sortedResearch[0]?.createdAt||null,lastPublishedAt:posts[0]?.publishedAt||null,lastLoopAt:lastLoop?.startedAt||null,lastLoopEvent:lastLoop?.eventName||lastLoop?.scheduling?.eventName||lastLoop?.scheduling?.event||null,lastRunAt:sortedRuns[0]?.finishedAt||null,lastHostedRunUrl:sortedRuns.find(r=>r.githubRunUrl)?.githubRunUrl||null,lastMeasuredAt:metrics.measuredAt||null,measurementStatus:metrics.site?.status||'not_connected',scheduleVerified:proof.state==='publication_observed'};
  const slots=publicationSlotStatus({posts,runs,reservations,outcomes}).map(slot=>({...slot,plannedAt:slot.scheduledAt,status:slot.state}));
  const previousDayEnd=previousLocalTime(part=>part.hour===23&&part.minute===59,new Date());
  const previousSlots=publicationSlotStatus({posts,runs,reservations,outcomes,now:new Date(previousDayEnd)}).map(slot=>({...slot,plannedAt:slot.scheduledAt,status:slot.state}));
  const cadence={...schedule(),slots,previousSlots,gateEveryMinutes:20,auxiliaryGateEveryMinutes:30,verifiedHostedRunAt:sortedRuns.find(r=>r.githubRunUrl)?.finishedAt||null,proof};
  const feed={posts:hydrated,stats,scoringPolicy:currentScoringPolicy,schedule:cadence,status};
  const linkedinUrl='https://www.linkedin.com/company/whileyousleep-ai/';
  const relayStatus=await readJSON(path.join(ROOT,'data','relay','status.json'));
  const curationConfig=await readJSON(path.join(ROOT,'data','curation','config.json'));
  const curationReceipts=await readCurationRecords(ROOT);
  const picks=await validatedCurationPicks({config:curationConfig,receipts:curationReceipts,posts,sidecars:scoreSidecars});
  const curation={...curationStatus({config:curationConfig,receipts:curationReceipts}),picks:picks.map(pick=>({...pick,title:posts.find(post=>post.id===pick.postId).title,publicUrl:publicPostURL(baseURL,pick.postId)}))};
  const bestFeedConfirmed=relayStatus.feedPath==='best.xml'&&relayStatus.bestFeedSwitch?.state==='confirmed'&&clockDate(relayStatus.bestFeedSwitch.confirmedAt);
  const relay={...relayStatus,path:'Website -> RSS -> Zapier -> LinkedIn Page',linkedinUrl,feedUrl:baseURL+(bestFeedConfirmed?'/best.xml':'/feed.xml'),recommendedFeedUrl:baseURL+'/best.xml'};
  const platforms=[{name:'LinkedIn',id:'linkedin',status:relay.state==='published'?'active':relay.state,provider:'Zapier RSS relay',lastPublishedAt:relay.firstPublishedAt||null,url:linkedinUrl,message:relay.message}];
  const versionHistory=versions.length?versions.sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')):[{id:INITIAL_RULES.id,createdAt:INITIAL_RULES.createdAt,status:'adopted',reason:INITIAL_RULES.reason,change:'Initial evidence-first writing and picking rules',baselineScore:null,challengerScore:null}];
  // Before registry accounting starts, old scan health can describe reported
  // availability but cannot identify which source produced a checked idea.
  const fallbackSources={enabled:false,coverage:{reason:'Historic origin attribution was not recorded; yield accounting starts with the source registry.',trustedFetchSnapshots:trustedResearch.length},rows:sourceDefinitions.map(definition=>{
    const health=healthMap.get(definition.name);
    return {id:hash(definition.url),name:definition.name,url:definition.url,status:'configured',lastFetchAt:health?.fetchedAt||null,health:health?{status:health.status,message:health.message}:null,stats:{fetchAttempts:null,successfulFetches:null,itemsFetched:null,distinctItems:null,candidates:null,checkedCandidates:null,passedChecks:null,averageScore:null,published:null,linkedInPicks:null}};
  }),changes:[]};
  const registryView=await loadSourceRegistryState({root:ROOT,posts,picks,currentPolicy:currentScoringPolicy,now:new Date()});
  const sources=registryView.enabled===true?normalizedSourceView(registryView):fallbackSources;
  const registry=await readJSON(path.join(ROOT,'data','sources','registry.json'));
  const learning=await loadLearningState({root:ROOT,registry,posts,now:new Date()});
  const health=await loadWatchdogHealth({root:ROOT,posts,runs});
  const machine={...feed,clock,curation,learning,health,freeze:codeFreezeStatus(),runs:sortedRuns.slice(0,100),versions:versionHistory,sourceHealth:[...healthMap.values()],sources:registryView,platforms,relay,metrics};
  await writeJSON(path.join(ROOT,'public','api','feed.json'),feed);
  await writeJSON(path.join(ROOT,'public','api','machine.json'),machine);
  await writeJSON(path.join(ROOT,'public','api','sources.json'),registryView);
  await writeJSON(path.join(ROOT,'public','api','learning.json'),learning);
  await writeJSON(path.join(ROOT,'public','api','health.json'),health);
  const counter=process.env.GOATCOUNTER_SITE||'';
  const validCounter=/^https:\/\/[a-z0-9-]+\.goatcounter\.com\/?$/.test(counter);
  await writeJSON(path.join(ROOT,'public','api','analytics.json'),{provider:validCounter?'goatcounter':null,site:validCounter?counter.replace(/\/$/,''):null});
  await fs.mkdir(path.join(ROOT,'public','machine'),{recursive:true});
  const indexHTML=await fs.readFile(path.join(ROOT,'public','index.html'),'utf8');
  await fs.writeFile(path.join(ROOT,'public','index.html'),versionHTML(indexHTML));
  const machineHTML=versionHTML(await fs.readFile(path.join(ROOT,'public','machine.html'),'utf8'));
  await fs.writeFile(path.join(ROOT,'public','machine.html'),machineHTML);
  await fs.writeFile(path.join(ROOT,'public','machine','index.html'),machineHTML.replace('<base href="./">','<base href="../">'));
  await fs.mkdir(path.join(ROOT,'public','method'),{recursive:true});
  await fs.writeFile(path.join(ROOT,'public','method','index.html'),renderMethodology({baseURL,styleVersion,generatedAt:new Date().toISOString(),policy:currentScoringPolicy,schedule:cadence,clock,curation,relay,sources,learning,versions:versionHistory,picks:curation.picks}));
  await fs.writeFile(path.join(ROOT,'public','.nojekyll'),'');
  // Cards are derived artifacts. A checked backfill or accepted weight change
  // updates their score line while preserving original JSON and RSS identity.
  for(const post of scoredPosts)if(post.scoring)await fs.writeFile(path.join(ROOT,'public','cards',post.id+'.jpg'),renderCard(post));
  await writeSiteArtifacts({root:ROOT,posts:scoredPosts,baseURL,styleVersion,picks});
  console.log(JSON.stringify({posts:posts.length,runs:runs.length,path:'public/api/feed.json'}));
}catch(error){console.error(safeError(error));process.exitCode=1;}
