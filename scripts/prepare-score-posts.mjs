import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {ROOT,records,readJSON,sha256,stableJSON,safeError} from '../lib/storage.mjs';
import {parseScoringPolicy,validateScoreSidecar} from '../lib/scoring.mjs';
import {verifyPublishedPost} from '../lib/validation.mjs';
import {fetchPublic,plainText} from '../lib/research.mjs';
import {validateScoreInput} from '../lib/score-batch.mjs';

export async function fetchScoreSources(posts,{fetchPage=fetchPublic}={}){
 const originals=[...new Map(posts.flatMap(post=>post.sources).map(source=>[source.id,source])).values()],sources=[],health=[];
 const results=await Promise.allSettled(originals.map(async source=>{
  try{const page=await fetchPage(source.url),text=plainText(page.text).slice(0,18000);if(text.length<100)throw new Error('Public source contains too little readable evidence.');return {...source,text,fetchedAt:page.fetchedAt,verifiedAt:page.fetchedAt};}
  catch(error){return {failure:{sourceId:source.id,url:source.url,status:'failed',message:safeError(error)}};}
 }));
 for(const result of results){if(result.status==='rejected')throw new Error('Public source collection failed.');if(result.value.failure)health.push(result.value.failure);else sources.push(result.value);}
 return {sources,health};
}
export async function prepareScorePosts({root=ROOT,env=process.env,posts,fetchPage=fetchPublic}={}){
 const runId=env.RUN_ID;
 if(!/^score-\d+-\d+$/.test(runId||''))throw new Error('A bounded cloud score run identity is required.');
 if(env.GITHUB_ACTIONS==='true'&&(env.GITHUB_REPOSITORY!=='xndanius/while-you-sleep'||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='workflow_dispatch'))throw new Error('Historical scoring runs only from the trusted main workflow.');
 const candidates=posts||await records('posts'),selected=[];
 for(const post of candidates){
  if(!verifyPublishedPost(post))throw new Error('An original post failed its immutable content fingerprint.');
  if(post.scoring)continue;
  let sidecar;try{sidecar=await readJSON(path.join(root,'data','scores',post.id+'.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(sidecar){if(validateScoreSidecar(post,sidecar).length)throw new Error('An existing score sidecar failed validation.');continue;}
  selected.push(post);
 }
 if(selected.length>10)throw new Error('Historical scoring is bounded to ten original posts per run.');
 if(!selected.length){console.log('run_models=false');return null;}
 const rules=await readFile(path.join(root,'RULES.md'),'utf8'),policy=parseScoringPolicy(rules);
 const git=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'});if(git.status!==0)throw new Error('Could not freeze the scoring repository revision.');
 const {sources,health}=await fetchScoreSources(selected,{fetchPage});
 const input={schema:1,runId,createdAt:new Date().toISOString(),rules,rulesSha256:sha256(rules),rulesCommit:git.stdout.trim(),policy,posts:selected,sources,health};
 const failures=validateScoreInput(input,{runId});if(failures.length)throw new Error(failures.join(' '));
 if(selected.some(post=>!sources.some(source=>post.sources.some(original=>original.id===source.id))))throw new Error('At least one original post has no readable public evidence; no model ran.');
 const directory=path.join(root,'.run','score-data');await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'input.json'),JSON.stringify(input,null,2)+'\n');
 console.log(`run_models=true\nrepo_sha=${input.rulesCommit}\nrules_sha256=${input.rulesSha256}\ninput_sha256=${sha256(stableJSON(input))}\npost_count=${selected.length}`);
 return input;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))prepareScorePosts().catch(error=>{console.error(safeError(error));process.exitCode=1;});
