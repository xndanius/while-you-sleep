import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {ROOT,stableJSON,sha256,safeError} from '../lib/storage.mjs';
import {loadWatchdogHealth,watchdogStateChanged,RECOVERY_REPORT_DUE_AT} from '../lib/watchdog.mjs';

const repo='xndanius/while-you-sleep';
export function watchdogAPI(endpoint,{method='GET',body,env=process.env}={}){
 const allowed=typeof endpoint==='string'&&new RegExp(`^repos/${repo}/(?:actions/runs/[1-9]\\d*|issues(?:\\?state=all&per_page=100|/[1-9]\\d*)?|actions/workflows/repair\\.yml/dispatches)$`).test(endpoint);
 if(!allowed||!['GET','POST','PATCH'].includes(method))throw new Error('Unsupported watchdog API request.');
 return new Promise((resolve,reject)=>{const args=['api','--hostname','github.com','--method',method,'-H','X-GitHub-Api-Version: 2026-03-10',endpoint];if(body!==undefined)args.push('--input','-');const childEnv={...env,GH_PROMPT_DISABLED:'1'};delete childEnv.GH_DEBUG;const child=spawn('gh',args,{env:childEnv,stdio:['pipe','pipe','pipe']});let output='',bytes=0,done=false;const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);if(error)reject(error);else resolve(value);};const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new Error('Watchdog API request timed out.'));},30000);child.stdout.on('data',part=>{bytes+=part.length;if(bytes>2000000){child.kill('SIGKILL');finish(new Error('Watchdog API response exceeded its bound.'));}else output+=part;});child.stderr.on('data',()=>{});child.on('error',()=>finish(new Error('Watchdog API unavailable.')));child.on('close',code=>{if(code!==0)return finish(new Error('Watchdog API request failed.'));try{finish(null,output?JSON.parse(output):null);}catch{finish(new Error('Watchdog API response was not JSON.'));}});child.stdin.end(body===undefined?'':JSON.stringify(body));});
}
export function diagnosisMarkdown(health){
 return `No checked post has been published for ${health.hoursWithoutPost.toFixed(1)} hours.\n\nMode: **${health.mode}**. Checked posts in last12hours: ${health.postsLast12Hours}. Recovery requires two new checked posts.\n\nAutomatic recovery: broader source types, at most10 leads per run, three-hour lead cooldown; fallback requires a named nontechnical customer and fresh public demand evidence. Publish threshold6 and independent checks remain intact.\n\nRecent no-post reasons:\n\n${health.noPostRuns.slice(0,40).map(row=>`- ${row.finishedAt}: ${row.reason} ${row.githubRunUrl?'[Run]('+row.githubRunUrl+')':''}`).join('\n')}\n\n[All no-post reasons and current health](https://xndanius.github.io/while-you-sleep/api/health.json) · [Machine](https://xndanius.github.io/while-you-sleep/machine/#health-heading)\n\nThe repair workflow may open a pull request. It must never merge it automatically.`;
}
async function optional(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function git(root,args){const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});if(result.status!==0)throw new Error('Watchdog could not persist its trusted record.');return result.stdout;}
async function save(root,health,message){const file=path.join(root,'data','watchdog','state.json');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(health,null,2)+'\n');git(root,['config','user.name','Autonomous Startup Ideas watchdog']);git(root,['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);git(root,['add','--','data/watchdog']);if(!git(root,['diff','--cached','--name-only']).trim())return false;git(root,['commit','-m',message]);for(let attempt=0;attempt<3;attempt++){const result=spawnSync('git',['push','origin','HEAD:main'],{cwd:root,encoding:'utf8'});if(result.status===0)return true;git(root,['pull','--rebase','origin','main']);}throw new Error('Watchdog record push failed.');}
export async function runWatchdog({root=ROOT,env=process.env,now=new Date(),api=watchdogAPI,commit=save}={}){
 if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!==repo||env.GITHUB_REF!=='refs/heads/main'||!['workflow_dispatch','schedule'].includes(env.GITHUB_EVENT_NAME))throw new Error('Watchdog needs its hosted default-branch workflow.');
 const caller=await api(`repos/${repo}/actions/runs/${env.GITHUB_RUN_ID}`,{env});
 if(caller.repository?.full_name!==repo||caller.head_repository?.full_name!==repo||caller.head_repository?.fork!==false||caller.head_branch!=='main'||!['.github/workflows/clock.yml','.github/workflows/recovery-report.yml'].includes(caller.path)||caller.run_attempt!==1)throw new Error('Watchdog caller provenance is invalid.');
 const health=await loadWatchdogHealth({root,now}),previous=await optional(path.join(root,'data','watchdog','state.json'));
 const actions={...health.actions};health.actions=actions;let committed=false;
 if(health.mode==='repair'&&health.episode){
  const title=`Publishing stalled — ${health.episode.id}`;
  if(!actions.issueNumber||actions.issueEpisode!==health.episode.id){
   const issues=await api(`repos/${repo}/issues?state=all&per_page=100`,{env});if(!Array.isArray(issues))throw new Error('Watchdog issue listing unavailable.');
   const issue=issues.find(row=>row.title===title&&!row.pull_request)||await api(`repos/${repo}/issues`,{method:'POST',body:{title,body:diagnosisMarkdown(health),assignees:['xndanius']},env});
   if(!Number.isSafeInteger(issue.number)||!issue.html_url?.startsWith(`https://github.com/${repo}/issues/`))throw new Error('Watchdog issue creation is unverified.');
   actions.issueNumber=issue.number;actions.issueUrl=issue.html_url;actions.issueEpisode=health.episode.id;
  }
  if(actions.repairEpisode!==health.episode.id){
   // Commit the at-most-once reservation before dispatch. An uncertain POST is
   // surfaced, never blindly repeated and billed on every clock tick.
   actions.repairEpisode=health.episode.id;actions.repairStatus='dispatch_reserved';actions.repairRequestedAt=new Date(now).toISOString();
   committed=await commit(root,health,'watchdog: reserve one repair for stalled publishing')||committed;
   try{const repair=await api(`repos/${repo}/actions/workflows/repair.yml/dispatches`,{method:'POST',body:{ref:'main',inputs:{episode_id:health.episode.id,issue_number:String(actions.issueNumber)}},env});if(!/^\d+$/.test(String(repair?.workflow_run_id))||repair.html_url!==`https://github.com/${repo}/actions/runs/${repair.workflow_run_id}`)throw new Error('Repair dispatch lacks its exact workflow identity.');actions.repairStatus='dispatched';actions.repairRunUrl=repair.html_url;}catch{actions.repairStatus='dispatch_unverified';}
  }
 }
 if(Date.parse(now)>=Date.parse(RECOVERY_REPORT_DUE_AT)&&!actions.reportSentAt){
  const directory=path.join(root,'data','curations');let files=[];try{files=await fs.readdir(directory);}catch(error){if(error.code!=='ENOENT')throw error;}
  const recovery=await optional(path.join(root,'data','recovery','config.json')),startedAt=recovery?.startedAt||'2026-10-19T00:00:00.000Z';
  const postFiles=await fs.readdir(path.join(root,'data','posts'));const posts=(await Promise.all(postFiles.filter(file=>file.endsWith('.json')).map(file=>optional(path.join(root,'data','posts',file))))).filter(post=>post&&Date.parse(post.publishedAt)>=Date.parse(startedAt));
  const picks=(await Promise.all(files.filter(file=>file.endsWith('.json')).map(file=>optional(path.join(directory,file))))).filter(record=>record?.outcome==='picked'&&Date.parse(record.selectedAt||record.pick?.pickedAt)>=Date.parse(startedAt));
  const report={schema:1,id:'recovery-report-2026-10-20',createdAt:new Date(now).toISOString(),startedAt,posts:posts.map(post=>({id:post.id,publishedAt:post.publishedAt,url:`https://xndanius.github.io/while-you-sleep/p/${post.id}/`})),picks:picks.map(record=>({id:record.id,postId:record.pick.postId})),mode:health.mode,goalMet:posts.length>=3&&picks.length>=1};
  const title='Publishing recovery report — 20 October 2026',body=`Checked posts since recovery: **${posts.length}**. Durable LinkedIn feed picks: **${picks.length}**. Watchdog mode: **${health.mode}**. Three-post/one-pick goal: **${report.goalMet?'met':'not yet met'}**.\n\n${posts.map(post=>`- [${post.title}](https://xndanius.github.io/while-you-sleep/p/${post.id}/) — ${post.publishedAt}`).join('\n')}\n\n${diagnosisMarkdown(health)}`;
  const issues=await api(`repos/${repo}/issues?state=all&per_page=100`,{env});const existing=issues.find(row=>row.title===title&&!row.pull_request);const issue=existing||await api(`repos/${repo}/issues`,{method:'POST',body:{title,body,assignees:['xndanius']},env});if(!Number.isSafeInteger(issue.number))throw new Error('Recovery report delivery is unverified.');
  await fs.mkdir(path.join(root,'data','watchdog','reports'),{recursive:true});const reportFile=path.join(root,'data','watchdog','reports','2026-10-20.json');try{await fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n',{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;const existing=await optional(reportFile);if(existing?.schema!==1||existing.id!==report.id||existing.startedAt!==startedAt)throw new Error('Existing immutable recovery report is inconsistent.');}actions.reportSentAt=new Date(now).toISOString();actions.reportUrl=issue.html_url;
 }
 if(watchdogStateChanged(previous,health)||actions.repairStatus==='dispatched'&&previous?.actions?.repairStatus!=='dispatched')committed=await commit(root,health,`watchdog: ${health.mode} · publishing health and recovery actions`)||committed;
 if(env.GITHUB_OUTPUT)await fs.appendFile(env.GITHUB_OUTPUT,`committed=${committed}\nmode=${health.mode}\n`);
 console.log(JSON.stringify({mode:health.mode,committed,postsLast12Hours:health.postsLast12Hours,issueUrl:actions.issueUrl||null,repairStatus:actions.repairStatus||null,reportUrl:actions.reportUrl||null}));return {health,committed};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runWatchdog().catch(error=>{console.error(safeError(error));process.exitCode=1;});
