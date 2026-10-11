import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {ROOT,sha256,stableJSON,readJSON,writeJSON,safeError} from '../lib/storage.mjs';
import {validateScoreSidecar} from '../lib/scoring.mjs';
import {fetchPublic,plainText} from '../lib/research.mjs';
import {readScoreArtifact} from './prepare-score-check.mjs';
import {SCORE_FILES,validateScoreInput,validateScoreDraft,validateScoreContext,validateScoreManifest,scoreDecisions,assessedSidecar} from '../lib/score-batch.mjs';

export function validateScoreBatch({input,draft,context,check},{env=process.env,now=Date.now()}={}){
 const missing=['EXPECTED_INPUT_SHA','EXPECTED_DRAFT_SHA','EXPECTED_CONTEXT_SHA','RULES_SHA256','RULES_COMMIT'].filter(key=>!env[key]);
 if(missing.length)throw new Error('Trusted pre-model scoring fingerprints are missing.');
 const failures=[...validateScoreInput(input,{runId:env.RUN_ID,expectedInputSha256:env.EXPECTED_INPUT_SHA,rulesSha256:env.RULES_SHA256,rulesCommit:env.RULES_COMMIT}),...validateScoreDraft(draft,input),...validateScoreContext(context,input,draft,{expectedDraftSha256:env.EXPECTED_DRAFT_SHA,expectedContextSha256:env.EXPECTED_CONTEXT_SHA,now}),...validateScoreManifest(check,context)];
 if(failures.length)throw new Error([...new Set(failures)].join(' '));
 return scoreDecisions(input,draft,context,check);
}
export async function recheckScoreEvidence(decisions,input,{fetchPage=fetchPublic}={}){
 const selected=new Map();
 for(const decision of decisions.filter(value=>value.pass)){
  const original=input.posts.find(post=>post.id===decision.postId);
  for(const claim of decision.check.scoreChecks){const source=original.sources.find(source=>source.id===claim.sourceId);selected.set(source.id,source);}
 }
 const results=await Promise.allSettled([...selected.values()].map(async source=>{
  try{const page=await fetchPage(source.url),text=plainText(page.text);if(text.length<100)throw new Error('Live source has too little readable evidence.');return {sourceId:source.id,text};}
  catch{return {sourceId:source.id,failed:true};}
 }));
 const live=new Map();
 for(const result of results){if(result.status!=='fulfilled')throw new Error('Final score evidence verification failed.');live.set(result.value.sourceId,result.value);}
 for(const decision of decisions.filter(value=>value.pass)){
  for(const claim of decision.check.scoreChecks){
   const source=live.get(claim.sourceId);
   if(!source||source.failed||!source.text.includes(claim.evidenceQuote))decision.reasons.push(`${claim.criterion} score evidence is no longer available on its live source.`);
  }
  decision.reasons=[...new Set(decision.reasons)];decision.pass=decision.reasons.length===0;
 }
 return decisions;
}
export async function recordScorePosts({root=ROOT,env=process.env,now=Date.now(),push=true,fetchPage=fetchPublic}={}){
 if(!/^score-\d+-\d+$/.test(env.RUN_ID||''))throw new Error('A bounded cloud score run identity is required.');
 if(env.GITHUB_ACTIONS==='true'&&(env.GITHUB_REPOSITORY!=='xndanius/while-you-sleep'||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='workflow_dispatch'))throw new Error('Score records can only be published from the trusted main workflow.');
 const values=await readScoreArtifact(path.join(root,'.staging','scoring'),SCORE_FILES),decisions=validateScoreBatch(values,{env,now}),{input,draft,context,check}=values;
 const originals=new Map();
 for(const frozen of input.posts){
  const original=await readJSON(path.join(root,'data','posts',frozen.id+'.json'));
  if(sha256(stableJSON(original))!==sha256(stableJSON(frozen)))throw new Error('An immutable original post changed while the cloud scores were being checked.');
  originals.set(original.id,original);
 }
 await recheckScoreEvidence(decisions,input,{fetchPage});
 const checkedAt=new Date(now).toISOString(),written=[];
 for(const decision of decisions){
  if(!decision.pass)continue;
  const original=originals.get(decision.postId),sidecar=assessedSidecar(original,decision.rating,decision.check,context,input,{checkedAt}),file=path.join(root,'data','scores',decision.postId+'.json');
  let existing;try{existing=await readJSON(file);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(existing){if(validateScoreSidecar(original,existing).length)throw new Error('An existing score record is invalid; immutable sidecars are never replaced.');continue;}
  await writeJSON(file,sidecar,{immutable:true});written.push(decision.postId);
 }
 for(const [directory,value] of [['score-inputs',input],['score-drafts',draft],['score-context',context],['score-checks',check]])await writeJSON(path.join(root,'data',directory,env.RUN_ID+'.json'),value,{immutable:true});
 const record={id:env.RUN_ID,type:'score',status:decisions.every(decision=>decision.pass)?'completed':written.length?'completed_with_rejections':'rejected',startedAt:input.createdAt,finishedAt:checkedAt,assessed:decisions.length,written,decisions:decisions.map(({postId,pass,reasons})=>({postId,pass,reasons})),policySha256:input.policy.policySha256,rulesSha256:input.rulesSha256,rulesCommit:input.rulesCommit,draftSha256:context.draftSha256,contextSha256:sha256(stableJSON(context)),sourceSnapshotSha256:context.sourceSnapshotSha256,eventName:'workflow_dispatch',githubRunUrl:`https://github.com/xndanius/while-you-sleep/actions/runs/${env.RUN_ID.match(/^score-(\d+)-\d+$/)[1]}`,engine:'official openai/codex-action',modelExecuted:true};
 await writeJSON(path.join(root,'data','score-runs',env.RUN_ID+'.json'),record,{immutable:true});
 if(push){
  function git(args){const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});if(result.status!==0)throw new Error(`Scoring record Git operation failed: ${args[0]}`);return result.stdout;}
  git(['config','user.name','While You Sleep loop']);git(['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);
  function commit(files,message){git(['add','--',...files]);if(git(['diff','--cached','--name-only']).trim())git(['commit','-m',message]);}
  commit(['score-inputs','score-drafts','score-context','score-checks','score-runs'].map(directory=>`data/${directory}/${env.RUN_ID}.json`),`scores: ${env.RUN_ID} · frozen original posts and independent evidence decisions`);
  for(const postId of written)commit([`data/scores/${postId}.json`],`score: ${originals.get(postId).title} · independent fresh evidence checked`);
  commit([`data/usage/${env.RUN_ID}.json`],'usage: '+env.RUN_ID+' · trusted scorer and checker token estimate');
  const update=spawnSync(process.execPath,['scripts/update-cost-readme.mjs'],{cwd:root,stdio:'inherit'});if(update.status!==0)throw new Error('Could not update scoring cost summary.');
  commit(['README.md'],`cost: ${env.RUN_ID} · daily scoring token estimate and coverage`);
  let pushed=false;
  for(let attempt=0;attempt<3;attempt++){
   const result=spawnSync('git',['push','origin','HEAD:main'],{cwd:root,stdio:'inherit'});if(result.status===0){pushed=true;break;}
   git(['pull','--rebase','origin','main']);
   for(const [postId,frozen] of originals){if(sha256(stableJSON(await readJSON(path.join(root,'data','posts',postId+'.json'))))!==sha256(stableJSON(frozen)))throw new Error('Original post changed during the scoring push retry.');}
  }
  if(!pushed)throw new Error('Could not push scoring records after three attempts.');
 }
 console.log(JSON.stringify({runId:env.RUN_ID,status:record.status,assessed:record.assessed,written,rejected:decisions.filter(decision=>!decision.pass).length}));return record;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))recordScorePosts().catch(error=>{console.error(safeError(error));process.exitCode=1;});
