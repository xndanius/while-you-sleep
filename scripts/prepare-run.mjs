import {mkdir,writeFile,readFile,rm,appendFile} from 'node:fs/promises';
import {readJSON,dataPath,sha256,stableJSON,records} from '../lib/storage.mjs';
import {validateLoopScheduling} from '../lib/loop-schedule.mjs';
import {candidateHistory,writerResearchView,writerReadiness} from '../lib/candidate-input.mjs';
import {ROOT} from '../lib/storage.mjs';
import {parseScoringPolicy,candidateScoringVersionReasons} from '../lib/scoring.mjs';
import {checkerOutputSchema} from '../lib/checker-output.mjs';
import {checkerAssessmentView} from '../lib/checker-assessment.mjs';
import {createNoveltyContext} from '../lib/novelty.mjs';
import {SEGMENTS,DEMAND_KINDS,DEMAND_MIX_POLICY,eligibleSegments,classifyPublishedSegment} from '../lib/demand.mjs';
import {noFreshLeadsReasons} from '../lib/no-fresh-leads.mjs';
import {hasDiscussionImplementationReference,discussionImplementationReference} from '../lib/discussion-implementation.mjs';
import {sealedDiscussionAssignmentReasons} from '../lib/check-diagnostics.mjs';
import {candidatePlanVersionReasons} from '../lib/candidate-plan.mjs';
import {verifyContinuationIntent,continuationResultReasons} from '../lib/research-continuation.mjs';
import {candidateEvidenceTasks} from '../lib/candidate-evidence-tasks.mjs';
import {previousContinuationPlans} from '../lib/candidate-development.mjs';
const runId=process.env.RUN_ID||`loop-${Date.now()}`;
if(!/^[a-zA-Z0-9_-]+$/.test(runId))throw new Error('Invalid run ID');
const role=process.argv[2]||'writer';
if(!['writer','repair','checker','final-checker'].includes(role))throw new Error('Unknown execution role; expected writer, repair, checker or final-checker.');
let scheduling;
if(process.env.LOOP_SCHEDULING_SHA)scheduling=validateLoopScheduling(await readJSON(dataPath('scheduling',runId)),{runId,expectedSha256:process.env.LOOP_SCHEDULING_SHA,eventName:process.env.GITHUB_EVENT_NAME});
if(scheduling&&scheduling.decision!=='run')throw new Error('This loop was not reserved for model execution.');
const targetCount=scheduling?.targetCount||(process.env.BOOTSTRAP==='true'?3:1);
const context={runId,targetCount,maxBatchSize:scheduling?.maxBatchSize||3,rulesSha256:sha256(await readFile('RULES.md','utf8')),role,researchPath:`data/research/${runId}.json`,draftPath:`data/drafts/${runId}.json`,checkContextPath:`data/check-context/${runId}.json`,checkPath:`data/checks/${runId}.json`,priorPostsPath:'.run/prior-posts.json',githubRunUrl:process.env.GITHUB_REPOSITORY?`https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`:null};
context.executionPhase={role,requiresRepairFeedback:role==='repair'};
if(scheduling){context.scheduling={slotId:scheduling.slotId,scheduledAt:scheduling.scheduledAt,eventName:scheduling.eventName,targetCount,slots:scheduling.slots||[],dailyCap:scheduling.dailyCap,maxBatchSize:scheduling.maxBatchSize||3,cadence:scheduling.cadence};context.assessmentContractVersion=scheduling.assessmentContractVersion||null;}
context.scoringPolicy=parseScoringPolicy(await readFile('RULES.md','utf8'));
context.demandContractVersion=process.env.DEMAND_CONTRACT_VERSION==='1'?1:null;context.demandPolicyPath='.run/demand-policy.json';
if(role==='repair')context.repairFeedbackPath='.run/repair-feedback.json';
await mkdir('.run',{recursive:true});await mkdir('data/drafts',{recursive:true});await mkdir('data/checks',{recursive:true});
if(['writer','repair'].includes(role)){
 const history=await candidateHistory(ROOT);context.recentRejectionsPath='.run/recent-rejections.json';
 await writeFile(context.recentRejectionsPath,JSON.stringify(history.rejections,null,2));
 const snapshot=await readJSON(dataPath('research',runId));const planFailures=candidatePlanVersionReasons(snapshot.candidatePlanVersion);if(planFailures.length)throw new Error(planFailures.join(' '));
 if(snapshot.candidatePlanVersion!==undefined)context.candidatePlanVersion=snapshot.candidatePlanVersion;
 const readiness=writerReadiness(snapshot,{demandRequired:context.demandContractVersion===1,now:new Date().toISOString()});
 if(!readiness.ready){
  let receipt;try{receipt=await readJSON(dataPath('no-fresh-leads',runId));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(receipt&&scheduling){const [scan,selection]=await Promise.all([readJSON(dataPath('source-scans',runId)),readJSON(dataPath('learning-selection',runId))]);const reasons=noFreshLeadsReasons(receipt,{runId,schedulingSha256:process.env.LOOP_SCHEDULING_SHA,expectedSha256:sha256(stableJSON(receipt)),scan,selection});if(reasons.length)throw new Error(reasons.join(' '));if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`ready=false\nno_fresh_leads=true\nreadiness_reason=${receipt.reason}\n`);console.log('No fresh lead remained; the deterministic no-post receipt will settle the reserved slot without a model call.');process.exit(0);}
  if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`ready=false\nno_fresh_leads=false\nreadiness_reason=${readiness.reason}\n`);throw new Error(readiness.reason);
 }
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'ready=true\nno_fresh_leads=false\n');
 context.originalResearchPath=context.researchPath;context.researchPath='.run/writer-research.json';
 context.researchPolicy=snapshot.learningSelection?.researchPolicy||null;context.builderFallback=readiness.fallback===true;context.demandSignalIds=context.builderFallback?snapshot.enrichment.demandSignalIds||[]:[];
 context.discussionFirst=readiness.discussionFirst===true;context.discussionBatch=context.discussionFirst?snapshot.enrichment.discussionBatch:null;
 context.mixedRecovery=readiness.mixedRecovery===true;context.recoveryBatch=context.mixedRecovery?snapshot.enrichment.recoveryBatch:null;
 context.selectedSegment=snapshot.learningSelection?.selectedSegment||null;
 if(context.demandContractVersion===1){const selection=await readJSON(dataPath('learning-selection',runId));if(selection.runId!==runId)throw new Error('Demand-first writer has no matching trusted learning selection.');context.selectedSegment=selection.selectedSegment;}
 if(role==='repair'){const frozen=await readJSON(dataPath('check-context',runId));context.selectedSegment=frozen.demandContext?.selectedSegment||context.selectedSegment;}
 const view=writerResearchView(snapshot);
 if(role==='writer'&&process.env.EXPECTED_RESEARCH_INTENT_SHA&&process.env.EXPECTED_RESEARCH_RESULT_SHA){
  const intent=await readJSON(dataPath('research-intents',runId)),result=await readJSON(dataPath('research-results',runId));
  await verifyContinuationIntent(ROOT,intent,{runId,expectedSha256:process.env.EXPECTED_RESEARCH_INTENT_SHA});
  if(sha256(stableJSON(result))!==process.env.EXPECTED_RESEARCH_RESULT_SHA||continuationResultReasons(result,intent,{sealed:true}).length)throw new Error('Writer continuation receipt failed its trusted pre-model binding.');
  if(result.outcome==='completed'&&view.sources.some(source=>source.id===intent.dossier.source.id))context.researchContinuation={version:1,productUrl:intent.dossier.source.url,sourceId:intent.dossier.source.id,priorPlan:intent.dossier.candidate.experimentPlan,previousCheckedPlans:await previousContinuationPlans(ROOT,intent),unresolved:intent.dossier.unresolved,evidenceTasks:candidateEvidenceTasks({candidate:intent.dossier.candidate,source:view.sources.find(source=>source.id===intent.dossier.source.id),capabilitySources:view.sources.filter(source=>source.role==='building')}),intentSha256:sha256(stableJSON(intent)),resultSha256:sha256(stableJSON(result)),notice:'Prior proposed design and pending evidence tasks only. Use the current independently verifiable sources. Pending tasks are not performed tests, facts, scores or approval.'};
 }
 if(context.discussionFirst){
  const selection=await readJSON(dataPath('learning-selection',runId));
  const researchSha256=process.env.EXPECTED_RESEARCH_SHA||sha256(stableJSON(snapshot)),selectionSha256=process.env.EXPECTED_LEARNING_SELECTION_SHA||sha256(stableJSON(selection));
  const identityFailures=sealedDiscussionAssignmentReasons({research:snapshot,selection,runId,expectedResearchSha256:researchSha256,expectedSelectionSha256:selectionSha256});
  if(identityFailures.length)throw new Error(identityFailures.join(' '));
  const ledgerPath='.run/writer-assignments.json';
  await writeFile(ledgerPath,JSON.stringify({schema:1,runId,researchSha256,selectionSha256,assignments:context.discussionBatch.leadAssignments},null,2));
  context.writerCoverage={researchSha256,selectionSha256,assignmentCount:context.discussionBatch.leadAssignments.length,ledgerPath,command:`node scripts/check-writer-coverage.mjs ${runId}`};
  const references=view.sources.filter(hasDiscussionImplementationReference),demands=view.sources.filter(source=>source.role==='demand');
  if(references.length>2||references.some(source=>!discussionImplementationReference(source,{demandSources:demands})))throw new Error('Writer implementation-reference inventory lacks its fixed task-bound authority.');
  context.discussionImplementationReferences=context.discussionBatch.leadAssignments.map(assignment=>({productUrl:assignment.productUrl,demandSourceId:assignment.demandSourceId,availableSourceIds:references.filter(source=>source.supportsDemandSourceIds.includes(assignment.demandSourceId)).map(source=>source.id)}));
 }
 await writeFile(context.researchPath,JSON.stringify(view,null,2));
}
const previous=await records('posts');
await writeFile(context.demandPolicyPath,JSON.stringify({version:1,segments:SEGMENTS,kinds:DEMAND_KINDS,mixPolicy:DEMAND_MIX_POLICY,eligibleSegments:eligibleSegments(previous),selectedSegment:context.selectedSegment||null,posts:previous.map(post=>({id:post.id,publishedAt:post.publishedAt,...classifyPublishedSegment(post)}))},null,2));
await writeFile(context.priorPostsPath,JSON.stringify(previous.map(({id,candidateId,title,productUrl,promise,whatItIs,whoPays,loop,publishedAt})=>({id,candidateId,title,productUrl,promise,whatItIs,whoPays,loop,publishedAt})),null,2));
context.recentPostsPath='.run/recent-posts.json';
let noveltyContext=createNoveltyContext(previous);
if(['checker','final-checker'].includes(role)){
 const frozen=await readJSON(dataPath('check-context',runId)),draft=await readJSON(dataPath('drafts',runId));
 context.checkContextSha256=sha256(stableJSON(frozen));context.rulesSha256=frozen.rulesSha256;context.assessmentContractVersion=frozen.assessmentContractVersion||null;
 noveltyContext=frozen.noveltyContext||noveltyContext;context.noveltyContractVersion=frozen.noveltyContractVersion||null;
 context.demandContractVersion=frozen.demandContractVersion||null;context.demandContextSha256=frozen.demandContextSha256||null;
 const planFailures=candidatePlanVersionReasons(frozen.candidatePlanVersion);if(planFailures.length)throw new Error(planFailures.join(' '));
 if(frozen.candidatePlanVersion!==undefined)context.candidatePlanVersion=frozen.candidatePlanVersion;
 const scoringFailures=candidateScoringVersionReasons(frozen.candidateScoringVersion);if(scoringFailures.length)throw new Error(scoringFailures.join(' '));
 if(frozen.candidateScoringVersion!==undefined)context.candidateScoringVersion=frozen.candidateScoringVersion;
 const assessmentView=checkerAssessmentView(draft,frozen,{role});
 context.checkerAssessment={path:'.run/checker-assessment.json',sha256:sha256(stableJSON(assessmentView)),counts:assessmentView.counts,command:`node scripts/inspect-check-assessment.mjs ${runId}`};
 // The advertised fingerprint must also be the hash of the exact file bytes.
 // Keep the reading aid canonical so sha256sum and the inspector agree.
 await writeFile(context.checkerAssessment.path,stableJSON(assessmentView));
 context.checkerOutputSchemaPath='.run/checker-output-schema.json';context.checkerResponsePath='.run/checker-response.json';
 const checkerSchema=checkerOutputSchema(draft,frozen,{allowOmittedCandidateRepair:role==='checker'&&process.env.CHECKER_PHASE==='initial'});
 context.omittedCandidateRepairAllowed=Boolean(checkerSchema.properties.repairFeedback);
 await rm(dataPath('checks',runId),{force:true});await rm(context.checkerResponsePath,{force:true});
 await writeFile(context.checkerOutputSchemaPath,JSON.stringify(checkerSchema,null,2));
 const stamp={schema:1,completed:false,decision:draft.posts.length?'assessed':'no_supported_candidate',reason:'Independent checker must supply its own verdict and reason.',contextSha256:context.checkContextSha256,rulesSha256:frozen.rulesSha256,draftSha256:frozen.draftSha256,sourceSnapshotSha256:frozen.sourceSnapshotSha256,policySha256:frozen.scoringPolicy.policySha256};
 context.checkerTemplatePath='.run/checker-template.json';
 await writeFile(context.checkerTemplatePath,JSON.stringify({runId,draftSha256:frozen.draftSha256,sourceSnapshotSha256:frozen.sourceSnapshotSha256,policySha256:frozen.scoringPolicy.policySha256,checks:[],...(frozen.assessmentContractVersion===1?{completedAssessment:stamp}: {})},null,2));
}
context.noveltyWindowDays=noveltyContext.windowDays;
await writeFile(context.recentPostsPath,JSON.stringify(noveltyContext,null,2));
await writeFile('.run/context.json',JSON.stringify(context,null,2));
console.log(`Prepared ${role} for ${runId}, target ${targetCount}.`);
