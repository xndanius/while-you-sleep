import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, writeJSON } from '../lib/storage.mjs';
import { collectUsage, parseModelJobResults } from '../lib/usage.mjs';

export async function runCollector({argv=process.argv.slice(2),env=process.env,root=ROOT,apiGet,now} = {}) {
  const [kind,runId] = argv;
  const context={kind,runId,repository:env.GITHUB_REPOSITORY,githubRunId:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT || '1',model:env.CODEX_MODEL || 'gpt-6-luna',jobResults:parseModelJobResults(env.MODEL_JOB_RESULTS,kind)};
  const record=await collectUsage(context,{apiGet,now});
  await writeJSON(path.join(root,'data','usage',runId+'.json'),record,{immutable:true});
  // Only bounded counters are written to the runner log; no source log is saved.
  console.log(JSON.stringify({runId:record.runId,status:record.status,coverage:record.coverage,costUsd:record.costUsd}));
  return record;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCollector().catch(() => {console.error('Usage collection failed before an immutable record could be saved.');process.exitCode=1;});
}
