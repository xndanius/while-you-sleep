import {promises as fs,constants} from 'node:fs';
import path from 'node:path';
import {hash,sha256,stableJSON,canonicalURL} from './storage.mjs';
import {validateSourceScanReceipt} from './source-registry.mjs';
import {DISCUSSION_SOURCE_CATALOG,discussionSourceDefinition,discussionPostURL,makeDiscussionSource} from './discussion-sources.mjs';
import {privateArtifactReasons} from './privacy.mjs';

export const DISCUSSION_DISCOVERY_POLICY=Object.freeze({version:1,maxAgeHours:24,maxSnapshots:48,maxCarryoverSources:80,maxCombinedSources:800,maxFileBytes:3*1024*1024});
const recordKeys=['sourceId','url','textSha256','observedAt','sourceRunId','sourceSnapshotSha256','sourceScanSha256','feedIds'];
const runPattern=/^research-([1-9]\d{0,15})-([1-9]\d{0,3})$/;
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const id=value=>typeof value==='string'&&/^[a-f0-9]{24}$/.test(value);
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const same=(a,b)=>stableJSON(a)===stableJSON(b);
const definitionMatches=(a,b)=>a?.id===b?.id&&a?.kind===b?.kind&&a?.url===b?.url;
const unique=values=>[...new Set(values)].sort();
const nativeURL=url=>typeof url==='string'&&DISCUSSION_SOURCE_CATALOG.some(definition=>discussionPostURL(definition,url)===url);

// This validates only the inventory, not the historical files or fresh primary
// evidence. Call verifyDiscussionDiscovery before trusting saved provenance.
export function discussionDiscoveryReasons(provenance){
 const error=['Discussion discovery provenance has invalid shape or bounds.'];
 if(!exact(provenance,['version','records'])||provenance.version!==1||!Array.isArray(provenance.records)||provenance.records.length>DISCUSSION_DISCOVERY_POLICY.maxCarryoverSources)return error;
 const records=provenance.records;
 if(records.some(row=>!exact(row,recordKeys)||!id(row.sourceId)||!nativeURL(row.url)||canonicalURL(row.url)!==row.url||row.sourceId!==hash(row.url)||!hex(row.textSha256)||!stamp(row.observedAt)||!runPattern.test(row.sourceRunId)||!hex(row.sourceSnapshotSha256)||!hex(row.sourceScanSha256)||!Array.isArray(row.feedIds)||!row.feedIds.length||row.feedIds.length>20||row.feedIds.some(value=>!id(value)||!DISCUSSION_SOURCE_CATALOG.some(definition=>definition.id===value))||new Set(row.feedIds).size!==row.feedIds.length))return error;
 if(new Set(records.map(row=>row.sourceId)).size!==records.length||new Set(records.map(row=>row.url)).size!==records.length||new Set(records.map(row=>row.sourceRunId)).size>DISCUSSION_DISCOVERY_POLICY.maxSnapshots)return error;
 return privateArtifactReasons(provenance).length?['Discussion discovery provenance is not privacy-safe.']:[];
}

async function directories(root){
 const base=path.resolve(root),names=[base,path.join(base,'data'),path.join(base,'data','research'),path.join(base,'data','source-scans')];
 try{for(const name of names){const stat=await fs.lstat(name);if(!stat.isDirectory()||stat.isSymbolicLink())return null;}return base;}catch{return null;}
}
async function readBounded(file){
 let handle;
 try{
  handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);const before=await handle.stat();
  if(!before.isFile()||before.size<2||before.size>DISCUSSION_DISCOVERY_POLICY.maxFileBytes)return null;
  const bytes=await handle.readFile(),after=await handle.stat(),text=bytes.toString('utf8');
  if(bytes.length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||!bytes.equals(Buffer.from(text,'utf8')))return null;
  return JSON.parse(text);
 }catch{return null;}finally{await handle?.close();}
}
function allowedDefinitions(definitions,selection){
 if(!Array.isArray(definitions)||definitions.length>20||!selection||!Array.isArray(selection.demandSourceIds)||selection.demandSourceIds.length>20||new Set(selection.demandSourceIds).size!==selection.demandSourceIds.length)throw new Error('Discussion discovery needs bounded current selected feed definitions.');
 const selected=new Set(selection.demandSourceIds),allowed=new Map();
 for(const definition of definitions){
  const known=discussionSourceDefinition(definition);
  if(!known||known.kind==='provider-discussion'||!selected.has(known.id)||definition.status!==undefined&&!['active','probation'].includes(definition.status))continue;
  if(allowed.has(known.id))throw new Error('Discussion discovery selected definitions are ambiguous.');
  allowed.set(known.id,known);
 }
 return allowed;
}
function clock(now){const value=new Date(now).getTime();if(!Number.isFinite(value))throw new Error('Discussion discovery needs a valid comparison time.');return value;}
function recent(value,now){return stamp(value)&&Date.parse(value)<=now&&Date.parse(value)>=now-DISCUSSION_DISCOVERY_POLICY.maxAgeHours*3600000;}
async function readPair(base,runId,{allowed,selection,now}){
 if(!runPattern.test(runId))return null;
 const [snapshot,scan]=await Promise.all([readBounded(path.join(base,'data','research',runId+'.json')),readBounded(path.join(base,'data','source-scans',runId+'.json'))]);
 if(!snapshot||!scan||snapshot.id!==runId||snapshot.runId!==runId||snapshot.createdAt!==scan.createdAt||!recent(snapshot.createdAt,now)||snapshot.enrichment?.status!=='not_requested'||snapshot.enrichment.selected!==0||snapshot.enrichment.attempted!==0||snapshot.enrichment.fetched!==0||snapshot.enrichment.failed!==0||!Array.isArray(snapshot.enrichment.observations)||snapshot.enrichment.observations.length||!Array.isArray(snapshot.sources)||snapshot.sources.length>800||validateSourceScanReceipt(scan,{runId}).length||scan.sourceSnapshotSha256!==sha256(stableJSON(snapshot.sources))||!same(snapshot.health,scan.observations))return null;
 const sourceScanSha256=sha256(stableJSON(scan)),records=[];
 for(const source of snapshot.sources){
  const definition=allowed.get(source?.registrySourceId);
  if(!definition||!scan.definitions.some(row=>definitionMatches(row,definition))||!recent(source.fetchedAt,now)||Date.parse(source.fetchedAt)<Date.parse(snapshot.createdAt)||typeof source.text!=='string'||source.text.length<25||source.text.length>200||typeof source.title!=='string'||source.title.trim().toLowerCase().startsWith(source.text.trim().toLowerCase())||privateArtifactReasons(source).length||Array.isArray(selection.eligibleSegments)&&!selection.eligibleSegments.includes(source.segment))continue;
  const expected=makeDiscussionSource(definition,{url:source.url,title:source.title,text:source.text,postedAt:source.postedAt},{fetchedAt:source.fetchedAt});
  if(!expected||source.discussionBodyVersion!==undefined&&source.discussionBodyVersion!==1||Object.keys(source).some(key=>!Object.hasOwn(expected,key)&&!['originFeedIds','discussionBodyVersion'].includes(key))||Object.keys(expected).some(key=>!same(source[key],expected[key])))continue;
  const metadata=scan.sources.find(row=>row.id===source.id&&row.url===source.url&&row.productUrl===source.productUrl&&row.textSha256===sha256(source.text));
  const origins=scan.originMap.filter(row=>row.sourceId===source.id&&row.url===source.url&&row.productUrl===source.productUrl),originalFeedIds=unique(origins.flatMap(row=>row.feedIds));
  if(!metadata||!originalFeedIds.includes(definition.id)||source.originFeedIds!==undefined&&(!Array.isArray(source.originFeedIds)||!same(unique(source.originFeedIds),originalFeedIds)))continue;
  const feedIds=originalFeedIds.filter(feedId=>allowed.has(feedId)&&scan.definitions.some(row=>definitionMatches(row,allowed.get(feedId))));
  if(!feedIds.length)continue;
  records.push({source:{...structuredClone(source),discussionBodyVersion:1},origin:{sourceId:source.id,url:source.url,productUrl:source.productUrl,feedIds},provenance:{sourceId:source.id,url:source.url,textSha256:sha256(source.text),observedAt:source.fetchedAt,sourceRunId:runId,sourceSnapshotSha256:scan.sourceSnapshotSha256,sourceScanSha256,feedIds}});
 }
 return {createdAt:snapshot.createdAt,records};
}

export async function loadDiscussionDiscovery(root,{currentSources=[],currentOriginMap=[],definitions,selection,now=new Date()}={}){
 if(!Array.isArray(currentSources)||currentSources.length>800||!Array.isArray(currentOriginMap)||currentOriginMap.length>800)throw new Error('Discussion discovery current inputs exceed their fixed bound.');
 const output={sources:[...currentSources],originMap:[...currentOriginMap],provenance:{version:1,records:[]}},allowed=allowedDefinitions(definitions,selection),at=clock(now),base=await directories(root);
 if(!base||!allowed.size)return output;
 const entries=await fs.readdir(path.join(base,'data','research'),{withFileTypes:true});
 const names=entries.filter(entry=>entry.isFile()&&runPattern.test(entry.name.replace(/\.json$/,''))&&entry.name.endsWith('.json')).map(entry=>entry.name.slice(0,-5)).sort((a,b)=>{const am=a.match(runPattern),bm=b.match(runPattern);return BigInt(am[1])===BigInt(bm[1])?Number(bm[2])-Number(am[2]):BigInt(am[1])>BigInt(bm[1])?-1:1;}).slice(0,48);
 const pairs=(await Promise.all(names.map(name=>readPair(base,name,{allowed,selection,now:at})))).filter(Boolean).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const ids=new Set(currentSources.map(source=>source.id)),urls=new Set(currentSources.map(source=>source.url));
 for(const pair of pairs)for(const row of pair.records){
  if(output.provenance.records.length>=80||output.sources.length>=800||output.originMap.length>=800)return output;
  if(ids.has(row.source.id)||urls.has(row.source.url))continue;
  ids.add(row.source.id);urls.add(row.source.url);output.sources.push(row.source);output.originMap.push(row.origin);output.provenance.records.push(row.provenance);
 }
 return output;
}

export async function verifyDiscussionDiscovery(root,provenance,{definitions,selection,now=new Date()}={}){
 const errors=discussionDiscoveryReasons(provenance);if(errors.length||!provenance.records.length)return errors;
 let allowed,at;try{allowed=allowedDefinitions(definitions,selection);at=clock(now);}catch{return ['Discussion discovery current authority is invalid.'];}
 const base=await directories(root);if(!base)return ['Discussion discovery original directories are unavailable.'];
 const pairs=new Map();for(const runId of unique(provenance.records.map(row=>row.sourceRunId)))pairs.set(runId,await readPair(base,runId,{allowed,selection,now:at}));
 for(const row of provenance.records){const original=pairs.get(row.sourceRunId)?.records.find(item=>item.source.id===row.sourceId);if(!original||!same(original.provenance,row))return ['Discussion discovery provenance does not match available original bounded evidence.'];}
 return [];
}
