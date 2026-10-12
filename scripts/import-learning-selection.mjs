import {promises as fs} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,writeJSON,stableJSON,safeError} from '../lib/storage.mjs';
import {readBoundedJSON} from '../lib/source-registry.mjs';
import {validateLearningSelection} from '../lib/learning.mjs';

export async function importLearningSelection({directory,runId,expectedSha256,expectedHeadSha,env=process.env,root=ROOT}){
 if(!/^loop-[1-9]\d{0,15}-[1-9]\d{0,3}$/.test(runId)||!/^[a-f0-9]{64}$/.test(expectedSha256||'')||!/^[a-f0-9]{40}$/.test(expectedHeadSha||''))throw new Error('Exact pre-model learning selection fingerprints are required.');
 const entries=await fs.readdir(directory);if(entries.length!==1||entries[0]!==runId+'.json')throw new Error('Learning artifact must contain only its exact canonical file.');
 const selection=await readBoundedJSON(path.join(directory,runId+'.json')),failures=validateLearningSelection(selection,{expectedSha256,runId});
 if(selection.producer?.runId!==env.GITHUB_RUN_ID||selection.producer?.runAttempt!==Number(env.GITHUB_RUN_ATTEMPT)||selection.producer?.headSha!==expectedHeadSha)failures.push('Learning selection did not originate in this trusted pre-model producer.');
 if(failures.length)throw new Error(failures.join(' '));
 const target=path.join(root,'data','learning-selection',runId+'.json');try{await writeJSON(target,selection,{immutable:true});}catch(error){if(error.code!=='EEXIST'||stableJSON(await readBoundedJSON(target))!==stableJSON(selection))throw error;}return selection;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{await importLearningSelection({directory:process.argv[2],runId:process.argv[3],expectedSha256:process.env.EXPECTED_LEARNING_SELECTION_SHA,expectedHeadSha:process.env.EXPECTED_SOURCE_SCAN_HEAD_SHA});}catch(error){console.error(safeError(error));process.exitCode=1;}}
