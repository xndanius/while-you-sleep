import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,validId,sha256,stableJSON,safeError} from '../lib/storage.mjs';
import {createAssistantExecution,validateAssistantExecution} from '../lib/assistant-provenance.mjs';

export async function registerAssistantCheck({root=ROOT,runId,writerPath,checkerPath,expectedWriterReceiptSha256,expectedCheckerReceiptSha256,now=new Date()}={}){
 if(!validId(runId)||!runId.startsWith('assistant-'))throw new Error('Assistant run ID must use its own assistant- namespace.');
 const bounded=async file=>{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>3000000)throw new Error('Assistant input must be a bounded regular file.');return JSON.parse(await fs.readFile(file,'utf8'));};
 const [draft,context,manifest,research,writer,checker,rules]=await Promise.all(['drafts','check-context','checks','research'].map(dir=>bounded(path.join(root,'data',dir,runId+'.json'))).concat([bounded(writerPath),bounded(checkerPath),fs.readFile(path.join(root,'RULES.md'),'utf8')]));
 // This command does not publish, fetch, run models, dispatch or alter a
 // checker manifest. Receipts come from the trusted host, not draft fields.
 let previous=[];try{const dir=path.join(root,'data','posts');previous=await Promise.all((await fs.readdir(dir)).filter(name=>name.endsWith('.json')).map(name=>bounded(path.join(dir,name))));}catch(error){if(error.code!=='ENOENT')throw error;}
 const inputs={draft,context,manifest,research,rules},target=path.join(root,'data','assistant-executions',runId+'.json');
 let existing;try{existing=await bounded(target);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(existing){
  if(sha256(stableJSON(writer))!==expectedWriterReceiptSha256||sha256(stableJSON(checker))!==expectedCheckerReceiptSha256||stableJSON(existing.writer)!==stableJSON(writer)||stableJSON(existing.checker)!==stableJSON(checker))throw new Error('Existing assistant execution conflicts with supplied runtime receipts.');
  const decisions=validateAssistantExecution(existing,inputs,{expectedSha256:sha256(stableJSON(existing)),previous,now});
  return {runId,executionSha256:sha256(stableJSON(existing)),decisions:decisions.map(({postId,pass,reasons})=>({postId,pass,reasons})),published:[]};
 }
 const result=createAssistantExecution(inputs,{writer,checker,expectedWriterReceiptSha256,expectedCheckerReceiptSha256,previous,now});
 await fs.mkdir(path.dirname(target),{recursive:true});
 const raw=stableJSON(result.record)+'\n';
 try{await fs.writeFile(target,raw,{flag:'wx'});}catch(error){if(error.code!=='EEXIST'||await fs.readFile(target,'utf8')!==raw)throw error;}
 return {runId,executionSha256:sha256(stableJSON(result.record)),decisions:result.decisions.map(({postId,pass,reasons})=>({postId,pass,reasons})),published:[]};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [runId,writerPath,checkerPath,expectedWriterReceiptSha256,expectedCheckerReceiptSha256]=process.argv.slice(2);
 registerAssistantCheck({runId,writerPath,checkerPath,expectedWriterReceiptSha256,expectedCheckerReceiptSha256}).then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(safeError(error));process.exitCode=1;});
}
