import {appendFile} from 'node:fs/promises';
import path from 'node:path';
import {ROOT,sha256,stableJSON} from '../lib/storage.mjs';
import {readBoundedJSON,validateSourceScanReceipt} from '../lib/source-registry.mjs';
import {validateLearningSelection} from '../lib/learning.mjs';
import {verifyContinuationIntent,sealContinuationResult} from '../lib/research-continuation.mjs';
const runId=process.argv[2],expectedSha256=process.env.EXPECTED_RESEARCH_INTENT_SHA;
if(!/^[a-f0-9]{64}$/.test(expectedSha256||''))throw new Error('The pre-model intent hash is required.');
const intent=await readBoundedJSON(path.join(ROOT,'data/research-intents',runId+'.json'));
await verifyContinuationIntent(ROOT,intent,{runId,expectedSha256,headSha:process.env.SOURCE_HEAD_SHA});
const result=await sealContinuationResult({root:ROOT,intent});
let outputs=`result_sha256=${sha256(stableJSON(result))}\n`;
for(const [directory,key,validate] of [['source-scans','source_scan_sha256',validateSourceScanReceipt],['learning-selection','learning_selection_sha256',validateLearningSelection]]){
 let value;try{value=await readBoundedJSON(path.join(ROOT,'data',directory,runId+'.json'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
 if(validate(value,{runId}).length||value.producer.headSha!==intent.producer.headSha)throw new Error('Continuation fallback input seal is invalid.');
 outputs+=`${key}=${sha256(stableJSON(value))}\n`;
}
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,outputs);
console.log(JSON.stringify({runId,outcome:result.outcome,events:result.events.length}));
