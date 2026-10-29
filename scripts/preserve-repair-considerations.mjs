import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalURL,dataPath,readJSON,safeError,sha256,stableJSON,writeJSON} from '../lib/storage.mjs';
import {isOmittedCandidateRepair,validateOmittedCandidateRepair} from '../lib/omitted-candidate-repair.mjs';

// Repair may change a decision, but cannot silently erase the screened batch.
// The original files came through a model workspace: trust job outputs, not
// hashes supplied by the model or the saved files themselves.
export function preserveRepairConsiderations(first,context,repaired,{expectedDraftSha256,expectedContextSha256,firstCheck,expectedRepairFeedbackSha256}={}) {
  if(!/^[a-f0-9]{64}$/.test(expectedDraftSha256||'')||! /^[a-f0-9]{64}$/.test(expectedContextSha256||'')||
    sha256(stableJSON(first))!==expectedDraftSha256||sha256(stableJSON(context))!==expectedContextSha256||context.draftSha256!==expectedDraftSha256)
    throw new Error('Saved first assessment does not match trusted checker job fingerprints.');
  const omissionRepair=isOmittedCandidateRepair(firstCheck)||Boolean(expectedRepairFeedbackSha256);
  if(omissionRepair)validateOmittedCandidateRepair(firstCheck,first,context,{allowInitial:true,expectedDraftSha256,expectedContextSha256,expectedFeedbackSha256:expectedRepairFeedbackSha256,requireFeedbackSha256:true});
  if(!first.runId||first.runId!==context.runId||first.runId!==repaired.runId||first.targetCount!==repaired.targetCount)
    throw new Error('Repair does not match the original assessed reservation.');
  for(const draft of [first,repaired])for(const field of ['posts','candidates','rejected'])
    if(!Array.isArray(draft[field])||draft[field].length>12)throw new Error('Repair considerations must be bounded arrays.');
  const key=item=>{if(typeof item?.title!=='string'||typeof item?.productUrl!=='string')throw new Error('A repair consideration needs its original title and product URL.');return canonicalURL(item.productUrl);};
  if(omissionRepair&&repaired.posts.some(post=>key(post)!==canonicalURL(firstCheck.omission.productUrl)))
    throw new Error('An omission repair cannot promote an unrelated candidate.');
  const proposed=new Set(repaired.posts.map(key));
  const merge=(current,original)=>{
    const rows=new Map(current.map(item=>[key(item),item]));
    for(const item of original)if(!rows.has(key(item)))rows.set(key(item),item);
    return [...rows.values()];
  };
  let candidates=merge(repaired.candidates,[...first.candidates,...first.posts]);
  if(omissionRepair){
    // This feedback requests one missing assessment, not a rewrite of already
    // scored work. Preserve its exact plan, unresolved gaps, quotes and scores
    // from the trusted first artifact before the fresh independent check.
    const originals=new Map(first.candidates.map(item=>[key(item),item]));
    candidates=candidates.map(item=>originals.get(key(item))||item);
  }
  const rejected=merge(repaired.rejected,first.rejected).filter(item=>!proposed.has(key(item)));
  const distinct=new Set([...repaired.posts,...candidates,...rejected].map(key));
  if(distinct.size>12)throw new Error('Repair exceeds the twelve distinct product consideration limit.');
  const exclusions=new Set(rejected.map(key));
  for(const post of first.posts)if(!proposed.has(key(post))&&!exclusions.has(key(post)))
    throw new Error('A removed proposal needs an explicit repair rejection.');
  return {...repaired,candidates,rejected,repairAttempt:1};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const runId=process.argv[2];
    const [first,context,repaired,firstCheck]=await Promise.all([
      readJSON(dataPath('drafts',`${runId}-first`)),readJSON(dataPath('check-context',`${runId}-first`)),readJSON(dataPath('drafts',runId)),readJSON(dataPath('checks',`${runId}-first`)).catch(error=>{if(error.code==='ENOENT'&&!process.env.EXPECTED_REPAIR_FEEDBACK_SHA)return undefined;throw error;}),
    ]);
    const result=preserveRepairConsiderations(first,context,repaired,{expectedDraftSha256:process.env.EXPECTED_FIRST_DRAFT_SHA,expectedContextSha256:process.env.EXPECTED_FIRST_CONTEXT_SHA,firstCheck,expectedRepairFeedbackSha256:process.env.EXPECTED_REPAIR_FEEDBACK_SHA});
    const verifyOnly=process.argv[3]==='--verify-only';
    if(!verifyOnly)await writeJSON(dataPath('drafts',runId),result);
    console.log(JSON.stringify({runId,verifiedFirstArtifacts:true,verifyOnly,candidates:result.candidates.length,rejections:result.rejected.length,posts:result.posts.length}));
  } catch(error) {console.error(safeError(error));process.exitCode=1;}
}
