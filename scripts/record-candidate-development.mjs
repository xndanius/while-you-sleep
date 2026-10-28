import path from 'node:path';
import {ROOT,records,sha256,stableJSON,writeJSON} from '../lib/storage.mjs';
import {readBoundedJSON} from '../lib/source-registry.mjs';
import {readResearchBundle,verifyContinuationIntent} from '../lib/research-continuation.mjs';
import {deriveCandidateDevelopment,loadDevelopmentHistory} from '../lib/candidate-development.mjs';
const runId=process.argv[2];if(!/^loop-\d+-\d+$/.test(runId||''))throw new Error('Invalid development run.');
const optional=async dir=>{try{return await readBoundedJSON(path.join(ROOT,'data',dir,runId+'.json'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const run=await optional('runs');if(!run)throw new Error('Trusted finalized run is absent.');
let intent=await optional('research-intents'),result=await optional('research-results'),originBundle=null;
if(intent){if(!/^[a-f0-9]{64}$/.test(process.env.EXPECTED_RESEARCH_INTENT_SHA||''))throw new Error('Development intent requires its trusted pre-model hash.');originBundle=await verifyContinuationIntent(ROOT,intent,{runId,expectedSha256:process.env.EXPECTED_RESEARCH_INTENT_SHA});if(result&&sha256(stableJSON(result))!==process.env.EXPECTED_RESEARCH_RESULT_SHA)throw new Error('Development result hash differs from its trusted output.');}
const bundle=await readResearchBundle(ROOT,runId).catch(()=>null),history=(await loadDevelopmentHistory(ROOT)).filter(row=>row.runId!==runId);
const record=deriveCandidateDevelopment({run,bundle,intent,result,originBundle,history,posts:await records('posts')});
if(record){const file=path.join(ROOT,'data/candidate-development',runId+'.json');try{await writeJSON(file,record,{immutable:true});}catch(error){if(error.code!=='EEXIST'||stableJSON(await readBoundedJSON(file))!==stableJSON(record))throw error;}}
console.log(JSON.stringify({runId,recorded:!!record,events:record?.events.length||0}));
