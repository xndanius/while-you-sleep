import {readFile,lstat} from 'node:fs/promises';
import {dataPath,readJSON,writeJSON,safeError} from '../lib/storage.mjs';
import {acceptCheckerOutput} from '../lib/checker-output.mjs';
const runId=process.argv[2];
try{
 if(process.env.GITHUB_ACTIONS==='true'&&(!process.env.EXPECTED_DRAFT_SHA||!process.env.EXPECTED_CONTEXT_SHA))throw new Error('Trusted pre-model checker fingerprints are required.');
 const file='.run/checker-response.json',stat=await lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>150000)throw new Error('Independent checker response must be a bounded regular file.');
 const response=JSON.parse(await readFile(file,'utf8'));
 const [draft,context]=await Promise.all(['drafts','check-context'].map(dir=>readJSON(dataPath(dir,runId))));
 let existing;try{existing=await readJSON(dataPath('checks',runId));}catch(error){if(error.code!=='ENOENT')throw error;}
 const manifest=acceptCheckerOutput(response,draft,context,{existing,expectedDraftSha256:process.env.EXPECTED_DRAFT_SHA,expectedContextSha256:process.env.EXPECTED_CONTEXT_SHA});
 await writeJSON(dataPath('checks',runId),manifest);
 console.log(JSON.stringify({runId,completed:true,decision:manifest.completedAssessment?.decision||'legacy',checks:manifest.checks.length}));
}catch(error){console.error(safeError(error));process.exitCode=1;}
