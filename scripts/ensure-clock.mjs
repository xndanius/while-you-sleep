import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT,readJSON,writeJSON } from '../lib/storage.mjs';
import { CLOCK_REPOSITORY,CLOCK_WAIT_MINUTES,clockAPI,clockLiveness,clockRunURL,dispatchClockWorkflow,trustedClockRun } from '../lib/clock.mjs';
import { commitClock } from './clock.mjs';

// Invoked under while-you-sleep-record by an existing cheap backup gate. A
// healthy chain causes no dispatch or repository write. A stalled chain is
// fenced before cancellation/replacement so its queued tick cannot publish.
export async function ensureClock({root=ROOT,env=process.env,now=new Date(),api=clockAPI,commit=commitClock}={}) {
  if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!==CLOCK_REPOSITORY||env.GITHUB_REF!=='refs/heads/main'||!['schedule','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)||!/^\d+$/.test(env.GITHUB_RUN_ID||'')||!/^\d+$/.test(env.GITHUB_RUN_ATTEMPT||''))throw new Error('Clock backup requires a trusted default-branch Actions gate.');
  let state=null;try{state=await readJSON(path.join(root,'data','clock','state.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
  let sourceRun=null;
  if(state?.expectedRunId){
    sourceRun=await api(`repos/${CLOCK_REPOSITORY}/actions/runs/${state.expectedRunId}`,{env});
    if(!trustedClockRun(sourceRun,state.expectedRunId))throw new Error('Clock backup source run identity is untrusted.');
  }
  const live=clockLiveness(state,sourceRun,now);
  if(live.alive){console.log(JSON.stringify({restarted:false,reason:live.reason}));return {restarted:false,reason:live.reason};}
  const restartedAt=new Date(now).toISOString();
  if(state){
    const fenced={...state,phase:'fenced',fencedAt:restartedAt,fencedByRunId:String(env.GITHUB_RUN_ID)};
    await writeJSON(path.join(root,'data','clock','state.json'),fenced);
    await commit({root,paths:['data/clock/state.json'],message:`clock: backup ${env.GITHUB_RUN_ID} · fence stale chain before replacement`});
    if(sourceRun.status!=='completed')await api(`repos/${CLOCK_REPOSITORY}/actions/runs/${state.expectedRunId}/cancel`,{method:'POST',env});
  }
  const chainId=`clock-restart-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  const dispatched=await dispatchClockWorkflow('clock.yml',{chain_id:chainId,parent_run_id:'',parent_run_attempt:'',generation:'0'},{api,env});
  const nextState={chainId,generation:0,expectedRunId:dispatched.runId,expectedRunAttempt:1,parentRunId:null,parentRunAttempt:0,phase:'queued',lastTickAt:null,nextTickAt:new Date(new Date(now).getTime()+CLOCK_WAIT_MINUTES*60000).toISOString(),clockRunUrl:clockRunURL(dispatched.runId),waitMinutes:CLOCK_WAIT_MINUTES,claimedAt:restartedAt,restartedAt,restartedByRunId:String(env.GITHUB_RUN_ID),previousChainId:state?.chainId||null};
  await writeJSON(path.join(root,'data','clock','state.json'),nextState);
  await commit({root,paths:['data/clock/state.json'],message:`clock: backup ${env.GITHUB_RUN_ID} · restart timer chain with exact run ${dispatched.runId}`});
  console.log(JSON.stringify({restarted:true,runId:dispatched.runId,reason:live.reason}));return {restarted:true,runId:dispatched.runId,reason:live.reason};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))ensureClock().catch(()=>{console.error('Clock backup failed closed; no uncertain replacement was accepted.');process.exitCode=1;});
