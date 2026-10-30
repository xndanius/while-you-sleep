// Static dependencies deliberately stay node-only: the cheap clock imports
// this planner without npm install. Checked-score hydration is loaded only by
// the deterministic curator/build after their normal dependency installation.
import {promises as fs} from 'node:fs';
import {rssEligible} from './publication-distribution.mjs';
import path from 'node:path';
import {sha256,stableJSON,validId} from './storage.mjs';
import {TIMEZONE,localParts,nextLocalTime} from './config.mjs';
import {validClockProvenance} from './clock-provenance.mjs';

export const CURATION_MINIMUM_SCORE=6;
// Earlier durable receipts retain their stricter 7/10 rule and frozen score.
// Accepting that historical rule never lowers a pick's own recorded minimum.
const RECEIPT_MINIMUM_SCORES=Object.freeze([CURATION_MINIMUM_SCORE,7]);
export const CURATION_DAILY_CAP=2;
export const CURATION_LOOKBACK_HOURS=24;
const RECEIPT_LOOKBACK_HOURS=Object.freeze([12,CURATION_LOOKBACK_HOURS]);
export const CURATION_TIMES=Object.freeze(['12:17','18:17']);
const HOUR=3600000,hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const exact=(value,keys)=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const scoreKeys=['ease','profit','feasibility','autonomy','evidence'];
const pad=value=>String(value).padStart(2,'0');
const runMatch=value=>typeof value==='string'&&value.match(/^curate-([1-9]\d{0,15})-([1-9]\d{0,3})$/);
const slotMatch=value=>typeof value==='string'&&/^curate-\d{4}-\d{2}-\d{2}-(?:12|18)-17$/.test(value);
const slotPredicate=part=>[12,18].includes(part.hour)&&part.minute===17;

export function validateCurationConfig(config){
 const failures=[];
 if(!exact(config,['schema','enabled','activatedAt'])||config.schema!==1||typeof config.enabled!=='boolean')failures.push('Curation configuration must have the fixed schema, enabled flag and activation timestamp.');
 if(config?.activatedAt!==null&&!timestamp(config?.activatedAt)||config?.enabled===true&&!timestamp(config?.activatedAt))failures.push('Enabled curation needs an exact UTC activation timestamp.');
 return failures;
}
export function curationSlots(config,now=new Date()){
 const failures=validateCurationConfig(config);if(failures.length)throw new Error(failures.join(' '));
 if(!config.enabled||!config.activatedAt)return [];
 const date=new Date(now);if(!Number.isFinite(date.getTime()))throw new Error('Invalid curation time.');
 const {day}=localParts(date),[year,month,dayOfMonth]=day.split('-').map(Number),start=Date.UTC(year,month-1,dayOfMonth)-4*HOUR,slots=[];
 for(let time=start;time<start+30*HOUR;time+=60000){
  const part=localParts(new Date(time));
  if(part.day!==day||!slotPredicate(part)||time<Date.parse(config.activatedAt))continue;
  const localTime=`${pad(part.hour)}:${pad(part.minute)}`;
  slots.push({id:`curate-${day}-${pad(part.hour)}-${pad(part.minute)}`,slotId:`curate-${day}-${pad(part.hour)}-${pad(part.minute)}`,scheduledAt:new Date(time).toISOString(),localDate:day,localTime});
 }
 return slots;
}
function frozenScoringReasons(scoring,minimumScore){
 const failures=[];
 if(!exact(scoring,['criteria','overall','weights','threshold','policySha256','assessmentPolicySha256','checkedAt','checkerRunId'])||!exact(scoring?.weights,scoreKeys)||!exact(scoring?.criteria,scoreKeys))return ['Frozen curation scoring schema is invalid.'];
 if(scoreKeys.some(key=>!Number.isFinite(scoring.weights[key])||scoring.weights[key]<=0||scoring.weights[key]>100||!exact(scoring.criteria[key],['value','reason','sourceIds'])||!Number.isInteger(scoring.criteria[key].value)||scoring.criteria[key].value<1||scoring.criteria[key].value>10||typeof scoring.criteria[key].reason!=='string'||!Array.isArray(scoring.criteria[key].sourceIds)))failures.push('Frozen curation criterion values or weights are invalid.');
 if(!Number.isFinite(scoring.overall)||scoring.overall<minimumScore||scoring.overall>10||!Number.isFinite(scoring.threshold)||scoring.threshold<1||scoring.threshold>10||!hex(scoring.assessmentPolicySha256)||!timestamp(scoring.checkedAt)||!validId(scoring.checkerRunId))failures.push('Frozen curation score, policy or checker identity is invalid.');
 if(scoring.policySha256!==sha256(stableJSON({weights:scoring.weights,publishThreshold:scoring.threshold})))failures.push('Frozen curation score policy fingerprint changed.');
 if(!failures.length){const total=scoreKeys.reduce((sum,key)=>sum+scoring.weights[key],0),overall=Math.min(10,Math.max(1,scoreKeys.reduce((sum,key)=>sum+scoring.criteria[key].value*scoring.weights[key],0)/total));if(scoring.overall!==overall)failures.push('Frozen curation weighted mean changed.');}
 return failures;
}
export function validateCurationReceipt(receipt,{config,posts}={}){
 const failures=[];
 if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))return ['Curation receipt is not an object.'];
 const allowed=['schema','id','type','slotId','localDate','localTime','scheduledAt','activatedAt','selectedAt','windowStart','windowEnd','outcome','scheduleStatus','reason','minimumScore','dailyCap','runId','githubRunId','githubRunAttempt','githubRunUrl','eventName','rulesSha256','policySha256','pick','modelExecuted','engine',...(Object.hasOwn(receipt,'clock')?['clock']:[])];
 if(!exact(receipt,allowed)||receipt.schema!==1||receipt.type!=='curation'||receipt.id!==receipt.slotId||!slotMatch(receipt.slotId)||receipt.scheduleStatus!=='completed'||!RECEIPT_MINIMUM_SCORES.includes(receipt.minimumScore)||receipt.dailyCap!==CURATION_DAILY_CAP||receipt.modelExecuted!==false||receipt.engine!=='GitHub Actions deterministic curator')failures.push('Curation receipt schema or terminal slot identity is invalid.');
 if(!timestamp(receipt.scheduledAt)||!timestamp(receipt.activatedAt)||!timestamp(receipt.selectedAt)||!timestamp(receipt.windowStart)||receipt.windowEnd!==receipt.selectedAt||!RECEIPT_LOOKBACK_HOURS.includes((Date.parse(receipt.selectedAt)-Date.parse(receipt.windowStart))/HOUR)||Date.parse(receipt.scheduledAt)<Date.parse(receipt.activatedAt)||Date.parse(receipt.scheduledAt)>Date.parse(receipt.selectedAt))failures.push('Curation receipt activation or recorded eligibility window is invalid.');
 if(timestamp(receipt.scheduledAt)&&timestamp(receipt.selectedAt)){
  const part=localParts(receipt.scheduledAt),localTime=`${pad(part.hour)}:${pad(part.minute)}`;
  if(!slotPredicate(part)||receipt.localDate!==part.day||receipt.localTime!==localTime||receipt.slotId!==`curate-${part.day}-${pad(part.hour)}-${pad(part.minute)}`||localParts(receipt.selectedAt).day!==part.day)failures.push('Curation receipt does not identify a current-day planned slot.');
 }
 if(config&&(validateCurationConfig(config).length||receipt.activatedAt!==config.activatedAt))failures.push('Curation receipt differs from the fixed activation boundary.');
 const match=runMatch(receipt.runId);
 if(!match||receipt.githubRunId!==match[1]||receipt.githubRunAttempt!==Number(match[2])||receipt.githubRunUrl!==`https://github.com/xndanius/while-you-sleep/actions/runs/${match[1]}`||!['schedule','workflow_dispatch'].includes(receipt.eventName)||!hex(receipt.rulesSha256)||!hex(receipt.policySha256))failures.push('Curation receipt cloud identity or rule fingerprint is invalid.');
 if(receipt.clock&&(receipt.eventName!=='workflow_dispatch'||!validClockProvenance(receipt.clock,{kind:'curate',runId:receipt.githubRunId})))failures.push('Curation receipt automatic clock provenance is invalid.');
 if(receipt.outcome==='picked'){
  const pick=receipt.pick;
  if(!exact(pick,['postId','postContentSha256','publishedAt','pickedAt','scoring'])||!validId(pick?.postId)||!hex(pick?.postContentSha256)||!timestamp(pick?.publishedAt)||pick.pickedAt!==receipt.selectedAt||Date.parse(pick.publishedAt)<Date.parse(receipt.activatedAt)||Date.parse(pick.publishedAt)<Date.parse(receipt.windowStart)||Date.parse(pick.publishedAt)>Date.parse(receipt.windowEnd)||receipt.reason!=='highest_eligible_checked_score')failures.push('Curation pick does not bind an eligible post and selection time.');
  failures.push(...frozenScoringReasons(pick?.scoring,receipt.minimumScore));
  if(pick?.scoring?.policySha256!==receipt.policySha256)failures.push('Curation pick differs from the frozen selection policy.');
  if(posts){const original=posts.find(post=>post.id===pick?.postId);if(!original||!rssEligible(original)||original.contentSha256!==pick.postContentSha256||original.publishedAt!==pick.publishedAt)failures.push('Curation pick no longer identifies its original published post.');}
 }else if(!['empty','daily_cap'].includes(receipt.outcome)||receipt.pick!==null||receipt.reason!==(receipt.outcome==='empty'?'no_eligible_checked_post':'daily_curation_cap_reached'))failures.push('Curation receipt has an unknown or nonterminal empty decision.');
 return [...new Set(failures)];
}
export function validateCurationReceipts(receipts,{config,posts}={}){
 if(!Array.isArray(receipts))return ['Curation receipts must be an array.'];
 const failures=receipts.flatMap(receipt=>validateCurationReceipt(receipt,{config,posts}));
 if(new Set(receipts.map(receipt=>receipt?.slotId)).size!==receipts.length)failures.push('Curation receipts repeated a terminal slot.');
 const picks=receipts.filter(receipt=>receipt?.outcome==='picked');
 if(new Set(picks.map(receipt=>receipt.pick?.postId)).size!==picks.length)failures.push('Curation receipts selected an already picked post again.');
 const daily=new Map();for(const receipt of picks){daily.set(receipt.localDate,(daily.get(receipt.localDate)||0)+1);if(daily.get(receipt.localDate)>CURATION_DAILY_CAP)failures.push('Curation receipts exceed the two-selection daily cap.');}
 return [...new Set(failures)];
}
export function curationDecision({config,receipts=[],now=new Date()}={}){
 const failures=[...validateCurationConfig(config),...validateCurationReceipts(receipts,{config})];if(failures.length)throw new Error(failures.join(' '));
 if(!config.enabled)return {due:false,reason:'curation_disabled',slots:[]};
 const date=new Date(now);if(!Number.isFinite(date.getTime()))throw new Error('Invalid curation time.');
 if(date<Date.parse(config.activatedAt))return {due:false,reason:'activation_not_reached',slots:[]};
 const slots=curationSlots(config,date).filter(slot=>Date.parse(slot.scheduledAt)<=date.getTime()&&!receipts.some(receipt=>receipt.slotId===slot.id));
 return {due:slots.length>0,reason:slots.length?'curation_slots_due':'curation_slots_settled_or_future',slots};
}
export async function readCurationRecords(root){
 const directory=path.join(root,'data','curations');let files;
 try{files=await fs.readdir(directory);}catch(error){if(error.code==='ENOENT')return [];throw error;}
 return Promise.all(files.map(async file=>{
  if(!/^curate-\d{4}-\d{2}-\d{2}-(?:12|18)-17\.json$/.test(file))throw new Error('Unexpected file in the trusted curation record directory.');
  const target=path.join(directory,file),stat=await fs.lstat(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw new Error('Curation receipt is not a bounded trusted file.');
  const receipt=JSON.parse(await fs.readFile(target,'utf8'));if(receipt.id+'.json'!==file)throw new Error('Curation receipt changed its physical slot identity.');return receipt;
 }));
}
function sidecarFor(sidecars,id){return sidecars instanceof Map?sidecars.get(id):Array.isArray(sidecars)?sidecars.find(sidecar=>sidecar?.postId===id):sidecars?.[id];}
export async function validatedCurationPicks({config,receipts=[],posts=[],sidecars=new Map()}={}){
 const failures=[...validateCurationConfig(config),...validateCurationReceipts(receipts,{config,posts})];if(failures.length)throw new Error(failures.join(' '));
 const selected=receipts.filter(receipt=>receipt.outcome==='picked');if(!selected.length)return [];
 const {hydrateScoring}=await import('./scoring.mjs'),picks=[];
 for(const receipt of selected){
  const pick=receipt.pick,post=posts.find(post=>post.id===pick.postId),policy={weights:pick.scoring.weights,threshold:pick.scoring.threshold,policySha256:pick.scoring.policySha256},scoring=hydrateScoring(post,sidecarFor(sidecars,post.id),policy);
  if(!scoring||stableJSON(scoring)!==stableJSON(pick.scoring))throw new Error('Curation pick lost its original checked scores or frozen evidence/policy binding.');
  picks.push(pick);
 }
 return picks.sort((left,right)=>right.pickedAt.localeCompare(left.pickedAt)||left.postId.localeCompare(right.postId));
}
export async function selectCurationPost({config,posts=[],sidecars=new Map(),policy,receipts=[],now=new Date()}={}){
 const failures=[...validateCurationConfig(config),...validateCurationReceipts(receipts,{config,posts})];if(failures.length)throw new Error(failures.join(' '));
 if(!config.enabled||Date.parse(config.activatedAt)>new Date(now).getTime())return null;
 const {hydrateScoring}=await import('./scoring.mjs'),selectedAt=new Date(now).toISOString(),start=Date.parse(selectedAt)-CURATION_LOOKBACK_HOURS*HOUR,already=new Set(receipts.filter(receipt=>receipt.outcome==='picked').map(receipt=>receipt.pick.postId)),candidates=[];
 for(const post of posts){
  if(!rssEligible(post))continue;
  const publishedAt=Date.parse(post.publishedAt);if(!Number.isFinite(publishedAt)||publishedAt<start||publishedAt>Date.parse(selectedAt)||publishedAt<Date.parse(config.activatedAt)||already.has(post.id))continue;
  const scoring=hydrateScoring(post,sidecarFor(sidecars,post.id),policy);if(!scoring||scoring.overall<CURATION_MINIMUM_SCORE)continue;
  candidates.push({postId:post.id,postContentSha256:post.contentSha256,publishedAt:post.publishedAt,pickedAt:selectedAt,scoring});
 }
 return candidates.sort((left,right)=>right.scoring.overall-left.scoring.overall||right.publishedAt.localeCompare(left.publishedAt)||left.postId.localeCompare(right.postId))[0]||null;
}
export function curationStatus({config,receipts=[],now=new Date()}={}){
 const failures=[...validateCurationConfig(config),...validateCurationReceipts(receipts,{config})];if(failures.length)throw new Error(failures.join(' '));
 const date=new Date(now),decisions=receipts.slice().sort((left,right)=>right.selectedAt.localeCompare(left.selectedAt)||right.slotId.localeCompare(left.slotId)),picks=decisions.filter(receipt=>receipt.outcome==='picked'),last=decisions[0];
 let nextSelectionAt=null;
 if(config.enabled){const start=new Date(Math.max(date.getTime(),Date.parse(config.activatedAt)-60000));nextSelectionAt=nextLocalTime(slotPredicate,start);const due=curationDecision({config,receipts,now:date}).slots[0];if(due)nextSelectionAt=due.scheduledAt;}
 return {enabled:config.enabled,activatedAt:config.activatedAt,minimumScore:CURATION_MINIMUM_SCORE,dailyCap:CURATION_DAILY_CAP,lookbackHours:CURATION_LOOKBACK_HOURS,selectionTimes:[...CURATION_TIMES],nextSelectionAt,lastSelectionAt:picks[0]?.selectedAt||null,lastDecision:last?{status:last.outcome,reason:last.reason,slotId:last.slotId,selectedAt:last.selectedAt,postId:last.pick?.postId||null}:null,totalPicks:picks.length};
}
