import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,validId} from '../lib/storage.mjs';
import {personalDataReasons} from '../lib/demand.mjs';

const sensitiveKeys=new Set(['email','email_address','phone','telephone','mobile','contact','contactpoint','contact_point','personal_name','personname','first_name','last_name','firstname','lastname','ssn','patient','patient_id','applicant','profile','employer','person_id','author']);
export function privateArtifactReasons(value){
 const reasons=personalDataReasons(value);
 function visit(item){if(!item||typeof item!=='object')return;if(Array.isArray(item)){for(const child of item)visit(child);return;}for(const [key,child] of Object.entries(item)){if(sensitiveKeys.has(key.toLowerCase()))reasons.push('Personal/contact/profile fields are forbidden in stored content artifacts.');visit(child);}}
 visit(value);if(/\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}/.test(JSON.stringify(value)))reasons.push('Possible credential found in stored content artifact.');
 return [...new Set(reasons)];
}

// No redacted artifact can acquire an approval for changed text. An unsafe
// phase loses its complete artifact set and returns a neutral unverified signal.
export async function guardPrivateArtifacts({root=ROOT,runId,phase='content',env=process.env}={}){
 if(!validId(runId)||!['scan','writer','checker','repair','final_check','content'].includes(phase))throw new Error('Invalid bounded privacy phase.');
 const directories=phase==='scan'?['source-scans','research','learning-selection']:['research','drafts','check-context','checks'],files=[],failures=[],safeSelectionFiles=new Set();
 for(const directory of directories)for(const suffix of ['',...(phase==='scan'?[]:['-first'])]){
  const file=path.join(root,'data',directory,runId+suffix+'.json');let bytes;
  try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()){failures.push('Content artifact must be an ordinary file.');files.push(file);continue;}bytes=await fs.readFile(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}
  files.push(file);if(bytes.length>2500000){failures.push('Content artifact exceeded its bounded size.');continue;}
  let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{failures.push('Content artifact JSON is malformed.');continue;}
  const privateReasons=privateArtifactReasons(value);failures.push(...privateReasons);
  if(directory==='learning-selection'&&!privateReasons.length&&value.type==='learning-selection'&&value.runId===runId&&value.id===runId&&value.producer?.stage==='pre_model')safeSelectionFiles.add(file);
 }
 if(['checker','final_check'].includes(phase)){
  const file=path.join(root,'.run','checker-response.json');let bytes;
  try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()){failures.push('Independent output must be an ordinary bounded JSON file.');files.push(file);}else{bytes=await fs.readFile(file);files.push(file);if(bytes.length>2500000)failures.push('Independent output exceeded its bounded size.');else{try{failures.push(...privateArtifactReasons(JSON.parse(bytes.toString('utf8'))));}catch{failures.push('Independent output JSON is malformed.');}}}}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 const safe=failures.length===0;
 if(!safe)for(const file of files)if(!safeSelectionFiles.has(file))await fs.rm(file,{force:true});
 const reason=safe?'No prohibited personal/contact fields or contact patterns were found in the bounded artifacts.':'Privacy guard withheld this phase; unsafe artifacts were removed without redaction or approval.';
 const result={safe,selectionSafe:safeSelectionFiles.size>0,phase,checkedFiles:files.length,reason};
 if(env.GITHUB_OUTPUT)await fs.appendFile(env.GITHUB_OUTPUT,`safe=${safe}\nselection_safe=${result.selectionSafe}\nreason=${reason}\n`);
 console.log(JSON.stringify(result));return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))guardPrivateArtifacts({runId:process.argv[2],phase:process.argv[3]||'content'}).catch(()=>{console.error('Privacy guard could not verify the bounded artifact set.');process.exitCode=1;});
