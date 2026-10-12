import {promises as fs} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {sha256,stableJSON,validId} from './storage.mjs';
import {isFrozenCodePath,CODE_FREEZE} from './code-freeze.mjs';
import {validClockProvenance,clockReceiptMatches,trustedClockTick} from './clock-provenance.mjs';

export const V5_BASELINE='57275e6ec9979007de2cc3e6c0ced8bf682962cb';
const REPO='xndanius/while-you-sleep',BOT='github-actions[bot]';
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const safePath=value=>typeof value==='string'&&/^[A-Za-z0-9._/-]+$/.test(value)&&!value.startsWith('/')&&!value.split('/').some(part=>part==='..'||!part);
const read=async file=>{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024)throw new Error('Safety input must be a bounded regular JSON file.');return JSON.parse(await fs.readFile(file,'utf8'));};
export function validateV5SafetyConfig(config){
 if(config?.schema!==1||config.id!=='v5-2026-10-12'||config.state!=='active'||!iso(config.activatedAt)||Date.parse(config.activatedAt)>=Date.parse(CODE_FREEZE.startsAt)||config.baselineCommit!==V5_BASELINE||config.morningCodePath!=='data/maintenance/v5-morning-code.json'||config.morningSourcesPath!=='data/maintenance/v5-morning-sources.json')throw new Error('V5 safety configuration is absent or invalid.');return config;
}
export function trustedSafetyClockCaller(run,env={}){
 const id=env.GITHUB_RUN_ID;
 return env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===REPO&&env.GITHUB_EVENT_NAME==='workflow_dispatch'&&env.GITHUB_REF==='refs/heads/main'&&/^[1-9]\d{0,15}$/.test(id||'')&&env.GITHUB_RUN_ATTEMPT==='1'&&env.GITHUB_ACTOR===BOT&&env.GITHUB_TRIGGERING_ACTOR===BOT&&String(run?.id)===id&&run?.repository?.full_name===REPO&&run?.head_repository?.full_name===REPO&&run?.head_repository?.fork===false&&run?.head_branch==='main'&&run?.path==='.github/workflows/clock.yml'&&run?.event==='workflow_dispatch'&&run?.run_attempt===1&&run?.actor?.login===BOT&&run?.triggering_actor?.login===BOT&&run?.html_url===`https://github.com/${REPO}/actions/runs/${id}`;
}
export function trustedAutomaticLoop(run,{scheduling,receipt,parent}={}){
 const id=String(run?.id||''),runId=`loop-${id}-1`;
 if(!/^[1-9]\d{0,15}$/.test(id)||run?.repository?.full_name!==REPO||run?.head_repository?.full_name!==REPO||run?.head_repository?.fork===true||run?.head_branch!=='main'||run?.path!=='.github/workflows/loop.yml'||run.run_attempt!==1||!Number.isFinite(Date.parse(run.run_started_at||run.created_at))||run.html_url!==`https://github.com/${REPO}/actions/runs/${id}`||scheduling?.runId!==runId||scheduling.id!==runId||scheduling.decision!=='run'||String(scheduling.githubRunId)!==id||scheduling.githubRunUrl!==run.html_url||scheduling.eventName!==run.event)return false;
 if(run.event==='schedule')return true;
 const clock=scheduling.clock;
 return run.event==='workflow_dispatch'&&run.actor?.login===BOT&&run.triggering_actor?.login===BOT&&validClockProvenance(clock,{kind:'loop',runId:id})&&clock.runAttempt===1&&clock.actor===BOT&&clock.triggeringActor===BOT&&trustedClockTick(receipt)&&clockReceiptMatches(clock,receipt)&&String(parent?.id)===clock.clockRunId&&parent?.repository?.full_name===REPO&&parent?.head_repository?.full_name===REPO&&parent?.head_branch==='main'&&parent?.path==='.github/workflows/clock.yml'&&parent?.event==='workflow_dispatch'&&Number(parent.run_attempt)===clock.parentAttempt&&parent.actor?.login===BOT&&parent.triggering_actor?.login===BOT;
}
export function v5RunEligibility(run,{config,scheduling,selection,receipt,parent,codeConfig}={}){
 validateV5SafetyConfig(config);
 if(!trustedAutomaticLoop(run,{scheduling,receipt,parent}))return {eligible:false,reason:'Not an exact first-attempt automatic reserved loop.'};
 const startedAt=run.run_started_at||run.created_at;if(!iso(scheduling.requestedAt)||Date.parse(startedAt)<Date.parse(config.activatedAt)||Date.parse(scheduling.requestedAt)<Date.parse(config.activatedAt))return {eligible:false,reason:'The reservation started before full V5 activation or has no valid timestamp.'};
 const sameActivation=codeConfig?.schema===1&&codeConfig.id===config.id&&codeConfig.state==='active'&&codeConfig.activatedAt===config.activatedAt&&codeConfig.baselineCommit===config.baselineCommit;
 if(!sameActivation)return {eligible:false,reason:'The run code did not contain this activated V5 configuration.'};
 if(selection){const producer=selection.producer;if(selection.schema!==1||selection.type!=='learning-selection'||selection.id!==scheduling.id||selection.runId!==scheduling.id||!iso(selection.createdAt)||Date.parse(selection.createdAt)<Date.parse(config.activatedAt)||producer?.repository!==REPO||String(producer.runId)!==String(run.id)||producer.runAttempt!==1||producer.workflow!=='loop.yml'||producer.stage!=='pre_model'||!/^[a-f0-9]{40}$/.test(producer.headSha||''))return {eligible:false,reason:'The pre-model learning selection does not bind this activated run.'};}
 // A reserved V5 writer which fails before sealing a selector still counts.
 // The trusted gate and code-at-commit proof distinguish it from cheap skips.
 return {eligible:true,runId:scheduling.id,githubRunId:String(run.id),startedAt,conclusion:run.status==='completed'?run.conclusion:null,proof:selection?'pre_model_selection_and_reserved_gate':'reserved_v5_gate_before_selector'};
}
export function firstTwoV5Runs(rows){return rows.filter(row=>row.eligible).sort((a,b)=>a.startedAt.localeCompare(b.startedAt)||Number(a.githubRunId)-Number(b.githubRunId)).slice(0,2);}
export function safetyDecision(rows){const first=firstTwoV5Runs(rows),failed=first.find(row=>row.conclusion!==null&&row.conclusion!=='success');return {state:failed?'rollback_required':first.length===2&&first.every(row=>row.conclusion==='success')?'verified':'awaiting_first_two',runs:first,failedRunId:failed?.runId||null};}

function git(root,args){const result=spawnSync('git',args,{cwd:root,maxBuffer:8*1024*1024});if(result.status!==0)throw new Error('Safety git operation failed: '+args[0]);return result.stdout;}
async function records(root,directory){let names;try{names=await fs.readdir(path.join(root,'data',directory));}catch(error){if(error.code==='ENOENT')return [];throw error;}return Promise.all(names.filter(name=>name.endsWith('.json')).map(async name=>{if(!validId(name.slice(0,-5)))throw new Error('Unsafe source audit filename.');const file=`data/${directory}/${name}`;return {file,value:await read(path.join(root,file))};}));}
export async function rollbackV5({root,config,decision,now=new Date()}={}){
 validateV5SafetyConfig(config);const at=new Date(now).toISOString();
 if(Date.parse(at)>=Date.parse(CODE_FREEZE.startsAt))throw new Error('Code freeze starts at 18:00 Vilnius; automatic rollback may not mutate code now.');
 if(decision?.state!=='rollback_required'||!validId(decision.failedRunId))throw new Error('Only a failed first-two automatic V5 proof authorizes rollback.');
 const receiptId=`v5-rollback-${decision.failedRunId}`,receiptFile=`data/v5-safety/rollbacks/${receiptId}.json`;
 try{return {alreadyRecorded:true,receipt:await read(path.join(root,receiptFile))};}catch(error){if(error.code!=='ENOENT')throw error;}
 const [morning,sources]=await Promise.all([read(path.join(root,config.morningCodePath)),read(path.join(root,config.morningSourcesPath))]);
 const baselineManifest=JSON.parse(git(root,['show',`${config.baselineCommit}:data/maintenance/${CODE_FREEZE.id}.json`]));
 if(stableJSON(morning)!==stableJSON(baselineManifest))throw new Error('Saved morning code inventory differs from its fixed baseline.');
 if(morning.schema!==1||morning.id!==CODE_FREEZE.id||!morning.files?.['RULES.md']||morning.codeSha256!==sha256(stableJSON(morning.files))||sources.schema!==1||!Array.isArray(sources.sources))throw new Error('Morning rollback inventories are missing or corrupt.');
 const originalFiles=Object.keys(morning.files).sort();if(!originalFiles.length||originalFiles.length>500||originalFiles.some(file=>!safePath(file)||!isFrozenCodePath(file)))throw new Error('Morning code inventory contains an unsafe path.');
 const blobs=new Map();for(const file of originalFiles){const bytes=git(root,['show',`${config.baselineCommit}:${file}`]);if(sha256(bytes)!==morning.files[file])throw new Error('Morning code inventory does not match its fixed baseline: '+file);blobs.set(file,bytes);}
 const currentFiles=git(root,['ls-files','-z']).toString().split('\0').filter(isFrozenCodePath);if(currentFiles.some(file=>!safePath(file)))throw new Error('Current code contains an unsafe path.');
 const currentSources=await read(path.join(root,'data','sources','registry.json'));
 const demandKinds=['uk-contracts-demand','uk-tenders-demand','jobtech-demand'];
 const incompatibleSourceIds=new Set((currentSources.sources||[]).filter(source=>demandKinds.includes(source.kind)).map(source=>source.id)),archived=[],archiveCandidates=[];
 const [scans,attributions,changes,evolutions,discoveries,exclusions]=await Promise.all(['source-scans','source-attributions','source-changes','source-evolution','source-discovery','source-exclusions'].map(directory=>records(root,directory)));
 // Morning readers require every raw item count to equal retained origins.
 // New omission receipts preserve both counters, even for all-building feeds.
 const incompatibleScans=new Set(scans.filter(record=>Object.hasOwn(record.value,'privacyOmissions')||record.value.definitions?.some(definition=>demandKinds.includes(definition.kind))).map(record=>record.value.id));
 for(const record of scans)for(const definition of record.value.definitions||[])if(demandKinds.includes(definition.kind))incompatibleSourceIds.add(definition.id);
 archiveCandidates.push(...scans.filter(record=>incompatibleScans.has(record.value.id)),...attributions.filter(record=>incompatibleScans.has(record.value.runId)));
 // Keep generic transition receipts referenced by still-compatible automatic
 // quota records. This preserves probes already spent today after rollback.
 const quotaChangeIds=new Set(discoveries.map(record=>record.value.changeId).filter(Boolean));
 const incompatibleChanges=changes.filter(record=>incompatibleSourceIds.has(record.value.sourceId)&&!quotaChangeIds.has(record.value.id));
 const changeIds=new Set(incompatibleChanges.map(record=>record.value.id));archiveCandidates.push(...incompatibleChanges,...exclusions.filter(record=>incompatibleSourceIds.has(record.value.sourceId)&&!discoveries.some(probe=>probe.value.exclusionId===record.value.id)),...evolutions.filter(record=>record.value.changeIds?.some(id=>changeIds.has(id))));
 // Discovery records contain no parsed adapter definition. Their generic
 // evidence and referenced transitions stay valid on the morning reader and
 // preserve every automatic probe already spent today.
 for(const record of [...new Map(archiveCandidates.map(record=>[record.file,record])).values()]){const bytes=await fs.readFile(path.join(root,record.file));archived.push({from:record.file,to:`data/rollback/${receiptId}/${record.file}`,sha256:sha256(bytes),bytes});}
 // Every blob, path, receipt and time boundary is verified before mutation.
 for(const entry of archived){await fs.mkdir(path.dirname(path.join(root,entry.to)),{recursive:true});await fs.writeFile(path.join(root,entry.to),entry.bytes,{flag:'wx'});await fs.unlink(path.join(root,entry.from));}
 for(const [file,bytes] of blobs){await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.writeFile(path.join(root,file),bytes);}
 const removed=currentFiles.filter(file=>!blobs.has(file));for(const file of removed)await fs.rm(path.join(root,file));
 await fs.mkdir(path.join(root,'data','sources'),{recursive:true});await fs.writeFile(path.join(root,'data','sources','registry.json'),JSON.stringify(sources,null,2)+'\n');
 await fs.writeFile(path.join(root,'data','maintenance',CODE_FREEZE.id+'.json'),JSON.stringify(morning,null,2)+'\n');
 const receipt={schema:1,id:receiptId,type:'v5-rollback',createdAt:at,activatedAt:config.activatedAt,baselineCommit:config.baselineCommit,failedRunId:decision.failedRunId,firstTwo:decision.runs.map(({runId,startedAt,conclusion,proof})=>({runId,startedAt,conclusion,proof})),restoredCodeSha256:morning.codeSha256,restoredCodeFiles:originalFiles.length,removedAddedCode:removed,restoredSourcesSha256:sha256(stableJSON(sources)),archived:archived.map(({bytes,...record})=>record),preserved:'All published posts, image cards, clock state/ticks, usage, scheduling and model-run records remain untouched.',reason:'A first-two verified automatic V5 workflow did not finish green; restored the morning code and source registry before the freeze.'};
 await fs.mkdir(path.dirname(path.join(root,receiptFile)),{recursive:true});await fs.writeFile(path.join(root,receiptFile),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 return {alreadyRecorded:false,receipt,changedPaths:[...new Set([...originalFiles,...removed,'data/sources/registry.json',`data/maintenance/${CODE_FREEZE.id}.json`,receiptFile,...archived.flatMap(record=>[record.from,record.to])])].sort()};
}
