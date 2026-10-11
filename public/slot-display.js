// Build records contain receipts; the browser clock only ages an unfilled slot.
// A run attempt never becomes a publication time.
import {publicationSlots,localParts} from './schedule.js';
const validTime=value=>value&&Number.isFinite(new Date(value).getTime());
const covers=(run,id)=>{
  const scheduling=run.scheduling||{};
  return (Array.isArray(scheduling.slotIds)?scheduling.slotIds:[scheduling.slotId]).includes(id);
};

export function slotPresentation(slot,now=new Date()){
  const plannedAt=slot.plannedAt||slot.scheduledAt;
  const planned=new Date(plannedAt).getTime(),clock=new Date(now).getTime();
  const actual=new Date(slot.actualAt||'').getTime();
  let state=slot.status||slot.state||'scheduled';
  let reason=slot.reason;
  if(Number.isFinite(actual)){state='published';reason='A checked post is committed for this slot.';}
  else if(['scheduled','due','waiting','late','missed'].includes(state)&&Number.isFinite(planned)&&Number.isFinite(clock)){
    state=clock<planned?'scheduled':clock-planned>=60*60*1000?'missed':clock-planned>=30*60*1000?'late':'waiting';
    reason=state==='scheduled'?'The planned publication time is still ahead.':'No checked publication has been committed for this elapsed slot.';
  }
  const delayMinutes=Number.isFinite(planned)&&Number.isFinite(actual)?Math.max(0,Math.floor((actual-planned)/60000)):null;
  return {...slot,plannedAt,state,status:state,reason,delayMinutes};
}

// A cheap gate can skip without a commit, so build-time rows may belong to an
// older day. Cadence comes from the current clock; receipts retain their exact
// slot IDs and publication timestamps. This does not upgrade scheduler proof.
export function currentDaySlots(data={},now=new Date()){
  const clock=new Date(now),today=localParts(clock).day,slots=publicationSlots(clock);
  const known=new Map([...(data.schedule?.previousSlots||[]),...(data.schedule?.slots||[])].map(slot=>[slot.id,slot]));
  const posts=(data.posts||[]).filter(post=>validTime(post.publishedAt));
  const assigned=new Map();
  for(const slot of slots){
    const post=posts.filter(post=>post.scheduling?.slotId===slot.id).sort((a,b)=>new Date(a.publishedAt)-new Date(b.publishedAt))[0];
    if(post)assigned.set(slot.id,post);
  }
  const legacy=posts.filter(post=>!post.scheduling&&localParts(post.publishedAt).day===today).sort((a,b)=>new Date(a.publishedAt)-new Date(b.publishedAt));
  for(const post of legacy){
    const slot=slots.find(slot=>!assigned.has(slot.id)&&new Date(slot.scheduledAt)<=new Date(post.publishedAt));
    if(slot)assigned.set(slot.id,post);
  }
  const atCap=posts.filter(post=>localParts(post.publishedAt).day===today).length>=3;
  return slots.map(slot=>{
    const receipt=known.get(slot.id)||{},post=assigned.get(slot.id);
    const attempt=(data.runs||[]).filter(run=>run.type==='loop'&&covers(run,slot.id)&&validTime(run.scheduling?.requestedAt||run.startedAt)).sort((a,b)=>new Date(b.scheduling?.requestedAt||b.startedAt)-new Date(a.scheduling?.requestedAt||a.startedAt))[0];
    const actualAt=post?.publishedAt||receipt.actualAt||null;
    const attemptedAt=attempt?.scheduling?.requestedAt||attempt?.startedAt||receipt.attemptedAt||null;
    let state='scheduled',reason;
    if(!actualAt&&clock>=new Date(slot.scheduledAt)){
      if(atCap){state='cap_reached';reason='The three-post cap is already reached for this Vilnius day.';}
      else if(receipt.state==='running'||receipt.status==='running'||attempt&&!validTime(attempt.finishedAt)&&attempt.status==='running'){
        state='running';reason='A trusted reservation is held; publication is not complete.';
      }
      else if(attempt?.modelExecuted!==false&&attempt&&['rejected','failed_closed','completed_with_failure','completed_with_rejections'].includes(attempt.status)){
        state='rejected';reason=attempt.rejected?.[0]?.reason||'The attempt did not publish this slot; a bounded retry is due.';
      }
      else if(['rejected','cap_reached'].includes(receipt.state||receipt.status)){
        state=receipt.state||receipt.status;reason=receipt.reason;
      }
    }
    const clockOrigin=post?(post.clock||post.scheduling?.clock||null):(attempt?.clock||attempt?.scheduling?.clock||receipt.clock||null);
    return slotPresentation({...receipt,...slot,plannedAt:slot.scheduledAt,state,status:state,reason,actualAt,attemptedAt,postId:post?.id||receipt.postId||null,runId:post?.runId||attempt?.id||receipt.runId||null,eventName:post?.eventName||post?.scheduling?.eventName||attempt?.eventName||receipt.eventName||null,githubRunUrl:post?.githubRunUrl||attempt?.githubRunUrl||receipt.githubRunUrl||null,clock:clockOrigin},clock);
  });
}
