import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const REPOSITORY='xndanius/while-you-sleep';
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
export const repairHash=value=>createHash('sha256').update(stable(value)).digest('hex');
const episode=value=>typeof value==='string'&&/^starvation-[a-f0-9]{20}$/.test(value);
const integer=value=>/^[1-9]\d{0,15}$/.test(String(value||''));
const clean=value=>String(value||'Unknown').replace(/[\r\n\x00-\x1f\x7f]/g,' ').replace(/(?:sk-(?:proj-)?|Bearer\s+)[A-Za-z0-9_.-]+/g,'[redacted]').slice(0,600);
const run=({root,args,env=process.env})=>{const result=spawnSync(args[0],args.slice(1),{cwd:root,env,encoding:'utf8'});if(result.status!==0)throw new Error('Trusted watchdog repair preparation could not complete.');return result.stdout.trim();};
export function repairActorIsTrusted(metadata,env={}){
 return env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===REPOSITORY&&env.GITHUB_REF==='refs/heads/main'&&env.GITHUB_EVENT_NAME==='workflow_dispatch'&&env.GITHUB_ACTOR==='github-actions[bot]'&&env.GITHUB_TRIGGERING_ACTOR==='github-actions[bot]'&&env.GITHUB_RUN_ATTEMPT==='1'&&integer(env.GITHUB_RUN_ID)&&String(metadata?.id)===env.GITHUB_RUN_ID&&metadata.event==='workflow_dispatch'&&metadata.run_attempt===1&&metadata.path==='.github/workflows/repair.yml'&&metadata.head_branch==='main'&&metadata.repository?.full_name===REPOSITORY&&metadata.head_repository?.full_name===REPOSITORY&&metadata.head_repository?.fork===false&&metadata.actor?.login==='github-actions[bot]'&&metadata.triggering_actor?.login==='github-actions[bot]';
}
export function repairEpisodeMatches(state,{episodeId,issueNumber}){
 return episode(episodeId)&&integer(issueNumber)&&state?.schema===1&&state.mode==='repair'&&state.episode?.id===episodeId&&state.actions?.issueNumber===Number(issueNumber)&&state.actions?.repairEpisode===episodeId&&['dispatch_reserved','dispatched'].includes(state.actions?.repairStatus);
}
export async function boundedRepairJSON(file,maxBytes=1000000){const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxBytes)throw new Error('Watchdog repair input must be a bounded regular JSON file.');return JSON.parse(await fs.readFile(file,'utf8'));}
export function validateRepairContext(context,{expectedSha256,episodeId,issueNumber}={}){
 if(!context||context.schema!==1||context.type!=='watchdog-repair-context'||context.repository!==REPOSITORY||!episode(context.episodeId)||!Number.isSafeInteger(context.issueNumber)||context.issueNumber<1||!/^[a-f0-9]{40}$/.test(context.baseSha||'')||!integer(context.githubRunId)||context.runAttempt!==1||context.mode!=='repair'||!/^[a-f0-9]{64}$/.test(context.stateSha256||'')||!Number.isFinite(Date.parse(context.createdAt))||!context.diagnosis||!Array.isArray(context.diagnosis.noPostRuns)||context.diagnosis.noPostRuns.length>24||!expectedSha256||repairHash(context)!==expectedSha256||episodeId&&context.episodeId!==episodeId||issueNumber&&context.issueNumber!==Number(issueNumber))throw new Error('Repair context does not match the trusted watchdog episode and exact gate hash.');return context;
}
export async function prepareWatchdogRepair({root=process.cwd(),env=process.env,now=new Date(),metadata=null,apiGet=null}={}){
 const episodeId=env.WATCHDOG_EPISODE_ID,issueNumber=env.WATCHDOG_ISSUE_NUMBER;
 if(!episode(episodeId)||!integer(issueNumber))throw new Error('Repair requires one exact watchdog episode and diagnosis issue.');
 const get=apiGet||((endpoint)=>JSON.parse(run({root,args:['gh','api','--hostname','github.com',endpoint],env})));
 const actual=metadata||await get(`repos/${REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`);if(!repairActorIsTrusted(actual,env))throw new Error('Only the exact first-attempt hosted watchdog bot may prepare this repair.');
 const state=await boundedRepairJSON(path.join(root,'data','watchdog','state.json'),3000000);
 if(!repairEpisodeMatches(state,{episodeId,issueNumber})){if(env.GITHUB_OUTPUT)await fs.appendFile(env.GITHUB_OUTPUT,'ready=false\nreason=episode_not_current\n');return {ready:false,reason:'episode_not_current'};}
 const baseSha=run({root,args:['git','rev-parse','HEAD'],env});if(!/^[a-f0-9]{40}$/.test(baseSha))throw new Error('Repair base is not an immutable Git commit.');
 const reasonCounts={};for(const [reason,count] of Object.entries(state.reasonCounts||{}).slice(0,30))if(Number.isSafeInteger(count)&&count>=0)reasonCounts[clean(reason)]=count;
 const context={schema:1,type:'watchdog-repair-context',repository:REPOSITORY,episodeId,issueNumber:Number(issueNumber),baseSha,githubRunId:env.GITHUB_RUN_ID,runAttempt:1,mode:'repair',stateSha256:repairHash(state),createdAt:new Date(now).toISOString(),diagnosis:{lastPublishedAt:state.lastPublishedAt||null,hoursWithoutPost:Number.isFinite(state.hoursWithoutPost)?state.hoursWithoutPost:null,postsLast12Hours:Number.isSafeInteger(state.postsLast12Hours)?state.postsLast12Hours:null,reasonCounts,noPostRuns:(state.noPostRuns||[]).slice(0,24).map(row=>({runId:clean(row.runId),finishedAt:row.finishedAt||null,status:clean(row.status),reason:clean(row.reason)}))},constraints:{publishThreshold:6,independentChecks:'unchanged',autoMerge:false,proposalOnly:true}};
 const file=path.join(root,'.run','watchdog-repair','context.json');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(context,null,2)+'\n',{flag:'wx'});
 const output={ready:true,baseSha,contextSha256:repairHash(context),episodeId,issueNumber:Number(issueNumber)};if(env.GITHUB_OUTPUT)await fs.appendFile(env.GITHUB_OUTPUT,`ready=true\nbase_sha=${baseSha}\ncontext_sha256=${output.contextSha256}\nepisode_id=${episodeId}\nissue_number=${issueNumber}\n`);console.log(JSON.stringify(output));return output;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))prepareWatchdogRepair().catch(()=>{console.error('Watchdog repair gate did not verify the current bot episode; no proposal was authorized.');process.exitCode=1;});
