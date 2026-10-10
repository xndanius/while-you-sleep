import {readJSON,dataPath,sha256,stableJSON} from '../lib/storage.mjs';
const runId=process.argv[2];
for(const [label,dir] of [['draft_sha256','drafts'],['context_sha256','check-context']]){
 const value=await readJSON(dataPath(dir,runId));
 console.log(`${label}=${sha256(stableJSON(value))}`);
}
