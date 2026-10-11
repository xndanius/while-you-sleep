import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ROOT,readJSON,writeJSON } from '../lib/storage.mjs';
import { CLOCK_REPOSITORY,CLOCK_WAIT_MINUTES,clockAPI,clockClaim,clockRecords,clockRunURL,clockTickId,dueClockDispatches,dispatchClockWorkflow,validateClockTick,trustedClockRun } from '../lib/clock.mjs';

function trustedEnvironment(env) {
  if (env.GITHUB_ACTIONS!=='true' || env.GITHUB_REPOSITORY!==CLOCK_REPOSITORY || env.GITHUB_EVENT_NAME!=='workflow_dispatch' || env.GITHUB_REF!=='refs/heads/main' || !/^\d+$/.test(env.GITHUB_RUN_ID||'') || !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT||'')) throw new Error('Clock requires a trusted default-branch Actions runner.');
}
async function stateAt(root) {try{return await readJSON(path.join(root,'data','clock','state.json'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function output(env,values) {if(env.GITHUB_OUTPUT)await fs.appendFile(env.GITHUB_OUTPUT,Object.entries(values).map(([key,value])=>`${key}=${value}\n`).join(''));console.log(JSON.stringify(values));}

export function commitClock({root=ROOT,paths,message}={}) {
  const git=args=>{const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});if(result.status!==0)throw new Error('Could not persist trusted clock state.');return result.stdout||'';};
  git(['config','user.name','While You Sleep clock']);git(['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);
  git(['add','--',...paths]);if(!git(['diff','--cached','--name-only']).trim())return;
  git(['commit','-m',message]);
  for(let attempt=0;attempt<3;attempt++) {
    const pushed=spawnSync('git',['push','origin','HEAD:main'],{cwd:root,encoding:'utf8'});
    if(pushed.status===0)return;
    git(['pull','--rebase','origin','main']);
  }
  throw new Error('Could not persist trusted clock state.');
}

export async function claimClock({root=ROOT,env=process.env,now=new Date(),api=clockAPI,commit=commitClock}={}) {
  trustedEnvironment(env);const state=await stateAt(root);let sourceRun=null;
  if(state?.expectedRunId && String(state.expectedRunId)!==env.GITHUB_RUN_ID){try{sourceRun=await api(`repos/${CLOCK_REPOSITORY}/actions/runs/${state.expectedRunId}`,{env});}catch{await output(env,{claimed:'false',reason:'clock_source_run_unavailable'});return {claimed:false,reason:'clock_source_run_unavailable'};}}
  const claim=clockClaim({state,sourceRun,runId:env.GITHUB_RUN_ID,attempt:Number(env.GITHUB_RUN_ATTEMPT),chainId:env.CLOCK_CHAIN_ID||'',parentRunId:env.CLOCK_PARENT_RUN_ID||'',parentAttempt:env.CLOCK_PARENT_RUN_ATTEMPT||'',generation:env.CLOCK_GENERATION||'',now});
  if(claim.claimed && state?.parentRunId){
    const parentReceipt=await readJSON(path.join(root,'data','clock','ticks',clockTickId(state.parentRunId,state.parentRunAttempt)+'.json'));
    if(parentReceipt.chainId!==state.chainId || parentReceipt.githubRunId!==String(state.parentRunId) || parentReceipt.githubRunAttempt!==state.parentRunAttempt || parentReceipt.child?.runId!==env.GITHUB_RUN_ID || parentReceipt.child?.generation!==state.generation || parentReceipt.child?.githubRunUrl!==clockRunURL(env.GITHUB_RUN_ID))throw new Error('Clock child is not bound to the immutable parent receipt.');
    const parent=await api(`repos/${CLOCK_REPOSITORY}/actions/runs/${state.parentRunId}`,{env});
    if(!trustedClockRun(parent,state.parentRunId,state.parentRunAttempt)||parent.status!=='completed')throw new Error('Clock parent workflow identity is untrusted or still active.');
  }
  if(claim.claimed){await writeJSON(path.join(root,'data','clock','state.json'),claim.state);await commit({root,paths:['data/clock/state.json'],message:`clock: ${env.GITHUB_RUN_ID} · singleton claim before the environment wait`});}
  await output(env,{claimed:String(claim.claimed),reason:claim.reason});return claim;
}

export async function tickClock({root=ROOT,env=process.env,now=new Date(),api=clockAPI,commit=commitClock}={}) {
  trustedEnvironment(env);const state=validateClockTick(await stateAt(root),{runId:env.GITHUB_RUN_ID,attempt:Number(env.GITHUB_RUN_ATTEMPT),now});
  const [posts,reservations,outcomes,research,measure,improve]=await Promise.all(['posts','slot-reservations','slot-outcomes','research','measurements','versions'].map(directory=>clockRecords(root,directory)));
  // Only bounded standalone no-model research files can complete a research slot.
  const researchDirectory=path.join(root,'data','research');let researchFiles=[];try{researchFiles=await fs.readdir(researchDirectory);}catch(error){if(error.code!=='ENOENT')throw error;}
  const trustedResearch=research.filter(record=>/^research-\d+-\d+$/.test(record.id||'')&&record.runId===record.id&&researchFiles.includes(record.id+'.json'));
  const plans=dueClockDispatches({posts,reservations,outcomes,completions:{research:trustedResearch,measure,improve},runId:env.GITHUB_RUN_ID,now});
  const id=clockTickId(env.GITHUB_RUN_ID,env.GITHUB_RUN_ATTEMPT),tickedAt=new Date(now).toISOString();
  const receipt={id,kind:'clock-tick',chainId:state.chainId,generation:state.generation,githubRunId:String(env.GITHUB_RUN_ID),githubRunAttempt:Number(env.GITHUB_RUN_ATTEMPT),githubRunUrl:clockRunURL(env.GITHUB_RUN_ID),parentRunId:state.parentRunId,environment:'clock',waitMinutes:CLOCK_WAIT_MINUTES,claimedAt:state.claimedAt,tickedAt,dispatches:[],child:null};
  for(const plan of plans){
    if(plan.kind==='loop' && plan.reason==='reservation_in_progress_or_unknown'){
      let active=false;
      for(const reservation of reservations.filter(record=>record.githubRepository===CLOCK_REPOSITORY && /^\d+$/.test(record.githubRunId||'') && (record.slotIds||[record.slotId]).some(id=>plan.slotIds.includes(id)))){
        let source;try{source=await api(`repos/${CLOCK_REPOSITORY}/actions/runs/${reservation.githubRunId}`,{env});}catch{continue;}
        if(source.id===Number(reservation.githubRunId) && source.repository?.full_name===CLOCK_REPOSITORY && source.head_repository?.full_name===CLOCK_REPOSITORY && source.head_branch==='main' && source.path==='.github/workflows/loop.yml' && ['waiting','queued','in_progress','pending','requested'].includes(source.status))active=true;
      }
      if(active)continue;
    }
    const dispatchId=`${id}-${plan.kind}`;
    const inputs={clock_tick_run_id:String(env.GITHUB_RUN_ID),clock_dispatch_id:dispatchId,clock_parent_attempt:String(env.GITHUB_RUN_ATTEMPT),...(plan.kind==='loop'?{bootstrap:false}:{})};
    const dispatched=await dispatchClockWorkflow(plan.workflow,inputs,{api,env});
    receipt.dispatches.push({...plan,...dispatched,dispatchId,requestedAt:tickedAt});
  }
  const child=await dispatchClockWorkflow('clock.yml',{chain_id:state.chainId,parent_run_id:String(env.GITHUB_RUN_ID),parent_run_attempt:String(env.GITHUB_RUN_ATTEMPT),generation:String(state.generation+1)},{api,env});
  receipt.child={...child,generation:state.generation+1};
  const nextState={...state,generation:state.generation+1,expectedRunId:child.runId,expectedRunAttempt:1,parentRunId:String(env.GITHUB_RUN_ID),parentRunAttempt:Number(env.GITHUB_RUN_ATTEMPT),phase:'queued',lastTickAt:tickedAt,nextTickAt:new Date(new Date(now).getTime()+CLOCK_WAIT_MINUTES*60000).toISOString(),clockRunUrl:child.githubRunUrl};
  await writeJSON(path.join(root,'data','clock','ticks',id+'.json'),receipt,{immutable:true});
  await writeJSON(path.join(root,'data','clock','state.json'),nextState);
  await commit({root,paths:['data/clock/state.json',`data/clock/ticks/${id}.json`],message:`clock: ${id} · timer released, ${receipt.dispatches.length} due gates, exact next run ${child.runId}`});
  await output(env,{ticked:'true',clock_tick_id:id,child_run_id:child.runId,dispatch_count:String(receipt.dispatches.length)});return receipt;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const action=process.argv[2];
  (action==='claim'?claimClock():action==='tick'?tickClock():Promise.reject(new Error('Unknown clock action.'))).catch(()=>{console.error('Trusted clock stopped before an uncertain or invalid action.');process.exitCode=1;});
}
