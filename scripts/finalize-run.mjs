import {spawnSync} from 'node:child_process';
import {readJSON,writeJSON,dataPath,records} from '../lib/storage.mjs';
import {validateLoopScheduling} from '../lib/loop-schedule.mjs';
import {settleLoop} from './settle-loop.mjs';
const runId=process.argv[2];
let scheduling;
if(process.env.LOOP_SCHEDULING_SHA)scheduling=validateLoopScheduling(await readJSON(dataPath('scheduling',runId)),{runId,expectedSha256:process.env.LOOP_SCHEDULING_SHA,eventName:process.env.GITHUB_EVENT_NAME});
if(process.env.GITHUB_ACTIONS==='true'&&!scheduling)throw new Error('Trusted scheduling decision is required for loop finalization.');
if(scheduling?.decision==='skip'){
 const now=new Date().toISOString();
 await writeJSON(dataPath('runs',runId),{id:runId,type:'loop',status:`skipped_${scheduling.reason}`,startedAt:scheduling.requestedAt,finishedAt:now,eventName:scheduling.eventName,scheduling,modelExecuted:false,published:[],rejected:[],steps:[{stage:'schedule',status:'skipped',at:now,message:scheduling.reason}],githubRunUrl:scheduling.githubRunUrl,engine:'GitHub Actions trusted scheduling gate'},{immutable:true});
 console.log(JSON.stringify({runId,status:'skipped',reason:scheduling.reason,published:[]}));
}else{
const child=spawnSync(process.execPath,['scripts/publish-checked.mjs',runId],{encoding:'utf8'});
if(child.stdout)process.stdout.write(child.stdout);
if(child.status!==0){
 let existing;try{existing=await readJSON(dataPath('runs',runId))}catch{}
 if(!existing){
  let research;try{research=await readJSON(dataPath('research',runId));}catch{}
  let usage;try{usage=await readJSON(dataPath('usage',runId));}catch{usage={inputTokens:null,outputTokens:null,costUsd:null};}
  const published=(await records('posts')).filter(post=>post.runId===runId).map(post=>post.id);
  await writeJSON(dataPath('runs',runId),{id:runId,type:'loop',status:published.length?'completed_with_failure':'failed_closed',startedAt:scheduling?.requestedAt||research?.createdAt||new Date().toISOString(),finishedAt:new Date().toISOString(),eventName:scheduling?.eventName||process.env.GITHUB_EVENT_NAME||'unknown',...(scheduling?{scheduling}:{}),modelExecuted:!!research,published,rejected:[{reason:'Research, model, independent check or deterministic publication gate did not complete.'}],steps:[{stage:'check',status:'failed',message:'Nothing was published without a valid separate checker approval.'}],githubRunUrl:scheduling?.githubRunUrl||research?.githubRunUrl||null,engine:'official openai/codex-action',usage},{immutable:true});
 }
 console.log('Loop recorded its rejection/failure; its reserved slot remains eligible for a bounded retry.');
}
if(scheduling)await settleLoop(runId);
}
