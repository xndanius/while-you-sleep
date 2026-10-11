import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ROOT, records, readJSON, writeJSON, safeError } from '../lib/storage.mjs';
import { INITIAL_RULES, schedule, previousLocalTime } from '../lib/config.mjs';
import { verifyPublishedPost } from '../lib/validation.mjs';
import { effectiveUsageRecords } from '../lib/usage.mjs';
import { schedulerProof,standaloneResearchRecords } from '../lib/scheduler-proof.mjs';
import { publicationSlotStatus } from '../lib/slot-status.mjs';
import { writeSiteArtifacts,publicPostURL } from '../lib/site-artifacts.mjs';
import { trustedClockTick } from '../lib/clock-provenance.mjs';

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
  const dispatches=(latest?.dispatches||[]).filter(record=>['loop.yml','research.yml','measure.yml','improve.yml'].includes(record.workflow)&&clockRunURL(record.githubRunUrl)===`https://github.com/xndanius/while-you-sleep/actions/runs/${record.runId}`).map(record=>({workflow:record.workflow,githubRunUrl:record.githubRunUrl,requestedAt:clockDate(record.requestedAt)}));
  return {clock:{phase:['waiting','ticking','queued','fenced'].includes(state.phase)?state.phase:'not_started',lastTickAt:latest?.tickedAt||clockDate(state.lastTickAt),nextTickAt:clockDate(state.nextTickAt),claimedAt:clockDate(state.claimedAt),clockRunUrl:clockRunURL(state.clockRunUrl),lastTickRunUrl:clockRunURL(latest?.githubRunUrl),waitMinutes:Number.isInteger(state.waitMinutes)&&state.waitMinutes>0?state.waitMinutes:15,dispatches},ticks};
}

try{
  const [allPosts,rawRuns,research,rawVersions,rejections,publications,measurements,rawUsageRecords,scheduler,reservations,outcomes]=await Promise.all(['posts','runs','research','versions','rejections','publications','measurements','usage','scheduler','slot-reservations','slot-outcomes'].map(records));
  const usageRecords=effectiveUsageRecords(rawUsageRecords);
  const usageByRun=new Map(usageRecords.map(record=>[record.runId,record]));
  const runs=rawRuns.map(run=>({...run,usage:usageByRun.get(run.id)||run.usage}));
  const versions=rawVersions.map(version=>({...version,usage:usageByRun.get(version.id)||version.usage}));
  const posts=allPosts.filter(verifyPublishedPost).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt));
  if(posts.length!==allPosts.length)throw new Error('A committed post failed checker provenance or content-integrity validation.');
  let metrics;try{metrics=await readJSON(path.join(ROOT,'metrics.json'));}catch(error){if(error.code==='ENOENT')metrics={site:{status:'not_connected',views:null,saves:null},social:{status:'not_connected'},measuredAt:null};else throw error;}
  if(metrics.social?.provider!=='zapier')metrics={...metrics,social:{provider:'zapier',status:'not_connected',posts:[],channels:[],measuredAt:metrics.measuredAt||null,reason:'LinkedIn relay metrics have not been connected.'}};
  const postMetrics=metrics.posts||metrics.social?.posts||[];
  const baseURL=(process.env.PUBLIC_BASE_URL||'https://xndanius.github.io/while-you-sleep').replace(/\/$/,'');
  const hydrated=posts.map(post=>({...post,imageUrl:`./cards/${post.id}.jpg`,publicUrl:publicPostURL(baseURL,post.id),metrics:{views:postMetrics.find(m=>m.postId===post.id)?.views??null,saves:postMetrics.find(m=>m.postId===post.id)?.saves??null}}));
  const improvementRuns=versions.filter(v=>v.evaluations).map(v=>({id:v.id,type:'improve',status:v.status,startedAt:v.startedAt||v.createdAt,finishedAt:v.createdAt,eventName:v.eventName,clock:v.clock,jobKey:v.jobKey,scheduledAt:v.scheduledAt,scheduleStatus:v.scheduleStatus,githubRunUrl:v.githubRunUrl||null,version:v.id,usage:v.usage||{inputTokens:null,outputTokens:null,costUsd:null},steps:[{stage:'improve',status:v.status,at:v.createdAt,message:`${v.change} ${(v.reasons?.length?v.reasons.join(' '):v.reason)||''}`,baselineScore:v.baselineScore,challengerScore:v.challengerScore}]}));
  const sortedRuns=[...runs,...measurements,...improvementRuns].sort((a,b)=>(b.finishedAt||b.startedAt).localeCompare(a.finishedAt||a.startedAt));
  const sortedResearch=research.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const healthMap=new Map();
  for(const snapshot of sortedResearch)for(const health of snapshot.health||[])if(health.name!=='X'&&!healthMap.has(health.name))healthMap.set(health.name,health);
  const candidates=(await records('candidates')).reduce((n,r)=>n+(r.candidates?.length||0),0);
  const measuredCost=usageRecords.map(r=>r.costUsd).filter(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0);
  const modelRunCount=runs.filter(run=>run.modelExecuted!==false).length+improvementRuns.length;
  const stats={published:posts.length,candidates,rejected:rejections.length,views:metrics.site?.views??null,saves:metrics.site?.saves??null,totalCostUsd:measuredCost.length?measuredCost.reduce((a,b)=>a+b,0):null,costStatus:measuredCost.length===modelRunCount&&modelRunCount?'recorded_token_estimate':'invoice_or_usage_not_connected'};
  // Loop research files cross a model workspace; only the standalone no-model
  // research job can contribute scheduler metadata from this collection.
  const trustedResearch=await standaloneResearchRecords(path.join(ROOT,'data','research'));
  const {clock,ticks}=await hostedClockRecord();
  const proof=schedulerProof([...scheduler,...trustedResearch,...measurements,...versions],runs,posts,ticks);
  const lastLoop=runs.filter(run=>run.type==='loop'&&run.modelExecuted!==false).sort((a,b)=>(b.startedAt||'').localeCompare(a.startedAt||''))[0];
  const status={state:posts.length?proof.state==='publication_observed'?'running':proof.state==='unverified'?'schedule_unverified':proof.state:'awaiting_first_cloud_run',hosted:true,engine:'GitHub Actions + official openai/codex-action',lastResearchAt:sortedResearch[0]?.createdAt||null,lastPublishedAt:posts[0]?.publishedAt||null,lastLoopAt:lastLoop?.startedAt||null,lastLoopEvent:lastLoop?.eventName||lastLoop?.scheduling?.eventName||lastLoop?.scheduling?.event||null,lastRunAt:sortedRuns[0]?.finishedAt||null,lastHostedRunUrl:sortedRuns.find(r=>r.githubRunUrl)?.githubRunUrl||null,lastMeasuredAt:metrics.measuredAt||null,measurementStatus:metrics.site?.status||'not_connected',scheduleVerified:proof.state==='publication_observed'};
  const slots=publicationSlotStatus({posts,runs,reservations,outcomes}).map(slot=>({...slot,plannedAt:slot.scheduledAt,status:slot.state}));
  const previousDayEnd=previousLocalTime(part=>part.hour===23&&part.minute===59,new Date(schedule().publicationSlots[0].scheduledAt));
  const previousSlots=publicationSlotStatus({posts,runs,reservations,outcomes,now:new Date(previousDayEnd)}).map(slot=>({...slot,plannedAt:slot.scheduledAt,status:slot.state}));
  const cadence={...schedule(),slots,previousSlots,gateEveryMinutes:20,auxiliaryGateEveryMinutes:30,verifiedHostedRunAt:sortedRuns.find(r=>r.githubRunUrl)?.finishedAt||null,proof};
  const feed={posts:hydrated,stats,schedule:cadence,status};
  const linkedinUrl='https://www.linkedin.com/company/whileyousleep-ai/';
  const relay={path:'Website -> RSS -> Zapier -> LinkedIn Page',state:'waiting_for_first_linkedin_post',message:'waiting for first LinkedIn post',linkedinUrl,feedUrl:baseURL+'/feed.xml'};
  const platforms=[{name:'LinkedIn',id:'linkedin',status:'waiting_for_first_linkedin_post',provider:'Zapier RSS relay',lastPublishedAt:null,url:linkedinUrl,message:relay.message}];
  const versionHistory=versions.length?versions.sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')):[{id:INITIAL_RULES.id,createdAt:INITIAL_RULES.createdAt,status:'adopted',reason:INITIAL_RULES.reason,change:'Initial evidence-first writing and picking rules',baselineScore:null,challengerScore:null}];
  const machine={...feed,clock,runs:sortedRuns.slice(0,100),versions:versionHistory,sourceHealth:[...healthMap.values()],platforms,relay,metrics};
  await writeJSON(path.join(ROOT,'public','api','feed.json'),feed);
  await writeJSON(path.join(ROOT,'public','api','machine.json'),machine);
  const counter=process.env.GOATCOUNTER_SITE||'';
  const validCounter=/^https:\/\/[a-z0-9-]+\.goatcounter\.com\/?$/.test(counter);
  await writeJSON(path.join(ROOT,'public','api','analytics.json'),{provider:validCounter?'goatcounter':null,site:validCounter?counter.replace(/\/$/,''):null});
  await fs.mkdir(path.join(ROOT,'public','machine'),{recursive:true});
  const machineHTML=await fs.readFile(path.join(ROOT,'public','machine.html'),'utf8');
  await fs.writeFile(path.join(ROOT,'public','machine','index.html'),machineHTML.replace('<base href="./">','<base href="../">'));
  await fs.writeFile(path.join(ROOT,'public','.nojekyll'),'');
  await writeSiteArtifacts({root:ROOT,posts,baseURL});
  console.log(JSON.stringify({posts:posts.length,runs:runs.length,path:'public/api/feed.json'}));
}catch(error){console.error(safeError(error));process.exitCode=1;}
