import { readJSON,dataPath } from '../lib/storage.mjs';
import {checkApproval} from '../lib/validation.mjs';
import {appendFile} from 'node:fs/promises';
const runId=process.argv[2];
const draft=await readJSON(dataPath('drafts',runId));const context=await readJSON(dataPath('check-context',runId));const manifest=await readJSON(dataPath('checks',runId));
const results=checkApproval(draft,context,manifest);
const count=results.filter(x=>x.pass).length;const target=Number.isInteger(draft.targetCount)&&draft.targetCount>=1&&draft.targetCount<=3?draft.targetCount:1;const repair=count<target;
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`repair=${repair}\npassed=${count}\n`);
console.log(JSON.stringify({runId,passed:count,target,repair,rejected:results.filter(x=>!x.pass).map(({postId,reasons})=>({postId,reasons}))}));
