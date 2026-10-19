import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {boundedRepairJSON,repairHash,repairEpisodeMatches,validateRepairContext} from './prepare-watchdog-repair.mjs';

const REPO='xndanius/while-you-sleep';
const protectedPaths=new Set(['lib/validation.mjs','lib/privacy.mjs','lib/demand.mjs','lib/checker-output.mjs','lib/scoring.mjs','lib/novelty.mjs','lib/source-fetch.mjs','lib/robots.mjs','lib/loop-schedule.mjs','lib/clock-provenance.mjs','scripts/publish-checked.mjs','scripts/import-artifact.mjs','scripts/guard-private-artifacts.mjs','scripts/accept-check-output.mjs','scripts/finalize-run.mjs','scripts/settle-loop.mjs','scripts/open-watchdog-repair.mjs','scripts/prepare-watchdog-repair.mjs','scripts/install-encrypted-openai-secret.mjs']);
export function allowedRepairPath(file){
 return typeof file==='string'&&file.length<=200&&/^[A-Za-z0-9_./-]+$/.test(file)&&!file.startsWith('/')&&!file.split('/').some(part=>!part||part==='..'||part.startsWith('.'))&&!protectedPaths.has(file)&&(/^(?:lib|scripts|tests)\/.+\.mjs$/.test(file)||/^docs\/.+\.(?:md|json)$/.test(file)||/^public\/.+\.(?:js|css|html|svg)$/.test(file)&&!/^public\/(?:api|p|cards|method)\//.test(file)&&file!=='public/machine/index.html');
}
export function repairPatchPaths(patch){
 if(typeof patch!=='string'||Buffer.byteLength(patch)>2000000||!patch.trim()||/\x00|(?:^|\n)(?:GIT binary patch|Binary files |old mode |new mode |rename from |rename to |copy from |copy to |deleted file mode )|(?:^|\n)new file mode (?!100644(?:\n|$))|\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}|\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9_.-]{20,}/.test(patch))throw new Error('Repair proposal is not a bounded safe text patch.');
 const paths=[];for(const line of patch.split('\n')){
  if(line.startsWith('diff --git ')){const match=line.match(/^diff --git a\/([^ ]+) b\/([^ ]+)$/);if(!match||match[1]!==match[2]||!allowedRepairPath(match[1]))throw new Error('Repair patch touches a protected or unsupported path.');paths.push(match[1]);}
  if(line.startsWith('--- ')||line.startsWith('+++ ')){const value=line.slice(4);if(value!=='/dev/null'&&!/^[ab]\/[A-Za-z0-9_./-]+$/.test(value))throw new Error('Repair patch header contains an unsafe path.');if(value!=='/dev/null'&&!allowedRepairPath(value.slice(2)))throw new Error('Repair patch touches a protected path.');}
 }
 if(!paths.length||paths.length>16||new Set(paths).size!==paths.length)throw new Error('Repair patch exceeds its bounded path scope.');return paths;
}
function diagnosisPatch(context,reason){
 const file=`docs/WATCHDOG_DIAGNOSIS_${context.episodeId}.md`,lines=[`# Publishing watchdog diagnosis`, '',`Episode: ${context.episodeId}`,`Diagnosis issue: #${context.issueNumber}`,`Recorded hours without a post: ${context.diagnosis.hoursWithoutPost??'unknown'}`,`Posts in the last twelve hours: ${context.diagnosis.postsLast12Hours??'unknown'}`,'',`No verified functional repair was generated. ${reason}`,'','This draft pull request preserves a reviewable diagnosis; it does not claim to restore publishing or to pass tests.','The publication threshold and all independent checks remain unchanged.','',...Object.entries(context.diagnosis.reasonCounts||{}).map(([value,count])=>`- ${count} runs: ${value.replace(/[\r\n]/g,' ')}`)];
 return `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line=>'+'+line.trimEnd()).join('\n')}\n`;
}
export function publisherRetryAuthorized(state,context,env){
 const actions=state?.actions;
 return env.GITHUB_RUN_ATTEMPT==='2'&&context.runAttempt===1&&context.githubRunId===env.GITHUB_RUN_ID&&actions?.publisherRetryEpisode===context.episodeId&&actions.publisherRetryRunId===env.GITHUB_RUN_ID&&actions.publisherRetryAttempt===2&&['reserved','requested','unverified'].includes(actions.publisherRetryStatus)&&/^[a-f0-9]{40}$/.test(actions.publisherRetrySourceHeadSha||'');
}
function retryMetadataTrusted(metadata,context,actions){
 return String(metadata?.id)===context.githubRunId&&metadata.event==='workflow_dispatch'&&metadata.run_attempt===2&&metadata.path==='.github/workflows/repair.yml'&&metadata.head_branch==='main'&&metadata.head_sha===actions.publisherRetrySourceHeadSha&&metadata.repository?.full_name===REPO&&metadata.head_repository?.full_name===REPO&&metadata.head_repository?.fork===false&&metadata.actor?.login==='github-actions[bot]'&&metadata.actor?.type==='Bot'&&metadata.triggering_actor?.login==='github-actions[bot]'&&metadata.triggering_actor?.type==='Bot';
}
export async function openWatchdogRepair({root=process.cwd(),env=process.env,execute=null,log=console.log}={}){
 if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!==REPO||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_ACTOR!=='github-actions[bot]'||env.GITHUB_TRIGGERING_ACTOR!=='github-actions[bot]'||!['1','2'].includes(env.GITHUB_RUN_ATTEMPT))throw new Error('Repair publishing requires the trusted bounded watchdog bot job.');
 const invoke=execute||((command,args,options={})=>{const result=spawnSync(command,args,{cwd:root,env,encoding:'utf8',...options});if(result.status!==0)throw new Error('Trusted draft repair publication could not complete.');return result.stdout.trim();});
 const context=validateRepairContext(await boundedRepairJSON(path.join(root,'.staging','repair-context','context.json')),{expectedSha256:env.EXPECTED_REPAIR_CONTEXT_SHA,episodeId:env.WATCHDOG_EPISODE_ID,issueNumber:env.WATCHDOG_ISSUE_NUMBER});
 if(context.githubRunId!==env.GITHUB_RUN_ID)throw new Error('Repair context belongs to a different hosted run.');
 const state=await boundedRepairJSON(path.join(root,'data','watchdog','state.json'),3000000);if(!repairEpisodeMatches(state,{episodeId:context.episodeId,issueNumber:context.issueNumber}))return {status:'episode_resolved',pullRequestUrl:null};
 if(env.GITHUB_RUN_ATTEMPT==='2'){
  if(!publisherRetryAuthorized(state,context,env))throw new Error('Publisher retry lacks its exact committed reservation.');
  const metadata=JSON.parse(invoke('gh',['api',`repos/${REPO}/actions/runs/${env.GITHUB_RUN_ID}`]));
  if(!retryMetadataTrusted(metadata,context,state.actions))throw new Error('Publisher retry metadata is not the reserved bot attempt.');
 }
 const branch='watchdog/repair-'+context.episodeId.slice('starvation-'.length),existing=JSON.parse(invoke('gh',['pr','list','--repo',REPO,'--head',branch,'--state','all','--json','url,state,isDraft','--limit','10']));
 if(!Array.isArray(existing)||existing.length>10)throw new Error('Repair pull request lookup was invalid.');if(existing.length){const row=existing[0];if(!/^https:\/\/github\.com\/xndanius\/while-you-sleep\/pull\/[1-9]\d*$/.test(row.url||''))throw new Error('Repair pull request URL is invalid.');return {status:'already_recorded',pullRequestUrl:row.url};}
 const proposal=path.join(root,'.staging','repair-proposal','proposal.patch');let patch,paths,diagnosisOnly=false;
 try{const stat=await fs.lstat(proposal);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2000000)throw new Error();patch=await fs.readFile(proposal,'utf8');paths=repairPatchPaths(patch);invoke('git',['apply','--check','--whitespace=error-all','-'],{input:patch});diagnosisOnly=paths.every(file=>file.startsWith('docs/'));}
 catch{diagnosisOnly=true;patch=diagnosisPatch(context,'The model proposal was missing, invalid, touched protected paths, or did not apply to current main.');paths=repairPatchPaths(patch);invoke('git',['apply','--check','--whitespace=error-all','-'],{input:patch});}
 invoke('git',['switch','-c',branch]);invoke('git',['apply','--whitespace=error-all','-'],{input:patch});
 const changed=invoke('git',['diff','--name-only','--no-renames']).split('\n').filter(Boolean);const untracked=invoke('git',['ls-files','--others','--exclude-standard']).split('\n').filter(Boolean).filter(file=>!file.startsWith('.staging/')&&!file.startsWith('.run/'));
 if([...changed,...untracked].some(file=>!paths.includes(file)))throw new Error('Repair patch changed a file outside its reviewed allowlist.');
 invoke('git',['config','user.name','Autonomous Startup Ideas repair']);invoke('git',['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);invoke('git',['add','--',...paths]);invoke('git',['commit','-m',diagnosisOnly?`watchdog: diagnosis for ${context.episodeId}`:`watchdog: proposed repair for ${context.episodeId}`]);invoke('git',['push','origin',`HEAD:refs/heads/${branch}`]);
 const body=[`Refs #${context.issueNumber}.`,'',diagnosisOnly?'The automated repair did not produce a verified functional fix. This draft preserves the diagnosis for human review.':'This draft contains a model-proposed repair for the publishing watchdog episode. Human review and normal validation are required before merging.','',`The trusted gate bound the proposal to code base ${context.baseSha} and episode ${context.episodeId}.`,'','No proposal code or tests were executed with the publisher write token. No publication, test pass or recovery is claimed by this pull request. Threshold 6, independent checks and protected safety files remain unchanged. Auto-merge was not requested.','',`Changed files: ${paths.join(', ')}.`].join('\n');
 const bodyFile=path.join(root,'.run','watchdog-repair-pr-body.md');await fs.mkdir(path.dirname(bodyFile),{recursive:true});await fs.writeFile(bodyFile,body);
 const url=invoke('gh',['pr','create','--repo',REPO,'--base','main','--head',branch,'--draft','--title',diagnosisOnly?'Watchdog diagnosis: publishing recovery needs review':'Watchdog repair proposal: restore checked publications','--body-file',bodyFile]).split('\n').find(value=>/^https:\/\/github\.com\/xndanius\/while-you-sleep\/pull\/[1-9]\d*$/.test(value));
 if(!url)throw new Error('Draft repair pull request creation returned no verified repository URL.');
 const record={schema:1,id:context.episodeId,type:'watchdog-repair-pull-request',episodeId:context.episodeId,issueNumber:context.issueNumber,contextSha256:repairHash(context),baseSha:context.baseSha,githubRunId:context.githubRunId,pullRequestUrl:url,diagnosisOnly,autoMerge:false,createdAt:new Date().toISOString()};
 await fs.mkdir(path.join(root,'.run'),{recursive:true});await fs.writeFile(path.join(root,'.run','watchdog-repair-result.json'),JSON.stringify(record,null,2)+'\n');if(env.GITHUB_OUTPUT)await fs.appendFile(env.GITHUB_OUTPUT,`pull_request_url=${url}\ndiagnosis_only=${diagnosisOnly}\n`);log(JSON.stringify({status:'draft_created',pullRequestUrl:url,diagnosisOnly}));return record;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))openWatchdogRepair().catch(()=>{console.error('Trusted draft repair publication did not complete. No merge was attempted.');process.exitCode=1;});
