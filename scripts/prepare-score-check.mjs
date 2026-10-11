import {readFile,writeFile,mkdir,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,sha256,stableJSON,safeError} from '../lib/storage.mjs';
import {fetchScoreSources} from './prepare-score-posts.mjs';
import {validateScoreInput,validateScoreDraft,scoreContext} from '../lib/score-batch.mjs';

export async function readScoreArtifact(directory,allowed){
 const entries=await readdir(directory,{withFileTypes:true});
 if(entries.length!==allowed.length||entries.some(entry=>!entry.isFile()||entry.isSymbolicLink()||!allowed.includes(entry.name)))throw new Error('Scoring artifact contains unexpected files or directories.');
 const values={};
 for(const name of allowed){
  const file=path.join(directory,name),stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2500000)throw new Error('Scoring artifact file exceeds the bounded JSON allowlist.');
  const raw=await readFile(file,'utf8');if(/\bsk-(?:proj-)?[A-Za-z0-9_-]{25,}|Bearer\s+[A-Za-z0-9_.-]{25,}/.test(raw))throw new Error('Scoring artifact may contain a credential; recording blocked.');
  values[name.slice(0,-5)]=JSON.parse(raw);
 }
 return values;
}
export async function prepareScoreCheck({root=ROOT,env=process.env,fetchPage}={}){
 const {input,draft}=await readScoreArtifact(path.join(root,'.staging','scoring'),['input.json','draft.json']);
 const failures=[...validateScoreInput(input,{runId:env.RUN_ID,expectedInputSha256:env.EXPECTED_INPUT_SHA,rulesSha256:env.RULES_SHA256,rulesCommit:env.RULES_COMMIT}),...validateScoreDraft(draft,input)];
 if(!env.EXPECTED_INPUT_SHA||failures.length)throw new Error(failures.join(' ')||'Trusted pre-model scoring input fingerprint is missing.');
 const {sources,health}=await fetchScoreSources(input.posts,{fetchPage}),context=scoreContext(input,draft,sources,health);
 const directory=path.join(root,'.run','score-data');await mkdir(directory,{recursive:true});
 for(const [name,value] of Object.entries({input,draft,context}))await writeFile(path.join(directory,name+'.json'),JSON.stringify(value,null,2)+'\n');
 console.log(`draft_sha256=${sha256(stableJSON(draft))}\ncontext_sha256=${sha256(stableJSON(context))}`);
 return {input,draft,context};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))prepareScoreCheck().catch(error=>{console.error(safeError(error));process.exitCode=1;});
