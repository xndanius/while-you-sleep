import { stableJSON, sha256, candidateIdentity, canonicalURL } from './storage.mjs';
import { plainText } from './research.mjs';
import { validateScoringCriteria,checkScoringApproval,validateScoringPolicy } from './scoring.mjs';

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

export function deterministicCheck(draft,sources,previous=[],{scoringPolicy}={}) {
  const reasons=[];
  const fields=new Set(['id','candidateId','title','promise','whatItIs','whoPays','loop','evidence','uncertainty','first24Hours','sourceIds','productUrl','scoring']);
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
  return reasons;
}

export function checkApproval(draft,context,manifest) {
  const reasons=[];
  if(manifest.runId!==context.runId||draft.runId!==context.runId)reasons.push('Checker run does not match draft and verified source context.');
  if(manifest.draftSha256!==context.draftSha256)reasons.push('Checker approval does not bind the current draft hash.');
  if(manifest.sourceSnapshotSha256!==context.sourceSnapshotSha256)reasons.push('Checker approval does not bind the verified source snapshot.');
  if(context.scoringPolicy&&manifest.policySha256!==context.scoringPolicy.policySha256)reasons.push('Checker approval does not bind the frozen scoring policy.');
  if(!Array.isArray(manifest.checks))reasons.push('Checker manifest has no checks array.');
  const checks=manifest.checks||[];
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
      if(typeof claim.evidenceQuote!=='string'||claim.evidenceQuote.trim().length<12||!plainText(source?.text||'').toLowerCase().includes(plainText(claim.evidenceQuote).toLowerCase()))failures.push('Checker evidence quote is missing or is not present in the fetched source.');
    }
    if(context.scoringPolicy){
      failures.push(...frozenScoringPolicyReasons(context));
      failures.push(...checkScoringApproval(post.scoring?.criteria,check?.scoreChecks,context.sources,{sourceIds:post.sourceIds}));
    }
    results.push({postId:post.id,pass:failures.length===0,reasons:[...new Set(failures)],check});
  }
  return results;
}
