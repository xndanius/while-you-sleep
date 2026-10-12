import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,writeJSON,stableJSON,safeError} from '../lib/storage.mjs';
import {readBoundedJSON} from '../lib/source-registry.mjs';
import {deriveLearningReceipt,readOperatorMarks} from '../lib/learning.mjs';

export async function recordLearning({runId,root=ROOT,env=process.env,fetchJSON=null}){
 if(!env.EXPECTED_LEARNING_SELECTION_SHA)return {recorded:false,reason:'This historical or in-flight run has no trusted pre-model learning selection.'};
 const read=directory=>readBoundedJSON(path.join(root,'data',directory,runId+'.json')),optional=async directory=>{try{return await read(directory);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
 const [run,selection,scan,draft,context,manifest]=await Promise.all([read('runs'),read('learning-selection'),optional('source-scans'),optional('drafts'),optional('check-context'),optional('checks')]);
 const receipt=deriveLearningReceipt({run,selection,scan,draft,context,manifest,expectedSelectionSha256:env.EXPECTED_LEARNING_SELECTION_SHA,expectedScanSha256:env.EXPECTED_SOURCE_SCAN_SHA,expectedDraftSha256:env.EXPECTED_DRAFT_SHA,expectedContextSha256:env.EXPECTED_CONTEXT_SHA});
 const target=path.join(root,'data','learning',runId+'.json');try{await writeJSON(target,receipt,{immutable:true});}catch(error){if(error.code!=='EEXIST'||stableJSON(await readBoundedJSON(target))!==stableJSON(receipt))throw error;}
 let marks;try{marks=await readOperatorMarks({root,fetchJSON,writeCache:true});}catch(error){marks={status:'unverified',reason:safeError(error)};}
 return {recorded:true,outcome:receipt.outcome,considered:receipt.samples.length,successes:receipt.samples.filter(sample=>sample.status==='success').length,unknown:receipt.samples.filter(sample=>sample.status==='unknown').length,marks:marks.status};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{console.log(JSON.stringify(await recordLearning({runId:process.argv[2],fetchJSON:async url=>{if(!url.startsWith('https://api.github.com/repos/xndanius/while-you-sleep/'))throw new Error('Feedback verification URL is outside the fixed repository.');const response=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{accept:'application/vnd.github+json',...(process.env.GH_TOKEN?{authorization:'Bearer '+process.env.GH_TOKEN}:{})}});if(!response.ok)throw new Error('Operator commit metadata is unavailable.');const text=await response.text();if(Buffer.byteLength(text)>2000000)throw new Error('Operator metadata exceeds its bounded size.');return JSON.parse(text);}})));}catch(error){console.log(JSON.stringify({recorded:false,reason:safeError(error)}));process.exitCode=1;}}
