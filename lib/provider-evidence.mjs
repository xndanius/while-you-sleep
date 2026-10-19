import {loadApifyPool,validateApifyPoolProof} from './apify-sources.mjs';
import {stableJSON} from './storage.mjs';

// This reader has no credential or network capability. The original capture
// was committed by the trusted retrieval job before the writer started.
export async function readProviderEvidence(root,source,{now=new Date()}={}){
 const evidence=source?.providerEvidence;
 const proof=evidence&&Object.fromEntries(['provider','platform','definitionId','receiptId','poolHash','postHash'].map(key=>[key,evidence[key]]));
 if(!proof||!await validateApifyPoolProof(root,proof,{definitionId:source.registrySourceId,postUrl:source.url,now,maxAgeHours:8}))throw new Error('Stored provider post lacks its exact valid immutable capture proof.');
 const item=(await loadApifyPool(root,{now,platforms:[proof.platform],maxAgeHours:8})).find(row=>row.post.url===source.url&&stableJSON(row.proof)===stableJSON(proof));
 if(!item||item.capturedAt!==evidence.capturedAt)throw new Error('Stored provider capture changed or expired.');
 return {post:item.post,proof:item.proof,capturedAt:item.capturedAt,independentlyReadAt:now.toISOString(),independentlyReread:true,livePostRefetched:false};
}
