import { fetchPublic,sourceRole,sourceSegments,sourceDemandKind,fetchDemandEvidence } from '../lib/research.mjs';
import { ROOT,dataPath, readJSON, writeJSON, records, candidateIdentity, canonicalURL, hash, sha256, stableJSON, safeError } from '../lib/storage.mjs';
import { deterministicCheck } from '../lib/validation.mjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseScoringPolicy,CANDIDATE_SCORING_VERSION } from '../lib/scoring.mjs';
import { validateLoopScheduling } from '../lib/loop-schedule.mjs';
import { sourceEvidenceFetchOptions } from '../lib/product-evidence.mjs';
import {createNoveltyContext} from '../lib/novelty.mjs';
import {createDemandContext,demandContextHash,demandEvidenceReasons,demandContextReasons} from '../lib/demand.mjs';
import {validSourceAdmission,sourceValidationMatchesDefinition} from '../lib/source-registry.mjs';
import {readProviderEvidence} from '../lib/provider-evidence.mjs';
import {privateArtifactCategories} from '../lib/privacy.mjs';
import {validateLearningSelection} from '../lib/learning.mjs';
import {extractImplementationEvidence} from '../lib/implementation-evidence.mjs';
import {assessmentEvidenceReasons,discussionEvidenceReasons} from '../lib/evidence-contract.mjs';
import {hasDiscussionImplementationReference as implementationSource,discussionImplementationReference,extractDiscussionImplementationEvidence} from '../lib/discussion-implementation.mjs';
import {discussionEvidenceURL} from '../lib/discussion-sources.mjs';
import {sealedDiscussionAssignmentReasons,checkDiagnosticsReasons,CHECK_DIAGNOSTIC_STAGES,CHECK_DIAGNOSTIC_CODES_BY_STAGE} from '../lib/check-diagnostics.mjs';
import {sealedWriterCoverage} from '../lib/writer-coverage.mjs';
import {candidatePlanReasons} from '../lib/candidate-plan.mjs';
import {verifyDiscussionDiscovery} from '../lib/discussion-discovery.mjs';
const runId=process.argv[2];
const preparationHealth=[];
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
  const planFailures=candidatePlanReasons(draft,{candidatePlanVersion:research.candidatePlanVersion});
  if(planFailures.length)throw new Error(planFailures.join(' '));
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
  const previous=await records('posts'),sources=[],health=preparationHealth;
  const noveltyContext=createNoveltyContext(previous);
  const demandRequired=process.env.DEMAND_CONTRACT_VERSION==='1'||!!process.env.EXPECTED_LEARNING_SELECTION_SHA;
  if(demandRequired&&process.env.GITHUB_ACTIONS==='true'&&!process.env.EXPECTED_LEARNING_SELECTION_SHA)throw new Error('Demand-first checking requires the independently sealed pre-model learning selection.');
  const registry=demandRequired?await readJSON(path.join(ROOT,'data','sources','registry.json')):{sources:[]};
  const registrySources=registry.sources.map(definition=>({id:definition.id,url:definition.url,kind:definition.kind,role:sourceRole(definition),demandKind:sourceDemandKind(definition),segments:sourceSegments(definition)}));
  let selectedDemandSourceIds=null;
  const definitionFor=source=>registry.sources.find(definition=>definition.id===source.registrySourceId&&['active','probation'].includes(definition.status)&&sourceValidationMatchesDefinition(definition.validation,definition)&&(selectedDemandSourceIds===null||selectedDemandSourceIds.includes(definition.id)));
  const authorizedSources=[];
  const officialDemandURL=value=>{try{return ['www.contractsfinder.service.gov.uk','www.find-tender.service.gov.uk','jobsearch.api.jobtechdev.se'].includes(new URL(value).hostname);}catch{return false;}};
  let selectedSegment=null,learningSelection=null,fallbackPolicy=null,recoveryBatchPolicy=null,discussionBatchPolicy=null;
  if(process.env.EXPECTED_LEARNING_SELECTION_SHA){const selection=await readJSON(dataPath('learning-selection',runId));if(validateLearningSelection(selection,{runId,expectedSha256:process.env.EXPECTED_LEARNING_SELECTION_SHA}).length)throw new Error('Trusted pre-model learning selection changed.');selectedSegment=selection.selectedSegment;selectedDemandSourceIds=selection.demandSourceIds;learningSelection=selection;}
  if(research.discoveryCarryover!==undefined){const definitions=registry.sources.filter(source=>['active','probation'].includes(source.status)&&learningSelection?.demandSourceIds.includes(source.id));const reasons=await verifyDiscussionDiscovery(ROOT,research.discoveryCarryover,{definitions,selection:learningSelection,now:research.createdAt});if(reasons.length)throw new Error(reasons.join(' '));}
  if(learningSelection?.selectionStrategy==='mixed-recovery-v1'){
   const batch=research.enrichment?.recoveryBatch;
   if(!/^[a-f0-9]{64}$/.test(process.env.EXPECTED_RESEARCH_SHA||'')||sha256(stableJSON(research))!==process.env.EXPECTED_RESEARCH_SHA||!batch||batch.mode!==learningSelection.researchPolicy.mode||!Array.isArray(batch.leadAssignments)||batch.leadAssignments.some(item=>!learningSelection.eligibleSegments.includes(item.segment)||!learningSelection.demandSourceIds.includes(item.registrySourceId)))throw new Error('Mixed recovery assignments lack their exact sealed original research and eligible source/segment binding.');
   recoveryBatchPolicy={...batch,researchSha256:process.env.EXPECTED_RESEARCH_SHA};
   const accounted=new Set([...draft.posts,...(draft.candidates||[]),...(draft.rejected||[])].map(item=>canonicalURL(item.productUrl)));if(batch.leadAssignments.some(item=>!accounted.has(canonicalURL(item.productUrl))))throw new Error('The mixed writer omitted an assigned lead; every builder and demand assignment needs an explicit assessment or exclusion.');
  }
  if(learningSelection?.selectionStrategy==='discussion-first-v1'){
    const batch=research.enrichment?.discussionBatch;
    if(!/^[a-f0-9]{64}$/.test(process.env.EXPECTED_RESEARCH_SHA||'')||sha256(stableJSON(research))!==process.env.EXPECTED_RESEARCH_SHA||!batch||batch.version!==1||batch.postIsDemand!==true||!Array.isArray(batch.leadAssignments)||batch.leadAssignments.some(item=>!learningSelection.eligibleSegments.includes(item.segment)||!learningSelection.demandSourceIds.includes(item.registrySourceId)))throw new Error('Discussion assignments lack their exact sealed research and eligible source/segment binding.');
    // Original identity is validated before retrieval. Fresh availability is a
    // separate gate: a guarded refusal cannot mutate or erase an assignment.
    const identityFailures=sealedDiscussionAssignmentReasons({research,selection:learningSelection,runId,expectedResearchSha256:process.env.EXPECTED_RESEARCH_SHA,expectedSelectionSha256:process.env.EXPECTED_LEARNING_SELECTION_SHA});
    if(identityFailures.length)throw new Error(identityFailures.join(' '));
    discussionBatchPolicy={...batch,researchSha256:process.env.EXPECTED_RESEARCH_SHA};
    const coverage=sealedWriterCoverage(draft,{runId,research,selection:learningSelection,expectedResearchSha256:process.env.EXPECTED_RESEARCH_SHA,expectedSelectionSha256:process.env.EXPECTED_LEARNING_SELECTION_SHA});
    if(!coverage.valid){
      const missing=coverage.missing.map(item=>`${item.productUrl} [${item.demandSourceId}]`).join(', ');
      const detail=missing?`The discussion writer omitted an assigned post: ${missing}.`:'Discussion writer coverage no longer matches its exact sealed discussion post assignments (foreign identity, within-list duplicate or changed binding).';
      throw new Error(`${detail} ${coverage.coveredAssignedCount} of ${coverage.assignedCount} unique assigned discussions considered. ${coverage.reasons.join(' ')}`);
    }
  }
  if(research.enrichment?.fallback===true){
    if(!learningSelection?.researchPolicy?.fallbackEnabled||!['fallback','repair'].includes(learningSelection.researchPolicy.mode)||research.enrichment.fallbackFrom?.status!=='no_new_leads'||research.enrichment.fallbackFrom.selected!==0||research.enrichment.fallbackFrom.attempted!==0||!/^[a-f0-9]{64}$/.test(process.env.EXPECTED_RESEARCH_SHA||'')||sha256(stableJSON(research))!==process.env.EXPECTED_RESEARCH_SHA)throw new Error('Builder fallback lacks the original pre-model no-fresh-demand research fingerprint.');
    const urls=(research.enrichment.observations||[]).filter(item=>item.status==='fetched').map(item=>canonicalURL(item.productUrl)),ids=research.enrichment.demandSignalIds;
    if(!urls.length||urls.length>10||!Array.isArray(ids)||!ids.length||ids.length>2)throw new Error('Builder fallback needs bounded builder leads and public demand signals.');
    fallbackPolicy={version:1,enabled:true,mode:learningSelection.researchPolicy.mode,reason:'no_fresh_demand_lead',researchSha256:process.env.EXPECTED_RESEARCH_SHA,allowedBuilderUrls:[...new Set(urls)],demandSourceIds:[...new Set(ids)]};
  }
  if(research.researchPolicy?.maxLeads===10){const considered=new Set([...draft.posts,...(draft.candidates||[]),...(draft.rejected||[])].map(item=>canonicalURL(item.productUrl)));if(considered.size>10)throw new Error('A recovery run may assess at most ten distinct leads.');}
  const sameProduct=(source,url)=>{try{return [source.url,source.productUrl].filter(Boolean).some(value=>canonicalURL(value)===canonicalURL(url));}catch{return false;}};
  const assignedDiscussionSources=discussionBatchPolicy?discussionBatchPolicy.leadAssignments.map(item=>research.sources.find(source=>source.id===item.demandSourceId&&sameProduct(source,item.productUrl))).filter(Boolean):[];
  const supportsDiscussion=(source,url)=>discussionBatchPolicy&&discussionImplementationReference(source,{demandSources:assignedDiscussionSources})&&discussionBatchPolicy.leadAssignments.some(item=>sameProduct({url:item.productUrl},url)&&source.supportsDemandSourceIds.includes(item.demandSourceId));
  // This reference set was sealed before either model. A writer's missing
  // citation cannot hide a preassigned capability from independent examination.
  const sealedImplementationReferences=discussionBatchPolicy?research.sources.filter(implementationSource):[];
  if(sealedImplementationReferences.length>2||new Set(sealedImplementationReferences.map(source=>source.id)).size!==sealedImplementationReferences.length||sealedImplementationReferences.some(source=>!discussionImplementationReference(source,{demandSources:assignedDiscussionSources})))throw new Error('Sealed discussion implementation references exceed their exact fixed authority or two-reference budget.');
  const attachedIds=item=>[...new Set([...(Array.isArray(item.sourceIds)?item.sourceIds:[]),...Object.values(item.scoring?.criteria||{}).flatMap(criterion=>Array.isArray(criterion?.sourceIds)?criterion.sourceIds:[])])];
  // Implementation references stay attached to the exact assigned discussion.
  // A model cannot turn a support page into a new primary or demand source.
  if(discussionBatchPolicy)for(const item of [...draft.posts,...(draft.candidates||[]),...(draft.rejected||[])])for(const id of attachedIds(item)){
    const source=research.sources.find(source=>source.id===id);
    if(implementationSource(source)&&!supportsDiscussion(source,item.productUrl))throw new Error('Discussion implementation reference is not bound to this exact assigned post.');
  }
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
      const attached=attachedIds(item).map(id=>research.sources.find(source=>source.id===id)).filter(source=>source&&(sameProduct(source,productUrl)||supportsDiscussion(source,productUrl)));
      const matched=research.sources.filter(source=>sameProduct(source,productUrl));
      const references=sealedImplementationReferences.filter(source=>supportsDiscussion(source,productUrl));
      const relevant=[...new Map([...matched,...references,...attached].map(source=>[source.id,source])).values()].sort((a,b)=>Number(sameProduct(b,productUrl))-Number(sameProduct(a,productUrl))||Number(b.enriched===true)-Number(a.enriched===true)).slice(0,4);
      for(const source of relevant)known.set(source.id,source);
      considerationEvidence.push({title:item.title.slice(0,200),productUrl,sourceIds:relevant.map(source=>source.id)});
    }
    if(known.size>32)throw new Error('Candidate exclusions exceed the bounded fresh assessment source budget.');
    selected=known.size?[...known.values()]:research.sources.filter(source=>typeof source?.id==='string'&&typeof source?.url==='string'&&typeof source?.text==='string'&&(source.discussionMetadataVersion===1?discussionEvidenceReasons(source,{definition:definitionFor(source),asOf:new Date().toISOString()}).length===0:source.text.trim().length>=100)).slice(0,8);
  }
  if(fallbackPolicy)selected=[...new Map([...selected,...fallbackPolicy.demandSourceIds.map(id=>research.sources.find(source=>source.id===id)).filter(Boolean)].map(source=>[source.id,source])).values()];
  if(recoveryBatchPolicy)selected=[...new Map([...selected,...recoveryBatchPolicy.leadAssignments.flatMap(item=>[research.sources.find(source=>source.id===item.demandSourceId),...research.sources.filter(source=>source.enriched===true&&sameProduct(source,item.productUrl))]).filter(Boolean)].map(source=>[source.id,source])).values()];
  if(discussionBatchPolicy)selected=[...new Map([...selected,...discussionBatchPolicy.leadAssignments.map(item=>research.sources.find(source=>source.id===item.demandSourceId)).filter(Boolean),...sealedImplementationReferences].map(source=>[source.id,source])).values()];
  const implementationReferences=selected.filter(source=>implementationSource(source));
  if(implementationReferences.length>2||implementationReferences.some(source=>!discussionBatchPolicy||!discussionImplementationReference(source,{demandSources:assignedDiscussionSources})))throw new Error('Discussion assessment exceeds its fixed implementation-reference authority or two-reference budget.');
  // Revalidate task bindings against independently fetched demand before the
  // optional documentation read, including empty and below-threshold batches.
  selected.sort((a,b)=>Number(implementationSource(a))-Number(implementationSource(b)));
  const checkerRobotsCache=new Map();
  const fetchPage=(url,options)=>fetchPublic(url,{...options,robotsCache:checkerRobotsCache,cacheRobots429:true});
  const failedAssignments=new Map();
  for(const source of selected){
    try{
      if(implementationSource(source)&&!discussionImplementationReference(source,{demandSources:sources.filter(item=>item.role==='demand')}))throw new Error('Discussion implementation reference lost its independently fetched task binding.');
      const definition=definitionFor(source);
      if(demandRequired&&(source.role==='demand'||source.demand===true||officialDemandURL(source.url))&&(!definition||sourceRole(definition)!=='demand'))throw new Error('Demand evidence has no currently admitted fixed-registry authority; raw notice data will not be copied.');
      if(definition&&sourceRole(definition)==='demand'){
        const fresh=await fetchDemandEvidence(source,{definition,fetchPage,providerFetch:(source)=>readProviderEvidence(ROOT,source)});sources.push(fresh);
        authorizedSources.push({sourceId:fresh.id,registrySourceId:definition.id,url:fresh.url,role:'demand',demandKind:sourceDemandKind(definition),segments:[fresh.segment]});
      }else{
        const page=await fetchPage(source.url,sourceEvidenceFetchOptions(source));
        if(implementationSource(source)&&canonicalURL(page.url)!==source.url)throw new Error('Implementation reference redirected away from its exact catalog URL.');
        const extracted=implementationSource(source)?extractDiscussionImplementationEvidence(source,page.text,{demandSources:sources.filter(item=>item.role==='demand')}):extractImplementationEvidence(page.text,{maxCharacters:source.enriched===true?8000:18000,minCharacters:100});
        if(!extracted)throw new Error('Evidence source has no useful complete privacy-safe capability section.');
        const validation=implementationSource(source)?{evidenceExcerpted:extracted.evidenceExtraction.omittedCharacters>0,evidenceValidation:{robots:page.robots,redirects:page.redirects||[],httpStatus:page.status,contentType:page.contentType,resolvedUrl:page.url,maxBytes:page.maxBytes,truncated:false}}:{};
        sources.push({...source,...extracted,...validation,fetchedAt:page.fetchedAt,verifiedAt:page.fetchedAt});
      }
    }
    catch(error){
      health.push({sourceId:source.id,url:source.url,status:'failed',message:safeError(error)});
      const assignment=discussionBatchPolicy?.leadAssignments.find(row=>row.demandSourceId===source.id);
      if(assignment){
        const definition=definitionFor(source);let adapterUrl=null;
        try{adapterUrl=discussionEvidenceURL(definition,source);}catch{}
        const candidateRobots=error.validation?.robotsUrl;
        const robotsUrl=adapterUrl&&candidateRobots===new URL('/robots.txt',adapterUrl).toString()?candidateRobots:null;
        const stage=CHECK_DIAGNOSTIC_STAGES.includes(error.stage)?error.stage:'validation';
        const code=CHECK_DIAGNOSTIC_CODES_BY_STAGE[stage].includes(error.code)?error.code:'evidence_unavailable';
        const status=error.validation?.status??error.validation?.httpStatus;
        failedAssignments.set(source.id,{sourceId:source.id,productUrl:assignment.productUrl,registrySourceId:assignment.registrySourceId,adapterUrl,robotsUrl,stage,code,httpStatus:Number.isInteger(status)&&status>=100&&status<=599?status:null,observedAt:new Date().toISOString()});
      }
    }
  }
  if(discussionBatchPolicy){
    const successfulSourceIds=discussionBatchPolicy.leadAssignments.filter(row=>authorizedSources.some(source=>source.sourceId===row.demandSourceId)).map(row=>row.demandSourceId);
    const unavailable=discussionBatchPolicy.leadAssignments.filter(row=>!successfulSourceIds.includes(row.demandSourceId));
    if(unavailable.length){
      // This receipt is diagnostic-only, outside the checker evidence namespace.
      // Keep the whole batch unverified and every original tuple, even when
      // other sources succeeded. No checker context or model call is created.
      const receipt={schema:1,kind:'check_preparation_diagnostics',runId,phase:process.env.CHECKER_PHASE||'initial',draftSha256:sha256(stableJSON(await readJSON(dataPath('drafts',runId)))),researchSha256:process.env.EXPECTED_RESEARCH_SHA,selectionSha256:process.env.EXPECTED_LEARNING_SELECTION_SHA,assignments:discussionBatchPolicy.leadAssignments,successfulSourceIds,failures:unavailable.map(row=>failedAssignments.get(row.demandSourceId))};
      const expectedSha256=sha256(stableJSON(receipt));
      const reasons=checkDiagnosticsReasons(receipt,{runId,phase:receipt.phase,expectedSha256,research,draft:await readJSON(dataPath('drafts',runId)),selection:learningSelection,expectedResearchSha256:process.env.EXPECTED_RESEARCH_SHA,expectedDraftSha256:receipt.draftSha256,expectedSelectionSha256:process.env.EXPECTED_LEARNING_SELECTION_SHA});
      if(reasons.length)throw new Error('Unavailable-evidence diagnostic could not be sealed: '+reasons.join(' '));
      await writeJSON(dataPath('check-diagnostics',runId),receipt,{immutable:true});
      if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,`check_diagnostics_sha256=${expectedSha256}\ncheck_diagnostics_draft_sha256=${receipt.draftSha256}\n`);
      throw new Error(`${unavailable.length} of ${discussionBatchPolicy.leadAssignments.length} sealed discussion assignments lack independently fetched evidence; original identities are unchanged. The whole batch remains unverified.`);
    }
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
        const fresh=await fetchDemandEvidence(original,{definition,fetchPage,providerFetch:(source)=>readProviderEvidence(ROOT,source)});sources.push(fresh);item.sourceIds=[...new Set([...item.sourceIds,fresh.id])];
        authorizedSources.push({sourceId:fresh.id,registrySourceId:definition.id,url:fresh.url,role:'demand',demandKind:sourceDemandKind(definition),segments:[fresh.segment]});
        primaryFetchDiagnostics.push({productUrl:item.productUrl,requestedAt,status:'fetched',sourceId:fresh.id,reason:'The exact demand item was independently fetched by its fixed privacy-safe official adapter.'});continue;
      }
      if(demandRequired&&(officialDemandURL(item.productUrl)||discussionBatchPolicy||original?.discussionMetadataVersion===1||original?.providerEvidence))throw new Error('Demand item has no available authorized privacy-safe adapter; no generic page or alternate provider fetch is permitted.');
      const page=await fetchPage(item.productUrl,{maxBytes:2000000,complete:true}),extracted=extractImplementationEvidence(page.text,{maxCharacters:18000,minCharacters:100});
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
    if(discussionBatchPolicy||product.discussionMetadataVersion===1||product.providerEvidence){health.push({url:post.productUrl,status:'failed',message:'The exact discussion adapter or immutable provider proof was unavailable; no generic fetch is permitted.'});continue;}
    if(demandRequired&&officialDemandURL(post.productUrl)){health.push({url:post.productUrl,status:'failed',message:'The guarded demand item could not be verified; no raw notice data was stored.'});continue;}
    try{const page=await fetchPage(post.productUrl,{maxBytes:2000000,complete:true}),extracted=extractImplementationEvidence(page.text,{maxCharacters:18000,minCharacters:100});if(!extracted)throw new Error('Primary product page has no useful complete privacy-safe capability section.');const sourceId=hash(post.productUrl);sources.push({id:sourceId,url:post.productUrl,title:post.title+' · official product',publisher:new URL(post.productUrl).hostname,...extracted,fetchedAt:page.fetchedAt,verifiedAt:page.fetchedAt});post.sourceIds=[...new Set([...(post.sourceIds||[]),sourceId])].slice(0,4);}
    catch(error){health.push({url:post.productUrl,status:'failed',message:safeError(error)});}
  }
  if(!sources.length)throw new Error('An assessment needs at least one successfully re-fetched privacy-safe public research source; no checker model call is permitted.');
  const demandContext=createDemandContext({registrySources,authorizedSources:[...new Map(authorizedSources.map(source=>[source.sourceId,source])).values()],posts:previous,selectedSegment,fallbackPolicy,recoveryBatchPolicy,discussionBatchPolicy}),demandContextSha256=demandContextHash(demandContext);
  const demandContract=demandRequired?{demandContractVersion:1,demandContext,demandContextSha256}:{};
  const demandFailures=demandContextReasons(demandContract);if(demandFailures.length)throw new Error(demandFailures.join(' ')+(health.length?' Guarded evidence retrieval: '+health.map(item=>item.message).join(' ').slice(0,500):''));
  if(demandRequired)for(const candidate of draft.candidates||[]){const reasons=demandEvidenceReasons(candidate,sources,{required:true,context:demandContract});if(reasons.length)throw new Error('A considered candidate did not begin with verifiable privacy-safe demand: '+reasons.join(' '));}
  const sameBatch=new Set(),earlierProposals=[];
  const deterministicResults=draft.posts.map(post=>{const reasons=deterministicCheck(post,[...research.sources,...sources],[...previous,...earlierProposals],{scoringPolicy,noveltyNow:new Date(noveltyContext.asOf),demandContext:demandContract,demandRequired});if(sameBatch.has(post.id))reasons.push('Duplicate product in this writer batch.');sameBatch.add(post.id);earlierProposals.push({...post,publishedAt:noveltyContext.asOf,...(demandRequired?{demandContractVersion:1,checker:{demandCheck:{supported:true}}}:{})});if(post.sourceIds?.some(sourceId=>!sources.some(s=>s.id===sourceId)))reasons.push('Attached evidence source could not be re-fetched.');return {postId:post.id,pass:reasons.length===0,reasons};});
  await writeJSON(dataPath('drafts',runId),draft);
  const context={runId,createdAt:new Date().toISOString(),rulesSha256,scoringPolicy,candidateScoringVersion:CANDIDATE_SCORING_VERSION,draftSha256:sha256(stableJSON(draft)),sourceSnapshotSha256:sha256(stableJSON(sources)),sources,health,deterministicResults,noveltyContractVersion:1,noveltyContext,...demandContract,...(research.discoveryCarryover?{discoveryCarryover:{...research.discoveryCarryover,records:research.discoveryCarryover.records.filter(record=>sources.some(source=>source.id===record.sourceId))}}:{}),...(research.candidatePlanVersion!==undefined?{candidatePlanVersion:research.candidatePlanVersion}:{}),...(assessmentContractVersion?{assessmentContractVersion}: {}),...(!draft.posts.length?{primaryFetchDiagnostics,considerationEvidence:considerationEvidence.map(item=>({...item,availableSourceIds:item.sourceIds.filter(id=>sources.some(source=>source.id===id)),unavailableSourceIds:item.sourceIds.filter(id=>!sources.some(source=>source.id===id))}))}: {})};
  const privacyCategories=privateArtifactCategories(context);
  const evidenceFailures=assessmentEvidenceReasons(context);
  if(evidenceFailures.length)throw new Error(evidenceFailures.join(' '));
  if(privacyCategories.length)throw new Error('Fresh independent evidence failed privacy checks ('+[...new Set(privacyCategories)].join(', ')+'); no checker model call is permitted.');
  await writeJSON(dataPath('check-context',runId),context);
  console.log(JSON.stringify({runId,draftSha256:context.draftSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,results:deterministicResults}));
}catch(error){
  // A failed context is deliberately never published as evidence. Preserve
  // bounded public identities in its trusted failure output instead, so the
  // durable unverified run can identify a guarded denial without a retry.
  const diagnostics=preparationHealth.slice(0,2).map(item=>{let host;try{host=new URL(item.url).hostname;}catch{return null;}const sourceId=/^[a-f0-9]{24}$/.test(item.sourceId||'')?` [${item.sourceId}]`:'';return `${host}${sourceId}: ${safeError(new Error(item.message)).slice(0,85)}`;}).filter(Boolean);
  const reason=(diagnostics.length?`Guarded sources: ${diagnostics.join('; ')}. `:'')+safeError(error);
  const boundedReason=reason.replace(/[\r\n\x00-\x1f\x7f]/g,' ').trim().slice(0,300);
  if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,`verified=false\nunverified_code=checker_preparation_failed\nunverified_reason=${boundedReason}\n`);
  console.error(boundedReason);process.exitCode=1;
}
