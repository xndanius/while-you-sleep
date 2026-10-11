import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT,readJSON,writeJSON } from '../lib/storage.mjs';
import { CLOCK_REPOSITORY,CLOCK_WAIT_MINUTES,clockAPI,clockLiveness,clockRunURL,clockTickId,dispatchClockWorkflow,trustedClockRun } from '../lib/clock.mjs';
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
  let blockingParent=null;
  if(state?.parentRunId && sourceRun?.status==='queued'){
    const receipt=await readJSON(path.join(root,'data','clock','ticks',clockTickId(state.parentRunId,state.parentRunAttempt)+'.json'));
    if(receipt.id!==clockTickId(state.parentRunId,state.parentRunAttempt) || receipt.kind!=='clock-tick' || receipt.chainId!==state.chainId || receipt.githubRunId!==String(state.parentRunId) || receipt.githubRunAttempt!==state.parentRunAttempt || receipt.child?.runId!==String(state.expectedRunId) || receipt.child?.githubRunUrl!==clockRunURL(state.expectedRunId) || receipt.child?.generation!==state.generation)throw new Error('Clock backup parent is not bound to its expected child.');
    const parent=await api(`repos/${CLOCK_REPOSITORY}/actions/runs/${state.parentRunId}`,{env});
    if(!trustedClockRun(parent,state.parentRunId,state.parentRunAttempt))throw new Error('Clock backup parent run identity is untrusted.');
    if(parent.status!=='completed')blockingParent=parent;
  }
  const cancel=async(run,expectedAttempt)=>{
    if(run.status==='completed')return;
    try{await api(`repos/${CLOCK_REPOSITORY}/actions/runs/${run.id}/cancel`,{method:'POST',env});}
    catch{
      // Cancellation can race natural completion after the lease was fenced.
      const terminal=await api(`repos/${CLOCK_REPOSITORY}/actions/runs/${run.id}`,{env});
      if(!trustedClockRun(terminal,run.id,expectedAttempt)||terminal.status!=='completed')throw new Error('Clock cancellation remains uncertain after fencing.');
    }
  };
  const restartedAt=new Date(now).toISOString();
  if(state){
    const fenced={...state,phase:'fenced',fencedAt:restartedAt,fencedByRunId:String(env.GITHUB_RUN_ID)};
    await writeJSON(path.join(root,'data','clock','state.json'),fenced);
    await commit({root,paths:['data/clock/state.json'],message:`clock: backup ${env.GITHUB_RUN_ID} · fence stale chain before replacement`});
    await cancel(sourceRun,state.expectedRunAttempt);
    if(blockingParent)await cancel(blockingParent,state.parentRunAttempt);
  }
  const chainId=`clock-restart-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  const dispatched=await dispatchClockWorkflow('clock.yml',{chain_id:chainId,parent_run_id:'',parent_run_attempt:'',generation:'0'},{api,env});
  const nextState={chainId,generation:0,expectedRunId:dispatched.runId,expectedRunAttempt:1,parentRunId:null,parentRunAttempt:0,phase:'queued',lastTickAt:null,nextTickAt:new Date(new Date(now).getTime()+CLOCK_WAIT_MINUTES*60000).toISOString(),clockRunUrl:clockRunURL(dispatched.runId),waitMinutes:CLOCK_WAIT_MINUTES,claimedAt:restartedAt,restartedAt,restartedByRunId:String(env.GITHUB_RUN_ID),previousChainId:state?.chainId||null};
  await writeJSON(path.join(root,'data','clock','state.json'),nextState);
  await commit({root,paths:['data/clock/state.json'],message:`clock: backup ${env.GITHUB_RUN_ID} · restart timer chain with exact run ${dispatched.runId}`});
  console.log(JSON.stringify({restarted:true,runId:dispatched.runId,reason:live.reason}));return {restarted:true,runId:dispatched.runId,reason:live.reason};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))ensureClock().catch(()=>{console.error('Clock backup failed closed; no uncertain replacement was accepted.');process.exitCode=1;});
