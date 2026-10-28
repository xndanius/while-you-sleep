import {hash} from './storage.mjs';
import {DISCUSSION_SOURCE_CATALOG,DISCUSSION_PROVIDER_CATALOG,discussionPostURL} from './discussion-sources.mjs';
import {extractImplementationEvidence} from './implementation-evidence.mjs';
import {nativeReadingContextReasons} from './native-reading-context.mjs';

// Fixed first-party documentation for observed task shapes. Matching
// only schedules a guarded read; it establishes no demand, capability or score.
export const DISCUSSION_IMPLEMENTATION_CATALOG=Object.freeze([
 Object.freeze({id:'n8n-summarize-records-v1',url:'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.summarize',title:'n8n Summarize node documentation',communityOrigin:'https://community.n8n.io'}),
 Object.freeze({id:'make-existing-workflow-errors-v1',url:'https://help.make.com/Overview-of-error-handling',title:'Make error handling documentation',communityOrigin:'https://community.make.com'}),
 Object.freeze({id:'n8n-if-conditions-v1',url:'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.if',title:'n8n If node documentation',communityOrigin:'https://community.n8n.io'}),
 Object.freeze({id:'n8n-code-data-v1',url:'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.code',title:'n8n Code node documentation',communityOrigin:'https://community.n8n.io'}),
 Object.freeze({id:'make-mapping-arrays-v1',url:'https://help.make.com/mapping-arrays',title:'Make array mapping documentation',communityOrigin:'https://community.make.com'}),
 Object.freeze({id:'n8n-resume-schema-v1',url:'https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.information-extractor',title:'n8n Information Extractor schema documentation',communityOrigin:'https://news.ycombinator.com'}),
 Object.freeze({id:'n8n-csv-extraction-v1',url:'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.extractfromfile',title:'n8n CSV file extraction documentation',communityOrigin:'https://community.n8n.io'}),
 Object.freeze({id:'n8n-persistent-deduplication-v1',url:'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.removeduplicates',title:'n8n cross-execution duplicate removal documentation',communityOrigin:'https://community.n8n.io'}),
]);
const definitions=[...DISCUSSION_SOURCE_CATALOG,...DISCUSSION_PROVIDER_CATALOG];
const taskBlocks=source=>[source?.text,...(Array.isArray(source?.nativeReadingContext?.spans)?source.nativeReadingContext.spans:[]).map(span=>span?.text)];
const orderSummary=source=>taskBlocks(source).some(text=>/\b(?:daily|weekly|regular|scheduled)\s+reports?\b/i.test(text)&&/\b(?:generate|prepare|create|produce)\b.{0,80}\bsummar(?:y|ies)\b/i.test(text)&&/\borders?\b/i.test(text)&&/\b(?:completed|cancell?ations?|cancell?ed|pending)\b/i.test(text));
const resumeFields=source=>taskBlocks(source).some(text=>/\b(?:resume|résumé)\s+(?:data|details|facts|information)\b|\b(?:my|your|their|the)\s+(?:resume|résumé)(?=\W|$)|\bcurriculum vitae\b/i.test(text)&&/\b(?:fill(?:ing)?|enter(?:ing)?|copy(?:ing)?|map(?:ping)?|transfer(?:ring)?)\b/i.test(text)&&/\b(?:forms?|fields?|applications?)\b/i.test(text));
// Match operations in retained task prose, not titles, generic file mentions,
// or ordinary repetition. These schedule documentation reads, never approval.
const csvExtraction=source=>taskBlocks(source).some(text=>/\bcsv\b/i.test(text)&&/\b(?:pars(?:e|es|ed|ing)|extract(?:s|ed|ing)?|read(?:s|ing)?|import(?:s|ed|ing)?|convert(?:s|ed|ing)?)\b/i.test(text)&&/\b(?:files?|rows?|data|sheets?|json|binary|workflow|records?)\b/i.test(text));
const persistentDuplicates=source=>taskBlocks(source).some(text=>/\b(?:files?|rows?|records?|items?)\b/i.test(text)&&/\b(?:duplicates?|deduplicat\w*|dedup\w*|twice|again)\b/i.test(text)&&(/\b(?:previous|earlier)\s+(?:runs?|executions?)\b|\bacross\s+(?:workflow\s+)?(?:runs?|executions?)\b/i.test(text)||/\b(?:same|duplicate)\s+(?:file|row|record|item)\b.{0,50}\b(?:twice|again)\b/i.test(text)||/\b(?:workflow|trigger)\b.{0,140}\b(?:twice|again|duplicates?)\b/i.test(text)&&/\b(?:fires?|firing|process(?:ed|es|ing)?|reads?|reading|grabs?|grabbing|imports?|importing|runs?|running)\b/i.test(text)));
// An advertised service list is still independently assessed as source text,
// but must not consume the scarce implementation reads for actual task requests.
// Keep this selection-only: old reference identities remain verifiable.
const serviceOffer=source=>taskBlocks(source).some(text=>/\bwhat I can help with\b|\bI(?:['’]m| am) available to help\b/i.test(text));
export const hasDiscussionImplementationReference=source=>!!source&&['implementationReferenceVersion','implementationSelectionVersion','implementationReferenceId','supportsDemandSourceIds'].some(key=>Object.hasOwn(source,key));
function discussion(source){
 const definition=definitions.find(row=>row.id===source?.registrySourceId);
 return !!definition&&source.role==='demand'&&source.demand===true&&source.discussionMetadataVersion===1&&source.enriched===true&&['demand-notice','discussion-post'].includes(source.evidenceKind)&&source.demandEvidence?.kind==='community_request'&&typeof source.text==='string'&&source.text.length>=25&&source.text.length<=200&&source.productUrl===source.url&&source.id===hash(source.url)&&discussionPostURL(definition,source.url)===source.url&&Number.isFinite(Date.parse(source.fetchedAt))&&Number.isFinite(Date.parse(source.verifiedAt))&&(source.nativeReadingContext===undefined||definition.kind==='discourse-discussion'&&nativeReadingContextReasons(source).length===0);
}
// These are forum form labels, not reports of an error. Remove them only from
// the retrieval matcher view; the sealed source and every literal quote stay
// byte-for-byte unchanged. Do not join separate spans to invent an error task.
const selectionText=text=>String(text||'').replace(/\bError messages or input\/output bundles\b|\bScreenshots\s*\(scenario flow,\s*module settings,\s*errors\)|\bWhat is the error message\s*\(if any\)\??/gi,' ');
function matches(reference,source,{selection=false}={}){
 if(!discussion(source)||new URL(source.url).origin!==reference.communityOrigin)return false;
 const blocks=taskBlocks(source).map(selection?selectionText:text=>String(text||''));
 const text=[...(selection?[]:[source.title]),...blocks].join(' ');
 if(reference.id==='n8n-summarize-records-v1')return /\b(?:count|counts|counting|how many)\b/i.test(text)&&/\b(?:tickets?|records?|rows?|items?|orders?|entries)\b/i.test(text)||orderSummary(source);
 if(reference.id==='n8n-resume-schema-v1')return resumeFields(source);
 if(reference.id==='n8n-csv-extraction-v1')return csvExtraction(source);
 if(reference.id==='n8n-persistent-deduplication-v1')return persistentDuplicates(source);
 if(reference.id==='n8n-if-conditions-v1')return /\bif\s+node\b|\bconditional(?:ly)?\b.{0,45}\b(?:branch\w*|rout\w*|split\w*)\b/i.test(text);
 if(reference.id==='n8n-code-data-v1')return /\bcode\s+node\b(?!\.?(?:js|javascript)\b)/i.test(text);
 if(reference.id==='make-mapping-arrays-v1')return /\bmap(?:ping|ped|s)?\b/i.test(text)&&/\barrays?\b|\binvoice\s+rows?\b/i.test(text);
 const errorTask=value=>/\b(?:debug|debugging|troubleshoot|troubleshooting|errors?|fix|repair|broken|fail(?:s|ed|ing|ure)?|finish)\b/i.test(value)&&/\b(?:existing|scenario|workflow|automation|build)\b/i.test(value);
 return reference.id==='make-existing-workflow-errors-v1'&&(selection?blocks.some(errorTask):errorTask(text));
}

// Validate the exact fixed identity before a checker retains or rereads a
// support reference. When fresh demands are available, recheck every binding.
export function discussionImplementationReference(source,{demandSources}={}){
 const reference=DISCUSSION_IMPLEMENTATION_CATALOG.find(row=>row.id===source?.implementationReferenceId);
 if(!reference||source.implementationReferenceVersion!==1||source.implementationSelectionVersion!==undefined&&source.implementationSelectionVersion!==2||source.role!=='building'||source.demand!==false||source.url!==reference.url||source.productUrl!==reference.url||source.id!==hash(reference.url)||!Array.isArray(source.originSourceIds)||source.originSourceIds.length||!Array.isArray(source.supportsDemandSourceIds)||source.supportsDemandSourceIds.length<1||source.supportsDemandSourceIds.length>10||source.supportsDemandSourceIds.some(id=>typeof id!=='string'||!/^[a-f0-9]{24}$/.test(id))||new Set(source.supportsDemandSourceIds).size!==source.supportsDemandSourceIds.length)return null;
 // Historical receipts keep their original match contract. New references
 // carry the stricter selection version through fresh checking/publication.
 if(demandSources!==undefined&&(!Array.isArray(demandSources)||demandSources.length>12||source.supportsDemandSourceIds.some(id=>!demandSources.some(demand=>demand.id===id&&matches(reference,demand,{selection:source.implementationSelectionVersion===2})))))return null;
 return reference;
}
export function selectDiscussionImplementationReferences(demandSources,{limit=2,priorityDemandSourceId=null,priorityReferenceIds=null,excludePriorityReferenceIds=[]}={}){
 if(!Array.isArray(demandSources)||demandSources.length>10||!Number.isInteger(limit)||limit<0||limit>2)return [];
 const available=DISCUSSION_IMPLEMENTATION_CATALOG.map((reference,index)=>{
  const supportsDemandSourceIds=[...new Set(demandSources.filter(source=>matches(reference,source,{selection:true})&&!serviceOffer(source)&&!(source.id===priorityDemandSourceId&&excludePriorityReferenceIds.includes(reference.id))).map(source=>source.id))].sort();
  const specificity=reference.id==='make-existing-workflow-errors-v1'?1:2;
  return supportsDemandSourceIds.length?{index,reference,supportsDemandSourceIds,specificity}:null;
 }).filter(Boolean),selected=[],covered=new Set();
 // Cover another assigned task before spending the second slot on a companion
 // reference for an already covered task. Prefer a concrete operation over a
 // generic debugging fallback on equal coverage; catalog order is the last tie.
 while(selected.length<limit&&available.length){
  const uncovered=row=>row.supportsDemandSourceIds.filter(id=>!covered.has(id)).length;
  const prioritized=row=>priorityDemandSourceId&&row.supportsDemandSourceIds.includes(priorityDemandSourceId)&&(!priorityReferenceIds||priorityReferenceIds.includes(row.reference.id))?(priorityReferenceIds?priorityReferenceIds.length-priorityReferenceIds.indexOf(row.reference.id):1):0;
  available.sort((a,b)=>prioritized(b)-prioritized(a)||uncovered(b)-uncovered(a)||b.specificity-a.specificity||b.supportsDemandSourceIds.length-a.supportsDemandSourceIds.length||a.index-b.index);
  const {reference,supportsDemandSourceIds}=available.shift();
  selected.push({id:hash(reference.url),url:reference.url,productUrl:reference.url,title:reference.title,role:'building',demand:false,originSourceIds:[],implementationReferenceVersion:1,implementationSelectionVersion:2,implementationReferenceId:reference.id,supportsDemandSourceIds});
  supportsDemandSourceIds.forEach(id=>covered.add(id));
 }
 return selected;
}

// A fixed task match must survive the fetched literal section. In particular,
// Summarize's unrelated output-format paragraph cannot prove its Count option.
export function extractDiscussionImplementationEvidence(source,raw,options={}){
 const reference=discussionImplementationReference(source,options);if(!reference)return null;
 const matchers={
  'n8n-summarize-records-v1':text=>/\bCount\s*:\s*Count the total number of values in your input data\./i.test(text),
  'make-existing-workflow-errors-v1':text=>/\b(?:error handlers?|error handling|incomplete executions?|retry)\b/i.test(text)&&/\b(?:handle|retry|schedule|recover|resolve|configure|process|execute|execution|continue|stop)\w*\b/i.test(text),
  'n8n-if-conditions-v1':text=>/\bIf node\b/i.test(text)&&/\bsplit (?:a )?workflow conditionally\b|\bcomparison operations?\b/i.test(text),
  'n8n-code-data-v1':text=>/\bCode node\b/i.test(text)&&/\b(?:JavaScript|Python)\b/i.test(text)&&/\b(?:run\w*|transform\w*|logic)\b/i.test(text),
  'make-mapping-arrays-v1':text=>/\bmap(?:ping|ped|s)?\b/i.test(text)&&/\barrays?\b/i.test(text)&&/\b(?:index|indices|elements?|items?)\b/i.test(text),
  'n8n-resume-schema-v1':text=>/\b(?:extract structured information|input text to extract information|Define using JSON Schema)\b/i.test(text),
  'n8n-csv-extraction-v1':text=>/\bExtract (?:from|From) CSV\b/i.test(text)&&/\boutputs?\b.{0,80}\bJSON\b.{0,30}\brow\b/i.test(text),
  'n8n-persistent-deduplication-v1':text=>/\bRemove Items Processed in Previous Executions\b/i.test(text)&&/\bcompares?\b.{0,100}\bprevious executions\b/i.test(text),
 };
 const matchBlock=matchers[reference.id];if(!matchBlock)return null;
 // A status-summary match needs Count and grouping in one retained literal
 // range. Schema extraction needs the text input and output-schema controls.
 // Neither range establishes a working integration or model accuracy.
 const groupedSummary=reference.id==='n8n-summarize-records-v1'&&options.demandSources?.some(demand=>source.supportsDemandSourceIds.includes(demand.id)&&orderSummary(demand));
 const matchRange=groupedSummary?text=>/\bCount\s*:\s*Count the total number of values in your input data\./i.test(text)&&/\bFields to Split By\b/i.test(text)&&/\b(?:group by|separate summaries)\b/i.test(text):reference.id==='n8n-resume-schema-v1'?text=>/\b(?:input text|extract structured information)\b/i.test(text)&&/\bDefine using JSON Schema\b/i.test(text):reference.id==='n8n-persistent-deduplication-v1'?text=>/\bRemove Items Processed in Previous Executions\b/i.test(text)&&/\bValue Is New\b/i.test(text)&&/\bValue to Dedupe On\b/i.test(text)&&/\bunique ID\b/i.test(text):undefined;
 return extractImplementationEvidence(raw,{...options,maxCharacters:Math.min(options.maxCharacters??8000,8000),minCharacters:100,matchBlock,matchRange});
}
