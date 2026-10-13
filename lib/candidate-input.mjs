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
// Retrieval hints only: these labels neither establish demand nor change a score.
// The fixed bilingual terms connect the supported Swedish notices to references
// already fetched in English. Exact source objects and identities stay intact.
const BUILDING_TOPICS=[
 /faktur|invoice|billing|payment|betalning/i,
 /dokument|document|\bpdf\b|arkiv|archiv|filing|registrering|\brecord(?:s|keeping)?\b/i,
 /rapport|report|statistik|statistic/i,
 /schem|bokning|boka\b|möte|meeting|calendar|appointment/i,
 /\bmail|e-mail|email|e-post/i,
 /spreadsheet|\bcsv\b|sheets?\b|kalkyl/i,
 /bokför|accounting|reconcil|expense|receipt|kvitto/i,
];
export function selectBuildingReferences(sources,demandSources,{limit=8}={}){
 const cap=Math.max(0,Math.min(8,Math.floor(Number(limit)||0)));
 const candidates=sources.filter(source=>source.role!=='demand'&&!source.demand);
 const demandText=demandSources.map(source=>Array.isArray(source.taskExcerpts)&&source.taskExcerpts.length?source.taskExcerpts.join(' '):[source.title,source.text].filter(Boolean).join(' ')).join(' ');
 const topics=BUILDING_TOPICS.filter(pattern=>pattern.test(demandText));
 if(!topics.length)return candidates.slice(0,cap);
 const ranked=candidates.map((source,index)=>{
  const heading=[source.title,source.url,source.productUrl].filter(Boolean).join(' '),body=String(source.text||'').slice(0,12000);
  const headingMatches=topics.filter(pattern=>pattern.test(heading)).length;
  const score=headingMatches*2+topics.filter(pattern=>pattern.test(body)).length;
  let host;try{host=new URL(source.url).hostname.replace(/^www\./,'');}catch{host='unknown';}
  return {source,index,score,headingMatches,host};
 }).sort((a,b)=>b.score-a.score||a.index-b.index);
 const direct=ranked.filter(item=>item.headingMatches>0),bodyOnly=ranked.filter(item=>item.score>0&&!item.headingMatches),chosen=[],seen=new Set(),hosts=new Map();
 // First offer two relevant references per host, then fill with the strongest
 // remaining matches. A task-specific title/URL comes before a broad page with
 // a match buried in its body. Unrelated items only fill unused capacity.
 const take=(items,hostCap)=>{for(const item of items){if(chosen.length>=cap)break;if(seen.has(item.index)||(hosts.get(item.host)||0)>=hostCap)continue;chosen.push(item.source);seen.add(item.index);hosts.set(item.host,(hosts.get(item.host)||0)+1);}};
 take(direct,2);take(direct,Infinity);take(bodyOnly,2);take(bodyOnly,Infinity);take(ranked.filter(item=>!item.score),Infinity);
 return chosen;
}
export function writerResearchView(snapshot){
 const observations=snapshot?.enrichment?.observations;
 if(snapshot?.enrichment?.status==='not_requested'||!Array.isArray(observations))return snapshot;
 const ids=new Set(observations.flatMap(item=>[...(item.originSourceIds||[]),...(item.evidenceIds||[])]));
 const selected=snapshot.sources.filter(source=>ids.has(source.id));
 const building=snapshot.learningSelection?selectBuildingReferences(snapshot.sources.filter(source=>!ids.has(source.id)),selected.filter(source=>source.role==='demand'&&source.demand)):[];
 return {...snapshot,sources:[...selected,...building],writerView:{originalSourceCount:snapshot.sources.length,selectionOnly:true,note:snapshot.learningSelection?'Selected public demand notices identify the customer. Up to eight already-fetched building references are chosen for task overlap and source-host variety. Building references only describe possible implementation; they establish no customer demand.':'Only selected lead discovery and primary evidence. The immutable full snapshot remains the checker and attribution input.'}};
}
