import { stableJSON, sha256, candidateIdentity, canonicalURL } from './storage.mjs';
import { plainText } from './research.mjs';
import { validateScoringCriteria,candidateScoringReasons,candidateScoringVersionReasons,checkScoringApproval,validateScoringPolicy,SCORING_KEYS } from './scoring.mjs';
import {noveltyContextReasons,noveltyAssessmentReasons,noveltyReasons,noveltyApprovalReasons} from './novelty.mjs';
import {demandContextReasons,demandEvidenceReasons,demandAssessmentReasons,demandApprovalReasons,publicationMixReasons} from './demand.mjs';
import {assessmentEvidenceReasons,sourceQuoteOccurs} from './evidence-contract.mjs';
import {candidatePlanReasons} from './candidate-plan.mjs';

const EXCLUDED_FIELDS=new Set(['checker','contentSha256','metrics','publicUrl','imageUrl']);
export function publishedContent(post) { return Object.fromEntries(Object.entries(post).filter(([k])=>!EXCLUDED_FIELDS.has(k))); }
export function contentHash(post) { return sha256(stableJSON(publishedContent(post))); }
export function verifyPublishedPost(post) {
  if(post?.checker?.passed!==true||!post.checker.checkerRunId||!post.contentSha256)return false;
  return contentHash(post)===post.contentSha256;
}

export function frozenScoringPolicyReasons(context,{expectedRulesSha256}={}) {
  const reasons=validateScoringPolicy(context?.scoringPolicy);
  if(!/^[a-f0-9]{64}$/.test(context?.rulesSha256||''))reasons.push('The frozen scoring policy has no valid RULES fingerprint.');
  if(expectedRulesSha256!==undefined&&context?.rulesSha256!==expectedRulesSha256)reasons.push('Scoring policy does not belong to the writer’s frozen RULES.');
  return [...new Set(reasons)];
}

// Completion is an independent decision for the whole frozen batch, including an
// empty batch. A per-post approval array alone cannot establish this boundary.
export function completedAssessmentReasons(draft,context,manifest) {
  const plans=[...candidatePlanReasons(draft,{candidatePlanVersion:context?.candidatePlanVersion}),...candidateScoringVersionReasons(context?.candidateScoringVersion)];
  // New preparation seals this version before model access. Archived contexts
  // retain their original contract; do not rewrite their historical receipts.
  if(context?.candidateScoringVersion===1)plans.push(...candidateScoringReasons(draft,{sources:context.sources}));
  if(context?.assessmentContractVersion!==1)return plans;
  const reasons=[...plans,...noveltyContextReasons(context),...demandContextReasons(context)],stamp=manifest?.completedAssessment;
  const bounded=value=>typeof value==='string'&&value.trim().length>0&&value.length<=500&&!/[\r\n]/.test(value);
  const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
  if(!exact(stamp,['schema','completed','decision','reason','contextSha256','rulesSha256','draftSha256','sourceSnapshotSha256','policySha256'])||stamp.schema!==1||stamp.completed!==true||!['assessed','no_supported_candidate'].includes(stamp.decision)||!bounded(stamp.reason))reasons.push('Independent checker did not complete the exact assessment contract.');
  if(stamp?.contextSha256!==sha256(stableJSON(context))||stamp?.rulesSha256!==context.rulesSha256||stamp?.draftSha256!==context.draftSha256||stamp?.sourceSnapshotSha256!==context.sourceSnapshotSha256||stamp?.policySha256!==context.scoringPolicy?.policySha256)reasons.push('Completed assessment does not bind all frozen context, RULES, draft, sources and policy fingerprints.');
  if(manifest?.runId!==context.runId||draft?.runId!==context.runId||manifest?.draftSha256!==context.draftSha256||manifest?.sourceSnapshotSha256!==context.sourceSnapshotSha256||manifest?.policySha256!==context.scoringPolicy?.policySha256)reasons.push('Independent assessment identity or top-level fingerprints changed.');
  const posts=Array.isArray(draft?.posts)?draft.posts:[],checks=manifest?.checks;
  if(!Array.isArray(draft?.posts)||!Array.isArray(checks)||checks.length!==posts.length||new Set(posts.map(post=>post?.id)).size!==posts.length||new Set((checks||[]).map(check=>check?.postId)).size!==(checks||[]).length||(checks||[]).some(check=>!posts.some(post=>post?.id===check?.postId)))reasons.push('Independent assessment requires exactly one decision for every known post and no extra decisions.');
  if(stamp?.decision!==(posts.length?'assessed':'no_supported_candidate'))reasons.push('Independent assessment decision does not match its proposed posts.');
  const sources=Array.isArray(context.sources)?context.sources:[];
  reasons.push(...assessmentEvidenceReasons(context));
  for(const post of posts){
    if(!Array.isArray(post?.sourceIds)||!post.sourceIds.length||post.sourceIds.some(id=>!sources.some(source=>source.id===id)))reasons.push('An assessed post has unavailable attached source evidence.');
    const check=(checks||[]).find(value=>value?.postId===post?.id);
    reasons.push(...noveltyAssessmentReasons(check,context));
    reasons.push(...demandAssessmentReasons(check,post,context));
    if(!exact(check,['postId','pass','reasons','claimChecks','scoreChecks',...(context.noveltyContractVersion===1?['noveltyCheck']:[]),...(context.demandContractVersion===1?['demandCheck']:[])])||typeof check.pass!=='boolean'||!Array.isArray(check.reasons)||check.reasons.some(reason=>!bounded(reason))||check.reasons.length>20||check.pass===false&&!check.reasons.length)reasons.push('Independent post decision is missing, malformed or lacks its rejection reason.');
    const claims=check?.claimChecks;
    if(!Array.isArray(claims)||claims.length<3||claims.length>30||new Set((claims||[]).map(claim=>claim?.claim)).size!==(claims||[]).length)reasons.push('Independent post decision needs three distinct checked claims.');
    for(const claim of claims||[]){
      const source=sources.find(value=>value.id===claim?.sourceId);
      if(!exact(claim,['claim','supported','sourceId','evidenceQuote'])||!bounded(claim.claim)||typeof claim.supported!=='boolean'||!post.sourceIds?.includes(claim.sourceId)||typeof claim.evidenceQuote!=='string'||claim.evidenceQuote.length<12||claim.evidenceQuote.length>500||!sourceQuoteOccurs(source,claim.evidenceQuote))reasons.push('Independent claim decision is malformed or lacks a literal fresh attached evidence quote.');
    }
    const scores=check?.scoreChecks;
    if(!Array.isArray(scores)||scores.length!==5||new Set((scores||[]).map(score=>score?.criterion)).size!==5||SCORING_KEYS.some(key=>!(scores||[]).some(score=>score?.criterion===key)))reasons.push('Independent assessment needs exactly five criterion decisions.');
    for(const score of scores||[]){
      const source=sources.find(value=>value.id===score?.sourceId);
      if(!exact(score,['criterion','supported','maxSupportedScore','reason','sourceId','evidenceQuote'])||!SCORING_KEYS.includes(score.criterion)||typeof score.supported!=='boolean'||!Number.isInteger(score.maxSupportedScore)||score.maxSupportedScore<1||score.maxSupportedScore>10||!bounded(score.reason)||score.reason.length>280||score.criterion==='profit'&&!/\bhypothes(?:is|es|ized|ised)|\bhypothetical\b/i.test(score.reason)||!post.sourceIds?.includes(score.sourceId)||typeof score.evidenceQuote!=='string'||score.evidenceQuote.length<12||score.evidenceQuote.length>500||!sourceQuoteOccurs(source,score.evidenceQuote))reasons.push('Independent criterion decision is malformed or lacks a literal fresh attached evidence quote.');
    }
  }
  return [...new Set(reasons)];
}

export function assessmentJobReasons(draft,jobResults,{required=false}={}) {
  if(!required)return [];
  let jobs;try{jobs=typeof jobResults==='string'?JSON.parse(jobResults):jobResults;}catch{}
  if(!jobs||jobs.writer?.result!=='success'||jobs.checker?.result!=='success')return ['Trusted writer and independent checker jobs did not both complete successfully.'];
  if(['writer','checker','repair','final_check'].some(name=>jobs[name]?.outputs?.model_completed==='false')||['checker','final_check'].some(name=>jobs[name]?.outputs?.verified==='false'))return ['An applicable model stage did not produce a fresh independently verifiable output.'];
  if(['writer','checker','repair','final_check'].some(name=>jobs[name]?.outputs?.privacy_safe==='false'||jobs[name]?.outputs?.scan_privacy_safe==='false'))return ['Privacy verification withheld an applicable content phase; no unsafe artifact may be archived or approved.'];
  // The repair model rewrites the exact public draft schema and may omit the
  // helper's repairAttempt marker. Only trusted Actions job results establish
  // that the repair and fresh final check actually ran successfully.
  const repaired=jobs.repair?.result==='success'&&jobs.final_check?.result==='success';
  const skipped=jobs.repair?.result==='skipped'&&jobs.final_check?.result==='skipped';
  if(!repaired&&(!skipped||Number(draft.repairAttempt||0)!==0))return ['The required repair and final independent checker jobs did not complete successfully.'];
  return [];
}

export function deterministicCheck(draft,sources,previous=[],{scoringPolicy,noveltyNow=new Date(),demandContext,demandRequired=false}={}) {
  const reasons=[];
  const fields=new Set(['id','candidateId','title','promise','whatItIs','whoPays','loop','evidence','uncertainty','first24Hours','sourceIds','productUrl','scoring','segment','demandEvidence']);
  if(Object.keys(draft).some(k=>!fields.has(k)))reasons.push('Draft contains fields outside the public post schema.');
  for(const field of ['title','promise','whatItIs','whoPays','evidence','uncertainty','productUrl'])if(typeof draft[field]!=='string'||!draft[field].trim())reasons.push(`Missing string ${field}.`);
  if(draft.title?.length>55)reasons.push('Title exceeds 55 characters.');
  if(draft.promise?.length>100)reasons.push('Promise exceeds 100 characters.');
  for(const field of ['whatItIs','whoPays','evidence','uncertainty'])if(draft[field]?.length>3500)reasons.push(`${field} is too long.`);
  if(!Array.isArray(draft.loop)||draft.loop.length<3||draft.loop.length>7||draft.loop.some(x=>typeof x!=='string'||!x.trim()))reasons.push('Loop must contain 3 to 7 concrete text steps.');
  if(!Array.isArray(draft.first24Hours)||draft.first24Hours.length!==3||draft.first24Hours.some(x=>typeof x!=='string'||!x.trim()))reasons.push('First 24 hours must contain exactly three text steps.');
  if(!Array.isArray(draft.sourceIds)||!draft.sourceIds.length||draft.sourceIds.length>4||draft.sourceIds.some(id=>!sources.some(s=>s.id===id)))reasons.push('Draft has missing or unknown evidence source IDs.');
  if(scoringPolicy || draft.scoring!==undefined){
    if(scoringPolicy)reasons.push(...validateScoringPolicy(scoringPolicy));
    if(!draft.scoring || typeof draft.scoring!=='object' || Array.isArray(draft.scoring) || Object.keys(draft.scoring).some(key=>key!=='criteria'))reasons.push('Draft scoring must contain only the five criterion assessments.');
    reasons.push(...validateScoringCriteria(draft.scoring?.criteria,{sourceIds:draft.sourceIds,sources}));
  }
  try{
    const url=new URL(draft.productUrl);
    if(url.protocol!=='https:'||url.username||url.password)reasons.push('Product URL must be public HTTPS without credentials.');
    const known=sources.some(s=>[s.url,s.productUrl].filter(Boolean).some(u=>canonicalURL(u)===canonicalURL(draft.productUrl)));
    if(!known)reasons.push('Product URL was not present in the live research snapshot.');
    const identity=candidateIdentity(draft);
    if(draft.id!==identity||draft.candidateId!==identity)reasons.push('Post ID does not match its canonical product URL.');
    if(previous.some(p=>p.id===identity||p.candidateId===identity||p.productUrl&&canonicalURL(p.productUrl)===canonicalURL(draft.productUrl)))reasons.push('Product already published.');
    const normalizedTitle=String(draft.title||'').toLowerCase().replace(/[^a-z0-9]/g,'');
    if(previous.some(p=>String(p.title||'').toLowerCase().replace(/[^a-z0-9]/g,'')===normalizedTitle))reasons.push('Idea title already published.');
  }catch{reasons.push('Invalid product URL.');}
  const text=JSON.stringify(draft);
  if(/get.rich.quick|guaranteed (income|profit|returns)|\b(casino|pornography|money laundering|spam campaign|gambling|adult content)\b/i.test(text))reasons.push('Prohibited content or unsupported hype in draft.');
  reasons.push(...noveltyReasons(draft,previous,{now:noveltyNow}));
  reasons.push(...demandEvidenceReasons(draft,sources,{required:demandRequired,context:demandContext}));
  if(demandRequired||draft.segment!==undefined)reasons.push(...publicationMixReasons(draft.segment,previous));
  return reasons;
}

export function checkApproval(draft,context,manifest) {
  const reasons=[];
  if(manifest.runId!==context.runId||draft.runId!==context.runId)reasons.push('Checker run does not match draft and verified source context.');
  if(manifest.draftSha256!==context.draftSha256)reasons.push('Checker approval does not bind the current draft hash.');
  if(manifest.sourceSnapshotSha256!==context.sourceSnapshotSha256)reasons.push('Checker approval does not bind the verified source snapshot.');
  if(context.scoringPolicy&&manifest.policySha256!==context.scoringPolicy.policySha256)reasons.push('Checker approval does not bind the frozen scoring policy.');
  if(!Array.isArray(manifest.checks))reasons.push('Checker manifest has no checks array.');
  reasons.push(...completedAssessmentReasons(draft,context,manifest));
  const checks=Array.isArray(manifest.checks)?manifest.checks:[];
  if(new Set(checks.map(c=>c.postId)).size!==checks.length)reasons.push('Checker contains duplicate post decisions.');
  const results=[];
  for(const post of draft.posts||[]){
    const check=checks.find(c=>c.postId===post.id);
    const deterministic=context.deterministicResults.find(c=>c.postId===post.id);
    const failures=[...reasons,...(deterministic?.reasons||['No deterministic validation record.'])];
    if(!check||check.pass!==true)failures.push(...(check?.reasons?.length?check.reasons:['Independent checker rejected or omitted this post.']));
    if(!check?.claimChecks||check.claimChecks.length<3)failures.push('Checker must substantiate at least three essential claims.');
    if(new Set((check?.claimChecks||[]).map(c=>c.claim)).size<(check?.claimChecks||[]).length)failures.push('Checker repeated the same claim instead of checking distinct claims.');
    for(const claim of check?.claimChecks||[]){
      const source=context.sources.find(s=>s.id===claim.sourceId);
      if(claim.supported!==true||!source||!post.sourceIds.includes(claim.sourceId))failures.push('Essential claim was unsupported or referenced an unattached source.');
      if(typeof claim.evidenceQuote!=='string'||claim.evidenceQuote.trim().length<12||!sourceQuoteOccurs(source,claim.evidenceQuote,{normalize:value=>plainText(value).toLowerCase()}))failures.push('Checker evidence quote is missing or is not present in the fetched source.');
    }
    if(context.scoringPolicy){
      failures.push(...frozenScoringPolicyReasons(context));
      failures.push(...checkScoringApproval(post.scoring?.criteria,check?.scoreChecks,context.sources,{sourceIds:post.sourceIds}));
    }
    failures.push(...noveltyApprovalReasons(check,context));
    failures.push(...demandApprovalReasons(check,post,context));
    results.push({postId:post.id,pass:failures.length===0,reasons:[...new Set(failures)],check});
  }
  return results;
}
