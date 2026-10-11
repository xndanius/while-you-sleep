import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, validId, sha256, stableJSON, writeJSON } from '../lib/storage.mjs';
import { loopDecision, slotOutcome, reservationSlotIds } from '../lib/loop-schedule.mjs';
import { githubApiGet } from '../lib/usage.mjs';
import { verifyClockDispatch } from '../lib/clock-provenance.mjs';

async function records(root,directory) {
  const dir=path.join(root,'data',directory);let names;
  try{names=await fs.readdir(dir);}catch(error){if(error.code==='ENOENT')return[];throw error;}
  return Promise.all(names.filter(name=>name.endsWith('.json')).map(async name=>JSON.parse(await fs.readFile(path.join(dir,name),'utf8'))));
}

// A missing settlement is never treated as an expired lock on time alone.
// Only GitHub's terminal source run plus the committed public-post state permits
// recovery. API failures leave the reservation held without another model call.
export async function prepareLoop({ root=ROOT,env=process.env,now=new Date(),apiGet=githubApiGet }={}) {
  const runId=env.RUN_ID;if(!validId(runId))throw new Error('Invalid loop run ID.');
  const clock=await verifyClockDispatch({kind:'loop',root,env,apiGet,now});
  const [posts,reservations,outcomes]=await Promise.all(['posts','slot-reservations','slot-outcomes'].map(dir=>records(root,dir)));
  const input={runId,eventName:env.GITHUB_EVENT_NAME||'unknown',triggerCron:env.LOOP_TRIGGER_CRON||null,githubRunId:env.GITHUB_RUN_ID,githubRunUrl:env.GITHUB_RUN_ID?`https://github.com/xndanius/while-you-sleep/actions/runs/${env.GITHUB_RUN_ID}`:null,clock,bootstrap:!clock&&env.BOOTSTRAP==='true',now,posts,reservations,outcomes};
  const preliminary=loopDecision(input);
  const relevantSlots=new Set(preliminary.missedSlots.map(slot=>slot.id));
  if(preliminary.bootstrap)relevantSlots.add('bootstrap-initial');
  const needsRecovery=preliminary.reason==='reservation_in_progress_or_unknown';
  const recovered=[];
  for(const reservation of reservations.filter(record=>needsRecovery&&reservationSlotIds(record).some(slotId=>relevantSlots.has(slotId))&&!outcomes.some(outcome=>outcome.reservationId===record.id))) {
    if(reservation.githubRepository!=='xndanius/while-you-sleep'||!/^\d+$/.test(String(reservation.githubRunId)))continue;
    let source;try{source=JSON.parse(await apiGet(`repos/xndanius/while-you-sleep/actions/runs/${reservation.githubRunId}`,{maxBytes:2*1024*1024,env}));}catch{continue;}
    if(source.id!==Number(reservation.githubRunId)||source.repository?.full_name!=='xndanius/while-you-sleep'||source.head_branch!=='main'||source.path!=='.github/workflows/loop.yml'||source.status!=='completed')continue;
    const existing=posts.filter(post=>post.runId===reservation.runId).map(post=>post.id);
    const outcome=slotOutcome(reservation,{id:reservation.runId,published:existing},{settledByRunId:runId,now:Number.isFinite(Date.parse(source.updated_at))?new Date(source.updated_at):now,posts});
    recovered.push(outcome);outcomes.push(outcome);
  }
  const record=needsRecovery?loopDecision(input):preliminary;
  const schedulingSha256=sha256(stableJSON(record));
  if(record.decision==='run'){
    for(const outcome of recovered)await writeJSON(path.join(root,'data','slot-outcomes',outcome.id+'.json'),outcome,{immutable:true});
    await writeJSON(path.join(root,'data','scheduling',runId+'.json'),record,{immutable:true});
    await writeJSON(path.join(root,'data','slot-reservations',runId+'.json'),{id:runId,runId,slotId:record.slotId,slotIds:record.slotIds,slots:record.slots,createdAt:record.requestedAt,githubRepository:'xndanius/while-you-sleep',githubRunId:record.githubRunId,schedulingSha256},{immutable:true});
  }else{
    // No repository records, commits, models or deployment on a cheap skip.
    await writeJSON(path.join(root,'.run','loop-gate.json'),record);
  }
  const values={run_models:String(record.decision==='run'),target_count:String(record.targetCount),scheduling_sha256:schedulingSha256,slot_id:record.slotId,decision:record.decision,reason:record.reason,clock_verified:String(record.clock?.verified===true)};
  if(env.GITHUB_OUTPUT)await fs.appendFile(env.GITHUB_OUTPUT,Object.entries(values).map(([key,value])=>`${key}=${value}\n`).join(''));
  console.log(JSON.stringify(values));return record;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))prepareLoop().catch(()=>{console.error('Trusted loop scheduling gate failed before model execution.');process.exitCode=1;});
