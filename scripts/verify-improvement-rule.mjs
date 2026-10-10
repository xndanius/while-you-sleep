import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../lib/storage.mjs';

const validRunId=value=>typeof value==='string' && /^improve-\d+-[1-9]\d*$/.test(value);

/** Recheck approved bytes after a rebase; rejection never restores old rules. */
export function verifyImprovementRule({runId,record,rulesBytes}={}) {
  if(!validRunId(runId) || record?.id!==runId)throw new Error('Improvement version does not match the immutable run ID.');
  if(record.status==='rejected' && record.adopted===false)return {runId,status:'rejected',ruleHashChecked:false};
  if(record.status!=='adopted' || record.adopted!==true || !/^[0-9a-f]{64}$/.test(record.newRulesSha256 || ''))throw new Error('Improvement version has no valid adopted RULES hash.');
  if(!Buffer.isBuffer(rulesBytes) && typeof rulesBytes!=='string')throw new Error('Current RULES bytes are unavailable.');
  const currentSha256=createHash('sha256').update(rulesBytes).digest('hex');
  if(currentSha256!==record.newRulesSha256)throw new Error('Current RULES differs from the exact adopted improvement; refusing to push.');
  return {runId,status:'adopted',ruleHashChecked:true};
}

export async function runVerifier({argv=process.argv.slice(2),root=ROOT,env=process.env}={}) {
  const [runId]=argv;
  if(!validRunId(runId))throw new Error('Invalid improvement run ID.');
  if(env.GITHUB_ACTIONS==='true' && runId!==`improve-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`)throw new Error('Improvement run ID does not match this trusted workflow attempt.');
  const record=JSON.parse(await readFile(path.join(root,'data','versions',runId+'.json'),'utf8'));
  const rulesBytes=record.status==='adopted'?await readFile(path.join(root,'RULES.md')):undefined;
  const result=verifyImprovementRule({runId,record,rulesBytes});
  console.log(JSON.stringify(result));
  return result;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  runVerifier().catch(()=>{console.error('Improvement RULES integrity verification failed; refusing to push.');process.exitCode=1;});
}
