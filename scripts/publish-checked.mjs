import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ROOT, dataPath, readJSON, writeJSON, records, sha256, stableJSON, safeError, hash } from '../lib/storage.mjs';
import { checkApproval, deterministicCheck, contentHash } from '../lib/validation.mjs';
import { fetchPublic, plainText } from '../lib/research.mjs';
import { localParts } from '../lib/config.mjs';
import { renderCard } from '../lib/card.mjs';

const runId=process.argv[2];
try{
  const draft=await readJSON(dataPath('drafts',runId)),context=await readJSON(dataPath('check-context',runId)),manifest=await readJSON(dataPath('checks',runId)),research=await readJSON(dataPath('research',runId));
  if(process.env.GITHUB_ACTIONS==='true'){
    if(!process.env.EXPECTED_DRAFT_SHA||!process.env.EXPECTED_CONTEXT_SHA)throw new Error('Trusted pre-check fingerprints are missing.');
    if(sha256(stableJSON(draft))!==process.env.EXPECTED_DRAFT_SHA||sha256(stableJSON(context))!==process.env.EXPECTED_CONTEXT_SHA)throw new Error('Checker changed its frozen draft or evidence context; publication blocked.');
  }
  if(sha256(stableJSON(draft))!==context.draftSha256||sha256(stableJSON(context.sources))!==context.sourceSnapshotSha256)throw new Error('Draft or verified source snapshot changed after independent check.');
  if(Date.now()-Date.parse(context.createdAt)>3*3600000||!Number.isFinite(Date.parse(context.createdAt)))throw new Error('Verified evidence snapshot is missing or older than three hours.');
  if(Number(draft.repairAttempt||0)>1)throw new Error('Only one writer repair is allowed.');
  const targetCount=Math.min(3,Math.max(1,Number(process.argv[3]||draft.targetCount||1)));
  const previous=await records('posts'),today=localParts().day;
  const todayCount=previous.filter(p=>localParts(new Date(p.publishedAt)).day===today).length;
  const results=checkApproval(draft,context,manifest),published=[],rejected=[...(draft.rejected||[])],steps=[...(draft.steps||[])];
  await writeJSON(dataPath('candidates',runId),{runId,createdAt:research.createdAt,candidates:draft.candidates||[],picked:draft.posts.map(p=>({id:p.id,title:p.title,sourceIds:p.sourceIds})),rejected:draft.rejected||[]},{immutable:true});
  const publishedUrls=[];
  for(const result of results){
    const post=draft.posts.find(p=>p.id===result.postId);
    const reasons=[...result.reasons,...deterministicCheck(post,[...research.sources,...context.sources],previous)];
    if(todayCount+published.length>=3){steps.push({stage:'publish',status:'skipped',at:new Date().toISOString(),message:'Daily cap reached: three posts are already public for this Vilnius date.'});break;}
    if(published.length>=targetCount)break;
    if(!reasons.length){
      for(const sourceId of post.sourceIds){
        const source=context.sources.find(s=>s.id===sourceId);
        try{
          const fetched=await fetchPublic(source.url),text=plainText(fetched.text).toLowerCase();
          if(text.length<100)throw new Error('Live source contains too little readable evidence.');
          for(const claim of result.check.claimChecks.filter(c=>c.sourceId===sourceId))if(!text.includes(plainText(claim.evidenceQuote).toLowerCase()))throw new Error('A checked evidence quote no longer exists on the live source.');
        }catch(error){reasons.push(`${source.url}: ${safeError(error)}`);}
      }
    }
    if(reasons.length){rejected.push({postId:post.id,title:post.title,reason:[...new Set(reasons)].join(' ')});continue;}
    const publishedAt=new Date().toISOString();
    const rulesSha256=process.env.RULES_SHA256||null;
    const record={...post,publishedAt,version:rulesSha256?`rules-${rulesSha256.slice(0,12)}`:draft.version||'v1',rulesSha256,rulesCommit:process.env.RULES_COMMIT||null,origin:process.env.GITHUB_ACTIONS==='true'?'github-actions-codex-loop':'local-checked-publication',runId,githubRunUrl:research.githubRunUrl||null,sources:context.sources.filter(s=>post.sourceIds.includes(s.id)).map(({id,title,url,publisher,fetchedAt,verifiedAt})=>({id,title,url,publisher,fetchedAt,verifiedAt})),imageUrl:`./cards/${post.id}.jpg`,checker:{passed:true,checkedAt:manifest.checkedAt||context.createdAt,checkerRunId:manifest.checkerRunId||`${runId}-independent-check`,draftSha256:context.draftSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,claimChecks:result.check.claimChecks}};
    delete record.sourceIds;
    record.contentSha256=contentHash(record);
    await fs.mkdir(path.join(ROOT,'public','cards'),{recursive:true});
    try{await fs.writeFile(path.join(ROOT,'public','cards',post.id+'.jpg'),renderCard(record),{flag:'wx'});}
    catch(error){if(error.code!=='EEXIST')throw error;}
    await writeJSON(dataPath('posts',post.id),record,{immutable:true});
    published.push(post.id);previous.push(record);publishedUrls.push(post.productUrl);
    steps.push({stage:'publish',status:'completed',at:publishedAt,message:`Published “${post.title}” and its 1080×1350 JPEG after separate checker approval.`,postId:post.id});
  }
  for(let i=0;i<rejected.length;i++)await writeJSON(dataPath('rejections',`${runId}-${String(i).padStart(3,'0')}`),{...rejected[i],runId,at:new Date().toISOString()},{immutable:true});
  const run={id:runId,type:'loop',status:published.length>=targetCount?'completed':todayCount>=3?'skipped_daily_cap':published.length?'completed_with_rejections':'rejected',startedAt:research.createdAt,finishedAt:new Date().toISOString(),candidatesFound:draft.candidates?.length||0,picked:draft.posts.length,rejected,published,steps:[{stage:'research',status:'completed',at:research.createdAt,message:`Fetched ${research.sources.length} live source records; ${research.health.filter(h=>h.status==='failed').length} feeds reported failure.`},{stage:'write',status:'completed',at:context.createdAt,message:`Codex CLI wrote ${draft.posts.length} proposed posts.`},{stage:'check',status:results.every(r=>r.pass)?'passed':'rejected',at:manifest.checkedAt||context.createdAt,message:'Separate Codex checker decisions bound to exact draft and evidence hashes.'},...steps],githubRunUrl:research.githubRunUrl||null,version:draft.version||'v1',usage:draft.usage||{inputTokens:null,outputTokens:null,costUsd:null},engine:'official openai/codex-action',sourceSnapshotSha256:context.sourceSnapshotSha256};
  await writeJSON(dataPath('runs',runId),run,{immutable:true});
  console.log(JSON.stringify({runId,status:run.status,published,rejected:rejected.length}));
  if(published.length<targetCount&&todayCount<3)process.exitCode=1;
}catch(error){console.error(safeError(error));process.exitCode=1;}
