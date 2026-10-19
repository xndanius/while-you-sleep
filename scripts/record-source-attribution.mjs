import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,writeJSON,safeError,stableJSON} from '../lib/storage.mjs';
import {deriveSourceAttribution,readBoundedJSON} from '../lib/source-registry.mjs';

export async function recordSourceAttribution({runId,root=ROOT,env=process.env}){
 // Old in-flight runs have no pre-model receipt and remain explicitly unknown.
 if(!env.EXPECTED_SOURCE_SCAN_SHA)return {recorded:false,reason:'No trusted pre-model source scan was frozen for this run.'};
 const read=directory=>readBoundedJSON(path.join(root,'data',directory,runId+'.json'));
 const run=await read('runs');
 if(run.status==='completed_no_post'&&run.assessmentOutcome==='retrieval_complete'&&run.retrievalCompletion?.independent===false)return {recorded:false,reason:'The deterministic no-lead search completed without a model or independently assessed candidate; no source quality verdict was created.'};
 const [scan,draft,context,manifest]=await Promise.all(['source-scans','drafts','check-context','checks'].map(read));
 const posts=await Promise.all((run.published||[]).map(id=>readBoundedJSON(path.join(root,'data','posts',id+'.json'))));
 const receipt=deriveSourceAttribution({scan,draft,context,manifest,run,posts,expectedScanSha256:env.EXPECTED_SOURCE_SCAN_SHA,expectedDraftSha256:env.EXPECTED_DRAFT_SHA,expectedContextSha256:env.EXPECTED_CONTEXT_SHA,rulesSha256:env.RULES_SHA256});
 const target=path.join(root,'data','source-attributions',runId+'.json');try{await writeJSON(target,receipt,{immutable:true});}catch(error){if(error.code!=='EEXIST'||stableJSON(await readBoundedJSON(target))!==stableJSON(receipt))throw error;}return {recorded:true,candidates:receipt.candidates.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{console.log(JSON.stringify(await recordSourceAttribution({runId:process.argv[2]})));}catch(error){console.log(JSON.stringify({recorded:false,reason:safeError(error)}));}}
