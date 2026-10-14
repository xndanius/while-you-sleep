import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {readJSON,dataPath,sha256,stableJSON,records} from '../lib/storage.mjs';
import {validateLoopScheduling} from '../lib/loop-schedule.mjs';
import {candidateHistory,writerResearchView,writerReadiness} from '../lib/candidate-input.mjs';
import {ROOT} from '../lib/storage.mjs';
import {parseScoringPolicy} from '../lib/scoring.mjs';
import {checkerOutputSchema} from '../lib/checker-output.mjs';
import {createNoveltyContext} from '../lib/novelty.mjs';
import {SEGMENTS,DEMAND_KINDS,DEMAND_MIX_POLICY,eligibleSegments,classifyPublishedSegment} from '../lib/demand.mjs';
const runId=process.env.RUN_ID||`loop-${Date.now()}`;
if(!/^[a-zA-Z0-9_-]+$/.test(runId))throw new Error('Invalid run ID');
let scheduling;
if(process.env.LOOP_SCHEDULING_SHA)scheduling=validateLoopScheduling(await readJSON(dataPath('scheduling',runId)),{runId,expectedSha256:process.env.LOOP_SCHEDULING_SHA,eventName:process.env.GITHUB_EVENT_NAME});
if(scheduling&&scheduling.decision!=='run')throw new Error('This loop was not reserved for model execution.');
const targetCount=scheduling?.targetCount||(process.env.BOOTSTRAP==='true'?3:1);
const role=process.argv[2]||'writer';
const context={runId,targetCount,maxBatchSize:scheduling?.maxBatchSize||3,rulesSha256:sha256(await readFile('RULES.md','utf8')),role,researchPath:`data/research/${runId}.json`,draftPath:`data/drafts/${runId}.json`,checkContextPath:`data/check-context/${runId}.json`,checkPath:`data/checks/${runId}.json`,priorPostsPath:'.run/prior-posts.json',githubRunUrl:process.env.GITHUB_REPOSITORY?`https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`:null};
if(scheduling){context.scheduling={slotId:scheduling.slotId,scheduledAt:scheduling.scheduledAt,eventName:scheduling.eventName,targetCount,slots:scheduling.slots||[],dailyCap:scheduling.dailyCap,maxBatchSize:scheduling.maxBatchSize||3,cadence:scheduling.cadence};context.assessmentContractVersion=scheduling.assessmentContractVersion||null;}
context.scoringPolicy=parseScoringPolicy(await readFile('RULES.md','utf8'));
context.demandContractVersion=process.env.DEMAND_CONTRACT_VERSION==='1'?1:null;context.demandPolicyPath='.run/demand-policy.json';
if(role==='repair')context.repairFeedbackPath='.run/repair-feedback.json';
await mkdir('.run',{recursive:true});await mkdir('data/drafts',{recursive:true});await mkdir('data/checks',{recursive:true});
if(['writer','repair'].includes(role)){
 const history=await candidateHistory(ROOT);context.recentRejectionsPath='.run/recent-rejections.json';
 await writeFile(context.recentRejectionsPath,JSON.stringify(history.rejections,null,2));
 const snapshot=await readJSON(dataPath('research',runId));const readiness=writerReadiness(snapshot,{demandRequired:context.demandContractVersion===1});if(!readiness.ready)throw new Error(readiness.reason);context.originalResearchPath=context.researchPath;context.researchPath='.run/writer-research.json';
 context.selectedSegment=snapshot.learningSelection?.selectedSegment||null;
 if(context.demandContractVersion===1){const selection=await readJSON(dataPath('learning-selection',runId));if(selection.runId!==runId)throw new Error('Demand-first writer has no matching trusted learning selection.');context.selectedSegment=selection.selectedSegment;}
 if(role==='repair'){const frozen=await readJSON(dataPath('check-context',runId));context.selectedSegment=frozen.demandContext?.selectedSegment||context.selectedSegment;}
 await writeFile(context.researchPath,JSON.stringify(writerResearchView(snapshot),null,2));
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
 context.checkerOutputSchemaPath='.run/checker-output-schema.json';context.checkerResponsePath='.run/checker-response.json';
 await rm(dataPath('checks',runId),{force:true});await rm(context.checkerResponsePath,{force:true});
 await writeFile(context.checkerOutputSchemaPath,JSON.stringify(checkerOutputSchema(draft,frozen),null,2));
 const stamp={schema:1,completed:false,decision:draft.posts.length?'assessed':'no_supported_candidate',reason:'Independent checker must supply its own verdict and reason.',contextSha256:context.checkContextSha256,rulesSha256:frozen.rulesSha256,draftSha256:frozen.draftSha256,sourceSnapshotSha256:frozen.sourceSnapshotSha256,policySha256:frozen.scoringPolicy.policySha256};
 context.checkerTemplatePath='.run/checker-template.json';
 await writeFile(context.checkerTemplatePath,JSON.stringify({runId,draftSha256:frozen.draftSha256,sourceSnapshotSha256:frozen.sourceSnapshotSha256,policySha256:frozen.scoringPolicy.policySha256,checks:[],...(frozen.assessmentContractVersion===1?{completedAssessment:stamp}: {})},null,2));
}
context.noveltyWindowDays=noveltyContext.windowDays;
await writeFile(context.recentPostsPath,JSON.stringify(noveltyContext,null,2));
await writeFile('.run/context.json',JSON.stringify(context,null,2));
console.log(`Prepared ${role} for ${runId}, target ${targetCount}.`);
