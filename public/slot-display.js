// Build records contain receipts; the browser clock only ages an unfilled slot.
// A run attempt never becomes a publication time.
export function slotPresentation(slot,now=new Date()){
  const plannedAt=slot.plannedAt||slot.scheduledAt;
  const planned=new Date(plannedAt).getTime(),clock=new Date(now).getTime();
  const actual=new Date(slot.actualAt||'').getTime();
  let state=slot.status||slot.state||'scheduled';
  if(Number.isFinite(actual))state='published';
  else if(['scheduled','due','waiting','late','missed'].includes(state)&&Number.isFinite(planned)&&Number.isFinite(clock)){
    state=clock<planned?'scheduled':clock-planned>=60*60*1000?'missed':clock-planned>=30*60*1000?'late':'waiting';
  }
  const delayMinutes=Number.isFinite(planned)&&Number.isFinite(actual)?Math.max(0,Math.floor((actual-planned)/60000)):null;
  return {...slot,plannedAt,state,delayMinutes};
}
