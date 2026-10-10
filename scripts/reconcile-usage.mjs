import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFile, readFile } from 'node:fs/promises';
import { ROOT, sha256, stableJSON, writeJSON } from '../lib/storage.mjs';
import { collectUsage, githubApiGet, modelJobNames, usageCountersComplete } from '../lib/usage.mjs';

export const REPOSITORY='xndanius/while-you-sleep';
const WORKFLOWS=Object.freeze({'.github/workflows/loop.yml':'loop','.github/workflows/improve.yml':'improve'});

export function validateSourceRun(source, requestedId) {
  const kind=WORKFLOWS[source?.path];
  if (!/^\d+$/.test(String(requestedId)) || String(source?.id)!==String(requestedId)
    || source.repository?.full_name!==REPOSITORY || source.head_repository?.full_name!==REPOSITORY
    || source.status!=='completed' || source.head_branch!=='main' || !/^[0-9a-f]{40}$/.test(source.head_sha || '')
    || !kind || !['schedule','workflow_dispatch'].includes(source.event)
    || !Number.isSafeInteger(source.run_attempt) || source.run_attempt<1) throw new Error('Source run did not pass trusted completed-main workflow validation.');
  return {kind,runId:`${kind}-${requestedId}-${source.run_attempt}`,githubRunId:String(requestedId),attempt:source.run_attempt};
}

/** Re-read terminal logs from trusted main, without downloading model artifacts. */
export async function reconcileUsage({sourceRunId,env=process.env,root=ROOT,apiGet=githubApiGet,now=new Date()}={}) {
  if (env.GITHUB_REPOSITORY!==REPOSITORY || (env.GITHUB_REF && env.GITHUB_REF!=='refs/heads/main')) throw new Error('Reconciliation only runs in the trusted main repository.');
  if (!/^\d+$/.test(String(sourceRunId))) throw new Error('Invalid source workflow run ID.');
  const source=JSON.parse(await apiGet(`repos/${REPOSITORY}/actions/runs/${sourceRunId}`,{maxBytes:2*1024*1024}));
  const context=validateSourceRun(source,sourceRunId);
  const originalPath=path.join(root,'data','usage',context.runId+'.json');
  let original;
  try {original=JSON.parse(await readFile(originalPath,'utf8'));}
  catch(error) {if(error.code==='ENOENT')return {changed:false,status:'initial_record_missing',runId:context.runId};throw error;}
  if (original.id!==context.runId || original.type!=='usage' || original.runId!==context.runId
    || original.workflowKind!==context.kind || original.githubRunId!==context.githubRunId || original.runAttempt!==context.attempt
    || !/^\d{4}-\d{2}-\d{2}$/.test(original.localDate || '')) throw new Error('Initial usage record does not match the validated source attempt.');
  if (usageCountersComplete(original))return {changed:false,status:'already_complete',runId:context.runId};
  const file=path.join(root,'data','usage',context.runId+'-reconciled.json');
  try {await readFile(file);return {changed:false,status:'already_reconciled',runId:context.runId};}
  catch(error) {if(error.code!=='ENOENT')throw error;}
  // The original collector may have a trusted workflow-needs proof for skipped
  // jobs that the REST API omits. Actual API jobs remain authoritative.
  const jobResults={};
  for(const name of modelJobNames(context.kind)) {
    const job=original.jobs?.find(job=>job.name===name);
    if(job?.status==='not_run' && ['trusted_workflow_needs_skipped','github_job_skipped'].includes(job.reason))jobResults[name]='skipped';
  }
  const record=await collectUsage({...context,repository:REPOSITORY,model:original.model || 'gpt-6-luna',jobResults},{apiGet,now});
  if (!usageCountersComplete(record))return {changed:false,status:'still_incomplete',runId:context.runId,coverage:record.coverage};
  Object.assign(record,{
    id:context.runId+'-reconciled',supersedes:original.id,supersedesSha256:sha256(stableJSON(original)),localDate:original.localDate,
    reconciliation:{sourceWorkflow:source.path,sourceHeadSha:source.head_sha,sourceConclusion:source.conclusion || null,
      collectedByRunId:/^\d+$/.test(env.GITHUB_RUN_ID || '')?env.GITHUB_RUN_ID:null},
  });
  await writeJSON(file,record,{immutable:true});
  return {changed:true,status:record.status,runId:context.runId,recordId:record.id,coverage:record.coverage,costUsd:record.costUsd};
}

async function main() {
  const result=await reconcileUsage({sourceRunId:process.argv[2] || process.env.SOURCE_RUN_ID});
  if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`changed=${result.changed}\nrun_id=${result.runId}\n`);
  // No log content, ANSI formatting, signed URL or provider error body is emitted.
  console.log(JSON.stringify(result));
  if(result.status==='still_incomplete')process.exitCode=1;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(()=>{console.error('Completed-run usage reconciliation failed; the original usage remains unchanged.');process.exitCode=1;});
}
