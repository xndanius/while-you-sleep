import {spawnSync} from 'node:child_process';
import {readJSON,writeJSON,dataPath,records,safeError,sha256,stableJSON} from '../lib/storage.mjs';
import {appendFile} from 'node:fs/promises';
import {validateLoopScheduling} from '../lib/loop-schedule.mjs';
import {settleLoop} from './settle-loop.mjs';
import {unverifiedAssessment} from '../lib/checker-output.mjs';
import {deriveModelExecution} from '../lib/usage.mjs';
import {noFreshLeadsReasons} from '../lib/no-fresh-leads.mjs';
import {checkDiagnosticsReasons} from '../lib/check-diagnostics.mjs';
const runId=process.argv[2];
let scheduling;
let noFreshFailure=null;
if(process.env.LOOP_SCHEDULING_SHA)scheduling=validateLoopScheduling(await readJSON(dataPath('scheduling',runId)),{runId,expectedSha256:process.env.LOOP_SCHEDULING_SHA,eventName:process.env.GITHUB_EVENT_NAME});
if(process.env.GITHUB_ACTIONS==='true'&&!scheduling)throw new Error('Trusted scheduling decision is required for loop finalization.');
async function finalizeNoFreshLeads(){
 if(!process.env.EXPECTED_NO_FRESH_LEADS_SHA||scheduling?.decision!=='run')return false;
 if(process.env.EXPECTED_CHECK_DIAGNOSTICS_SHA){noFreshFailure='A failed independent preparation cannot also claim a completed no-lead retrieval.';return false;}
 try{
 const receipt=await readJSON(dataPath('no-fresh-leads',runId)),scan=await readJSON(dataPath('source-scans',runId)),selection=await readJSON(dataPath('learning-selection',runId));
 const reasons=noFreshLeadsReasons(receipt,{runId,schedulingSha256:process.env.LOOP_SCHEDULING_SHA,expectedSha256:process.env.EXPECTED_NO_FRESH_LEADS_SHA,scan,selection});if(reasons.length)throw new Error(reasons.join(' '));
 let usage;try{usage=await readJSON(dataPath('usage',runId));}catch{usage={inputTokens:null,outputTokens:null,costUsd:null};}
 const modelExecuted=deriveModelExecution({runId,githubRunUrl:scheduling.githubRunUrl,jobResults:process.env.MODEL_JOB_RESULTS,usage});if(modelExecuted!==false)throw new Error('A deterministic no-lead receipt cannot conceal an attempted or unknown model run.');
 const finishedAt=new Date().toISOString(),retrievalCompletion={schema:1,completed:true,independent:false,runId,schedulingSha256:process.env.LOOP_SCHEDULING_SHA,slotIds:scheduling.slotIds||[scheduling.slotId],noFreshLeadsSha256:sha256(stableJSON(receipt)),sourceScanSha256:receipt.sourceScanSha256,selectionSha256:receipt.selectionSha256,researchSha256:receipt.researchSha256,completedAt:finishedAt,decision:'no_fresh_leads',reason:receipt.reason};
 await writeJSON(dataPath('runs',runId),{id:runId,type:'loop',status:'completed_no_post',assessmentOutcome:'retrieval_complete',retrievalCompletion,operationalFailures:[],startedAt:scheduling.requestedAt,finishedAt,eventName:scheduling.eventName,scheduling,modelExecuted:false,candidatesFound:0,picked:0,published:[],rejected:[],steps:[{stage:'research',status:'completed_no_post',at:finishedAt,message:receipt.reason}],githubRunUrl:scheduling.githubRunUrl,engine:'GitHub Actions deterministic no-lead gate',usage},{immutable:true});
 await settleLoop(runId);if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'operational_failure=false\nunverified=false\nrun_status=completed_no_post\n');console.log(JSON.stringify({runId,status:'completed_no_post',assessmentOutcome:'retrieval_complete',independentAssessment:false,published:[]}));return true;
 }catch(error){noFreshFailure=error.code==='ENOENT'?'Trusted no-lead receipt or original scan/selection proof was not imported; no candidate can be approved.':safeError(error);return false;}
}
if(scheduling?.decision==='skip'){
 const now=new Date().toISOString();
 await writeJSON(dataPath('runs',runId),{id:runId,type:'loop',status:`skipped_${scheduling.reason}`,startedAt:scheduling.requestedAt,finishedAt:now,eventName:scheduling.eventName,scheduling,modelExecuted:false,published:[],rejected:[],steps:[{stage:'schedule',status:'skipped',at:now,message:scheduling.reason}],githubRunUrl:scheduling.githubRunUrl,engine:'GitHub Actions trusted scheduling gate'},{immutable:true});
 console.log(JSON.stringify({runId,status:'skipped',reason:scheduling.reason,published:[]}));
}else if(!await finalizeNoFreshLeads()){
let draftExists=true;try{await readJSON(dataPath('drafts',runId));}catch(error){if(error.code==='ENOENT')draftExists=false;else throw error;}
let jobsForReadiness;try{jobsForReadiness=JSON.parse(process.env.MODEL_JOB_RESULTS||'{}');}catch{jobsForReadiness={};}
let checkPreparationDiagnostics=null,diagnosticsFailure=null;
const diagnosticsRequested=!!process.env.EXPECTED_CHECK_DIAGNOSTICS_SHA;
if(diagnosticsRequested)try{
 const receipt=await readJSON(dataPath('check-diagnostics',runId)),research=await readJSON(dataPath('research',runId)),draft=await readJSON(dataPath('drafts',runId)),selection=await readJSON(dataPath('learning-selection',runId));
 const reasons=checkDiagnosticsReasons(receipt,{runId,phase:process.env.EXPECTED_DIAGNOSTIC_PHASE,expectedSha256:process.env.EXPECTED_CHECK_DIAGNOSTICS_SHA,research,draft,selection,expectedResearchSha256:process.env.EXPECTED_RESEARCH_SHA,expectedDraftSha256:process.env.EXPECTED_DIAGNOSTIC_DRAFT_SHA,expectedSelectionSha256:process.env.EXPECTED_LEARNING_SELECTION_SHA});
 if(reasons.length)throw new Error(reasons.join(' '));
 checkPreparationDiagnostics={sha256:process.env.EXPECTED_CHECK_DIAGNOSTICS_SHA,receipt};
}catch(error){diagnosticsFailure=error.code==='ENOENT'?'Sealed unavailable-evidence diagnostics or their original inputs were not imported.':safeError(error);}
// A preparation failure receipt is never a completion or publication input,
// including when a prior phase's context/check files happen to remain present.
const child=draftExists&&!noFreshFailure&&!diagnosticsRequested?spawnSync(process.execPath,['scripts/publish-checked.mjs',runId],{encoding:'utf8'}):{status:1,stdout:'',stderr:noFreshFailure||diagnosticsFailure||(diagnosticsRequested?'Independent preparation retained unavailable assignments; the whole batch remains unverified.':jobsForReadiness.writer?.outputs?.readiness_reason||'Writer preparation did not produce a draft. No candidate was independently checked or approved.')};
if(child.stdout)process.stdout.write(child.stdout);
if(child.stderr)process.stderr.write(safeError({message:child.stderr.trim()})+'\n');
if(child.status!==0){
 let existing;try{existing=await readJSON(dataPath('runs',runId))}catch{}
 if(!existing){
  let research;try{research=await readJSON(dataPath('research',runId));}catch{}
  let usage;try{usage=await readJSON(dataPath('usage',runId));}catch{usage={inputTokens:null,outputTokens:null,costUsd:null};}
  const published=(await records('posts')).filter(post=>post.runId===runId).map(post=>post.id);
  let jobs;try{jobs=JSON.parse(process.env.MODEL_JOB_RESULTS||'{}');}catch{jobs={};}
  const lastCheck=jobs.final_check?.outputs?.verified==='false'?jobs.final_check:jobs.checker?.outputs?.verified==='false'?jobs.checker:null;
  const privacyHeld=['writer','checker','repair','final_check'].some(name=>jobs[name]?.outputs?.privacy_safe==='false'||jobs[name]?.outputs?.scan_privacy_safe==='false');
  const reason=privacyHeld?'Privacy verification withheld the content; unsafe artifacts were discarded and no post was approved.':safeError({message:lastCheck?.outputs?.unverified_reason||child.error?.message||child.stderr.trim()||'Research, model, independent check or deterministic publication gate did not complete.'}).replace(/[\r\n]/g,' ');
  const failure={stage:privacyHeld?'privacy':lastCheck?'check':'publication',code:privacyHeld?'content_privacy_unverified':lastCheck?.outputs?.unverified_code||'publication_pipeline_incomplete',reason};
  const terminal=scheduling?.assessmentContractVersion===1;
  const finishedAt=new Date().toISOString();
  const githubRunUrl=scheduling?.githubRunUrl||research?.githubRunUrl||null;
  const modelExecuted=deriveModelExecution({runId,githubRunUrl,jobResults:process.env.MODEL_JOB_RESULTS,usage});
  await writeJSON(dataPath('runs',runId),{id:runId,type:'loop',status:terminal?published.length?'completed_with_unverified':'no_post_unverified':published.length?'completed_with_failure':'failed_closed',assessmentOutcome:terminal?'unverified':'incomplete',operationalFailures:[failure,...(diagnosticsFailure?[{stage:'check',code:'check_diagnostics_unverified',reason:diagnosticsFailure}]:[])],...(!privacyHeld&&checkPreparationDiagnostics?{checkPreparationDiagnostics}:{}),...(terminal?{unverifiedAssessment:unverifiedAssessment(scheduling,failure,finishedAt)}:{}),startedAt:scheduling?.requestedAt||research?.createdAt||finishedAt,finishedAt,eventName:scheduling?.eventName||process.env.GITHUB_EVENT_NAME||'unknown',...(scheduling?{scheduling}:{}),modelExecuted,published,rejected:[{reason}],steps:[{stage:'check',status:terminal?'unverified':'failed',message:reason}],githubRunUrl,engine:'official openai/codex-action',usage},{immutable:true});
 }
 console.log(scheduling?.assessmentContractVersion===1?'No post for this hour: the verification did not complete. No independent approval was created.':'Loop recorded its rejection/failure; its reserved slot remains eligible for a bounded retry.');
}
if(scheduling)await settleLoop(runId);
const finalized=await readJSON(dataPath('runs',runId));
const unverified=finalized.assessmentOutcome==='unverified'&&!!finalized.unverifiedAssessment;
const operationalFailure=unverified||child.status!==0||finalized.operationalFailures?.length>0;
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`operational_failure=${!!operationalFailure}\nunverified=${unverified}\nrun_status=${finalized.status}\n`);
console.log(JSON.stringify({runId,operationalFailure,assessmentOutcome:finalized.assessmentOutcome||'legacy',status:finalized.status}));
}
