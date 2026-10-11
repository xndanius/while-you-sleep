import path from 'node:path';
import { readJSON,stableJSON,validId } from './storage.mjs';
import { CLOCK_REPOSITORY,CLOCK_WAIT_MINUTES,clockAPI,clockRunURL } from './clock.mjs';
import { trustedClockTick } from './clock-provenance.mjs';

export const CLOCK_RUNTIME_MODE='deployments-v1';
export const CLOCK_RUNTIME_ENVIRONMENT='clock-runtime';
export const CLOCK_RUNTIME_ENDPOINT=`repos/${CLOCK_REPOSITORY}/deployments?environment=${CLOCK_RUNTIME_ENVIRONMENT}&per_page=1`;
const workflows=['clock.yml','loop.yml','research.yml','measure.yml','improve.yml','curate.yml'];
const numeric=value=>/^[1-9]\d{0,15}$/.test(String(value||''))&&Number.isSafeInteger(Number(value));
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const nullableTime=value=>value===null||timestamp(value);
const runStatus=new Set(['queued','requested','pending','waiting','in_progress','completed']);

export async function runtimeEnabled(root,env=process.env){
  if(env.CLOCK_RUNTIME_MODE===CLOCK_RUNTIME_MODE)return true;
  try{return (await readJSON(path.join(root,'data','clock','runtime-config.json'))).mode===CLOCK_RUNTIME_MODE;}
  catch(error){if(error.code==='ENOENT')return false;throw error;}
}
export const runtimeWritable=env=>env.CLOCK_RUNTIME_MODE===CLOCK_RUNTIME_MODE;

export function validRuntimeState(state){
  return !!state&&validId(state.chainId)&&integer(state.generation)&&numeric(state.expectedRunId)
    &&Number.isSafeInteger(state.expectedRunAttempt)&&state.expectedRunAttempt>0
    &&['queued','waiting','fenced'].includes(state.phase)&&state.waitMinutes===CLOCK_WAIT_MINUTES
    &&timestamp(state.claimedAt)&&nullableTime(state.lastTickAt)&&nullableTime(state.nextTickAt)
    &&state.clockRunUrl===clockRunURL(state.expectedRunId)
    &&(state.parentRunId===null?state.parentRunAttempt===0:numeric(state.parentRunId)&&Number.isSafeInteger(state.parentRunAttempt)&&state.parentRunAttempt>0);
}

export function validateRuntimeDeployment(deployment,{now=new Date()}={}){
  const payload=deployment?.payload,producer=payload?.producer,state=payload?.state;
  if(!deployment||!numeric(deployment.id)||deployment.environment!==CLOCK_RUNTIME_ENVIRONMENT||deployment.ref!=='main'
    ||deployment.task!=='clock:state'||deployment.repository_url!==`https://api.github.com/repos/${CLOCK_REPOSITORY}`
    ||deployment.creator?.login!=='github-actions[bot]'||deployment.creator?.type!=='Bot'
    ||deployment.transient_environment!==true||deployment.production_environment!==false||!/^[a-f0-9]{40}$/.test(deployment.sha||'')
    ||!payload||typeof payload!=='object'||Array.isArray(payload)||Buffer.byteLength(stableJSON(payload))>262144
    ||payload.schema!==1||payload.kind!=='clock-runtime'||payload.repository!==CLOCK_REPOSITORY
    ||!timestamp(payload.recordedAt)||Date.parse(payload.recordedAt)>new Date(now).getTime()+60000
    ||!timestamp(deployment.created_at)||Math.abs(Date.parse(deployment.created_at)-Date.parse(payload.recordedAt))>5*60000
    ||!producer||!numeric(producer.runId)||!Number.isSafeInteger(producer.runAttempt)||producer.runAttempt<1
    ||!workflows.includes(producer.workflow)||!['schedule','workflow_dispatch'].includes(producer.eventName)
    ||!validRuntimeState(state)||state.runtimeUpdatedAt!==payload.recordedAt
    ||(payload.receipt!==null&&!trustedClockTick(payload.receipt)))throw new Error('Clock runtime deployment is untrusted.');
  const receipt=payload.receipt;
  if(payload.transition==='claim'){
    if(producer.workflow!=='clock.yml'||producer.eventName!=='workflow_dispatch'||state.phase!=='waiting'
      ||String(state.expectedRunId)!==String(producer.runId)||state.expectedRunAttempt!==producer.runAttempt
      ||state.claimedAt!==payload.recordedAt)throw new Error('Clock runtime claim does not bind its producer.');
  }else if(payload.transition==='tick'){
    if(producer.workflow!=='clock.yml'||producer.eventName!=='workflow_dispatch'||state.phase!=='queued'
      ||!receipt||receipt.githubRunId!==String(producer.runId)||receipt.githubRunAttempt!==producer.runAttempt
      ||receipt.tickedAt!==payload.recordedAt||state.lastTickAt!==receipt.tickedAt
      ||receipt.chainId!==state.chainId||receipt.generation+1!==state.generation
      ||state.parentRunId!==String(producer.runId)||state.parentRunAttempt!==producer.runAttempt
      ||receipt.child?.runId!==String(state.expectedRunId)||receipt.child?.githubRunUrl!==state.clockRunUrl
      ||receipt.child?.generation!==state.generation)throw new Error('Clock runtime tick does not bind its exact successor.');
  }else if(payload.transition==='fence'){
    if(producer.workflow==='clock.yml'||state.phase!=='fenced'||state.fencedByRunId!==String(producer.runId)
      ||state.fencedAt!==payload.recordedAt)throw new Error('Clock runtime fence does not bind its backup.');
  }else if(payload.transition==='restart'){
    if(producer.workflow==='clock.yml'||state.phase!=='queued'||state.parentRunId!==null||state.lastTickAt!==null
      ||state.restartedByRunId!==String(producer.runId)||state.restartedAt!==payload.recordedAt)
      throw new Error('Clock runtime restart does not bind its backup.');
  }else throw new Error('Unknown clock runtime transition.');
  return payload;
}

export function trustedRuntimeProducer(run,producer){
  return !!run&&run.id===Number(producer.runId)&&run.run_attempt===producer.runAttempt
    &&run.repository?.full_name===CLOCK_REPOSITORY&&run.head_repository?.full_name===CLOCK_REPOSITORY
    &&run.head_branch==='main'&&run.path===`.github/workflows/${producer.workflow}`
    &&run.event===producer.eventName&&runStatus.has(run.status);
}

export async function loadClockState({root,env=process.env,api=clockAPI,now=new Date()}={}){
  let repositoryState=null;
  try{repositoryState=await readJSON(path.join(root,'data','clock','state.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!await runtimeEnabled(root,env))return {state:repositoryState,receipt:null,source:'repository'};
  const deployments=await api(CLOCK_RUNTIME_ENDPOINT,{env});
  if(!Array.isArray(deployments)||deployments.length>1)throw new Error('Clock runtime listing is invalid.');
  if(!deployments.length)return {state:repositoryState,receipt:null,source:'repository'};
  // A newer uncertain lease must never be hidden by a stale repository fallback.
  const deployment=deployments[0],payload=validateRuntimeDeployment(deployment,{now});
  const producer=await api(`repos/${CLOCK_REPOSITORY}/actions/runs/${payload.producer.runId}`,{env});
  if(!trustedRuntimeProducer(producer,payload.producer))throw new Error('GitHub did not verify the clock runtime producer.');
  if(repositoryState?.runtimeUpdatedAt&&timestamp(repositoryState.runtimeUpdatedAt)
    &&Date.parse(repositoryState.runtimeUpdatedAt)>Date.parse(payload.recordedAt)){
    if(!validRuntimeState(repositoryState)||Date.parse(repositoryState.runtimeUpdatedAt)>new Date(now).getTime()+60000)
      throw new Error('Newer repository clock transition is invalid.');
    return {state:repositoryState,receipt:null,source:'repository'};
  }
  return {state:payload.state,receipt:payload.receipt,source:'deployment',deploymentId:String(deployment.id)};
}

export async function persistClockRuntime({state,receipt=null,transition,env=process.env,api=clockAPI,now=new Date()}={}){
  if(!runtimeWritable(env))throw new Error('This workflow has no clock runtime write capability.');
  if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!==CLOCK_REPOSITORY||env.GITHUB_REF!=='refs/heads/main'
    ||!numeric(env.GITHUB_RUN_ID)||!numeric(env.GITHUB_RUN_ATTEMPT))throw new Error('Clock runtime requires a trusted default-branch Actions writer.');
  const producerRun=await api(`repos/${CLOCK_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,{env});
  const workflow=producerRun?.path?.replace(/^\.github\/workflows\//,'');
  const producer={runId:String(env.GITHUB_RUN_ID),runAttempt:Number(env.GITHUB_RUN_ATTEMPT),workflow,eventName:env.GITHUB_EVENT_NAME};
  if(!trustedRuntimeProducer(producerRun,producer))throw new Error('Clock runtime writer identity is untrusted.');
  const recordedAt=new Date(now).toISOString(),payload={schema:1,kind:'clock-runtime',repository:CLOCK_REPOSITORY,transition,recordedAt,producer,state:{...state,runtimeUpdatedAt:recordedAt},receipt};
  // Validate before the first write, so malformed trusted-call arguments cannot
  // publish an invalid latest lease that would stop otherwise healthy readers.
  validateRuntimeDeployment({id:1,ref:'main',sha:producerRun.head_sha,task:'clock:state',environment:CLOCK_RUNTIME_ENVIRONMENT,
    repository_url:`https://api.github.com/repos/${CLOCK_REPOSITORY}`,creator:{login:'github-actions[bot]',type:'Bot'},
    transient_environment:true,production_environment:false,created_at:recordedAt,payload},{now});
  const body={ref:'main',task:'clock:state',auto_merge:false,required_contexts:[],payload,environment:CLOCK_RUNTIME_ENVIRONMENT,
    description:`Clock ${transition} ${producer.runId} · runtime state, no Git commit`,transient_environment:true,production_environment:false};
  // Identical deployment records are safe to retry: they authorize the same
  // exact lease and successor, never a second dispatch or a new chain.
  for(let attempt=0;attempt<3;attempt++){
    try{
      const deployment=await api(`repos/${CLOCK_REPOSITORY}/deployments`,{method:'POST',body,env});
      const accepted=validateRuntimeDeployment(deployment,{now});
      if(stableJSON(accepted)!==stableJSON(payload))throw new Error('Clock runtime response changed the exact lease.');
      return {state:payload.state,receipt,payload,deploymentId:String(deployment.id)};
    }catch{}
  }
  throw new Error('Clock runtime state could not be persisted.');
}
