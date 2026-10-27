import {plainText} from './research.mjs';
import {privateArtifactReasons} from './privacy.mjs';
import {sha256} from './storage.mjs';

export const IMPLEMENTATION_EXCERPT_VERSION=1;
const capability=/\b(?:extracts?|parses?|automates?|routes?|classif(?:y|ies)|exports?|imports?|synchroniz(?:e|es)|syncs?|generates?|schedules?|connects?|integrates?|process(?:es)?|tracks?|converts?|monitors?|updates?|retrieves?|creates?|sends?|receives?|saves?|scans?)\b/i;
const safe=text=>privateArtifactReasons(text).length===0;

// Keep one literal range of the normalized public response. A blocked paragraph
// is never redacted or stitched to another fragment, and remains unavailable.
export function extractImplementationEvidence(raw,{maxCharacters=8000,minCharacters=100,matchBlock,matchRange}={}){
 if(typeof raw!=='string'||raw.length>2000000||!Number.isInteger(maxCharacters)||maxCharacters<minCharacters||maxCharacters>18000||matchBlock!==undefined&&typeof matchBlock!=='function'||matchRange!==undefined&&typeof matchRange!=='function')return null;
 const useful=matchBlock||((text)=>capability.test(text));
 const complete=matchRange||(()=>true);
 const normalized=plainText(raw);if(normalized.length<minCharacters)return null;
 const html=/<(?:html|body|main|article|section|p|div)\b/i.test(raw),clean=raw.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi,''),main=clean.search(/<(?:main|article)\b/i),heading=clean.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/i),boundary=html?(main>=0?main:heading?heading.index+heading[0].length:0):0,blocks=[];let cursor=boundary?plainText(clean.slice(0,boundary)).length:0;
 const pieces=html?[...clean.matchAll(matchBlock?/<(p|pre|li|h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi:/<(p|pre|h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi)].filter(match=>match.index>=boundary).slice(0,400).map(match=>({body:match[2],heading:/^h/.test(match[1])})):raw.split(/\r?\n\s*\r?\n/).slice(0,400).map(body=>({body,heading:/^\s*#/.test(body)}));
 for(const piece of pieces){const text=plainText(piece.body);if(!text)continue;const start=normalized.indexOf(text,cursor);if(start<0)continue;const end=start+text.length;blocks.push({start,end,text,heading:piece.heading,safe:safe(text)&&!(/\bmailto:|<[^\s<>]+@[^\s<>]+>/.test(piece.body))&&(!html?safe(piece.body):true)});cursor=end;}
 if(!blocks.length)blocks.push({start:0,end:normalized.length,text:normalized,heading:false,safe:safe(normalized)});
 const finish=(start,end)=>{const text=normalized.slice(start,end),retained=blocks.filter(block=>block.start<end&&block.end>start).length;return {text,evidenceExtraction:{version:IMPLEMENTATION_EXCERPT_VERSION,normalization:'public-plain-text-v1',rawSha256:sha256(raw),normalizedSha256:sha256(normalized),start,end,fullCharacters:normalized.length,retainedCharacters:text.length,omittedCharacters:normalized.length-text.length,totalBlocks:blocks.length,retainedBlocks:retained,omittedBlocks:blocks.length-retained,unsafeBlocks:blocks.filter(block=>!block.safe).length}};};
 const profileMaterial=/\b(?:created by|written by|about the (?:author|creator)|follow me|creator profile|contributors?|testimonials?)\b/i;
 const metadataLabel=/^(?:last update(?:d)?|last modified|categories?|quick overview|share)(?:\s|$)/i;
 // Check the entire literal range as well as parsed blocks. Text in an
 // unparsed wrapper (for example an aside) cannot bridge two safe paragraphs.
 const rangeSafe=(start,end)=>{
  const text=normalized.slice(start,end),retained=blocks.filter(block=>block.start<end&&block.end>start);
  if(!safe(text)||profileMaterial.test(text)||retained.some(block=>!block.safe||metadataLabel.test(block.text)))return false;
  if(matchRange){
   let covered=start;
   for(const block of retained){if(block.start>covered&&normalized.slice(covered,block.start).trim())return false;covered=Math.max(covered,Math.min(end,block.end));}
   if(normalized.slice(covered,end).trim())return false;
  }
  return true;
 };
 const wholeSafe=!boundary&&rangeSafe(0,normalized.length);
 if(normalized.length<=maxCharacters&&wholeSafe&&useful(normalized)&&complete(normalized))return finish(0,normalized.length);
 if(wholeSafe&&useful(normalized)){const prefix=normalized.slice(0,maxCharacters),boundary=Math.max(prefix.lastIndexOf('. '),prefix.lastIndexOf('! '),prefix.lastIndexOf('? '));if(boundary+1>=minCharacters&&(!matchBlock||useful(normalized.slice(0,boundary+1)))&&complete(normalized.slice(0,boundary+1)))return finish(0,boundary+1);}
 for(let i=0;i<blocks.length;i++){
  if(!blocks[i].safe||blocks[i].heading||metadataLabel.test(blocks[i].text)||profileMaterial.test(blocks[i].text)||!useful(blocks[i].text))continue;
  for(let j=i;j<blocks.length&&blocks[j].safe;j++){
   if(metadataLabel.test(blocks[j].text)||profileMaterial.test(blocks[j].text))break;
   const start=blocks[i].start,end=blocks[j].end;if(end-start>maxCharacters)break;
   const text=normalized.slice(start,end);if(!rangeSafe(start,end))break;
   if(text.length>=minCharacters&&complete(text))return finish(start,end);
  }
 }
 return null;
}
