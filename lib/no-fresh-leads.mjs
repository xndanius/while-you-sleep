import {sha256,stableJSON} from './storage.mjs';
import {validateSourceScanReceipt} from './source-registry.mjs';
import {validateLearningSelection} from './learning.mjs';

const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const keys=['schema','id','runId','type','createdAt','schedulingSha256','sourceScanSha256','selectionSha256','researchSha256','decision','code','reason','selectedLeads','producer'];
export function noFreshLeadsEligible(snapshot,scan,selection){
 const e=snapshot?.enrichment;
 if(e?.status!=='no_new_leads'||e.selected!==0||e.attempted!==0||e.fetched!==0||e.failed!==0||!Array.isArray(e.observations)||e.observations.length)return false;
 // A failed chosen feed is unavailable evidence, not an empty successful search.
 return !selection?.demandSourceIds?.length||selection.demandSourceIds.some(id=>scan?.observations?.some(row=>row.feedId===id&&['ok','empty'].includes(row.status)));
}
export function createNoFreshLeadsReceipt({runId,schedulingSha256,scan,selection,snapshot,now=new Date()}={}){
 if(!noFreshLeadsEligible(snapshot,scan,selection))return null;
 if(!hex(schedulingSha256)||validateSourceScanReceipt(scan,{runId}).length||validateLearningSelection(selection,{runId}).length||scan.producer.headSha!==selection.producer.headSha||scan.registrySha256!==selection.registrySha256||snapshot.runId!==runId)throw new Error('No-lead completion requires the original trusted scan, selection and reservation.');
 return {schema:1,id:runId,runId,type:'no-fresh-leads',createdAt:new Date(now).toISOString(),schedulingSha256,sourceScanSha256:sha256(stableJSON(scan)),selectionSha256:sha256(stableJSON(selection)),researchSha256:sha256(stableJSON(snapshot)),decision:'completed_no_post',code:'no_fresh_leads',reason:'No fresh lead remained in the bounded guarded selection. No writer or independent checker ran; no candidate approval or reward was created.',selectedLeads:0,producer:scan.producer};
}
export function noFreshLeadsReasons(record,{runId,schedulingSha256,expectedSha256,scan,selection}={}){
 const p=record?.producer,match=typeof runId==='string'&&runId.match(/^loop-([1-9]\d{0,15})-([1-9]\d{0,3})$/);
 if(!record||typeof record!=='object'||Array.isArray(record)||Object.keys(record).length!==keys.length||keys.some(key=>!Object.hasOwn(record,key))||record.schema!==1||record.id!==runId||record.runId!==runId||record.type!=='no-fresh-leads'||!match||!Number.isFinite(Date.parse(record.createdAt))||new Date(record.createdAt).toISOString()!==record.createdAt||record.decision!=='completed_no_post'||record.code!=='no_fresh_leads'||record.selectedLeads!==0||record.reason!=='No fresh lead remained in the bounded guarded selection. No writer or independent checker ran; no candidate approval or reward was created.'||!hex(schedulingSha256)||record.schedulingSha256!==schedulingSha256||!['sourceScanSha256','selectionSha256','researchSha256'].every(key=>hex(record[key]))||!hex(expectedSha256)||sha256(stableJSON(record))!==expectedSha256)return ['Trusted deterministic no-lead completion is missing or changed.'];
 if(!p||p.repository!=='xndanius/while-you-sleep'||p.runId!==match[1]||p.runAttempt!==Number(match[2])||p.workflow!=='loop.yml'||p.stage!=='pre_model'||!/^[a-f0-9]{40}$/.test(p.headSha||''))return ['No-lead completion has no exact pre-model producer.'];
 if(!scan||validateSourceScanReceipt(scan,{runId,expectedSha256:record.sourceScanSha256}).length||!selection||validateLearningSelection(selection,{runId,expectedSha256:record.selectionSha256}).length||scan.producer.headSha!==p.headSha||selection.producer.headSha!==p.headSha||scan.registrySha256!==selection.registrySha256)return ['No-lead completion does not bind the original independent scan and selection.'];
 return [];
}
export {noFreshLeadsSettlement} from './no-fresh-leads-settlement.mjs';
