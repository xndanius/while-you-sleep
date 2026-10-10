import {promises as fs} from 'node:fs';
import path from 'node:path';

const date = value => typeof value==='string' && Number.isFinite(Date.parse(value)) ? value : null;
const runURL = value => typeof value==='string' && /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/.test(value) ? value : null;
const event = record => record.eventName || record.scheduling?.eventName || record.scheduling?.event;
const at = record => date(record.startedAt || record.createdAt || record.publishedAt);
const newest = rows => rows.slice().sort((a,b)=>(at(b)||'').localeCompare(at(a)||''))[0];

// Artifact imports permit only loop-*.json on model runs. Trust the actual
// standalone filename, never an id field that a loop writer could rename.
export async function standaloneResearchRecords(directory) {
  let files;try{files=await fs.readdir(directory);}catch(error){if(error.code==='ENOENT')return [];throw error;}
  const records=await Promise.all(files.filter(file=>/^research-\d+-\d+\.json$/.test(file)).map(async file=>{
    const record=JSON.parse(await fs.readFile(path.join(directory,file),'utf8')),id=file.slice(0,-5);
    return record.id===id&&record.runId===id?record:null;
  }));
  return records.filter(Boolean);
}

// A hosted URL or configured cron is not evidence that GitHub emitted schedule.
export function schedulerProof(scheduler = [], runs = [], posts = []) {
  const diagnosis=newest(scheduler.filter(record=>record.kind==='diagnosis').map(record=>({...record,createdAt:record.checkedAt}))) || {};
  const observations=[...scheduler,...runs].filter(record=>event(record)==='schedule' && at(record) && runURL(record.githubRunUrl));
  const scheduledLoops=runs.filter(record=>record.type==='loop' && record.modelExecuted!==false && event(record)==='schedule' && at(record) && runURL(record.githubRunUrl));
  const latest=newest(observations),loop=newest(scheduledLoops);
  const scheduledPosts=posts.filter(post=>scheduledLoops.some(run=>run.published?.includes(post.id)&&run.id===post.runId&&run.githubRunUrl===post.githubRunUrl));
  const publication=newest(scheduledPosts.filter(post=>date(post.publishedAt)&&runURL(post.githubRunUrl)));
  const observedCount=new Set(observations.map(record=>record.githubRunUrl)).size;
  const diagnosedCount=Number.isSafeInteger(diagnosis.scheduledRunCount)&&diagnosis.scheduledRunCount>=0?diagnosis.scheduledRunCount:null;
  return {
    state:publication?'publication_observed':loop?'loop_observed':latest?'trigger_observed':'unverified',
    checkedAt:date(diagnosis.checkedAt),scheduledRunCount:diagnosedCount===null?observedCount:Math.max(observedCount,diagnosedCount),
    lastScheduledAt:latest?at(latest):null,lastScheduledRunUrl:runURL(latest?.githubRunUrl),
    lastScheduledLoopAt:loop?at(loop):null,lastScheduledLoopRunUrl:runURL(loop?.githubRunUrl),
    lastScheduledPublicationAt:date(publication?.publishedAt),lastScheduledPostId:publication?.id||null,
    lastScheduledPublicationRunUrl:runURL(publication?.githubRunUrl),
    actionsEnabled:typeof diagnosis.actionsEnabled==='boolean'?diagnosis.actionsEnabled:null,
    workflowStates:Array.isArray(diagnosis.workflowStates)?diagnosis.workflowStates.map(record=>({name:record.name,path:record.path,state:record.state})):[],
    probe:diagnosis.probe?{cron:diagnosis.probe.cron,expiresAt:date(diagnosis.probe.expiresAt)}:null,
  };
}
