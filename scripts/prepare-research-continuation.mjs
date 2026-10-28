import {appendFile} from 'node:fs/promises';
import {ROOT,records,sha256,stableJSON} from '../lib/storage.mjs';
import {candidateHistory} from '../lib/candidate-input.mjs';
import {prepareContinuationIntent} from '../lib/research-continuation.mjs';
const runId=process.argv[2],history=await candidateHistory(ROOT,new Date(),{continuations:true});
const intent=await prepareContinuationIntent({root:ROOT,runId,bundles:history.continuationBundles||[],published:await records('posts'),producer:{repository:process.env.GITHUB_REPOSITORY,runId:process.env.GITHUB_RUN_ID,runAttempt:Number(process.env.GITHUB_RUN_ATTEMPT),workflow:'loop.yml',stage:'pre_model',headSha:process.env.SOURCE_HEAD_SHA}});
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`intent_sha256=${intent?sha256(stableJSON(intent)):''}\n`);
console.log(JSON.stringify({runId,planned:!!intent,candidate:intent?.dossier.id||null,requests:intent?.dossier.referenceRequests.length||0}));
