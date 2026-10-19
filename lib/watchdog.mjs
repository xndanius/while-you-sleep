import {promises as fs} from 'node:fs';
import path from 'node:path';
import {sha256,stableJSON,safeError} from './storage.mjs';

export const WATCHDOG_POLICY=Object.freeze({widenAfterHours:12,fallbackAfterHours:18,repairAfterHours:24,recoverAfterPosts:2,maxLeads:10,normalCooldownHours:24,recoveryCooldownHours:3,discoveryRetryHours:3});
export const RECOVERY_REPORT_DUE_AT='2026-10-20T07:00:00.000Z';
const levels=['normal','widened','fallback','repair'];
const hour=3600000;
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const clean=value=>safeError({message:String(value||'No publication reason was recorded.')}).replace(/[\r\n]+/g,' ').slice(0,600);
// Keep the cheap clock independent of npm parsers. Match the existing immutable
// publication content envelope; models cannot import records into data/posts.
const verifiedPost=post=>post?.checker?.passed===true&&!!post.checker.checkerRunId&&post.contentSha256===sha256(stableJSON(Object.fromEntries(Object.entries(post).filter(([key])=>!['checker','contentSha256','metrics','publicUrl','imageUrl'].includes(key)))));
export function noPostReason(run){
 if(run.retrievalCompletion?.reason)return clean(run.retrievalCompletion.reason);
 if(run.retrievalOutcome?.reason)return clean(run.retrievalOutcome.reason);
 if(run.unverifiedAssessment?.reason)return clean(run.unverifiedAssessment.reason);
 if(run.operationalFailures?.length)return clean(run.operationalFailures.map(item=>item.reason).filter(Boolean).join(' '));
 const reasons=(run.rejected||[]).map(item=>typeof item==='string'?item:item.reason).filter(Boolean);
 if(reasons.length)return clean([...new Set(reasons)].join(' '));
 return clean(run.checkedAssessment?.reason||run.steps?.find(item=>item.message)?.message||run.status);
}
export function deriveWatchdogHealth({posts=[],runs=[],previous=null,now=new Date()}={}){
 const at=new Date(now).getTime();if(!Number.isFinite(at))throw new Error('Watchdog requires a valid clock.');
 const published=posts.filter(post=>stamp(post.publishedAt)&&Date.parse(post.publishedAt)<=at).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt));
 const finished=runs.filter(run=>run.type==='loop'&&stamp(run.finishedAt)&&Date.parse(run.finishedAt)<=at&&!String(run.status).startsWith('skipped_')).sort((a,b)=>Date.parse(b.finishedAt)-Date.parse(a.finishedAt));
 const lastPost=published[0]||null;
 const baseline=lastPost?.publishedAt||finished.at(-1)?.startedAt||new Date(at).toISOString();
 const hoursWithoutPost=Math.max(0,(at-Date.parse(baseline))/hour);
 const measuredLevel=hoursWithoutPost>=24?3:hoursWithoutPost>=18?2:hoursWithoutPost>=12?1:0;
 let episode=previous?.schema===1&&previous.episode&&stamp(previous.episode.raisedAt)?{...previous.episode}:null;
 let mode=levels[measuredLevel],recoveryPosts=episode?published.filter(post=>Date.parse(post.publishedAt)>Date.parse(episode.raisedAt)).length:0;
 let recoveredAt=previous?.recoveredAt||null;
 if(episode&&recoveryPosts>=WATCHDOG_POLICY.recoverAfterPosts){recoveredAt=new Date(at).toISOString();episode=null;mode='normal';}
 else if(episode)mode=levels[Math.max(measuredLevel,Math.max(1,levels.indexOf(episode.mode)))];
 if(mode!=='normal'&&!episode)episode={id:'starvation-'+sha256(baseline).slice(0,20),raisedAt:new Date(at).toISOString(),since:baseline,lastPostId:lastPost?.id||null,mode};
 if(episode)episode.mode=mode;
 const noPostRuns=finished.filter(run=>!(run.published||[]).length).map(run=>({runId:run.id,finishedAt:run.finishedAt,status:run.status,reason:noPostReason(run),githubRunUrl:run.githubRunUrl||null}));
 const reasonCounts={};for(const run of noPostRuns){const key=run.reason;reasonCounts[key]=(reasonCounts[key]||0)+1;}
 const widened=mode!=='normal',fallbackEnabled=['fallback','repair'].includes(mode);
 return {schema:1,type:'publishing-health',updatedAt:new Date(at).toISOString(),mode,healthy:mode==='normal',lastPublishedAt:lastPost?.publishedAt||null,hoursWithoutPost:Math.round(hoursWithoutPost*100)/100,postsLast12Hours:published.filter(post=>Date.parse(post.publishedAt)>=at-12*hour).length,postsLast24Hours:published.filter(post=>Date.parse(post.publishedAt)>=at-24*hour).length,recoveryPosts,recoveryTarget:2,episode,recoveredAt,policy:WATCHDOG_POLICY,researchPolicy:{mode,widened,fallbackEnabled,maxLeads:10,cooldownHours:widened?3:24},noPostRuns,reasonCounts,actions:previous?.actions||{},summary:mode==='normal'?'Normal research. Checked posts and no-post reasons remain visible.':`${Math.floor(hoursWithoutPost)} hours since publication. ${mode==='widened'?'Broader source search and shorter lead cooldowns are active.':mode==='fallback'?'Builder-led proposals may use freshly verified public demand evidence.':'Source recovery, a diagnosis issue and a repair pull request are required.'} Recovery continues until two new checked posts publish.`};
}
async function records(root,directory){let files;try{files=await fs.readdir(path.join(root,'data',directory));}catch(error){if(error.code==='ENOENT')return [];throw error;}return Promise.all(files.filter(file=>file.endsWith('.json')).map(async file=>{const target=path.join(root,'data',directory,file),stat=await fs.lstat(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4000000)throw new Error('Watchdog input is not a bounded regular record.');return JSON.parse(await fs.readFile(target,'utf8'));}));}
export async function loadWatchdogHealth({root,now=new Date(),posts,runs}={}){
 let previous=null;try{previous=JSON.parse(await fs.readFile(path.join(root,'data','watchdog','state.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const [allPosts,allRuns]=await Promise.all([posts||records(root,'posts'),runs||records(root,'runs')]);
 return deriveWatchdogHealth({posts:allPosts.filter(verifiedPost),runs:allRuns,previous,now});
}
export function watchdogStateChanged(previous,next){
 if(!previous&&next?.mode==='normal'&&!Object.keys(next.actions||{}).length)return false;
 const view=value=>({mode:value?.mode,episode:value?.episode,recoveredAt:value?.recoveredAt,actions:value?.actions||{}});
 return stableJSON(view(previous))!==stableJSON(view(next));
}
