import {readJSON,writeJSON,dataPath,records} from '../lib/storage.mjs';
import {slotOutcome,validateLoopScheduling} from '../lib/loop-schedule.mjs';
export async function settleLoop(runId,env=process.env) {
  const scheduling=validateLoopScheduling(await readJSON(dataPath('scheduling',runId)),{runId,expectedSha256:env.LOOP_SCHEDULING_SHA,eventName:env.GITHUB_EVENT_NAME});
  if(scheduling.decision!=='run')return;
  const reservation=await readJSON(dataPath('slot-reservations',runId));
  if(reservation.schedulingSha256!==env.LOOP_SCHEDULING_SHA||reservation.slotId!==scheduling.slotId)throw new Error('Loop reservation does not match its trusted scheduling decision.');
  let existing;try{existing=await readJSON(dataPath('slot-outcomes',runId));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(existing)return existing;
  const run=await readJSON(dataPath('runs',runId)),outcome=slotOutcome(reservation,run,{posts:await records('posts')});
  await writeJSON(dataPath('slot-outcomes',runId),outcome,{immutable:true});return outcome;
}
