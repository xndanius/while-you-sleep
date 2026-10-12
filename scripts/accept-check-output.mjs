import {readFile,lstat,rm,appendFile} from 'node:fs/promises';
import {dataPath,readJSON,writeJSON} from '../lib/storage.mjs';
import {acceptCheckerOutput,checkerFailure} from '../lib/checker-output.mjs';
const runId=process.argv[2];
const target=dataPath('checks',runId);
try{
 if(process.env.GITHUB_ACTIONS==='true'&&(!process.env.EXPECTED_DRAFT_SHA||!process.env.EXPECTED_CONTEXT_SHA))throw new Error('Trusted pre-model checker fingerprints are required.');
 const file='.run/checker-response.json',stat=await lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>150000)throw new Error('Independent checker response must be a bounded regular file.');
 const response=JSON.parse(await readFile(file,'utf8'));
 const [draft,context]=await Promise.all(['drafts','check-context'].map(dir=>readJSON(dataPath(dir,runId))));
 let existing;try{existing=await readJSON(dataPath('checks',runId));}catch(error){if(error.code!=='ENOENT')throw error;}
 const manifest=acceptCheckerOutput(response,draft,context,{existing,expectedDraftSha256:process.env.EXPECTED_DRAFT_SHA,expectedContextSha256:process.env.EXPECTED_CONTEXT_SHA});
 await writeJSON(target,manifest);
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'verified=true\n');
 console.log(JSON.stringify({runId,completed:true,decision:manifest.completedAssessment?.decision||'legacy',checks:manifest.checks.length}));
}catch(error){
 // A missing, contradictory or unbound checker answer authorizes no content.
 // Delete any model-written manifest, record the trusted step outcome and let
 // the no-model finalizer settle this hour without inventing an assessment.
 await rm(target,{force:true});
 const failure=checkerFailure(error);
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`verified=false\nunverified_code=${failure.code}\nunverified_reason=${failure.reason}\n`);
 console.log(JSON.stringify({runId,completed:false,verified:false,...failure}));
}
