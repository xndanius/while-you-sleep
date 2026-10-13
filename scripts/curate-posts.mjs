import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {ROOT,readJSON,writeJSON,sha256,stableJSON,validId} from '../lib/storage.mjs';
import {verifyClockDispatch} from '../lib/clock-provenance.mjs';
import {CURATION_MINIMUM_SCORE,CURATION_DAILY_CAP,CURATION_LOOKBACK_HOURS,validateCurationConfig,readCurationRecords,curationDecision,validatedCurationPicks,selectCurationPost,validateCurationReceipt} from '../lib/curation.mjs';

function trustedEnvironment(env){
 if(!/^curate-[1-9]\d{0,15}-[1-9]\d{0,3}$/.test(env.RUN_ID||''))throw new Error('A bounded curator run identity is required.');
 if(env.GITHUB_ACTIONS==='true'&&(env.GITHUB_REPOSITORY!=='xndanius/while-you-sleep'||env.GITHUB_REF!=='refs/heads/main'||!['schedule','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)||env.RUN_ID!==`curate-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`))throw new Error('Curation requires the trusted main Actions workflow.');
}
async function output(env,values){if(env.GITHUB_OUTPUT)await fs.appendFile(env.GITHUB_OUTPUT,Object.entries(values).map(([key,value])=>`${key}=${value}\n`).join(''));console.log(JSON.stringify(values));}
export async function curationState(root){
 const config=await readJSON(path.join(root,'data','curation','config.json')),failures=validateCurationConfig(config);if(failures.length)throw new Error(failures.join(' '));
 return {config,receipts:await readCurationRecords(root)};
}
export async function prepareCurationGate({root=ROOT,env=process.env,now=new Date(),apiGet}={}){
 trustedEnvironment(env);const {config,receipts}=await curationState(root),clock=await verifyClockDispatch({kind:'curate',root,env,now,apiGet}),decision=curationDecision({config,receipts,now});
 const gate={...decision,runId:env.RUN_ID,selectedAt:new Date(now).toISOString(),...(clock?{clock}:{})};
 await writeJSON(path.join(root,'.run','curation-gate.json'),gate);
 await output(env,{due:String(decision.due),reason:decision.reason,slot_count:String(decision.slots.length)});return gate;
}
async function originalPosts(root){
 const directory=path.join(root,'data','posts'),files=await fs.readdir(directory);
 return Promise.all(files.map(async file=>{
  if(!file.endsWith('.json')||!validId(file.slice(0,-5)))throw new Error('Unexpected original post filename.');
  const target=path.join(directory,file),stat=await fs.lstat(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>262144)throw new Error('Original post is not a bounded immutable record.');
  const post=await readJSON(target);if(post.id+'.json'!==file)throw new Error('Original post changed its physical identity.');return post;
 }));
}
async function scoreSidecars(root,posts){
 const sidecars=new Map();
 for(const post of posts){try{sidecars.set(post.id,await readJSON(path.join(root,'data','scores',post.id+'.json')));}catch(error){if(error.code!=='ENOENT')throw error;}}
 return sidecars;
}
export function curationReceipt({slot,config,pick,receipts,policy,rulesSha256,env,clock=null,now=new Date()}={}){
 const selectedAt=new Date(now).toISOString(),cap=receipts.filter(receipt=>receipt.outcome==='picked'&&receipt.localDate===slot.localDate).length>=CURATION_DAILY_CAP;
 if(cap)pick=null;
 const outcome=cap?'daily_cap':pick?'picked':'empty',reason=cap?'daily_curation_cap_reached':pick?'highest_eligible_checked_score':'no_eligible_checked_post';
 const receipt={schema:1,id:slot.id,type:'curation',slotId:slot.id,localDate:slot.localDate,localTime:slot.localTime,scheduledAt:slot.scheduledAt,activatedAt:config.activatedAt,selectedAt,windowStart:new Date(Date.parse(selectedAt)-CURATION_LOOKBACK_HOURS*3600000).toISOString(),windowEnd:selectedAt,outcome,scheduleStatus:'completed',reason,minimumScore:CURATION_MINIMUM_SCORE,dailyCap:CURATION_DAILY_CAP,runId:env.RUN_ID,githubRunId:env.RUN_ID.match(/^curate-(\d+)-/)[1],githubRunAttempt:Number(env.RUN_ID.match(/-(\d+)$/)[1]),githubRunUrl:`https://github.com/xndanius/while-you-sleep/actions/runs/${env.RUN_ID.match(/^curate-(\d+)-/)[1]}`,eventName:env.GITHUB_EVENT_NAME||'workflow_dispatch',rulesSha256,policySha256:policy.policySha256,pick,modelExecuted:false,engine:'GitHub Actions deterministic curator',...(clock?{clock}:{})};
 const failures=validateCurationReceipt(receipt,{config});if(failures.length)throw new Error(failures.join(' '));return receipt;
}
export async function writeCurationDecisions({root=ROOT,env=process.env,now=new Date(),apiGet}={}){
 trustedEnvironment(env);const {config,receipts}=await curationState(root),decision=curationDecision({config,receipts,now});if(!decision.due)return {written:[],receipts,reason:decision.reason};
 const clock=await verifyClockDispatch({kind:'curate',root,env,now,apiGet}),posts=await originalPosts(root),sidecars=await scoreSidecars(root,posts);
 await validatedCurationPicks({config,receipts,posts,sidecars});
 const {parseScoringPolicy}=await import('../lib/scoring.mjs'),rules=await fs.readFile(path.join(root,'RULES.md'),'utf8'),policy=parseScoringPolicy(rules),written=[];
 for(const slot of decision.slots){
  const cap=receipts.filter(receipt=>receipt.outcome==='picked'&&receipt.localDate===slot.localDate).length>=CURATION_DAILY_CAP;
  const pick=cap?null:await selectCurationPost({config,posts,sidecars,policy,receipts,now});
  const receipt=curationReceipt({slot,config,pick,receipts,policy,rulesSha256:sha256(rules),env,clock,now});
  await writeJSON(path.join(root,'data','curations',receipt.id+'.json'),receipt,{immutable:true});receipts.push(receipt);written.push(receipt);
 }
 return {written,receipts,reason:'curation_slots_settled'};
}
export async function publishCuration({root=ROOT,env=process.env,now,apiGet,push=env.GITHUB_ACTIONS==='true',gitRun}={}){
 trustedEnvironment(env);if(push&&env.GITHUB_ACTIONS!=='true')throw new Error('Curator pushes are restricted to its isolated Actions checkout.');
 const currentTime=()=>typeof now==='function'?new Date(now()):now?new Date(now):new Date(),attempted=new Set();
 const git=gitRun||((args,{optional=false}={})=>{const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});if(result.status!==0&&!optional)throw new Error(`Trusted curation Git operation failed: ${args[0]}`);return {ok:result.status===0,stdout:result.stdout||''};});
 if(push){git(['config','user.name','While You Sleep curator']);git(['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);git(['pull','--ff-only','origin','main']);}
 for(let attempt=0;attempt<(push?3:1);attempt++){
  // Only our unpushed receipt commits can be discarded on a race. Re-read main
  // and fully reselect under its latest policy, cap and prior picks each time.
  const base=push?git(['rev-parse','HEAD']).stdout.trim():null,result=await writeCurationDecisions({root,env,now:currentTime(),apiGet});
  for(const receipt of result.written)attempted.add(receipt.id);
  const ownCommitted=result.receipts.filter(receipt=>attempted.has(receipt.id)&&receipt.runId===env.RUN_ID);
  if(!result.written.length){const committed=ownCommitted.length>0;await output(env,{committed:String(committed),receipt_count:String(ownCommitted.length),pick_count:String(ownCommitted.filter(receipt=>receipt.outcome==='picked').length),reason:result.reason});return {committed,written:ownCommitted,reason:result.reason};}
  if(!push){await output(env,{committed:'false',receipt_count:String(result.written.length),pick_count:String(result.written.filter(receipt=>receipt.outcome==='picked').length),reason:result.reason});return {committed:false,...result};}
  for(const receipt of result.written){git(['add','--',`data/curations/${receipt.id}.json`]);git(['commit','-m',`curate: ${receipt.slotId} · ${receipt.outcome==='picked'?receipt.pick.postId+' independently checked score '+receipt.pick.scoring.overall.toFixed(1):receipt.reason}`]);}
  if(git(['push','origin','HEAD:main'],{optional:true}).ok){await output(env,{committed:'true',receipt_count:String(result.written.length),pick_count:String(result.written.filter(receipt=>receipt.outcome==='picked').length),reason:result.reason});return {committed:true,...result};}
  // This workflow owns a clean checkout and has no model workspace. Reset only
  // the unpublished commits just made above; no remote history is rewritten.
  git(['reset','--hard',base]);git(['pull','--ff-only','origin','main']);
 }
 throw new Error('Could not persist curation after three re-evaluated push attempts.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const command=process.argv[2];(command==='gate'?prepareCurationGate():command==='publish'?publishCuration():Promise.reject(new Error('Unknown curation command.'))).catch(()=>{console.error('Trusted curator stopped before an invalid or uncertain publication.');process.exitCode=1;});
}
