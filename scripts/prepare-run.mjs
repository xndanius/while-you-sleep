import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {readJSON,dataPath,sha256,stableJSON,records} from '../lib/storage.mjs';
import {validateLoopScheduling} from '../lib/loop-schedule.mjs';
import {checkerOutputSchema} from '../lib/checker-output.mjs';
const runId=process.env.RUN_ID||`loop-${Date.now()}`;
if(!/^[a-zA-Z0-9_-]+$/.test(runId))throw new Error('Invalid run ID');
let scheduling;
if(process.env.LOOP_SCHEDULING_SHA)scheduling=validateLoopScheduling(await readJSON(dataPath('scheduling',runId)),{runId,expectedSha256:process.env.LOOP_SCHEDULING_SHA,eventName:process.env.GITHUB_EVENT_NAME});
if(scheduling&&scheduling.decision!=='run')throw new Error('This loop was not reserved for model execution.');
const targetCount=scheduling?.targetCount||(process.env.BOOTSTRAP==='true'?3:1);
const role=process.argv[2]||'writer';
const context={runId,targetCount,maxBatchSize:scheduling?.maxBatchSize||3,rulesSha256:sha256(await readFile('RULES.md','utf8')),role,researchPath:`data/research/${runId}.json`,draftPath:`data/drafts/${runId}.json`,checkContextPath:`data/check-context/${runId}.json`,checkPath:`data/checks/${runId}.json`,priorPostsPath:'.run/prior-posts.json',githubRunUrl:process.env.GITHUB_REPOSITORY?`https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`:null};
if(scheduling){context.scheduling={slotId:scheduling.slotId,scheduledAt:scheduling.scheduledAt,eventName:scheduling.eventName,targetCount,slots:scheduling.slots||[],dailyCap:scheduling.dailyCap,maxBatchSize:scheduling.maxBatchSize||3,cadence:scheduling.cadence};context.assessmentContractVersion=scheduling.assessmentContractVersion||null;}
if(role==='repair')context.repairFeedbackPath='.run/repair-feedback.json';
await mkdir('.run',{recursive:true});await mkdir('data/drafts',{recursive:true});await mkdir('data/checks',{recursive:true});
const previous=await records('posts');
await writeFile(context.priorPostsPath,JSON.stringify(previous.map(({id,candidateId,title,productUrl,promise,whatItIs,loop})=>({id,candidateId,title,productUrl,promise,whatItIs,loop})),null,2));
if(['checker','final-checker'].includes(role)){
 const frozen=await readJSON(dataPath('check-context',runId)),draft=await readJSON(dataPath('drafts',runId));
 context.checkContextSha256=sha256(stableJSON(frozen));context.rulesSha256=frozen.rulesSha256;context.assessmentContractVersion=frozen.assessmentContractVersion||null;
 context.checkerOutputSchemaPath='.run/checker-output-schema.json';context.checkerResponsePath='.run/checker-response.json';
 await rm(dataPath('checks',runId),{force:true});await rm(context.checkerResponsePath,{force:true});
 await writeFile(context.checkerOutputSchemaPath,JSON.stringify(checkerOutputSchema(draft,frozen),null,2));
 const stamp={schema:1,completed:false,decision:draft.posts.length?'assessed':'no_supported_candidate',reason:'Independent checker must supply its own verdict and reason.',contextSha256:context.checkContextSha256,rulesSha256:frozen.rulesSha256,draftSha256:frozen.draftSha256,sourceSnapshotSha256:frozen.sourceSnapshotSha256,policySha256:frozen.scoringPolicy.policySha256};
 context.checkerTemplatePath='.run/checker-template.json';
 await writeFile(context.checkerTemplatePath,JSON.stringify({runId,draftSha256:frozen.draftSha256,sourceSnapshotSha256:frozen.sourceSnapshotSha256,policySha256:frozen.scoringPolicy.policySha256,checks:[],...(frozen.assessmentContractVersion===1?{completedAssessment:stamp}: {})},null,2));
}
await writeFile('.run/context.json',JSON.stringify(context,null,2));
console.log(`Prepared ${role} for ${runId}, target ${targetCount}.`);
