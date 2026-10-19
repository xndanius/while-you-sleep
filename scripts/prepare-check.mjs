import { fetchPublic,sourceRole,sourceSegments,sourceDemandKind,fetchDemandEvidence } from '../lib/research.mjs';
import { ROOT,dataPath, readJSON, writeJSON, records, candidateIdentity, canonicalURL, hash, sha256, stableJSON, safeError } from '../lib/storage.mjs';
import { deterministicCheck } from '../lib/validation.mjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseScoringPolicy } from '../lib/scoring.mjs';
import { validateLoopScheduling } from '../lib/loop-schedule.mjs';
import { sourceEvidenceFetchOptions } from '../lib/product-evidence.mjs';
import {createNoveltyContext} from '../lib/novelty.mjs';
import {createDemandContext,demandContextHash,demandEvidenceReasons,demandContextReasons} from '../lib/demand.mjs';
import {validSourceAdmission} from '../lib/source-registry.mjs';
import {privateArtifactCategories} from '../lib/privacy.mjs';
import {validateLearningSelection} from '../lib/learning.mjs';
import {extractImplementationEvidence} from '../lib/implementation-evidence.mjs';
const runId=process.argv[2];
try{
  const draft=await readJSON(dataPath('drafts',runId));const research=await readJSON(dataPath('research',runId));
  const rules=await fs.readFile(path.join(ROOT,'RULES.md'),'utf8'),rulesSha256=sha256(rules),scoringPolicy=parseScoringPolicy(rules);
  let scheduling;
  if(process.env.LOOP_SCHEDULING_SHA)scheduling=validateLoopScheduling(await readJSON(dataPath('scheduling',runId)),{runId,expectedSha256:process.env.LOOP_SCHEDULING_SHA,eventName:process.env.GITHUB_EVENT_NAME});
  if(process.env.GITHUB_ACTIONS==='true'&&!scheduling)throw new Error('Trusted loop reservation is missing from evidence preparation.');
  const assessmentContractVersion=scheduling?.assessmentContractVersion===1?1:null;
  if(draft.runId!==runId||!Array.isArray(draft.posts)||draft.posts.length<(assessmentContractVersion?0:1)||draft.posts.length>6)throw new Error('Writer output must have matching runId and a bounded assessed post batch.');
  if(scheduling&&draft.targetCount!==scheduling.targetCount)throw new Error('Writer target differs from its trusted reservation.');
  if(!Array.isArray(research.sources))throw new Error('Research source records are missing.');
  if(research.enrichment&&research.enrichment.status!=='not_requested'){
    if(!['completed','failed','no_new_leads'].includes(research.enrichment.status)||!Array.isArray(research.enrichment.observations)||research.enrichment.observations.length>12)throw new Error('Product evidence selection is missing or exceeds its bounded lead budget.');
    const selectedProducts=new Set(research.enrichment.observations.map(item=>canonicalURL(item.productUrl)));
    for(const item of [...draft.posts,...(Array.isArray(draft.candidates)?draft.candidates:[]),...(Array.isArray(draft.rejected)?draft.rejected:[])]){
      if(typeof item?.productUrl==='string'&&!selectedProducts.has(canonicalURL(item.productUrl)))throw new Error('Writer assessed a product outside the bounded primary evidence selection.');
    }
  }
  for(const field of ['candidates','rejected']){
    if(draft[field]!==undefined&&!Array.isArray(draft[field]))throw new Error('Writer '+field+' must be an array of explicitly identified items.');
    for(const item of draft[field]||[]){
      if(typeof item?.title!=='string'||!item.title.trim()||typeof item?.productUrl!=='string'||!item.productUrl.trim())throw new Error('Writer '+field+' entry must retain its title and exact productUrl; no exclusion may be silently dropped.');
      try{canonicalURL(item.productUrl);}catch{throw new Error('Writer '+field+' entry has an invalid productUrl; no exclusion may be silently dropped.');}
    }
  }
  const previous=await records('posts'),sources=[],health=[];
  const noveltyContext=createNoveltyContext(previous);
  const demandRequired=process.env.DEMAND_CONTRACT_VERSION==='1'||!!process.env.EXPECTED_LEARNING_SELECTION_SHA;
  if(demandRequired&&process.env.GITHUB_ACTIONS==='true'&&!process.env.EXPECTED_LEARNING_SELECTION_SHA)throw new Error('Demand-first checking requires the independently sealed pre-model learning selection.');
  const registry=demandRequired?await readJSON(path.join(ROOT,'data','sources','registry.json')):{sources:[]};
  const registrySources=registry.sources.map(definition=>({id:definition.id,url:definition.url,kind:definition.kind,role:sourceRole(definition),demandKind:sourceDemandKind(definition),segments:sourceSegments(definition)}));
  let selectedDemandSourceIds=null;
  const definitionFor=source=>registry.sources.find(definition=>definition.id===source.registrySourceId&&['active','probation'].includes(definition.status)&&validSourceAdmission(definition.validation)&&(selectedDemandSourceIds===null||selectedDemandSourceIds.includes(definition.id)));
  const authorizedSources=[];
  const officialDemandURL=value=>{try{return ['www.contractsfinder.service.gov.uk','www.find-tender.service.gov.uk','jobsearch.api.jobtechdev.se'].includes(new URL(value).hostname);}catch{return false;}};
  let selectedSegment=null,learningSelection=null,fallbackPolicy=null,recoveryBatchPolicy=null;
  if(process.env.EXPECTED_LEARNING_SELECTION_SHA){const selection=await readJSON(dataPath('learning-selection',runId));if(validateLearningSelection(selection,{runId,expectedSha256:process.env.EXPECTED_LEARNING_SELECTION_SHA}).length)throw new Error('Trusted pre-model learning selection changed.');selectedSegment=selection.selectedSegment;selectedDemandSourceIds=selection.demandSourceIds;learningSelection=selection;}
  if(learningSelection?.selectionStrategy==='mixed-recovery-v1'){
   const batch=research.enrichment?.recoveryBatch;
   if(!/^[a-f0-9]{64}$/.test(process.env.EXPECTED_RESEARCH_SHA||'')||sha256(stableJSON(research))!==process.env.EXPECTED_RESEARCH_SHA||!batch||batch.mode!==learningSelection.researchPolicy.mode||!Array.isArray(batch.leadAssignments)||batch.leadAssignments.some(item=>!learningSelection.eligibleSegments.includes(item.segment)||!learningSelection.demandSourceIds.includes(item.registrySourceId)))throw new Error('Mixed recovery assignments lack their exact sealed original research and eligible source/segment binding.');
   recoveryBatchPolicy={...batch,researchSha256:process.env.EXPECTED_RESEARCH_SHA};
   const accounted=new Set([...draft.posts,...(draft.candidates||[]),...(draft.rejected||[])].map(item=>canonicalURL(item.productUrl)));if(batch.leadAssignments.some(item=>!accounted.has(canonicalURL(item.productUrl))))throw new Error('The mixed writer omitted an assigned lead; every builder and demand assignment needs an explicit assessment or exclusion.');
  }
  if(research.enrichment?.fallback===true){
    if(!learningSelection?.researchPolicy?.fallbackEnabled||!['fallback','repair'].includes(learningSelection.researchPolicy.mode)||research.enrichment.fallbackFrom?.status!=='no_new_leads'||research.enrichment.fallbackFrom.selected!==0||research.enrichment.fallbackFrom.attempted!==0||!/^[a-f0-9]{64}$/.test(process.env.EXPECTED_RESEARCH_SHA||'')||sha256(stableJSON(research))!==process.env.EXPECTED_RESEARCH_SHA)throw new Error('Builder fallback lacks the original pre-model no-fresh-demand research fingerprint.');
    const urls=(research.enrichment.observations||[]).filter(item=>item.status==='fetched').map(item=>canonicalURL(item.productUrl)),ids=research.enrichment.demandSignalIds;
    if(!urls.length||urls.length>10||!Array.isArray(ids)||!ids.length||ids.length>2)throw new Error('Builder fallback needs bounded builder leads and public demand signals.');
    fallbackPolicy={version:1,enabled:true,mode:learningSelection.researchPolicy.mode,reason:'no_fresh_demand_lead',researchSha256:process.env.EXPECTED_RESEARCH_SHA,allowedBuilderUrls:[...new Set(urls)],demandSourceIds:[...new Set(ids)]};
  }
  if(research.researchPolicy?.maxLeads===10){const considered=new Set([...draft.posts,...(draft.candidates||[]),...(draft.rejected||[])].map(item=>canonicalURL(item.productUrl)));if(considered.size>10)throw new Error('A recovery run may assess at most ten distinct leads.');}
  const sameProduct=(source,url)=>{try{return [source.url,source.productUrl].filter(Boolean).some(value=>canonicalURL(value)===canonicalURL(url));}catch{return false;}};
  // Primary enrichment is evidence for a discovered product, not a new model-
  // invented origin. Retain matching original discovery IDs before hashing.
  for(const item of [...draft.posts,...(Array.isArray(draft.candidates)?draft.candidates:[])]){
    const attached=(Array.isArray(item.sourceIds)?item.sourceIds:[]).map(id=>research.sources.find(source=>source.id===id)).filter(Boolean);
    const origins=attached.flatMap(source=>Array.isArray(source.originSourceIds)?source.originSourceIds:[]).filter(id=>research.sources.some(source=>source.id===id&&sameProduct(source,item.productUrl)));
    item.sourceIds=[...new Set([...(Array.isArray(item.sourceIds)?item.sourceIds:[]),...origins])].slice(0,4);
  }
  for(const post of draft.posts)if(typeof post.productUrl==='string'){try{post.id=candidateIdentity(post);post.candidateId=post.id;}catch{}}
  const considerationEvidence=[];
  let selected;
  if(draft.posts.length)selected=[...new Set([...draft.posts.flatMap(p=>Array.isArray(p.sourceIds)?p.sourceIds:[]),...(draft.candidates||[]).flatMap(candidate=>Array.isArray(candidate.demandEvidence?.sourceIds)?candidate.demandEvidence.sourceIds:[])])].map(sourceId=>research.sources.find(s=>s.id===sourceId)).filter(Boolean);
  else{
    const considerations=new Map();
    for(const item of [...(Array.isArray(draft.candidates)?draft.candidates:[]),...(Array.isArray(draft.rejected)?draft.rejected:[])]){
      if(typeof item?.productUrl!=='string'||typeof item?.title!=='string')continue;
      let key;try{key=canonicalURL(item.productUrl);}catch{continue;}
      if(!considerations.has(key))considerations.set(key,item);
    }
    if(considerations.size>12)throw new Error('An empty assessment may cover at most 12 distinct candidate exclusions.');
    const known=new Map();
    for(const [productUrl,item] of considerations){
      const attached=(Array.isArray(item.sourceIds)?item.sourceIds:[]).map(id=>research.sources.find(source=>source.id===id)).filter(source=>source&&sameProduct(source,productUrl));
      const matched=research.sources.filter(source=>sameProduct(source,productUrl));
      const relevant=[...new Map([...attached,...matched].map(source=>[source.id,source])).values()].sort((a,b)=>Number(b.enriched===true)-Number(a.enriched===true)).slice(0,4);
      for(const source of relevant)known.set(source.id,source);
      considerationEvidence.push({title:item.title.slice(0,200),productUrl,sourceIds:relevant.map(source=>source.id)});
    }
    if(known.size>32)throw new Error('Candidate exclusions exceed the bounded fresh assessment source budget.');
    selected=known.size?[...known.values()]:research.sources.filter(source=>typeof source?.id==='string'&&typeof source?.url==='string'&&typeof source?.text==='string'&&source.text.trim().length>=100).slice(0,8);
  }
  if(fallbackPolicy)selected=[...new Map([...selected,...fallbackPolicy.demandSourceIds.map(id=>research.sources.find(source=>source.id===id)).filter(Boolean)].map(source=>[source.id,source])).values()];
  if(recoveryBatchPolicy)selected=[...new Map([...selected,...recoveryBatchPolicy.leadAssignments.flatMap(item=>[research.sources.find(source=>source.id===item.demandSourceId),...research.sources.filter(source=>source.enriched===true&&sameProduct(source,item.productUrl))]).filter(Boolean)].map(source=>[source.id,source])).values()];
  for(const source of selected){
    try{
      const definition=definitionFor(source);
      if(demandRequired&&(source.role==='demand'||source.demand===true||officialDemandURL(source.url))&&(!definition||sourceRole(definition)!=='demand'))throw new Error('Demand evidence has no currently admitted fixed-registry authority; raw notice data will not be copied.');
      if(definition&&sourceRole(definition)==='demand'){
        const fresh=await fetchDemandEvidence(source,{definition});sources.push(fresh);
        authorizedSources.push({sourceId:fresh.id,registrySourceId:definition.id,url:fresh.url,role:'demand',demandKind:sourceDemandKind(definition),segments:[fresh.segment]});
      }else{const page=await fetchPublic(source.url,sourceEvidenceFetchOptions(source)),extracted=extractImplementationEvidence(page.text,{maxCharacters:source.enriched===true?8000:18000,minCharacters:100});if(!extracted)throw new Error('Evidence source has no useful complete privacy-safe capability section.');sources.push({...source,...extracted,fetchedAt:page.fetchedAt,verifiedAt:page.fetchedAt});}
    }
    catch(error){health.push({sourceId:source.id,url:source.url,status:'failed',message:safeError(error)});}
  }
  const primaryFetchDiagnostics=[];
  const sameURL=(left,right)=>{try{return canonicalURL(left)===canonicalURL(right);}catch{return false;}};
  // Earlier enrichment crossed the writer workspace and is not independent
  // evidence of a failed request. Re-fetch each exact known candidate product
  // here so empty-batch exclusions have current guarded diagnostics too.
  if(!draft.posts.length)for(const item of considerationEvidence){
    const requestedAt=new Date().toISOString(),existing=sources.find(source=>sameURL(source.url,item.productUrl)||(source.enriched===true&&['product-page','github-readme'].includes(source.evidenceKind)&&sameURL(source.productUrl,item.productUrl)));
    const denied=health.find(entry=>sameURL(entry.url,item.productUrl));
    if(existing){primaryFetchDiagnostics.push({productUrl:item.productUrl,requestedAt,status:'fetched',sourceId:existing.id,reason:'The candidate product or its exact discovered implementation document was independently re-fetched in this check context.'});continue;}
    if(denied){primaryFetchDiagnostics.push({productUrl:item.productUrl,requestedAt,status:'failed',sourceId:null,reason:denied.message});continue;}
    try{
      const original=research.sources.find(source=>sameURL(source.url,item.productUrl)),definition=original&&definitionFor(original);
      if(definition&&sourceRole(definition)==='demand'){
        const fresh=await fetchDemandEvidence(original,{definition});sources.push(fresh);item.sourceIds=[...new Set([...item.sourceIds,fresh.id])];
        authorizedSources.push({sourceId:fresh.id,registrySourceId:definition.id,url:fresh.url,role:'demand',demandKind:sourceDemandKind(definition),segments:[fresh.segment]});
        primaryFetchDiagnostics.push({productUrl:item.productUrl,requestedAt,status:'fetched',sourceId:fresh.id,reason:'The exact demand item was independently fetched by its fixed privacy-safe official adapter.'});continue;
      }
      if(demandRequired&&officialDemandURL(item.productUrl))throw new Error('Demand item has no authorized privacy-safe adapter; raw notice data will not be copied.');
      const page=await fetchPublic(item.productUrl,{maxBytes:2000000,complete:true}),extracted=extractImplementationEvidence(page.text,{maxCharacters:18000,minCharacters:100});
      if(!extracted)throw new Error('Primary product page has no useful complete privacy-safe capability section.');
      const url=canonicalURL(page.url),sourceId=hash(url);
      if(!sources.some(source=>source.id===sourceId))sources.push({id:sourceId,url,productUrl:item.productUrl,title:item.title+' · independently fetched product',publisher:new URL(url).hostname,...extracted,fetchedAt:page.fetchedAt,verifiedAt:page.fetchedAt,enriched:true,evidenceKind:'product-page',evidenceFetch:{maxBytes:2000000,complete:true}});
      item.sourceIds=[...new Set([...item.sourceIds,sourceId])];
      primaryFetchDiagnostics.push({productUrl:item.productUrl,requestedAt,status:'fetched',sourceId,reason:'The candidate product URL was independently re-fetched with public HTTPS, DNS and robots guards.'});
    }catch(error){const reason=safeError(error);health.push({url:item.productUrl,status:'failed',message:reason});primaryFetchDiagnostics.push({productUrl:item.productUrl,requestedAt,status:'failed',sourceId:null,reason});}
  }
  for(const post of draft.posts){
    const product=research.sources.find(s=>s.productUrl===post.productUrl||s.url===post.productUrl);
    if(!product||sources.some(s=>s.url===post.productUrl))continue;
    if(demandRequired&&officialDemandURL(post.productUrl)){health.push({url:post.productUrl,status:'failed',message:'The guarded demand item could not be verified; no raw notice data was stored.'});continue;}
    try{const page=await fetchPublic(post.productUrl,{maxBytes:2000000,complete:true}),extracted=extractImplementationEvidence(page.text,{maxCharacters:18000,minCharacters:100});if(!extracted)throw new Error('Primary product page has no useful complete privacy-safe capability section.');const sourceId=hash(post.productUrl);sources.push({id:sourceId,url:post.productUrl,title:post.title+' · official product',publisher:new URL(post.productUrl).hostname,...extracted,fetchedAt:page.fetchedAt,verifiedAt:page.fetchedAt});post.sourceIds=[...new Set([...(post.sourceIds||[]),sourceId])].slice(0,4);}
    catch(error){health.push({url:post.productUrl,status:'failed',message:safeError(error)});}
  }
  if(!sources.length)throw new Error('An assessment needs at least one successfully re-fetched privacy-safe public research source; no checker model call is permitted.');
  const demandContext=createDemandContext({registrySources,authorizedSources:[...new Map(authorizedSources.map(source=>[source.sourceId,source])).values()],posts:previous,selectedSegment,fallbackPolicy,recoveryBatchPolicy}),demandContextSha256=demandContextHash(demandContext);
  const demandContract=demandRequired?{demandContractVersion:1,demandContext,demandContextSha256}:{};
  const demandFailures=demandContextReasons(demandContract);if(demandFailures.length)throw new Error(demandFailures.join(' ')+(health.length?' Guarded evidence retrieval: '+health.map(item=>item.message).join(' ').slice(0,500):''));
  if(demandRequired)for(const candidate of draft.candidates||[]){const reasons=demandEvidenceReasons(candidate,sources,{required:true,context:demandContract});if(reasons.length)throw new Error('A considered candidate did not begin with verifiable privacy-safe demand: '+reasons.join(' '));}
  const sameBatch=new Set(),earlierProposals=[];
  const deterministicResults=draft.posts.map(post=>{const reasons=deterministicCheck(post,[...research.sources,...sources],[...previous,...earlierProposals],{scoringPolicy,noveltyNow:new Date(noveltyContext.asOf),demandContext:demandContract,demandRequired});if(sameBatch.has(post.id))reasons.push('Duplicate product in this writer batch.');sameBatch.add(post.id);earlierProposals.push({...post,publishedAt:noveltyContext.asOf,...(demandRequired?{demandContractVersion:1,checker:{demandCheck:{supported:true}}}:{})});if(post.sourceIds?.some(sourceId=>!sources.some(s=>s.id===sourceId)))reasons.push('Attached evidence source could not be re-fetched.');return {postId:post.id,pass:reasons.length===0,reasons};});
  await writeJSON(dataPath('drafts',runId),draft);
  const context={runId,createdAt:new Date().toISOString(),rulesSha256,scoringPolicy,draftSha256:sha256(stableJSON(draft)),sourceSnapshotSha256:sha256(stableJSON(sources)),sources,health,deterministicResults,noveltyContractVersion:1,noveltyContext,...demandContract,...(assessmentContractVersion?{assessmentContractVersion}: {}),...(!draft.posts.length?{primaryFetchDiagnostics,considerationEvidence:considerationEvidence.map(item=>({...item,availableSourceIds:item.sourceIds.filter(id=>sources.some(source=>source.id===id)),unavailableSourceIds:item.sourceIds.filter(id=>!sources.some(source=>source.id===id))}))}: {})};
  const privacyCategories=privateArtifactCategories(context);
  if(privacyCategories.length)throw new Error('Fresh independent evidence failed privacy checks ('+[...new Set(privacyCategories)].join(', ')+'); no checker model call is permitted.');
  await writeJSON(dataPath('check-context',runId),context);
  console.log(JSON.stringify({runId,draftSha256:context.draftSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,results:deterministicResults}));
}catch(error){
  const reason=safeError(error).replace(/[\r\n\x00-\x1f\x7f]/g,' ').trim();
  if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,`verified=false\nunverified_code=checker_preparation_failed\nunverified_reason=${reason}\n`);
  console.error(reason);process.exitCode=1;
}
