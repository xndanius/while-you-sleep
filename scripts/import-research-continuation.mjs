import {promises as fs} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,sha256,stableJSON,writeJSON} from '../lib/storage.mjs';
import {readBoundedJSON} from '../lib/source-registry.mjs';
import {verifyContinuationIntent,continuationResultReasons} from '../lib/research-continuation.mjs';
export async function importResearchContinuation({directory,kind,runId,expectedSha256,headSha,env=process.env,root=ROOT}){
 if(!['intent','result'].includes(kind)||!/^loop-[1-9]\d{0,15}-[1-9]\d{0,3}$/.test(runId)||!/^[a-f0-9]{64}$/.test(expectedSha256||'')||!/^[a-f0-9]{40}$/.test(headSha||''))throw new Error('Exact continuation artifact fingerprints are required.');
 const names=await fs.readdir(directory);if(names.length!==1||names[0]!==runId+'.json')throw new Error('Continuation artifact must contain its one exact canonical file.');
 const value=await readBoundedJSON(path.join(directory,names[0]));if(sha256(stableJSON(value))!==expectedSha256)throw new Error('Continuation artifact hash changed.');
 const intent=kind==='intent'?value:await readBoundedJSON(path.join(root,'data/research-intents',runId+'.json'));
 await verifyContinuationIntent(root,intent,{runId,headSha});
 if(intent.producer.runId!==env.GITHUB_RUN_ID||intent.producer.runAttempt!==Number(env.GITHUB_RUN_ATTEMPT))throw new Error('Continuation artifact belongs to another execution.');
 if(kind==='result'){
  const errors=continuationResultReasons(value,intent,{sealed:true});if(errors.length)throw new Error(errors.join(' '));
  for(const [key,dir] of [['sourceScanSha256','source-scans'],['selectionSha256','learning-selection']])if(value[key]!==null&&sha256(stableJSON(await readBoundedJSON(path.join(root,'data',dir,runId+'.json'))))!==value[key])throw new Error('Continuation result does not bind the imported pre-model input.');
 }
 const target=path.join(root,'data',kind==='intent'?'research-intents':'research-results',runId+'.json');
 try{await writeJSON(target,value,{immutable:true});}catch(error){if(error.code!=='EEXIST'||stableJSON(await readBoundedJSON(target))!==stableJSON(value))throw error;}
 return value;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await importResearchContinuation({directory:process.argv[2],kind:process.argv[3],runId:process.argv[4],expectedSha256:process.env.EXPECTED_CONTINUATION_SHA,headSha:process.env.EXPECTED_SOURCE_SCAN_HEAD_SHA});
