import {spawnSync} from 'node:child_process';
import {readJSON,writeJSON,dataPath} from '../lib/storage.mjs';
const runId=process.argv[2];
const child=spawnSync(process.execPath,['scripts/publish-checked.mjs',runId],{encoding:'utf8'});
if(child.stdout)process.stdout.write(child.stdout);
if(child.status!==0){
 let existing;try{existing=await readJSON(dataPath('runs',runId))}catch{}
 if(!existing){const research=await readJSON(dataPath('research',runId));await writeJSON(dataPath('runs',runId),{id:runId,type:'loop',status:'failed_closed',startedAt:research.createdAt,finishedAt:new Date().toISOString(),published:[],rejected:[{reason:'Independent check or deterministic publication gate did not complete.'}],steps:[{stage:'check',status:'failed',message:'Nothing was published without a valid separate checker approval.'}],githubRunUrl:research.githubRunUrl,engine:'official openai/codex-action',usage:{inputTokens:null,outputTokens:null,costUsd:null}},{immutable:true})}
 console.log('Loop recorded its rejection/failure; next scheduled run can proceed.');
}
