import {canonicalURL,sha256,stableJSON} from './storage.mjs';
import {privateArtifactReasons} from './privacy.mjs';

const lists=['posts','candidates','rejected'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const url=value=>typeof value==='string'?canonicalURL(value):null;

// A lossless reading aid, not an independent assessment or publication gate.
// Keep candidate scores and rejection reasons together even when the same
// product appears in several lists. An empty proposal list is not an empty draft.
export function checkerAssessmentView(draft,context,{role}={}){
 if(!['checker','final-checker'].includes(role)||!object(draft)||!object(context)||!/^loop-[1-9]\d{0,15}-[1-9]\d{0,3}$/.test(context.runId||'')||draft.runId!==context.runId)throw new Error('Checker assessment input identity is unavailable.');
 if(sha256(stableJSON(draft))!==context.draftSha256||!Array.isArray(context.sources)||sha256(stableJSON(context.sources))!==context.sourceSnapshotSha256)throw new Error('Checker assessment input fingerprints changed.');
 if(privateArtifactReasons(context).length)throw new Error('Checker assessment context is not privacy-safe.');
 const counts={},listPresence={},inventory=new Map(),unidentifiedRows=[];
 for(const list of lists){
  listPresence[list]=Object.hasOwn(draft,list);
  const rows=draft[list]===undefined&&list!=='posts'?[]:draft[list];
  if(!Array.isArray(rows)||rows.some(row=>!object(row)))throw new Error('Checker assessment decision lists are unavailable.');
  counts[list]=rows.length;
  for(const [index,row] of rows.entries()){
   const productUrl=url(row.productUrl);
   if(!productUrl){unidentifiedRows.push({list,index});continue;}
   if(!inventory.has(productUrl))inventory.set(productUrl,{productUrl,occurrences:[]});
   inventory.get(productUrl).occurrences.push({list,index});
  }
 }
 counts.uniqueConsidered=inventory.size;
 const match=(rows,productUrl)=>{
  if(rows===undefined)return [];
  if(!Array.isArray(rows))throw new Error('Checker assessment evidence inventory is unavailable.');
  return rows.filter(row=>url(row?.productUrl)===productUrl);
 };
 const view={schema:1,kind:'checker_assessment_view',advisoryOnly:true,role,runId:context.runId,
  bindings:{draftSha256:context.draftSha256,contextSha256:sha256(stableJSON(context)),sourceSnapshotSha256:context.sourceSnapshotSha256,rulesSha256:context.rulesSha256,policySha256:context.scoringPolicy?.policySha256},
  counts,listPresence,draft:structuredClone(draft),
  inventory:[...inventory.values()].map(item=>({...item,considerationEvidence:structuredClone(match(context.considerationEvidence,item.productUrl)),primaryFetchDiagnostics:structuredClone(match(context.primaryFetchDiagnostics,item.productUrl))})),
  unidentifiedRows};
 if(Buffer.byteLength(JSON.stringify(view))>6000000)throw new Error('Checker assessment view exceeds its complete-read bound.');
 if(privateArtifactReasons(view).length)throw new Error('Checker assessment input is not privacy-safe.');
 return view;
}
