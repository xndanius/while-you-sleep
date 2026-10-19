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
 /\b(?:support tickets?|customer (?:support|repl(?:y|ies))|support (?:inbox|repl(?:y|ies)|responses?)|helpdesk|ticket (?:triage|routing|repl(?:y|ies)))\b/i,
 /\b(?:order (?:processing|tracking|management|status|fulfill?ment)|(?:process|track|manage|fulfil|fulfill|export|import|sync) (?:customer )?orders)\b/i,
 /\b(?:inventory|stock levels?|stock control)\b/i,
 /\b(?:shipping|shipments?|delivery tracking|tracking numbers?)\b/i,
 /\b(?:marketing|campaigns?|crm|customer relationship management|lead (?:generation|qualification|follow[- ]?up))\b/i,
];
export function selectBuildingReferences(sources,demandSources,{limit=8,matchedOnly=false}={}){
 const cap=Math.max(0,Math.min(8,Math.floor(Number(limit)||0)));
 const candidates=sources.filter(source=>source.role!=='demand'&&!source.demand);
 const demandText=demandSources.map(source=>Array.isArray(source.taskExcerpts)&&source.taskExcerpts.length?source.taskExcerpts.join(' '):[source.title,source.text].filter(Boolean).join(' ')).join(' ');
 const topics=BUILDING_TOPICS.filter(pattern=>pattern.test(demandText));
 if(!topics.length)return matchedOnly?[]:candidates.slice(0,cap);
 const ranked=candidates.map((source,index)=>{
  const heading=[source.title,source.url,source.productUrl].filter(Boolean).join(' '),body=String(source.text||'').slice(0,12000);
  const headingMatches=topics.filter(pattern=>pattern.test(heading)).length;
  const score=headingMatches*2+topics.filter(pattern=>pattern.test(body)).length;
  let host;try{host=new URL(source.url).hostname.replace(/^www\./,'');}catch{host='unknown';}
  return {source,index,score,headingMatches,host};
 }).filter(item=>!matchedOnly||item.score>0).sort((a,b)=>b.score-a.score||a.index-b.index);
 const direct=ranked.filter(item=>item.headingMatches>0),bodyOnly=ranked.filter(item=>item.score>0&&!item.headingMatches),chosen=[],seen=new Set(),hosts=new Map();
 // First offer two relevant references per host, then fill with the strongest
 // remaining matches. A task-specific title/URL comes before a broad page with
 // a match buried in its body. Unrelated items only fill unused capacity.
 const take=(items,hostCap)=>{for(const item of items){if(chosen.length>=cap)break;if(seen.has(item.index)||(hosts.get(item.host)||0)>=hostCap)continue;chosen.push(item.source);seen.add(item.index);hosts.set(item.host,(hosts.get(item.host)||0)+1);}};
 take(direct,2);take(direct,Infinity);take(bodyOnly,2);take(bodyOnly,Infinity);take(ranked.filter(item=>!item.score),Infinity);
 return chosen;
}
