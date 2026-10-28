import {canonicalURL,sha256,stableJSON} from './storage.mjs';
import {privateArtifactReasons} from './privacy.mjs';
import {noveltyContextReasons} from './novelty.mjs';
import {demandContextReasons} from './demand.mjs';
import {assessmentEvidenceReasons} from './evidence-contract.mjs';
import {frozenScoringPolicyReasons} from './validation.mjs';
import {nativeDemandQuoteSpans} from './demand-quotes.mjs';

const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const url=value=>{try{return canonicalURL(value);}catch{return null;}};
const bounded=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\r\n\x00-\x1f\x7f]/.test(value);
const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const fixed=(type,value)=>({type,enum:[value]});
const fields=['schema','kind','runId','contextSha256','rulesSha256','draftSha256','sourceSnapshotSha256','policySha256','demandContextSha256','omission'];
const assignmentFields=['productUrl','segment','kind','demandSourceId','registrySourceId'];
const omissionFields=[...assignmentFields,'chore','evidenceQuote','reason'];
const ratingFields=['scoring','ratings','score','scores','criteria','writerCriteria','overall'];

export const isOmittedCandidateRepair=record=>record?.kind==='omitted_candidate';

// Only an explicit unscored exclusion in the sealed discussion batch can use
// the existing repair. A low rating is already an assessment, not an omission.
export function omittedCandidateAssignments(draft,context){
 const batch=context?.demandContext?.discussionBatchPolicy;
 if(context?.assessmentContractVersion!==1||context?.demandContractVersion!==1||!Array.isArray(draft?.posts)||draft.posts.length||!Array.isArray(draft.candidates)||!Array.isArray(draft.rejected)||draft.candidates.length>12||draft.rejected.length>12||batch?.version!==1||batch.postIsDemand!==true||!Array.isArray(batch.leadAssignments)||batch.leadAssignments.length>10)return [];
 const assessed=new Set([...draft.posts,...draft.candidates].map(item=>url(item?.productUrl)));
 const rejected=new Set(draft.rejected.filter(item=>bounded(item?.title,200)&&bounded(item?.reason,2000)&&!ratingFields.some(key=>Object.hasOwn(item,key))).map(item=>url(item.productUrl)));
 return batch.leadAssignments.filter(assignment=>assignment.kind==='discussion'&&url(assignment.productUrl)&&rejected.has(url(assignment.productUrl))&&!assessed.has(url(assignment.productUrl))).map(assignment=>Object.fromEntries(assignmentFields.map(key=>[key,assignment[key]])));
}

export function omittedCandidateRepairSchema(draft,context){
 // Keep each identity and its exact evidence location in one schema branch.
 // Historical schema 1 stays readable. New anchor feedback uses schema 3:
 // literal source prose must not appear in enum/const, whose strict-output
 // grammar rejects quoted strings before the checker can run. Bind its hash
 // here and verify the exact full anchor at acceptance, without rewriting it.
 // Schema 2 still binds a native span hash and a literal substring.
 const candidates=omittedCandidateAssignments(draft,context);
 if(!candidates.length)return null;
 try{if(assessmentEvidenceReasons(context).length)return null;}catch{return null;}
 const assignments=candidates.flatMap(assignment=>{
  const source=context.sources.find(row=>row.id===assignment.demandSourceId);
  const consideration=context.considerationEvidence?.find(row=>url(row.productUrl)===url(assignment.productUrl));
  if(!source||!consideration?.availableSourceIds?.includes(assignment.demandSourceId)||url(source.url)!==url(assignment.productUrl)||source.registrySourceId!==assignment.registrySourceId||source.segment!==assignment.segment||!bounded(source.text,200)||source.text.length<12)return [];
  return [{assignment,quote:source.text,spans:nativeDemandQuoteSpans(source,{asOf:context.createdAt})}];
 });
 if(!assignments.length)return null;
 const omission=({assignment,quote})=>object({...Object.fromEntries(assignmentFields.map(key=>[key,fixed('string',assignment[key])])),chore:{type:'string',minLength:1,maxLength:280},evidenceQuote:{type:'string',minLength:12,maxLength:200},reason:{type:'string',minLength:1,maxLength:500},quoteAnchorSha256:fixed('string',sha256(quote))});
 const envelope=(version,omission)=>object({schema:fixed('integer',version),kind:fixed('string','omitted_candidate'),runId:fixed('string',context.runId),contextSha256:fixed('string',sha256(stableJSON(context))),rulesSha256:fixed('string',context.rulesSha256),draftSha256:fixed('string',context.draftSha256),sourceSnapshotSha256:fixed('string',context.sourceSnapshotSha256),policySha256:fixed('string',context.scoringPolicy.policySha256),demandContextSha256:fixed('string',context.demandContextSha256),omission});
 const anchor=envelope(3,assignments.length===1?omission(assignments[0]):{anyOf:assignments.map(omission)});
 const native=assignments.flatMap(({assignment,spans})=>spans.filter(span=>span.text.length>=12).map(span=>object({...Object.fromEntries(assignmentFields.map(key=>[key,fixed('string',assignment[key])])),chore:{type:'string',minLength:1,maxLength:280},evidenceQuote:{type:'string',minLength:12,maxLength:200},reason:{type:'string',minLength:1,maxLength:500},quoteSpanSha256:fixed('string',span.sha256)})));
 return native.length?{anyOf:[anchor,envelope(2,native.length===1?native[0]:{anyOf:native})]}:anchor;
}

export function validateOmittedCandidateRepair(record,draft,context,{allowInitial=false,expectedDraftSha256,expectedContextSha256,expectedFeedbackSha256,requireFeedbackSha256=false}={}){
 if(!allowInitial)throw new Error('Omitted-candidate feedback is allowed only in the trusted initial checker phase.');
 if(expectedDraftSha256&&sha256(stableJSON(draft))!==expectedDraftSha256||expectedContextSha256&&sha256(stableJSON(context))!==expectedContextSha256)throw new Error('Omitted-candidate feedback changed its trusted frozen draft or evidence context.');
 if((requireFeedbackSha256&&!/^[a-f0-9]{64}$/.test(expectedFeedbackSha256||''))||expectedFeedbackSha256&&sha256(stableJSON(record))!==expectedFeedbackSha256)throw new Error('Omitted-candidate feedback does not match its trusted checker output fingerprint.');
 const native=record?.schema===2,anchor=record?.schema===3;
 if(!exact(record,fields)||![1,2,3].includes(record.schema)||record.kind!=='omitted_candidate'||!exact(record.omission,[...omissionFields,...(native?['quoteSpanSha256']:anchor?['quoteAnchorSha256']:[])]))throw new Error('Omitted-candidate feedback has an unexpected record shape.');
 if(record.runId!==context.runId||draft.runId!==context.runId||record.contextSha256!==sha256(stableJSON(context))||record.rulesSha256!==context.rulesSha256||record.draftSha256!==context.draftSha256||record.sourceSnapshotSha256!==context.sourceSnapshotSha256||record.policySha256!==context.scoringPolicy?.policySha256||record.demandContextSha256!==context.demandContextSha256||sha256(stableJSON(draft))!==context.draftSha256||sha256(stableJSON(context.sources))!==context.sourceSnapshotSha256)throw new Error('Omitted-candidate feedback does not bind its exact frozen identity, draft, sources, demand and policy fingerprints.');
 const reasons=[...frozenScoringPolicyReasons(context),...noveltyContextReasons(context),...demandContextReasons(context),...assessmentEvidenceReasons(context)];
 if(reasons.length)throw new Error([...new Set(reasons)].join(' '));
 const omission=record.omission,assignment=omittedCandidateAssignments(draft,context).find(row=>assignmentFields.every(key=>row[key]===omission[key]));
 if(!assignment)throw new Error('Omitted-candidate feedback must name one exact original unscored rejected discussion assignment.');
 const consideration=context.considerationEvidence?.find(row=>url(row.productUrl)===url(assignment.productUrl));
 const source=context.sources.find(row=>row.id===assignment.demandSourceId);
 const literal=native?nativeDemandQuoteSpans(source,{asOf:context.createdAt}).some(span=>span.sha256===omission.quoteSpanSha256&&span.text.includes(omission.evidenceQuote)):anchor?typeof source?.text==='string'&&omission.quoteAnchorSha256===sha256(source.text)&&omission.evidenceQuote===source.text:source?.text?.includes(omission.evidenceQuote);
 if(!consideration?.availableSourceIds?.includes(assignment.demandSourceId)||!source||url(source.url)!==url(assignment.productUrl)||source.registrySourceId!==assignment.registrySourceId||source.segment!==assignment.segment||!['discussion-post','demand-notice'].includes(source.evidenceKind)||!bounded(omission.chore,280)||!bounded(omission.reason,500)||!bounded(omission.evidenceQuote,200)||omission.evidenceQuote.length<12||!literal)throw new Error('Omitted-candidate feedback lacks its available exact discussion assignment and bounded literal fresh chore quote.');
 if(privateArtifactReasons(record).length)throw new Error('Privacy verification rejected the omitted-candidate feedback.');
 return record;
}
