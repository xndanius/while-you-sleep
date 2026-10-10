const date = value => typeof value==='string' && Number.isFinite(Date.parse(value)) ? value : null;
const runURL = value => typeof value==='string' && /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/.test(value) ? value : null;
const event = record => record.triggerEvent || record.eventName || record.scheduling?.event || record.scheduling?.eventName;
const at = record => date(record.startedAt || record.createdAt || record.publishedAt);
const newest = rows => rows.slice().sort((a,b)=>(at(b)||'').localeCompare(at(a)||''))[0];

// A hosted URL or configured cron is not evidence that GitHub emitted schedule.
export function schedulerProof(scheduler = [], runs = [], posts = []) {
  const diagnosis=newest(scheduler.filter(record=>record.kind==='diagnosis').map(record=>({...record,createdAt:record.checkedAt}))) || {};
  const observations=[...scheduler,...runs,...posts].filter(record=>event(record)==='schedule' && at(record) && runURL(record.githubRunUrl));
  const latest=newest(observations),loop=newest(runs.filter(record=>record.type==='loop' && event(record)==='schedule' && at(record) && runURL(record.githubRunUrl)));
  const scheduledPosts=posts.filter(post=>event(post)==='schedule' || runs.some(run=>run.type==='loop'&&event(run)==='schedule'&&run.published?.includes(post.id)&&run.id===post.runId));
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
