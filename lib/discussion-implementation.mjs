import {hash} from './storage.mjs';
import {DISCUSSION_SOURCE_CATALOG,DISCUSSION_PROVIDER_CATALOG,discussionPostURL} from './discussion-sources.mjs';
import {extractImplementationEvidence} from './implementation-evidence.mjs';

// Fixed first-party documentation for the two observed task shapes. Matching
// only schedules a guarded read; it establishes no demand, capability or score.
export const DISCUSSION_IMPLEMENTATION_CATALOG=Object.freeze([
 Object.freeze({id:'n8n-summarize-records-v1',url:'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.summarize',title:'n8n Summarize node documentation',communityOrigin:'https://community.n8n.io'}),
 Object.freeze({id:'make-existing-workflow-errors-v1',url:'https://help.make.com/Overview-of-error-handling',title:'Make error handling documentation',communityOrigin:'https://community.make.com'}),
]);
const definitions=[...DISCUSSION_SOURCE_CATALOG,...DISCUSSION_PROVIDER_CATALOG];
export const hasDiscussionImplementationReference=source=>!!source&&['implementationReferenceVersion','implementationReferenceId','supportsDemandSourceIds'].some(key=>Object.hasOwn(source,key));
function discussion(source){
 const definition=definitions.find(row=>row.id===source?.registrySourceId);
 return !!definition&&source.role==='demand'&&source.demand===true&&source.discussionMetadataVersion===1&&source.enriched===true&&['demand-notice','discussion-post'].includes(source.evidenceKind)&&source.demandEvidence?.kind==='community_request'&&typeof source.text==='string'&&source.text.length>=25&&source.text.length<=200&&source.productUrl===source.url&&source.id===hash(source.url)&&discussionPostURL(definition,source.url)===source.url&&Number.isFinite(Date.parse(source.fetchedAt))&&Number.isFinite(Date.parse(source.verifiedAt));
}
function matches(reference,source){
 if(!discussion(source)||new URL(source.url).origin!==reference.communityOrigin)return false;
 const text=[source.title,source.text].join(' ');
 if(reference.id==='n8n-summarize-records-v1')return /\b(?:count|counts|counting|how many)\b/i.test(text)&&/\b(?:tickets?|records?|rows?|items?|orders?|entries)\b/i.test(text);
 return /\b(?:debug|debugging|troubleshoot|troubleshooting|errors?|fix|repair|broken|fail(?:s|ed|ing|ure)?|finish)\b/i.test(text)&&/\b(?:existing|scenario|workflow|automation|build)\b/i.test(text);
}

// Validate the exact fixed identity before a checker retains or rereads a
// support reference. When fresh demands are available, recheck every binding.
export function discussionImplementationReference(source,{demandSources}={}){
 const reference=DISCUSSION_IMPLEMENTATION_CATALOG.find(row=>row.id===source?.implementationReferenceId);
 if(!reference||source.implementationReferenceVersion!==1||source.role!=='building'||source.demand!==false||source.url!==reference.url||source.productUrl!==reference.url||source.id!==hash(reference.url)||!Array.isArray(source.originSourceIds)||source.originSourceIds.length||!Array.isArray(source.supportsDemandSourceIds)||source.supportsDemandSourceIds.length<1||source.supportsDemandSourceIds.length>10||source.supportsDemandSourceIds.some(id=>typeof id!=='string'||!/^[a-f0-9]{24}$/.test(id))||new Set(source.supportsDemandSourceIds).size!==source.supportsDemandSourceIds.length)return null;
 if(demandSources!==undefined&&(!Array.isArray(demandSources)||demandSources.length>12||source.supportsDemandSourceIds.some(id=>!demandSources.some(demand=>demand.id===id&&matches(reference,demand)))))return null;
 return reference;
}
export function selectDiscussionImplementationReferences(demandSources,{limit=2}={}){
 if(!Array.isArray(demandSources)||demandSources.length>10||!Number.isInteger(limit)||limit<0||limit>2)return [];
 return DISCUSSION_IMPLEMENTATION_CATALOG.map(reference=>{
  const supportsDemandSourceIds=[...new Set(demandSources.filter(source=>matches(reference,source)).map(source=>source.id))].sort();
  return supportsDemandSourceIds.length?{id:hash(reference.url),url:reference.url,productUrl:reference.url,title:reference.title,role:'building',demand:false,originSourceIds:[],implementationReferenceVersion:1,implementationReferenceId:reference.id,supportsDemandSourceIds}:null;
 }).filter(Boolean).slice(0,limit);
}

// A fixed task match must survive the fetched literal section. In particular,
// Summarize's unrelated output-format paragraph cannot prove its Count option.
export function extractDiscussionImplementationEvidence(source,raw,options={}){
 const reference=discussionImplementationReference(source,options);if(!reference)return null;
 const matchBlock=reference.id==='n8n-summarize-records-v1'?text=>/\bCount\s*:\s*Count the total number of values in your input data\./i.test(text):text=>/\b(?:error handlers?|error handling|incomplete executions?|retry)\b/i.test(text)&&/\b(?:handle|retry|schedule|recover|resolve|configure|process|execute|execution|continue|stop)\w*\b/i.test(text);
 return extractImplementationEvidence(raw,{...options,maxCharacters:Math.min(options.maxCharacters??8000,8000),minCharacters:100,matchBlock});
}
