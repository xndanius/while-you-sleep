const repository='xndanius/while-you-sleep';
const apiRoot=`https://api.github.com/repos/${repository}`;
const numeric=value=>typeof value==='string'&&/^[1-9]\d{0,15}$/.test(value)&&Number.isSafeInteger(Number(value));
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
const runURL=id=>`https://github.com/${repository}/actions/runs/${id}`;
const workflows=new Set(['clock.yml','loop.yml','research.yml','measure.yml','improve.yml','curate.yml']);
export const CLOCK_RUNTIME_URL=`${apiRoot}/deployments?environment=clock-runtime&per_page=1`;
export const CLOCK_RUNTIME_REFRESH_MS=180000;

// Public metadata supplies timing only. Publication proof still comes from
// committed posts and their independent checker and clock receipts.
export function publicClockRuntime(deployment,now=new Date()){
  if(!deployment||!Number.isSafeInteger(deployment.id)||deployment.id<1||deployment.environment!=='clock-runtime'||deployment.ref!=='main'||deployment.task!=='clock:state'||deployment.repository_url!==apiRoot||deployment.creator?.login!=='github-actions[bot]'||deployment.transient_environment!==true||deployment.production_environment!==false)return null;
  const payload=deployment.payload,state=payload?.state,producer=payload?.producer;
  if(payload?.schema!==1||payload.kind!=='clock-runtime'||payload.repository!==repository||!['claim','tick','fence','restart'].includes(payload.transition))return null;
  const recorded=date(payload.recordedAt),created=date(deployment.created_at),time=new Date(now).getTime();
  if(!recorded||!created||Date.parse(recorded)>time+60000||Date.parse(recorded)>Date.parse(created)+60000||Date.parse(created)-Date.parse(recorded)>300000)return null;
  if(!numeric(producer?.runId)||!Number.isInteger(producer.runAttempt)||producer.runAttempt<1||!workflows.has(producer.workflow)||!['workflow_dispatch','schedule'].includes(producer.eventName))return null;
  if(!state||!numeric(state.expectedRunId)||!Number.isInteger(state.expectedRunAttempt)||state.expectedRunAttempt<1||state.waitMinutes!==15||!/^clock-(?:restart-)?\d+-\d+$/.test(state.chainId)||!Number.isInteger(state.generation)||state.generation<0||!['waiting','ticking','queued','fenced'].includes(state.phase)||state.clockRunUrl!==runURL(state.expectedRunId))return null;
  const claimed=date(state.claimedAt),next=date(state.nextTickAt),last=date(state.lastTickAt);
  if(!claimed||!next||Date.parse(claimed)>Date.parse(recorded)+60000||(state.lastTickAt&&!last)||(last&&Date.parse(last)>Date.parse(recorded)+60000)||(state.parentRunId&&!numeric(state.parentRunId)))return null;
  const receipt=last?payload.receipt:null;
  if(receipt){
    const start=date(receipt.claimedAt),end=date(receipt.tickedAt);
    if(receipt.kind!=='clock-tick'||!numeric(receipt.githubRunId)||!Number.isInteger(receipt.githubRunAttempt)||receipt.githubRunAttempt<1||receipt.id!==`clock-${receipt.githubRunId}-${receipt.githubRunAttempt}`||receipt.githubRunUrl!==runURL(receipt.githubRunId)||receipt.chainId!==state.chainId||receipt.environment!=='clock'||receipt.waitMinutes!==15||!start||!end||end!==last||Date.parse(end)-Date.parse(start)<900000||!Array.isArray(receipt.dispatches))return null;
  }
  const dispatches=(receipt?.dispatches||[]).filter(item=>workflows.has(item.workflow)&&item.workflow!=='clock.yml'&&numeric(item.runId)&&item.githubRunUrl===runURL(item.runId)&&date(item.requestedAt)).map(item=>({workflow:item.workflow,githubRunUrl:item.githubRunUrl,requestedAt:item.requestedAt}));
  return {phase:state.phase,lastTickAt:last,nextTickAt:next,claimedAt:claimed,fencedAt:date(state.fencedAt),clockRunUrl:state.clockRunUrl,lastTickRunUrl:receipt?.githubRunUrl||(last&&state.parentRunId?runURL(state.parentRunId):null),waitMinutes:15,dispatches,runtimeUpdatedAt:recorded,runtimeSource:'github-deployment-metadata',runtimeURL:`${apiRoot}/deployments/${deployment.id}`};
}

export function newerClockRecord(committed={},runtime=null){
  if(!runtime)return committed;
  const committedAt=Math.max(0,...[committed.runtimeUpdatedAt,committed.fencedAt,committed.claimedAt,committed.lastTickAt].filter(date).map(Date.parse));
  return Date.parse(runtime.runtimeUpdatedAt)>=committedAt?runtime:committed;
}
