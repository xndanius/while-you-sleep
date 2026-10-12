import {promises as fs} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT,stableJSON,sha256,safeError} from '../lib/storage.mjs';
import {safetyApiGet,validateV5SafetyConfig,trustedSafetyClockCaller,v5RunEligibility,safetyDecision,rollbackV5} from '../lib/v5-safety.mjs';

const repository='xndanius/while-you-sleep';
async function optional(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function git(root,args,{optional=false}={}){const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});if(result.status!==0&&!optional)throw new Error('V5 safety git operation failed: '+args[0]);return result;}
export async function verifiedCompletion({root,config}){
 const completion=await optional(path.join(root,'data','v5-safety','complete.json'));if(!completion)return null;
 const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
 if(completion.schema!==1||completion.id!=='v5-safety-complete'||completion.type!=='v5-safety-complete'||completion.activatedAt!==config.activatedAt||completion.baselineCommit!==config.baselineCommit||!date(completion.completedAt)||!Array.isArray(completion.firstTwo)||completion.firstTwo.length!==2||new Set(completion.firstTwo.map(row=>row.runId)).size!==2)throw new Error('Terminal V5 proof is missing its exact activated first-two identity.');
 const runs=[];
 for(const [index,row] of completion.firstTwo.entries()){
  const match=typeof row.runId==='string'&&row.runId.match(/^loop-([1-9]\d{0,15})-1$/);
  if(!match||row.githubRunId!==match[1]||row.ordinal!==index+1||row.conclusion!=='success'||!date(row.startedAt)||Date.parse(row.startedAt)<Date.parse(config.activatedAt)||!['pre_model_selection_and_reserved_gate','reserved_v5_gate_before_selector'].includes(row.proof)||!/^[a-f0-9]{64}$/.test(row.resultSha256||''))throw new Error('Terminal V5 proof cannot mask a failed, rerun or invalid result.');
  const result=await optional(path.join(root,'data','v5-safety','results',row.runId+'.json'));
  if(!result||sha256(stableJSON(result))!==row.resultSha256||result.schema!==1||result.id!==row.runId||result.type!=='v5-safety-result'||result.activatedAt!==config.activatedAt||result.ordinal!==row.ordinal||result.githubRunId!==row.githubRunId||result.githubRunUrl!==`https://github.com/${repository}/actions/runs/${row.githubRunId}`||result.startedAt!==row.startedAt||result.conclusion!=='success'||result.proof!==row.proof||!date(result.checkedAt)||Date.parse(result.checkedAt)>Date.parse(completion.completedAt))throw new Error('Terminal V5 proof does not match its immutable per-run result.');
  runs.push({...row,eligible:true});
 }
 if(runs[0].startedAt>runs[1].startedAt||runs[0].startedAt===runs[1].startedAt&&Number(runs[0].githubRunId)>Number(runs[1].githubRunId))throw new Error('Terminal V5 proof changed the chronological first-two order.');
 return {state:'verified',runs,rollback:false,committed:false,completionId:completion.id};
}
export async function verifyV5Safety({root=ROOT,env=process.env,apiGet=safetyApiGet,now=new Date(),push=true}={}){
 const clockCall=env.GITHUB_EVENT_NAME==='workflow_dispatch';
 if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!==repository||!['workflow_run','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)||clockCall&&(env.GITHUB_REF!=='refs/heads/main'||!/^[1-9]\d{0,15}$/.test(env.GITHUB_RUN_ID||'')||env.GITHUB_RUN_ATTEMPT!=='1'||env.GITHUB_ACTOR!=='github-actions[bot]'||env.GITHUB_TRIGGERING_ACTOR!=='github-actions[bot]'))throw new Error('V5 safety requires its workflow_run job or an exact first-attempt hosted clock caller.');
 const config=await optional(path.join(root,'data','v5-safety','config.json'));if(!config)return {state:'not_activated',committed:false,rollback:false};validateV5SafetyConfig(config);
 const completed=await verifiedCompletion({root,config});if(completed)return completed;
 const get=async endpoint=>{const body=await apiGet(`repos/${repository}/${endpoint}`,{maxBytes:4*1024*1024,env});return typeof body==='string'?JSON.parse(body):body;};
 // A completed proof grants no new mutation. Every incomplete clock call must
 // independently verify the real caller before listing or recording results.
 if(clockCall&&!trustedSafetyClockCaller(await get(`actions/runs/${env.GITHUB_RUN_ID}`),env))throw new Error('The reusable safety caller is not the authoritative first-attempt bot clock on main.');
 const query=`actions/workflows/loop.yml/runs?per_page=100&branch=main&created=${encodeURIComponent('>='+config.activatedAt)}`,listed=await get(query),rows=[];
 if(!Array.isArray(listed.workflow_runs)||listed.total_count>100)throw new Error('The bounded first-two V5 run listing is unavailable or incomplete.');
 for(const listedRun of listed.workflow_runs){
  const runId=`loop-${listedRun.id}-1`,scheduling=await optional(path.join(root,'data','scheduling',runId+'.json'));if(!scheduling||scheduling.decision!=='run')continue;
  const run=await get(`actions/runs/${listedRun.id}`),selection=await optional(path.join(root,'data','learning-selection',runId+'.json'));
  let receipt=null,parent=null;if(scheduling.clock?.tickId){receipt=await optional(path.join(root,'data','clock','ticks',scheduling.clock.tickId+'.json'));if(receipt)parent=await get(`actions/runs/${scheduling.clock.clockRunId}`);}
  const ref=selection?.producer?.headSha||run.head_sha;if(!/^[a-f0-9]{40}$/.test(ref||''))continue;
  const code=git(root,['show',`${ref}:data/v5-safety/config.json`],{optional:true});let codeConfig=null;if(code.status===0)try{codeConfig=JSON.parse(code.stdout);}catch{}
  const row=v5RunEligibility(run,{config,scheduling,selection,receipt,parent,codeConfig});rows.push({...row,githubRunId:String(run.id)});
 }
 const decision=safetyDecision(rows);let committed=false;const changed=[];
 for(const [index,row] of decision.runs.entries()){
  if(row.conclusion===null)continue;
  const file=`data/v5-safety/results/${row.runId}.json`,record={schema:1,id:row.runId,type:'v5-safety-result',activatedAt:config.activatedAt,ordinal:index+1,githubRunId:row.githubRunId,githubRunUrl:`https://github.com/${repository}/actions/runs/${row.githubRunId}`,startedAt:row.startedAt,conclusion:row.conclusion,proof:row.proof,checkedAt:new Date(now).toISOString()};
  const previous=await optional(path.join(root,file));if(previous){if(previous.startedAt!==record.startedAt||previous.conclusion!==record.conclusion||previous.activatedAt!==record.activatedAt)throw new Error('Immutable V5 safety evidence changed.');continue;}
  await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.writeFile(path.join(root,file),JSON.stringify(record,null,2)+'\n',{flag:'wx'});changed.push(file);
 }
 if(decision.state==='verified'){
  const firstTwo=[];for(const [index,row] of decision.runs.entries()){const result=await optional(path.join(root,'data','v5-safety','results',row.runId+'.json'));firstTwo.push({runId:row.runId,githubRunId:row.githubRunId,ordinal:index+1,startedAt:row.startedAt,conclusion:'success',proof:row.proof,resultSha256:sha256(stableJSON(result))});}
  const file='data/v5-safety/complete.json',completion={schema:1,id:'v5-safety-complete',type:'v5-safety-complete',activatedAt:config.activatedAt,baselineCommit:config.baselineCommit,completedAt:new Date(now).toISOString(),firstTwo};
  await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.writeFile(path.join(root,file),JSON.stringify(completion,null,2)+'\n',{flag:'wx'});changed.push(file);
 }
 let rollback=false,receipt=null;
 if(decision.state==='rollback_required'){
  const restored=await rollbackV5({root,config,decision,now});receipt=restored.receipt;rollback=!restored.alreadyRecorded;if(restored.changedPaths)changed.push(...restored.changedPaths);
 }
 if(changed.length){
  git(root,['config','user.name','While You Sleep safety']);git(root,['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);
  git(root,['add','-A','--',...new Set(changed)]);git(root,['commit','-m',rollback?`safety: restore morning baseline after ${decision.failedRunId}`:`safety: first-two V5 automatic run proof · ${decision.state}`]);
  if(push)git(root,['push','origin','HEAD:main']);committed=true;
 }
 return {...decision,rollback,committed,receiptId:receipt?.id||null};
}
if(process.argv[1]&&path.resolve(process.argv[1])===new URL(import.meta.url).pathname){try{const result=await verifyV5Safety();if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,`rollback=${result.rollback}\ncommitted=${result.committed}\nstate=${result.state}\n`);console.log(JSON.stringify(result));}catch(error){console.error(safeError(error));process.exitCode=1;}}
