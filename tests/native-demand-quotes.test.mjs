import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {demandQuoteOccurs,nativeDemandQuoteSpans} from '../lib/demand-quotes.mjs';
import {demandContextHash,demandContextReasons,demandEvidenceReasons,demandAssessmentReasons,demandApprovalReasons} from '../lib/demand.mjs';
import {nativeReadingContextReasons} from '../lib/native-reading-context.mjs';
import {assessmentEvidenceReasons} from '../lib/evidence-contract.mjs';
import {omittedCandidateRepairSchema,validateOmittedCandidateRepair} from '../lib/omitted-candidate-repair.mjs';
import {acceptCheckerOutput} from '../lib/checker-output.mjs';
import {completedAssessmentReasons} from '../lib/validation.mjs';

const runId='loop-40538177966-1',productUrl='https://community.make.com/t/118231';
const quote='Form submissions not reaching Airtable or Google Sheets';
const load=async directory=>JSON.parse(await readFile(new URL(`../data/${directory}/${runId}-first.json`,import.meta.url),'utf8'));
async function fixture(){
 const [draft,context]=await Promise.all([load('drafts'),load('check-context')]);
 const source=context.sources.find(row=>row.url===productUrl),assignment=context.demandContext.discussionBatchPolicy.leadAssignments.find(row=>row.productUrl===productUrl),span=source.nativeReadingContext.spans.find(row=>row.text.includes(quote));
 const candidate={title:'Synthetic examination of failed form delivery',productUrl,segment:assignment.segment,sourceIds:[source.id],demandEvidence:{kind:source.demandKind,sourceIds:[source.id],chore:'Examine why a form submission does not reach its configured table.',evidenceQuote:quote}};
 const check={demandCheck:{demandContextSha256:context.demandContextSha256,supported:false,segment:candidate.segment,sourceId:source.id,kind:source.demandKind,chore:candidate.demandEvidence.chore,evidenceQuote:quote,reason:'Synthetic contract check: the literal problem is present, but no approval or supported product outcome is asserted.',noPersonalData:true}};
 const record={schema:2,kind:'omitted_candidate',runId,contextSha256:sha256(stableJSON(context)),rulesSha256:context.rulesSha256,draftSha256:context.draftSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,policySha256:context.scoringPolicy.policySha256,demandContextSha256:context.demandContextSha256,omission:{...assignment,chore:candidate.demandEvidence.chore,evidenceQuote:quote,reason:'Synthetic control: independently examine the original unscored assignment using the task in its retained native span.',quoteSpanSha256:span.sha256}};
 return {draft,context,source,assignment,span,candidate,check,record};
}
const pins=f=>({expectedDraftSha256:sha256(stableJSON(f.draft)),expectedContextSha256:sha256(stableJSON(f.context)),expectedFeedbackSha256:sha256(stableJSON(f.record))});
function reseal(packet){const {packetSha256,...payload}=packet;packet.packetSha256=sha256(stableJSON(payload));}
function rebind(f){
 f.context.sourceSnapshotSha256=sha256(stableJSON(f.context.sources));f.context.draftSha256=sha256(stableJSON(f.draft));
 f.context.demandContext.registrySha256=sha256(stableJSON(f.context.demandContext.registrySources));f.context.demandContextSha256=demandContextHash(f.context.demandContext);
 f.check.demandCheck.demandContextSha256=f.context.demandContextSha256;
 Object.assign(f.record,{contextSha256:sha256(stableJSON(f.context)),draftSha256:f.context.draftSha256,sourceSnapshotSha256:f.context.sourceSnapshotSha256,demandContextSha256:f.context.demandContextSha256});
}
// The omission schema uses only this bounded vocabulary. Fail on additions
// instead of silently ignoring a future schema condition.
function schemaAllows(schema,value){
 const allowed=new Set(['type','additionalProperties','properties','required','enum','anyOf','minLength','maxLength']);
 for(const key of Object.keys(schema))assert.ok(allowed.has(key),'Unsupported schema keyword: '+key);
 if(schema.anyOf&&!schema.anyOf.some(branch=>schemaAllows(branch,value)))return false;
 if(schema.enum&&!schema.enum.some(item=>stableJSON(item)===stableJSON(value)))return false;
 const object=value!==null&&typeof value==='object'&&!Array.isArray(value);
 if(schema.type==='object'&&!object||schema.type==='string'&&typeof value!=='string'||schema.type==='integer'&&!Number.isInteger(value))return false;
 if(typeof value==='string'&&(schema.minLength!==undefined&&[...value].length<schema.minLength||schema.maxLength!==undefined&&[...value].length>schema.maxLength))return false;
 if(object){if((schema.required||[]).some(key=>!Object.hasOwn(value,key)))return false;for(const [key,item] of Object.entries(value)){if(Object.hasOwn(schema.properties||{},key)){if(!schemaAllows(schema.properties[key],item))return false;}else if(schema.additionalProperties===false)return false;}}
 return true;
}

test('the exact saved Make task is available to candidate and independent demand checks without changing its anchor',async()=>{
 const f=await fixture(),before=stableJSON(f);
 assert.equal(f.source.text.includes(quote),false);assert.equal(f.span.kind,'context');assert.equal(f.span.sha256,'2d9c5d7bcc8791f39552aee082d3fbd1ab5ac819eca5aec0f7d682bc6569929f');
 assert.deepEqual(nativeReadingContextReasons(f.source),[]);assert.deepEqual(demandContextReasons(f.context),[]);assert.deepEqual(assessmentEvidenceReasons(f.context),[]);
 assert.ok(nativeDemandQuoteSpans(f.source,{asOf:f.context.createdAt}).some(span=>span.sha256===f.span.sha256));assert.equal(demandQuoteOccurs(f.source,quote,{asOf:f.context.createdAt}),true);
 assert.deepEqual(demandEvidenceReasons(f.candidate,f.context.sources,{required:true,context:f.context}),[]);assert.deepEqual(demandAssessmentReasons(f.check,f.candidate,f.context),[]);
 assert.ok(demandApprovalReasons(f.check,f.candidate,f.context).some(reason=>/did not establish/.test(reason)),'A literal demand check is not a product approval.');assert.equal(stableJSON(f),before);
});

test('native schema 2 omission binds the original assignment and exact span hash without completing or approving an assessment',async()=>{
 const f=await fixture(),before=stableJSON(f),schema=omittedCandidateRepairSchema(f.draft,f.context);
 assert.equal(schemaAllows(schema,f.record),true);assert.equal(validateOmittedCandidateRepair(f.record,f.draft,f.context,{allowInitial:true,requireFeedbackSha256:true,...pins(f)}),f.record);
 const response={outcome:'needs_repair',reason:'Examine one original unscored native discussion task.',manifest:null,repairFeedback:f.record};
 assert.equal(acceptCheckerOutput(response,f.draft,f.context,{allowOmittedCandidateRepair:true,...pins(f)}),f.record);
 assert.ok(completedAssessmentReasons(f.draft,f.context,f.record).length);assert.equal(f.record.completedAssessment,undefined);assert.equal(f.record.checks,undefined);assert.equal(f.record.scoring,undefined);
 assert.throws(()=>validateOmittedCandidateRepair(f.record,f.draft,f.context,pins(f)),/initial checker phase/);assert.equal(stableJSON(f),before);
});

test('schema 2 rejects swapped identities, forged span hashes, foreign quotes and malformed feedback',async()=>{
 const changes=[f=>f.record.omission.quoteSpanSha256='0'.repeat(64),f=>f.record.omission.demandSourceId='forged',f=>f.record.omission.registrySourceId='forged',f=>f.record.omission.productUrl='https://community.make.com/t/118232',f=>f.record.omission.segment='education',f=>f.record.omission.evidenceQuote='A different task not present in this original discussion.',f=>f.record.omission.extra='not allowed',f=>delete f.record.omission.quoteSpanSha256,f=>f.record.sourceSnapshotSha256='0'.repeat(64)];
 for(const change of changes){const f=await fixture();change(f);assert.throws(()=>validateOmittedCandidateRepair(f.record,f.draft,f.context,{allowInitial:true,...pins(f)}),undefined,change.toString());}
 const f=await fixture(),other=f.context.sources.find(source=>source.id!==f.source.id&&source.nativeReadingContext?.spans?.length);
 assert.ok(other);f.record.omission.quoteSpanSha256=other.nativeReadingContext.spans[0].sha256;assert.equal(schemaAllows(omittedCandidateRepairSchema(f.draft,f.context),f.record),false);assert.throws(()=>validateOmittedCandidateRepair(f.record,f.draft,f.context,{allowInitial:true,...pins(f)}),/literal fresh chore quote/);
 const unavailable=await fixture();unavailable.context.considerationEvidence.find(row=>row.productUrl===productUrl).availableSourceIds=[];rebind(unavailable);assert.throws(()=>validateOmittedCandidateRepair(unavailable.record,unavailable.draft,unavailable.context,{allowInitial:true,...pins(unavailable)}),/available exact discussion assignment/);
});

test('stale, corrupt, private, provider and forged native evidence cannot supply the additional demand quote',async()=>{
 const changes=[
  f=>{const old=new Date(Date.parse(f.context.createdAt)-4*3600000).toISOString();f.source.fetchedAt=f.source.verifiedAt=f.source.nativeReadingContext.fetchedAt=old;reseal(f.source.nativeReadingContext);},
  f=>f.source.nativeReadingContext.packetSha256='0'.repeat(64),
  f=>{const packet=f.source.nativeReadingContext,span=packet.spans[0];span.text=f.source.text+' '+quote+' Contact person@example.invalid.';span.end=span.start+span.text.length;span.sha256=sha256(span.text);packet.retainedCharacters=span.text.length;packet.omittedCharacters=packet.normalizedLength-packet.retainedCharacters;reseal(packet);},
  f=>f.source.id='f'.repeat(24),f=>f.source.productUrl='https://community.make.com/t/118232',f=>f.source.enriched=false,
  f=>{f.source.providerEvidence={provider:'apify'};f.source.providerProofVerified=true;f.source.livePostRefetched=false;},
 ];
 for(const change of changes){const f=await fixture();change(f);rebind(f);assert.deepEqual(nativeDemandQuoteSpans(f.source,{asOf:f.context.createdAt}),[],change.toString());assert.equal(demandQuoteOccurs(f.source,quote,{asOf:f.context.createdAt}),false,change.toString());assert.ok(demandEvidenceReasons(f.candidate,f.context.sources,{required:true,context:f.context}).length,change.toString());assert.ok(demandAssessmentReasons(f.check,f.candidate,f.context).length,change.toString());assert.throws(()=>validateOmittedCandidateRepair(f.record,f.draft,f.context,{allowInitial:true,...pins(f)}),undefined,change.toString());}
});

test('the original candidate identity, source authority and independent decision remain mandatory',async()=>{
 for(const change of [f=>f.candidate.productUrl='https://community.make.com/t/118232',f=>f.candidate.segment='education',f=>f.candidate.sourceIds=[],f=>f.candidate.demandEvidence.sourceIds=['forged']]){const f=await fixture();change(f);assert.ok(demandEvidenceReasons(f.candidate,f.context.sources,{required:true,context:f.context}).length,change.toString());}
 for(const change of [f=>f.check.demandCheck.sourceId='forged',f=>f.check.demandCheck.demandContextSha256='0'.repeat(64),f=>f.check.demandCheck.evidenceQuote='A foreign discussion task which is not in this source.']){const f=await fixture();change(f);assert.ok(demandAssessmentReasons(f.check,f.candidate,f.context).length,change.toString());}
 const f=await fixture();f.source.registrySourceId='forged';rebind(f);assert.ok(demandEvidenceReasons(f.candidate,f.context.sources,{required:true,context:f.context}).length);assert.ok(demandAssessmentReasons(f.check,f.candidate,f.context).length);
});

test('a quote cannot join separate native spans or use an example as a demand-task span',async()=>{
 const f=await fixture(),packet=f.source.nativeReadingContext,original=packet.spans[0],offset=original.text.indexOf(quote)+25;
 packet.spans=[{...original,end:original.start+offset,text:original.text.slice(0,offset)},{...original,start:original.start+offset,text:original.text.slice(offset)}];for(const span of packet.spans)span.sha256=sha256(span.text);reseal(packet);rebind(f);
 assert.deepEqual(nativeReadingContextReasons(f.source),[]);assert.equal(nativeDemandQuoteSpans(f.source,{asOf:f.context.createdAt}).length,2);assert.equal(demandQuoteOccurs(f.source,quote,{asOf:f.context.createdAt}),false);assert.ok(demandEvidenceReasons(f.candidate,f.context.sources,{required:true,context:f.context}).length);assert.ok(demandAssessmentReasons(f.check,f.candidate,f.context).length);
 f.record.omission.quoteSpanSha256=packet.spans[0].sha256;assert.throws(()=>validateOmittedCandidateRepair(f.record,f.draft,f.context,{allowInitial:true,...pins(f)}),/literal fresh chore quote/);
 const example=await fixture();example.source.nativeReadingContext.spans[0].kind='example';reseal(example.source.nativeReadingContext);rebind(example);assert.deepEqual(nativeReadingContextReasons(example.source),[]);assert.deepEqual(nativeDemandQuoteSpans(example.source,{asOf:example.context.createdAt}),[]);assert.equal(demandQuoteOccurs(example.source,quote,{asOf:example.context.createdAt}),false);
});

test('schema 1 remains anchor-only and cannot silently gain the native context quote',async()=>{
 const f=await fixture();f.record.schema=1;delete f.record.omission.quoteSpanSha256;
 assert.throws(()=>validateOmittedCandidateRepair(f.record,f.draft,f.context,{allowInitial:true,...pins(f)}),/literal fresh chore quote/);
 f.record.omission.evidenceQuote=f.source.text;assert.equal(schemaAllows(omittedCandidateRepairSchema(f.draft,f.context),f.record),false,'New requests offer schema 3 anchors; old schema 1 receipts remain verifiable.');assert.equal(validateOmittedCandidateRepair(f.record,f.draft,f.context,{allowInitial:true,...pins(f)}),f.record);
 const legacy=structuredClone(f.source);delete legacy.nativeReadingContext;assert.deepEqual(nativeDemandQuoteSpans(legacy),[]);assert.equal(demandQuoteOccurs(legacy,quote),false);assert.equal(demandQuoteOccurs(legacy,legacy.text),true);
});

test('all focused checks leave the exact saved context and draft files unchanged',async()=>{
 const paths=['drafts','check-context'].map(directory=>new URL(`../data/${directory}/${runId}-first.json`,import.meta.url)),before=await Promise.all(paths.map(path=>readFile(path,'utf8'))),f=await fixture();
 demandEvidenceReasons(f.candidate,f.context.sources,{required:true,context:f.context});demandAssessmentReasons(f.check,f.candidate,f.context);validateOmittedCandidateRepair(f.record,f.draft,f.context,{allowInitial:true,...pins(f)});
 assert.deepEqual(await Promise.all(paths.map(path=>readFile(path,'utf8'))),before);
});
