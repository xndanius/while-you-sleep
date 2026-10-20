import {promises as fs} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,writeJSON,stableJSON,safeError} from '../lib/storage.mjs';
import {readBoundedJSON} from '../lib/source-registry.mjs';
import {CHECK_DIAGNOSTICS_MAX_BYTES,checkDiagnosticsReasons} from '../lib/check-diagnostics.mjs';

async function bounded(file,maxBytes){try{return await readBoundedJSON(file,maxBytes);}catch{throw new Error('Check diagnostic input is not valid bounded ordinary JSON.');}}
export async function importCheckDiagnostics({directory,runId,phase,expectedSha256,expectedResearchSha256,expectedDraftSha256,expectedSelectionSha256,root=ROOT}={}){
 if(!directory||!/^loop-[1-9]\d{0,15}-[1-9]\d{0,3}$/.test(runId||'')||!['initial','final'].includes(phase)||[expectedSha256,expectedResearchSha256,expectedDraftSha256,expectedSelectionSha256].some(value=>!/^[a-f0-9]{64}$/.test(value||'')))throw new Error('Exact check diagnostic run, phase and trusted fingerprints are required.');
 const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Check diagnostic artifact must be an ordinary directory.');
 const entries=await fs.readdir(directory);if(entries.length!==1||entries[0]!==runId+'.json')throw new Error('Check diagnostic artifact must contain only its exact canonical file.');
 const [receipt,research,draft,selection]=await Promise.all([bounded(path.join(directory,runId+'.json'),CHECK_DIAGNOSTICS_MAX_BYTES),bounded(path.join(root,'data','research',runId+'.json')),bounded(path.join(root,'data','drafts',runId+'.json')),bounded(path.join(root,'data','learning-selection',runId+'.json'))]);
 const failures=checkDiagnosticsReasons(receipt,{runId,phase,expectedSha256,research,draft,selection,expectedResearchSha256,expectedDraftSha256,expectedSelectionSha256});if(failures.length)throw new Error(failures.join(' '));
 const targetDirectory=path.join(root,'data','check-diagnostics');
 for(const item of [path.join(root,'data'),targetDirectory]){await fs.mkdir(item,{recursive:true});const metadata=await fs.lstat(item);if(!metadata.isDirectory()||metadata.isSymbolicLink())throw new Error('Check diagnostic target must be an ordinary directory.');}
 const target=path.join(targetDirectory,runId+'.json');try{await writeJSON(target,receipt,{immutable:true});}catch(error){if(error.code!=='EEXIST'||stableJSON(await bounded(target,CHECK_DIAGNOSTICS_MAX_BYTES))!==stableJSON(receipt))throw error;}
 return receipt;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{const receipt=await importCheckDiagnostics({directory:process.argv[2],runId:process.argv[3],phase:process.env.EXPECTED_DIAGNOSTIC_PHASE,expectedSha256:process.env.EXPECTED_CHECK_DIAGNOSTICS_SHA,expectedDraftSha256:process.env.EXPECTED_DIAGNOSTIC_DRAFT_SHA,expectedResearchSha256:process.env.EXPECTED_RESEARCH_SHA,expectedSelectionSha256:process.env.EXPECTED_LEARNING_SELECTION_SHA});console.log(JSON.stringify({runId:receipt.runId,phase:receipt.phase,imported:true,diagnosticOnly:true}));}catch(error){console.error(safeError(error));process.exitCode=1;}}
