import { fetchPublic, plainText } from '../lib/research.mjs';
import { ROOT,dataPath, readJSON, writeJSON, records, candidateIdentity, hash, sha256, stableJSON, safeError } from '../lib/storage.mjs';
import { deterministicCheck } from '../lib/validation.mjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseScoringPolicy } from '../lib/scoring.mjs';
import { validateLoopScheduling } from '../lib/loop-schedule.mjs';
const runId=process.argv[2];
try{
  const draft=await readJSON(dataPath('drafts',runId));const research=await readJSON(dataPath('research',runId));
  const rules=await fs.readFile(path.join(ROOT,'RULES.md'),'utf8'),rulesSha256=sha256(rules),scoringPolicy=parseScoringPolicy(rules);
  let scheduling;
  if(process.env.LOOP_SCHEDULING_SHA)scheduling=validateLoopScheduling(await readJSON(dataPath('scheduling',runId)),{runId,expectedSha256:process.env.LOOP_SCHEDULING_SHA,eventName:process.env.GITHUB_EVENT_NAME});
  if(process.env.GITHUB_ACTIONS==='true'&&!scheduling)throw new Error('Trusted loop reservation is missing from evidence preparation.');
  const assessmentContractVersion=scheduling?.assessmentContractVersion===1?1:null;
  if(draft.runId!==runId||!Array.isArray(draft.posts)||draft.posts.length<(assessmentContractVersion?0:1)||draft.posts.length>6)throw new Error('Writer output must have matching runId and a bounded assessed post batch.');
  if(scheduling&&draft.targetCount!==scheduling.targetCount)throw new Error('Writer target differs from its trusted reservation.');
  if(!Array.isArray(research.sources))throw new Error('Research source records are missing.');
  const previous=await records('posts'),sources=[],health=[];
  for(const post of draft.posts)if(typeof post.productUrl==='string'){try{post.id=candidateIdentity(post);post.candidateId=post.id;}catch{}}
  const selected=draft.posts.length?[...new Set(draft.posts.flatMap(p=>Array.isArray(p.sourceIds)?p.sourceIds:[]))].map(sourceId=>research.sources.find(s=>s.id===sourceId)).filter(Boolean):research.sources.filter(source=>typeof source?.id==='string'&&typeof source?.url==='string'&&typeof source?.text==='string'&&source.text.trim().length>=100).slice(0,6);
  for(const source of selected){
    try{const page=await fetchPublic(source.url),text=plainText(page.text).slice(0,18000);if(text.length<100)throw new Error('Evidence source contained too little readable text.');sources.push({...source,text,fetchedAt:page.fetchedAt,verifiedAt:page.fetchedAt});}
    catch(error){health.push({sourceId:source.id,url:source.url,status:'failed',message:safeError(error)});}
  }
  if(!draft.posts.length&&!sources.length)throw new Error('An empty assessment needs at least one successfully re-fetched public research source.');
  for(const post of draft.posts){
    const product=research.sources.find(s=>s.productUrl===post.productUrl||s.url===post.productUrl);
    if(!product||sources.some(s=>s.url===post.productUrl))continue;
    try{const page=await fetchPublic(post.productUrl),text=plainText(page.text).slice(0,18000);if(text.length<100)continue;const sourceId=hash(post.productUrl);sources.push({id:sourceId,url:post.productUrl,title:post.title+' · official product',publisher:new URL(post.productUrl).hostname,text,fetchedAt:page.fetchedAt,verifiedAt:page.fetchedAt});post.sourceIds=[...new Set([...(post.sourceIds||[]),sourceId])].slice(0,4);}
    catch(error){health.push({url:post.productUrl,status:'failed',message:safeError(error)});}
  }
  const sameBatch=new Set();
  const deterministicResults=draft.posts.map(post=>{const reasons=deterministicCheck(post,[...research.sources,...sources],previous,{scoringPolicy});if(sameBatch.has(post.id))reasons.push('Duplicate product in this writer batch.');sameBatch.add(post.id);if(post.sourceIds?.some(sourceId=>!sources.some(s=>s.id===sourceId)))reasons.push('Attached evidence source could not be re-fetched.');return {postId:post.id,pass:reasons.length===0,reasons};});
  await writeJSON(dataPath('drafts',runId),draft);
  const context={runId,createdAt:new Date().toISOString(),rulesSha256,scoringPolicy,draftSha256:sha256(stableJSON(draft)),sourceSnapshotSha256:sha256(stableJSON(sources)),sources,health,deterministicResults,...(assessmentContractVersion?{assessmentContractVersion}: {})};
  await writeJSON(dataPath('check-context',runId),context);
  console.log(JSON.stringify({runId,draftSha256:context.draftSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,results:deterministicResults}));
}catch(error){console.error(safeError(error));process.exitCode=1;}
