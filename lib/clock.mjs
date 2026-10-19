import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loopDecision } from './loop-schedule.mjs';
import { scheduledDecision } from '../scripts/prepare-scheduled-job.mjs';
import {curationDecision} from './curation.mjs';

export const CLOCK_REPOSITORY = 'xndanius/while-you-sleep';
export const CLOCK_WAIT_MINUTES = 15;
export const CLOCK_STALE_MINUTES = 45;
export const CLOCK_WORKFLOW = 'clock.yml';
const activeStatuses = new Set(['queued','waiting','in_progress','requested','pending']);
const unsuccessfulConclusions = new Set(['action_required','cancelled','failure','neutral','skipped','stale','startup_failure','timed_out']);
const kinds = ['loop','research','measure','improve','curate'];
const numericId = value => /^\d+$/.test(String(value||''));
const instant = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN;
export const clockRunURL = runId => `https://github.com/${CLOCK_REPOSITORY}/actions/runs/${runId}`;
export const clockTickId = (runId, attempt=1) => `clock-${runId}-${attempt}`;

export function trustedClockRun(run, expectedRunId, expectedAttempt) {
  return !!run && numericId(expectedRunId) && run.id===Number(expectedRunId)
    && run.repository?.full_name===CLOCK_REPOSITORY && run.head_repository?.full_name===CLOCK_REPOSITORY
    && run.head_branch==='main' && run.path==='.github/workflows/clock.yml'
    && run.event==='workflow_dispatch' && (!expectedAttempt || run.run_attempt===Number(expectedAttempt));
}

export function clockLiveness(state, sourceRun, now=new Date()) {
  if (!state || !numericId(state.expectedRunId)) return {alive:false,reason:'no_clock_state'};
  // An authoritative failed attempt cannot tick again. Its recent claim is
  // still a fencing boundary, never evidence that a runner remains alive.
  if (Number.isInteger(state.expectedRunAttempt) && state.expectedRunAttempt>0
    && trustedClockRun(sourceRun,state.expectedRunId,state.expectedRunAttempt)
    && sourceRun.status==='completed' && unsuccessfulConclusions.has(sourceRun.conclusion)) return {alive:false,reason:'clock_run_terminal_non_success'};
  const last = instant(state.lastTickAt || state.claimedAt);
  const recent=Number.isFinite(last) && new Date(now).getTime()-last<CLOCK_STALE_MINUTES*60000;
  if (recent && trustedClockRun(sourceRun,state.expectedRunId) && activeStatuses.has(sourceRun.status)) return {alive:true,reason:'clock_run_active'};
  if (recent) return {alive:true,reason:'clock_tick_recent'};
  return {alive:false,reason:'clock_tick_stale'};
}

export function clockClaim({state=null,sourceRun=null,runId,attempt=1,chainId='',parentRunId='',parentAttempt='',generation='',now=new Date()}={}) {
  if (!numericId(runId) || !Number.isInteger(Number(attempt)) || Number(attempt)<1 || !Number.isFinite(new Date(now).getTime())) throw new Error('Invalid trusted clock claim.');
  const continuing=!!state && String(state.expectedRunId)===String(runId);
  if (continuing) {
    if (state.expectedRunAttempt!==Number(attempt) || state.chainId!==chainId || String(state.parentRunId||'')!==String(parentRunId||'') || state.parentRunAttempt!==Number(parentAttempt||0) || state.generation!==Number(generation) || state.phase!=='queued') return {claimed:false,reason:'clock_claim_mismatch'};
  } else {
    if (chainId || parentRunId || parentAttempt || generation) return {claimed:false,reason:'unexpected_clock_child'};
    const live=clockLiveness(state,sourceRun,now);
    if (live.alive) return {claimed:false,reason:live.reason};
    chainId=clockTickId(runId,attempt);generation=0;parentRunId=null;parentAttempt=0;
  }
  const claimedAt=new Date(now).toISOString();
  return {claimed:true,reason:continuing?'expected_clock_child':state?'stale_clock_claim':'initial_clock_claim',state:{chainId,generation:Number(generation),expectedRunId:String(runId),expectedRunAttempt:Number(attempt),parentRunId:parentRunId?String(parentRunId):null,parentRunAttempt:Number(parentAttempt||0),phase:'waiting',lastTickAt:continuing?state.lastTickAt||null:null,nextTickAt:new Date(new Date(now).getTime()+CLOCK_WAIT_MINUTES*60000).toISOString(),clockRunUrl:clockRunURL(runId),waitMinutes:CLOCK_WAIT_MINUTES,claimedAt}};
}

export function validateClockTick(state,{runId,attempt=1,now=new Date()}={}) {
  if (!state || String(state.expectedRunId)!==String(runId) || state.expectedRunAttempt!==Number(attempt) || state.phase!=='waiting' || state.waitMinutes!==CLOCK_WAIT_MINUTES) throw new Error('This clock run did not win the durable claim.');
  if (!Number.isFinite(instant(state.claimedAt)) || new Date(now).getTime()<instant(state.claimedAt)+CLOCK_WAIT_MINUTES*60000) throw new Error('The clock environment wait has not elapsed.');
  return state;
}

// Pure planning never writes model reservations. A missing terminal settlement
// is potential work: the actual child loop gate alone may recover that lock.
export function dueClockDispatches({posts=[],reservations=[],outcomes=[],completions={},curation=null,watchdog=null,runId,now=new Date()}={}) {
  const loop=loopDecision({runId:`loop-${runId}-1`,githubRunId:String(runId),eventName:'schedule',now,posts,reservations,outcomes});
  const dispatches=[];
  if (loop.decision==='run' || loop.reason==='reservation_in_progress_or_unknown') dispatches.push({kind:'loop',workflow:'loop.yml',jobKey:null,slotIds:loop.decision==='run'?loop.slotIds:loop.missedSlots.map(slot=>slot.id),scheduledAt:loop.scheduledAt,reason:loop.reason});
  for (const kind of ['research','measure','improve']) {
    const decision=scheduledDecision({kind,eventName:'schedule',automatic:true,now,completions:completions[kind]||[]});
    const forceDiscovery=kind==='research'&&watchdog?.researchPolicy?.widened===true&&(!watchdog.actions?.discoveryRequestedAt||new Date(now)-new Date(watchdog.actions.discoveryRequestedAt)>=3*3600000);
    if (decision.due||forceDiscovery) dispatches.push({kind,workflow:kind+'.yml',jobKey:decision.jobKey,slotIds:[],scheduledAt:decision.scheduledAt,reason:forceDiscovery?'watchdog_discovery':decision.reason,...(forceDiscovery?{forceDiscovery:true}:{})});
  }
  if(curation){const decision=curationDecision({...curation,now});if(decision.due)dispatches.push({kind:'curate',workflow:'curate.yml',jobKey:decision.slots[0].id,slotIds:decision.slots.map(slot=>slot.id),scheduledAt:decision.slots[0].scheduledAt,reason:decision.reason});}
  return dispatches;
}

export async function clockRecords(root,directory) {
  const target=path.join(root,'data',directory);
  let files;try{files=await fs.readdir(target);}catch(error){if(error.code==='ENOENT')return[];throw error;}
  return Promise.all(files.filter(file=>file.endsWith('.json')).map(async file=>JSON.parse(await fs.readFile(path.join(target,file),'utf8'))));
}

// GitHub API stdin carries structured bodies; credentials stay in the runner's
// environment and neither error bodies nor auth headers reach the public log.
function validateClockAPIEndpoint(endpoint,method){
  const allowed=/^repos\/xndanius\/while-you-sleep\/(?:actions\/(?:runs\/\d+(?:\/cancel)?|workflows\/(?:clock|loop|research|measure|improve|curate)\.yml\/dispatches)|deployments(?:\?environment=clock-runtime&per_page=1)?)$/;
  if(!allowed.test(endpoint)||!['GET','POST'].includes(method))throw new Error('Unsupported clock API endpoint.');
}
function clockAPIOnce(endpoint,{method='GET',body,env=process.env}={}) {
  validateClockAPIEndpoint(endpoint,method);
  if(method==='GET'&&endpoint.endsWith('/deployments?environment=clock-runtime&per_page=1')&&env.CLOCK_RUNTIME_MODE!=='deployments-v1'){
    // An already-created workflow retains its old token scopes. Public runtime
    // metadata lets it hand over safely without needing a new credential.
    return (async()=>{
      try{
        const response=await fetch(`https://api.github.com/${endpoint}`,{headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'},signal:AbortSignal.timeout(30000)});
        if(!response.ok)throw new Error('Unavailable.');
        const chunks=[];let bytes=0;
        for await(const chunk of response.body){bytes+=chunk.length;if(bytes>2*1024*1024)throw new Error('Oversized.');chunks.push(chunk);}
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      }catch{throw new Error('Clock public runtime API is unavailable.');}
    })();
  }
  return new Promise((resolve,reject)=>{
    const args=['api','--method',method,'-H','X-GitHub-Api-Version: 2026-03-10',endpoint];
    if (body!==undefined) args.push('--input','-');
    const child=spawn('gh',args,{env,stdio:['pipe','pipe','pipe']});let output='';let bytes=0;
    const timeout=setTimeout(()=>child.kill('SIGTERM'),30000);
    child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>2*1024*1024){child.kill('SIGTERM');return;}output+=chunk.toString();});
    child.stderr.resume();
    child.on('error',()=>{clearTimeout(timeout);reject(new Error('Clock GitHub API is unavailable.'));});
    child.on('close',code=>{clearTimeout(timeout);if(code!==0||bytes>2*1024*1024)return reject(new Error('Clock GitHub API is unavailable.'));try{resolve(output.trim()?JSON.parse(output):null);}catch{reject(new Error('Clock GitHub API response is invalid.'));}});
    child.stdin.end(body===undefined?'':JSON.stringify(body));
  });
}

export async function retryClockRead(read,{attempts=3,pause=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds))}={}) {
  if(typeof read!=='function'||!Number.isInteger(attempts)||attempts<1||attempts>3)throw new Error('Clock reads have a fixed bounded retry budget.');
  for(let attempt=0;attempt<attempts;attempt++){
    try{return await read();}catch(error){if(attempt===attempts-1)throw error;await pause(250*(attempt+1));}
  }
}
export async function requestClockAPI(request,endpoint,options={}) {
  // Reads authorize nothing. An uncertain dispatch or deployment POST must
  // retain its existing exact-receipt handling; never blindly repeat it here.
  return (options.method||'GET')==='GET'?retryClockRead(()=>request(endpoint,options)):request(endpoint,options);
}
export function clockAPI(endpoint,options={}) {
  validateClockAPIEndpoint(endpoint,options.method||'GET');
  return requestClockAPI(clockAPIOnce,endpoint,options);
}

export async function dispatchClockWorkflow(workflow,inputs={}, {api=clockAPI,env=process.env}={}) {
  if (![CLOCK_WORKFLOW,...kinds.map(kind=>kind+'.yml')].includes(workflow)) throw new Error('Unknown clock dispatch target.');
  const result=await api(`repos/${CLOCK_REPOSITORY}/actions/workflows/${workflow}/dispatches`,{method:'POST',body:{ref:'main',inputs},env});
  if (!numericId(result?.workflow_run_id) || result.html_url!==clockRunURL(result.workflow_run_id)) throw new Error('Clock dispatch has no exact trusted run binding.');
  return {runId:String(result.workflow_run_id),githubRunUrl:result.html_url};
}
