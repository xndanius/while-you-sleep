const validDate=value=>value&&Number.isFinite(new Date(value).getTime())?new Date(value):null;
export function clockTiming(clock={},now=new Date()){
  const time=new Date(now).getTime(),last=validDate(clock.lastTickAt),next=validDate(clock.nextTickAt),claimed=validDate(clock.claimedAt);
  const reference=last||claimed;
  const elapsedMinutes=reference?Math.max(0,(time-reference.getTime())/60000):null;
  const lateMinutes=next?Math.max(0,Math.floor((time-next.getTime())/60000)):null;
  if(!reference)return {state:'not_started',label:'No clock tick recorded',elapsedMinutes:null,lateMinutes};
  if(reference.getTime()>time+60000)return {state:'unverified',label:'Clock timestamp is ahead of this device',elapsedMinutes:null,lateMinutes};
  if(elapsedMinutes>45)return {state:'stalled',label:'Clock stalled · no tick for over 45 minutes',elapsedMinutes,lateMinutes};
  if(next&&next.getTime()<time)return {state:'late',label:'Clock late · next tick not yet recorded',elapsedMinutes,lateMinutes};
  if(clock.phase==='fenced')return {state:'recovering',label:'Clock recovery recorded · awaiting a new claim',elapsedMinutes,lateMinutes};
  if(clock.phase==='queued')return {state:'waiting',label:'Next clock wait queued',elapsedMinutes,lateMinutes};
  if(clock.phase==='ticking')return {state:'ticking',label:'Tick recorded · next wait is being prepared',elapsedMinutes,lateMinutes};
  return {state:'waiting',label:last?'Clock waiting for the next tick':'First clock tick waiting',elapsedMinutes,lateMinutes};
}

// This label consumes deterministic verifier output. An input marker cannot
// upgrade workflow_dispatch to clock origin or to GitHub's schedule event.
export function runTriggerLabel(run){
  const event=run.eventName||run.scheduling?.eventName||run.scheduling?.event;
  const clock=run.clock||run.scheduling?.clock;
  const identity=run.runId||run.id||run.scheduling?.runId||run.scheduling?.id;
  const match=/^(loop|research|measure|improve)-(\d+)-(\d+)$/.exec(identity||'');
  if(match&&Number(match[3])>1)return `Manual rerun · original ${event||'trigger'}`;
  const fields=clock?[clock.runAttempt,clock.actor,clock.triggeringActor]:[];
  const actorsValid=fields.every(value=>value===undefined)||(fields[0]===1&&fields[1]==='github-actions[bot]'&&fields[2]==='github-actions[bot]');
  const url=run.githubRunUrl||run.scheduling?.githubRunUrl;
  if(event==='workflow_dispatch'&&clock?.verified===true&&clock?.source==='github-environment-clock'&&actorsValid&&match&&match[3]==='1'&&identity===`${clock.workflow?.replace(/\.yml$/,'')}-${clock.runId}-1`&&url===`https://github.com/xndanius/while-you-sleep/actions/runs/${clock.runId}`)return 'Hosted clock dispatch · workflow_dispatch';
  return event==='schedule'?'GitHub cron · schedule':event==='workflow_dispatch'?'Manual dispatch · workflow_dispatch':'Trigger not recorded';
}
