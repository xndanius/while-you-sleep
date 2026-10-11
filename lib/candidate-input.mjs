import {promises as fs} from 'node:fs';
import path from 'node:path';
import {canonicalURL,sha256,stableJSON} from './storage.mjs';
import {recentProductAssessments,PRODUCT_SELECTION_POLICY} from './product-evidence.mjs';

async function boundedRecord(file){
 try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>3*1024*1024)throw new Error('Candidate history must be a bounded regular file.');return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
export async function candidateHistory(root,now=new Date()){
 let files;try{files=await fs.readdir(path.join(root,'data','runs'));}catch(error){if(error.code==='ENOENT')return {recentAssessments:[],rejections:[]};throw error;}
 const current=new Date(now).getTime(),cutoff=current-24*3600000;
 const runs=(await Promise.all(files.filter(file=>/^loop-\d+-\d+\.json$/.test(file)).sort().reverse().slice(0,PRODUCT_SELECTION_POLICY.maxHistoryRecords).map(file=>boundedRecord(path.join(root,'data','runs',file))))).filter(run=>run?.assessmentOutcome==='completed'&&run.checkedAssessment?.completed===true&&Date.parse(run.checkedAssessment.completedAt)>cutoff&&Date.parse(run.checkedAssessment.completedAt)<=current).slice(0,PRODUCT_SELECTION_POLICY.maxHistoryRuns);
 const [drafts,research,contexts]=await Promise.all(['drafts','research','check-context'].map(directory=>Promise.all(runs.map(run=>boundedRecord(path.join(root,'data',directory,run.id+'.json')))).then(values=>values.filter(Boolean))));
 const recentAssessments=recentProductAssessments({runs,drafts,research,contexts,now}),cooled=new Set(recentAssessments.map(item=>item.runId+'|'+item.productUrl)),rejections=[];
 for(const run of runs){const draft=drafts.find(item=>item.runId===run.id&&sha256(stableJSON(item))===run.checkedAssessment.draftSha256);if(!draft||run.operationalFailures?.length)continue;
  for(const candidate of (draft.candidates||[]).slice(0,12)){if(!candidate.productUrl)continue;rejections.push({runId:run.id,assessedAt:run.checkedAssessment.completedAt,title:candidate.title,productUrl:candidate.productUrl,reason:candidate.reason,writerCriteria:candidate.scoring?.criteria||null,primaryEvidenceFetched:cooled.has(run.id+'|'+canonicalURL(candidate.productUrl)),ratingStatus:'Writer ratings are provisional. The completed batch stamp is not an individual criterion approval.'});}
 }
 return {recentAssessments,rejections:rejections.slice(0,96)};
}
export function writerResearchView(snapshot){
 const observations=snapshot?.enrichment?.observations;
 if(snapshot?.enrichment?.status==='not_requested'||!Array.isArray(observations))return snapshot;
 const ids=new Set(observations.flatMap(item=>[...(item.originSourceIds||[]),...(item.evidenceIds||[])]));
 return {...snapshot,sources:snapshot.sources.filter(source=>ids.has(source.id)),writerView:{originalSourceCount:snapshot.sources.length,selectionOnly:true,note:'Only selected lead discovery and primary evidence. The immutable full snapshot remains the checker and attribution input.'}};
}
