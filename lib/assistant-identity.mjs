import {sha256,stableJSON,validId} from './storage.mjs';
import {websiteOnly} from './publication-distribution.mjs';

const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const taskId=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const turnId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{5,159}$/.test(value);
const bindingKeys=['researchSha256','draftSha256','contextSha256','sourceSnapshotSha256','rulesSha256','policySha256','manifestSha256','writerReceiptSha256','checkerReceiptSha256'];
const actorKeys=['surface','taskId','turnId'];
const receiptKeys=['schema','role','runId','actor','startedAt','completedAt','inputSha256','outputSha256'];
export const assistantCheckerId=record=>'assistant-check-'+sha256(stableJSON(record.checker.actor)).slice(0,32);

// These are host attestations, not cryptographic authentication of a task ID.
// The orchestrator must obtain the identities/times from runtime task records,
// pin each receipt outside model output, then invoke the registration command.
export function assistantProvenanceReasons(record){
 const reasons=[];
 if(!exact(record,['schema','kind','runId','registeredAt','bindings','writer','checker','checks','distribution'])||record.schema!==1||record.kind!=='assistant-execution'||!validId(record.runId)||!record.runId.startsWith('assistant-')||!stamp(record.registeredAt)||!websiteOnly(record.distribution))return ['Assistant execution envelope is malformed or is not website-only.'];
 if(!exact(record.bindings,bindingKeys)||bindingKeys.some(key=>!hex(record.bindings[key])))reasons.push('Assistant execution fingerprints are incomplete.');
 if(!Array.isArray(record.checks)||record.checks.length>6||new Set(record.checks.map(check=>check?.postId)).size!==record.checks.length||record.checks.some(check=>!exact(check,['postId','sha256','draftPostSha256'])||!validId(check.postId)||!hex(check.sha256)||!hex(check.draftPostSha256)))reasons.push('Assistant per-post decision fingerprints are invalid.');
 for(const role of ['writer','checker']){
  const r=record[role];
  if(!exact(r,receiptKeys)||r.schema!==1||r.role!==role||r.runId!==record.runId||!exact(r.actor,actorKeys)||!['codex','chatgpt'].includes(r.actor.surface)||!taskId(r.actor.taskId)||!turnId(r.actor.turnId)||!stamp(r.startedAt)||!stamp(r.completedAt)||Date.parse(r.startedAt)>Date.parse(r.completedAt)||!hex(r.inputSha256)||!hex(r.outputSha256))reasons.push(`Assistant ${role} runtime receipt is malformed.`);
 }
 if(reasons.length)return reasons;
 const {writer,checker,bindings}=record;
 if(writer.actor.taskId===checker.actor.taskId)reasons.push('Writer and independent checker must be different runtime tasks, not two turns or labels of one task.');
 if(Date.parse(checker.startedAt)<Date.parse(writer.completedAt)||Date.parse(record.registeredAt)<Date.parse(checker.completedAt))reasons.push('Assistant execution times do not establish a completed independent check after writing.');
 if(writer.inputSha256!==bindings.researchSha256||writer.outputSha256!==bindings.draftSha256||checker.inputSha256!==bindings.contextSha256||checker.outputSha256!==bindings.manifestSha256||sha256(stableJSON(writer))!==bindings.writerReceiptSha256||sha256(stableJSON(checker))!==bindings.checkerReceiptSha256)reasons.push('Assistant runtime receipts do not bind their exact inputs and outputs.');
 return reasons;
}
