import {sourceRole} from './demand-sources.mjs';
import {privateArtifactCategories,privateArtifactReasons,PRIVACY_CATEGORIES} from './privacy.mjs';

const policy='whole-unsafe-building-record-omission';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const count=value=>Number.isInteger(value)&&value>=0;
function buildingOrigins(source,originMap,definitions,originalSources=[]){
 if(source.role==='demand'||source.demand===true)return [];
 const ids=new Set(originMap.filter(origin=>origin.sourceId===source.id).flatMap(origin=>origin.feedIds));
 for(const id of source.originSourceIds||[])for(const original of originalSources.filter(row=>row.id===id)){
  if(original.role==='demand'||original.demand===true)return [];
  for(const origin of originMap.filter(row=>row.sourceId===original.id))for(const feedId of origin.feedIds)ids.add(feedId);
 }
 return ids.size&&[...ids].every(id=>definitions.some(definition=>definition.id===id&&sourceRole(definition)==='building'))?[...ids]:[];
}

// Discard entire records, before any seal or write. Safe records keep their exact
// text/IDs; demand and unknown-origin records remain subject to the strict guard.
export function retainSafeBuildingScan(result,definitions){
 const omitted=new Map();
 for(const source of result.sources){const categories=privateArtifactCategories(source);if(categories.length&&buildingOrigins(source,result.originMap,definitions).length)omitted.set(source.id,categories);}
 if(!omitted.size)return result;
 const originMap=result.originMap.filter(origin=>!omitted.has(origin.sourceId));
 const observations=result.observations.map(observation=>({...observation,retainedItemCount:originMap.filter(origin=>origin.feedIds.includes(observation.feedId)).length,omittedItemCount:result.originMap.filter(origin=>omitted.has(origin.sourceId)&&origin.feedIds.includes(observation.feedId)).length}));
 const byFeed=observations.filter(observation=>observation.omittedItemCount).map(observation=>{
  const counts=new Map();for(const origin of result.originMap.filter(origin=>omitted.has(origin.sourceId)&&origin.feedIds.includes(observation.feedId)))for(const category of omitted.get(origin.sourceId))counts.set(category,(counts.get(category)||0)+1);
  return {feedId:observation.feedId,fetchedItemCount:observation.itemCount,retainedItemCount:observation.retainedItemCount,omittedItemCount:observation.omittedItemCount,categories:[...counts].sort(([a],[b])=>a.localeCompare(b)).map(([category,count])=>({category,count}))};
 });
 const privacyOmissions={schema:1,phase:'scan',policy,fetchedItemCount:observations.reduce((sum,row)=>sum+row.itemCount,0),retainedItemCount:observations.reduce((sum,row)=>sum+row.retainedItemCount,0),omittedItemCount:observations.reduce((sum,row)=>sum+row.omittedItemCount,0),uniqueOmittedRecords:omitted.size,byFeed};
 return {...result,sources:result.sources.filter(source=>!omitted.has(source.id)),observations,originMap,privacyOmissions};
}

export function retainSafeBuildingEnrichment(sources,scan,definitions){
 const omitted=new Map(),retained=[];
 for(const source of sources){const categories=privateArtifactCategories(source),feedIds=categories.length?buildingOrigins(source,scan.originMap,definitions,scan.sources):[];
  if(!feedIds.length){retained.push(source);continue;}
  for(const feedId of feedIds){if(!omitted.has(feedId))omitted.set(feedId,{omittedItemCount:0,categories:new Map()});const row=omitted.get(feedId);row.omittedItemCount++;for(const category of categories)row.categories.set(category,(row.categories.get(category)||0)+1);}
 }
 if(retained.length===sources.length)return {sources};
 return {sources:retained,privacyOmissions:{schema:1,phase:'enrichment',policy,uniqueOmittedRecords:sources.length-retained.length,byFeed:[...omitted].sort(([a],[b])=>a.localeCompare(b)).map(([feedId,row])=>({feedId,omittedItemCount:row.omittedItemCount,categories:[...row.categories].sort(([a],[b])=>a.localeCompare(b)).map(([category,count])=>({category,count}))}))}};
}

export function scanPrivacyOmissionReasons(receipt){
 try{
  const value=receipt.privacyOmissions,observations=receipt.observations;
  if(value===undefined)return observations.some(row=>row.retainedItemCount!==undefined||row.omittedItemCount!==undefined)?['Source scan retention counts lack their omission contract.']:[];
  const reason=['Source scan privacy omission counts are not bound to the retained evidence.'];
  if(!exact(value,['schema','phase','policy','fetchedItemCount','retainedItemCount','omittedItemCount','uniqueOmittedRecords','byFeed'])||value.schema!==1||value.phase!=='scan'||value.policy!==policy||!['fetchedItemCount','retainedItemCount','omittedItemCount','uniqueOmittedRecords'].every(key=>count(value[key]))||value.omittedItemCount<1||value.uniqueOmittedRecords<1||value.uniqueOmittedRecords>value.omittedItemCount||!Array.isArray(value.byFeed)||!value.byFeed.length||value.byFeed.length>observations.length)return reason;
  if(observations.some(row=>!count(row.retainedItemCount)||!count(row.omittedItemCount)||row.retainedItemCount+row.omittedItemCount!==row.itemCount)||value.fetchedItemCount!==observations.reduce((sum,row)=>sum+row.itemCount,0)||value.retainedItemCount!==observations.reduce((sum,row)=>sum+row.retainedItemCount,0)||value.omittedItemCount!==observations.reduce((sum,row)=>sum+row.omittedItemCount,0)||new Set(value.byFeed.map(row=>row.feedId)).size!==value.byFeed.length)return reason;
  for(const row of value.byFeed){const observation=observations.find(item=>item.feedId===row.feedId),definition=receipt.definitions.find(item=>item.id===row.feedId);
   if(!exact(row,['feedId','fetchedItemCount','retainedItemCount','omittedItemCount','categories'])||!observation||!definition||sourceRole(definition)!=='building'||row.fetchedItemCount!==observation.itemCount||row.retainedItemCount!==observation.retainedItemCount||row.omittedItemCount!==observation.omittedItemCount||row.omittedItemCount<1||!Array.isArray(row.categories)||!row.categories.length||row.categories.length>PRIVACY_CATEGORIES.length||new Set(row.categories.map(item=>item.category)).size!==row.categories.length||row.categories.some(item=>!exact(item,['category','count'])||!PRIVACY_CATEGORIES.includes(item.category)||!count(item.count)||item.count<1||item.count>row.omittedItemCount))return reason;
  }
  if(observations.some(row=>row.omittedItemCount>0&&!value.byFeed.some(item=>item.feedId===row.feedId))||privateArtifactReasons(value).length)return reason;
  return [];
 }catch{return ['Source scan privacy omission counts are malformed.'];}
}
