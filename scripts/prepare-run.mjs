import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {readJSON,dataPath,sha256,stableJSON} from '../lib/storage.mjs';
import {validateLoopScheduling} from '../lib/loop-schedule.mjs';
const runId=process.env.RUN_ID||`loop-${Date.now()}`;
if(!/^[a-zA-Z0-9_-]+$/.test(runId))throw new Error('Invalid run ID');
let scheduling;
if(process.env.LOOP_SCHEDULING_SHA)scheduling=validateLoopScheduling(await readJSON(dataPath('scheduling',runId)),{runId,expectedSha256:process.env.LOOP_SCHEDULING_SHA,eventName:process.env.GITHUB_EVENT_NAME});
if(scheduling&&scheduling.decision!=='run')throw new Error('This loop was not reserved for model execution.');
const targetCount=scheduling?.targetCount||(process.env.BOOTSTRAP==='true'?3:1);
const role=process.argv[2]||'writer';
const context={runId,targetCount,maxBatchSize:scheduling?.maxBatchSize||3,rulesSha256:sha256(await readFile('RULES.md','utf8')),role,researchPath:`data/research/${runId}.json`,draftPath:`data/drafts/${runId}.json`,checkContextPath:`data/check-context/${runId}.json`,checkPath:`data/checks/${runId}.json`,githubRunUrl:process.env.GITHUB_REPOSITORY?`https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`:null};
if(scheduling){context.scheduling={slotId:scheduling.slotId,scheduledAt:scheduling.scheduledAt,eventName:scheduling.eventName,targetCount,slots:scheduling.slots||[],dailyCap:scheduling.dailyCap,maxBatchSize:scheduling.maxBatchSize||3,cadence:scheduling.cadence};context.assessmentContractVersion=scheduling.assessmentContractVersion||null;}
if(['checker','final-checker'].includes(role)){const frozen=await readJSON(dataPath('check-context',runId));context.checkContextSha256=sha256(stableJSON(frozen));context.rulesSha256=frozen.rulesSha256;context.assessmentContractVersion=frozen.assessmentContractVersion||null;}
if(role==='repair')context.repairFeedbackPath='.run/repair-feedback.json';
await mkdir('.run',{recursive:true});await mkdir('data/drafts',{recursive:true});await mkdir('data/checks',{recursive:true});
await writeFile('.run/context.json',JSON.stringify(context,null,2));
console.log(`Prepared ${role} for ${runId}, target ${targetCount}.`);
