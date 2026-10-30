import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ROOT, dataPath, readJSON, writeJSON, records, sha256, stableJSON, safeError, hash, canonicalURL } from '../lib/storage.mjs';
import { checkApproval, deterministicCheck, contentHash,frozenScoringPolicyReasons,completedAssessmentReasons,assessmentJobReasons } from '../lib/validation.mjs';
import { fetchPublic, plainText,sourceRole,fetchDemandEvidence } from '../lib/research.mjs';
import { renderCard } from '../lib/card.mjs';
import { localParts } from '../lib/config.mjs';
import { validateLoopScheduling, dailyPublicationCount, DAILY_PUBLICATION_CAP, postScheduling } from '../lib/loop-schedule.mjs';
import { weightedOverall,publishedScoring } from '../lib/scoring.mjs';
import { readRelayStatus,relayPublicationReady } from '../lib/relay.mjs';
import { sourceEvidenceFetchOptions } from '../lib/product-evidence.mjs';
import {demandContextReasons} from '../lib/demand.mjs';
import {sourceValidationMatchesDefinition} from '../lib/source-registry.mjs';
import {readProviderEvidence} from '../lib/provider-evidence.mjs';
import {discussionEvidenceReasons,sourceQuoteOccurs} from '../lib/evidence-contract.mjs';
import {demandQuoteOccurs} from '../lib/demand-quotes.mjs';
import {validateAssistantExecution,assistantCheckerId} from '../lib/assistant-provenance.mjs';
import {unverifiedAssessment} from '../lib/checker-output.mjs';
import {hasDiscussionImplementationReference as implementationSource,discussionImplementationReference,extractDiscussionImplementationEvidence} from '../lib/discussion-implementation.mjs';

const runId=process.argv[2];
try{
  let scheduling;
  if(process.env.LOOP_SCHEDULING_SHA)scheduling=validateLoopScheduling(await readJSON(dataPath('scheduling',runId)),{runId,expectedSha256:process.env.LOOP_SCHEDULING_SHA,eventName:process.env.GITHUB_EVENT_NAME});
  if(process.env.GITHUB_ACTIONS==='true'&&!scheduling)throw new Error('Trusted loop reservation is missing.');
  if(scheduling?.decision!=='run'&&scheduling)throw new Error('The scheduling gate did not reserve model publication.');
  const assistantMode=runId?.startsWith('assistant-')||process.env.ASSISTANT_EXECUTION_SHA256!==undefined;
  if(assistantMode&&(!scheduling||process.env.GITHUB_ACTIONS==='true'))throw new Error('Assistant publication requires the existing verified reservation and a separate host execution.');
  if(scheduling){const reservation=await readJSON(dataPath('slot-reservations',runId));if(reservation.schedulingSha256!==process.env.LOOP_SCHEDULING_SHA||reservation.slotId!==scheduling.slotId||reservation.runId!==runId)throw new Error('Publication reservation changed.');}
  const draft=await readJSON(dataPath('drafts',runId)),context=await readJSON(dataPath('check-context',runId)),manifest=await readJSON(dataPath('checks',runId)),research=await readJSON(dataPath('research',runId));
  if(process.env.DEMAND_CONTRACT_VERSION==='1'&&context.demandContractVersion!==1)throw new Error('Demand-first publication requires the new independent fixed-registry demand contract.');
  const demandFailures=demandContextReasons(context);if(demandFailures.length)throw new Error(demandFailures.join(' '));
  const demandRegistry=context.demandContractVersion===1?await readJSON(path.join(ROOT,'data','sources','registry.json')):null;
  const liveDemandCache=new Map();
  const readLiveDemand=sourceId=>{
    if(!liveDemandCache.has(sourceId))liveDemandCache.set(sourceId,(async()=>{
      const source=context.sources.find(row=>row.id===sourceId),authority=context.demandContext?.authorizedSources.find(row=>row.sourceId===sourceId);
      const definition=authority?.role==='demand'&&demandRegistry.sources.find(entry=>entry.id===authority.registrySourceId&&['active','probation'].includes(entry.status)&&sourceValidationMatchesDefinition(entry.validation,entry));
      if(!source||!definition||sourceRole(definition)!=='demand')throw new Error('The exact demand item is no longer admitted in the fixed registry.');
      const fresh=await fetchDemandEvidence(source,{definition,providerFetch:(source)=>readProviderEvidence(ROOT,source)});
      if(fresh.discussionMetadataVersion===1){const invalid=discussionEvidenceReasons(fresh,{definition,asOf:new Date().toISOString()});if(invalid.length)throw new Error(invalid.join(' '));}
      return fresh;
    })());
    return liveDemandCache.get(sourceId);
  };
  let trustedUsage;try{trustedUsage=await readJSON(dataPath('usage',runId));}catch{trustedUsage={inputTokens:null,outputTokens:null,costUsd:null};}
  if(process.env.GITHUB_ACTIONS==='true'){
    if(!process.env.EXPECTED_DRAFT_SHA||!process.env.EXPECTED_CONTEXT_SHA)throw new Error('Trusted pre-check fingerprints are missing.');
    if(sha256(stableJSON(draft))!==process.env.EXPECTED_DRAFT_SHA||sha256(stableJSON(context))!==process.env.EXPECTED_CONTEXT_SHA)throw new Error('Checker changed its frozen draft or evidence context; publication blocked.');
  }
  if(sha256(stableJSON(draft))!==context.draftSha256||sha256(stableJSON(context.sources))!==context.sourceSnapshotSha256)throw new Error('Draft or verified source snapshot changed after independent check.');
  const policyFailures=frozenScoringPolicyReasons(context,{...(process.env.GITHUB_ACTIONS==='true'?{expectedRulesSha256:process.env.RULES_SHA256||''}: {})});
  if(policyFailures.length)throw new Error(policyFailures.join(' '));
  if(Date.now()-Date.parse(context.createdAt)>3*3600000||!Number.isFinite(Date.parse(context.createdAt)))throw new Error('Verified evidence snapshot is missing or older than three hours.');
  if(Number(draft.repairAttempt||0)>1)throw new Error('Only one writer repair is allowed.');
  const contract=scheduling?.assessmentContractVersion===1;
  if((contract?1:null)!==(context.assessmentContractVersion||null))throw new Error('Independent assessment contract differs from the frozen scheduling reservation.');
  const assessmentFailures=completedAssessmentReasons(draft,context,manifest);
  if(assessmentFailures.length)throw new Error(assessmentFailures.join(' '));
  if(!Array.isArray(draft.posts)||!contract&&!draft.posts.length)throw new Error('Writer proposed no assessable posts under the legacy contract.');
  const targetCount=scheduling?.targetCount||Math.min(3,Math.max(1,Number(process.argv[3]||draft.targetCount||1)));
  const dailyCap=scheduling?.dailyCap||DAILY_PUBLICATION_CAP;
  if(scheduling&&draft.targetCount!==targetCount)throw new Error('Writer target count differs from the trusted slot reservation.');
  const previous=await records('posts');
  let assistantExecution=null;
  if(assistantMode){
    assistantExecution=await readJSON(dataPath('assistant-executions',runId));
    validateAssistantExecution(assistantExecution,{draft,context,manifest,research,rules:await fs.readFile(path.join(ROOT,'RULES.md'),'utf8')},{expectedSha256:process.env.ASSISTANT_EXECUTION_SHA256,previous});
    if(Date.parse(scheduling.requestedAt)>Date.parse(assistantExecution.writer.startedAt))throw new Error('Assistant reservation must precede the writer execution.');
    trustedUsage={inputTokens:null,outputTokens:null,costUsd:null,source:'assistant-runtime',status:'not_reported'};
  }
  const checkerRunId=assistantExecution?assistantCheckerId(assistantExecution):manifest.checkerRunId||`${runId}-independent-check`;
  const checkedAt=assistantExecution?.checker.completedAt||manifest.checkedAt||context.createdAt;
  const todayCount=dailyPublicationCount(previous);
  if(scheduling&&localParts(new Date()).day!==scheduling.localDate)throw new Error('Reserved publication date ended; only the current Vilnius day can catch up.');
  const reservedSlots=scheduling?.slots||[scheduling].filter(Boolean);
  if(scheduling&&!scheduling.bootstrap&&previous.some(post=>reservedSlots.some(slot=>post.scheduling?.slotId===(slot.id?.startsWith('publish-')?slot.id:slot.slotId))))throw new Error('A reserved publication slot already has a committed post.');
  const results=checkApproval(draft,context,manifest),published=[],rejected=[...(draft.rejected||[])],steps=[...(draft.steps||[])];
  const operationalFailures=assessmentJobReasons(draft,process.env.MODEL_JOB_RESULTS,{required:contract&&process.env.GITHUB_ACTIONS==='true'}).map(reason=>({stage:'model_jobs',code:'model_stage_incomplete',reason}));
  let relayReady=true;
  if(process.env.GITHUB_ACTIONS==='true'&&scheduling?.cadence?.mode==='hourly'&&draft.posts.length){
    try{relayReady=relayPublicationReady(await readRelayStatus(ROOT),{hourly:true});}catch{relayReady=false;}
  }
  await writeJSON(dataPath('candidates',runId),{runId,createdAt:research.createdAt,candidates:draft.candidates||[],picked:draft.posts.map(p=>({id:p.id,title:p.title,sourceIds:p.sourceIds})),rejected:draft.rejected||[]},{immutable:true});
  const publishedUrls=[];
  for(const result of results){
    if(operationalFailures.some(failure=>failure.stage==='model_jobs'))break;
    if(scheduling&&localParts(new Date()).day!==scheduling.localDate)throw new Error('Reserved publication date ended during publication.');
    const post=draft.posts.find(p=>p.id===result.postId);
    const reasons=[...result.reasons,...deterministicCheck(post,[...research.sources,...context.sources],previous,{scoringPolicy:context.scoringPolicy,demandContext:context,demandRequired:context.demandContractVersion===1})];
    if(!reasons.length && weightedOverall(post.scoring.criteria,context.scoringPolicy.weights)<context.scoringPolicy.threshold)reasons.push(`Overall score is below the frozen publish threshold of ${context.scoringPolicy.threshold}.`);
    if(todayCount+published.length>=dailyCap){steps.push({stage:'publish',status:'skipped',at:new Date().toISOString(),message:`Daily cap reached: ${dailyCap} posts are already public for this Vilnius date.`});break;}
    if(published.length>=targetCount)break;
    if(!reasons.length&&!relayReady){
      const reason='Publishing is held until the actual LinkedIn relay switch to best.xml is confirmed.';
      reasons.push(reason);
      if(!operationalFailures.some(failure=>failure.stage==='relay'))operationalFailures.push({stage:'relay',code:'relay_confirmation_pending',reason});
    }
    if(!reasons.length){
      for(const sourceId of post.sourceIds.slice().sort((a,b)=>Number(implementationSource(context.sources.find(source=>source.id===a)))-Number(implementationSource(context.sources.find(source=>source.id===b))))){
        const source=context.sources.find(s=>s.id===sourceId);
        try{
          const authority=context.demandContext?.authorizedSources.find(row=>row.sourceId===sourceId);
          let text,liveSource;
          if(authority?.role==='demand'){
            liveSource=await readLiveDemand(sourceId);text=liveSource.text;
            if(!demandQuoteOccurs(liveSource,post.demandEvidence.evidenceQuote)||!demandQuoteOccurs(liveSource,result.check.demandCheck.evidenceQuote))throw new Error('The checked demand chore quote no longer exists in the live privacy-safe notice.');
          }else{
            if(implementationSource(source)&&!discussionImplementationReference(source,{demandSources:context.sources.filter(item=>item.role==='demand')}))throw new Error('Implementation reference lost its exact fixed catalog and discussion-task binding.');
            // A shared document may also support rejected batch assignments.
            // Preserve the full frozen binding above, then independently
            // revalidate only this post's exact demand, which its claims use.
            const liveReference=implementationSource(source)?{...source,supportsDemandSourceIds:post.demandEvidence?.sourceIds}:null;
            if(liveReference&&(!discussionImplementationReference(liveReference)||!liveReference.supportsDemandSourceIds.every(id=>source.supportsDemandSourceIds.includes(id))))throw new Error('Implementation reference is not attached to this post\'s exact demand.');
            const liveDemands=liveReference?await Promise.all(liveReference.supportsDemandSourceIds.map(readLiveDemand)):[];
            if(liveReference&&!discussionImplementationReference(liveReference,{demandSources:liveDemands}))throw new Error('Implementation reference lost its freshly fetched discussion-task binding.');
            const fetched=await fetchPublic(source.url,sourceEvidenceFetchOptions(source));
            if(implementationSource(source)&&canonicalURL(fetched.url)!==source.url)throw new Error('Implementation reference redirected away from its exact catalog URL.');
            if(implementationSource(source)){const extracted=extractDiscussionImplementationEvidence(liveReference,fetched.text,{demandSources:liveDemands});if(!extracted)throw new Error('Live implementation reference has no privacy-safe task-matched literal section.');text=extracted.text;}
            else text=plainText(fetched.text);
          }
          if(source.discussionMetadataVersion!==1&&text.length<100)throw new Error('Live source contains too little readable evidence.');
          for(const claim of [...result.check.claimChecks,...result.check.scoreChecks].filter(c=>c.sourceId===sourceId)){
            const occurs=sourceQuoteOccurs(liveSource||{text},claim.evidenceQuote,claim.criterion?{}:{normalize:value=>plainText(value).toLowerCase()});
            if(!occurs)throw new Error('A checked claim or score evidence quote no longer exists on the live source.');
          }
        }catch(error){const reason=safeError(error);reasons.push(`${source.url}: ${reason}`);operationalFailures.push({stage:'live_source',code:'live_evidence_unavailable',sourceId,url:source.url,reason});}
      }
    }
    if(reasons.length){rejected.push({postId:post.id,title:post.title,reason:[...new Set(reasons)].join(' ')});continue;}
    const publishedAt=new Date().toISOString();
    if(scheduling&&localParts(publishedAt).day!==scheduling.localDate)throw new Error('Reserved publication date ended while checking sources.');
    const rulesSha256=assistantExecution?.bindings.rulesSha256||process.env.RULES_SHA256||null;
    const record={...post,publishedAt,version:rulesSha256?`rules-${rulesSha256.slice(0,12)}`:draft.version||'v1',rulesSha256,rulesCommit:process.env.RULES_COMMIT||null,origin:assistantExecution?'assistant-checked-publication':process.env.GITHUB_ACTIONS==='true'?'github-actions-codex-loop':'local-checked-publication',runId,githubRunUrl:research.githubRunUrl||null,sources:context.sources.filter(s=>post.sourceIds.includes(s.id)).map(({id,title,url,publisher,fetchedAt,verifiedAt,discussionMetadataVersion,community})=>({id,title,url,publisher,fetchedAt,verifiedAt,...(discussionMetadataVersion===1&&typeof community==='string'?{community}: {})})),imageUrl:`./cards/${post.id}.jpg`,checker:{passed:true,checkedAt,checkerRunId,...(assistantExecution?{manifestSha256:assistantExecution.bindings.manifestSha256}: {}),draftSha256:context.draftSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,claimChecks:result.check.claimChecks}};
    if(assistantExecution){record.assistantExecution=assistantExecution;record.distribution=assistantExecution.distribution;record.checker.approval=result.check;}
    record.scoring=publishedScoring(post.scoring.criteria,context.scoringPolicy,{checkedAt:record.checker.checkedAt,checkerRunId:record.checker.checkerRunId});
    record.checker.scoreChecks=result.check.scoreChecks;
    record.checker.scoreSources=context.sources;
    record.checker.scoringPolicy=context.scoringPolicy;
    if(context.noveltyContractVersion===1)record.checker.noveltyCheck=result.check.noveltyCheck;
    if(context.demandContractVersion===1){record.demandContractVersion=1;record.checker.demandCheck=result.check.demandCheck;record.checker.demandContextSha256=context.demandContextSha256;}
    delete record.sourceIds;
    delete record.triggerEvent;
    record.githubRunUrl=assistantExecution?null:scheduling?.githubRunUrl||research.githubRunUrl||null;
    record.eventName=assistantExecution?'assistant':scheduling?.eventName||process.env.GITHUB_EVENT_NAME||'unknown';
    record.publicUrl=`${(process.env.PUBLIC_BASE_URL||'https://xndanius.github.io/while-you-sleep').replace(/\/$/,'')}/p/${post.id}/`;
    if(scheduling)record.scheduling=postScheduling(scheduling,published.length);
    record.contentSha256=contentHash(record);
    await fs.mkdir(path.join(ROOT,'public','cards'),{recursive:true});
    try{await fs.writeFile(path.join(ROOT,'public','cards',post.id+'.jpg'),renderCard(record),{flag:'wx'});}
    catch(error){if(error.code!=='EEXIST')throw error;}
    await writeJSON(dataPath('posts',post.id),record,{immutable:true});
    published.push(post.id);previous.push(record);publishedUrls.push(post.productUrl);
    steps.push({stage:'publish',status:'completed',at:publishedAt,message:`Published “${post.title}” and its 1080×1350 JPEG after separate checker approval.`,postId:post.id});
  }
  // No-candidate decisions still need a currently reachable public evidence
  // snapshot. Empty model output cannot turn a network outage into success.
  if(contract&&!draft.posts.length){
    let available=0;const liveDemands=[];
    for(const source of context.sources.slice().sort((a,b)=>Number(implementationSource(a))-Number(implementationSource(b)))){
      try{
        const authority=context.demandContext?.authorizedSources.find(row=>row.sourceId===source.id);
        if(authority?.role==='demand'){
          liveDemands.push(await readLiveDemand(source.id));
        }else{
          if(implementationSource(source)&&!discussionImplementationReference(source,{demandSources:liveDemands}))throw new Error('Implementation reference lost its freshly fetched discussion-task binding.');
          const page=await fetchPublic(source.url,sourceEvidenceFetchOptions(source));
          if(implementationSource(source)&&canonicalURL(page.url)!==source.url)throw new Error('Implementation reference redirected away from its exact catalog URL.');
          const text=implementationSource(source)?extractDiscussionImplementationEvidence(source,page.text,{demandSources:liveDemands})?.text:plainText(page.text);
          if(!text||text.length<100)throw new Error('Live source contains too little task-matched readable evidence.');
        }
        available++;
      }
      catch(error){operationalFailures.push({stage:'live_source',code:'empty_assessment_evidence_unavailable',sourceId:source.id,url:source.url,reason:safeError(error)});}
    }
    if(!available&&!operationalFailures.length)operationalFailures.push({stage:'live_source',code:'empty_assessment_evidence_unavailable',reason:'No fresh public evidence was available for the empty assessment.'});
  }
  for(let i=0;i<rejected.length;i++)await writeJSON(dataPath('rejections',`${runId}-${String(i).padStart(3,'0')}`),{...rejected[i],runId,at:new Date().toISOString()},{immutable:true});
  const completed=contract&&!operationalFailures.length;
  const run={id:runId,type:'loop',status:operationalFailures.length?(contract?published.length?'completed_with_unverified':'no_post_unverified':published.length?'completed_with_failure':'failed_closed'):published.length>=targetCount?'completed':todayCount>=dailyCap?'skipped_daily_cap':published.length?'completed_with_rejections':completed?'completed_no_post':'rejected',startedAt:research.createdAt,finishedAt:new Date().toISOString(),candidatesFound:draft.candidates?.length||0,picked:draft.posts.length,rejected,published,steps:[{stage:'research',status:'completed',at:research.createdAt,message:`Retained ${research.sources.length} source records with per-source retrieval provenance; ${(research.health||[]).filter(h=>h.status==='failed').length} feeds reported failure.`},{stage:'write',status:'completed',at:assistantExecution?.writer.completedAt||context.createdAt,message:assistantExecution?`Assistant writer prepared ${draft.posts.length} proposed posts.`:`Codex CLI wrote ${draft.posts.length} proposed posts.`},{stage:'check',status:results.every(r=>r.pass)?'passed':'rejected',at:assistantExecution?.checker.completedAt||manifest.checkedAt||context.createdAt,message:assistantExecution?'Independent assistant decisions bound to exact draft and evidence hashes.':'Separate Codex checker decisions bound to exact draft and evidence hashes.'},...steps,...operationalFailures.map(failure=>({stage:failure.stage,status:contract?'unverified':'failed',at:new Date().toISOString(),message:failure.reason}))],githubRunUrl:research.githubRunUrl||null,version:process.env.RULES_SHA256?`rules-${process.env.RULES_SHA256.slice(0,12)}`:draft.version||'v1',rulesSha256:assistantExecution?.bindings.rulesSha256||process.env.RULES_SHA256||null,rulesCommit:process.env.RULES_COMMIT||null,usage:trustedUsage,engine:assistantExecution?'assistant-orchestrated':'official openai/codex-action',...(assistantExecution?{assistantExecution}: {}),sourceSnapshotSha256:context.sourceSnapshotSha256};
  if(contract){
    run.assessmentOutcome=completed?'completed':'unverified';run.operationalFailures=operationalFailures;
    if(!completed)run.unverifiedAssessment=unverifiedAssessment(scheduling,{...operationalFailures[0],reason:operationalFailures.map(failure=>failure.reason).join(' ')},run.finishedAt);
    if(completed){
      const assessedRefusals=rejected.filter(rejection=>results.some(result=>result.postId===rejection.postId));
      const reason=!draft.posts.length?manifest.completedAssessment.reason:assessedRefusals.length?assessedRefusals.map(rejection=>`${rejection.title}: ${rejection.reason}`).join(' ').slice(0,500):`Assessment completed with ${published.length} checked publications; no further supported candidate was proposed. ${manifest.completedAssessment.reason}`.slice(0,500);
      run.checkedAssessment={schema:1,completed:true,contractVersion:1,runId,schedulingSha256:process.env.LOOP_SCHEDULING_SHA,slotIds:scheduling.slotIds||[scheduling.slotId],draftSha256:context.draftSha256,contextSha256:sha256(stableJSON(context)),rulesSha256:context.rulesSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,policySha256:context.scoringPolicy.policySha256,checkerRunId:assistantExecution?checkerRunId:`${runId}-independent-check`,completedAt:run.finishedAt,decision:manifest.completedAssessment.decision,reason,checkedPostIds:results.filter(result=>result.pass).map(result=>result.postId)};
    }
  }
  run.eventName=assistantExecution?'assistant':scheduling?.eventName||process.env.GITHUB_EVENT_NAME||'unknown';run.modelExecuted=true;
  run.startedAt=scheduling?.requestedAt||research.createdAt;
  run.githubRunUrl=assistantExecution?null:scheduling?.githubRunUrl||research.githubRunUrl||null;
  if(scheduling)run.scheduling=scheduling;
  await writeJSON(dataPath('runs',runId),run,{immutable:true});
  console.log(JSON.stringify({runId,status:run.status,published,rejected:rejected.length}));
  if(!contract&&(operationalFailures.length||!completed&&published.length<targetCount&&todayCount<dailyCap))process.exitCode=1;
}catch(error){console.error(safeError(error));process.exitCode=1;}
