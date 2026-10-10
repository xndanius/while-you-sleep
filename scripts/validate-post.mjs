import { dataPath, readJSON, sha256, stableJSON, safeError } from '../lib/storage.mjs';
import { checkApproval } from '../lib/validation.mjs';
try{
  const runId=process.argv[2],draft=await readJSON(dataPath('drafts',runId)),context=await readJSON(dataPath('check-context',runId)),manifest=await readJSON(dataPath('checks',runId));
  if(sha256(stableJSON(draft))!==context.draftSha256||sha256(stableJSON(context.sources))!==context.sourceSnapshotSha256)throw new Error('Draft or verified source snapshot changed after checker preparation.');
  const results=checkApproval(draft,context,manifest);console.log(JSON.stringify({runId,results}));
  if(!results.length||results.some(r=>!r.pass))process.exitCode=1;
}catch(error){console.error(safeError(error));process.exitCode=1;}
