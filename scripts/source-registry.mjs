import {promises as fs} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {ROOT,hash,sha256,stableJSON,canonicalURL,writeJSON,safeError} from '../lib/storage.mjs';
import {localParts} from '../lib/config.mjs';
import {sourceSeedCatalog,normalizeSourceDefinition,validateSource,fetchPublic} from '../lib/research.mjs';
import {readPublicSourceRegistry,sourceValidationMatchesDefinition,validateSourceRegistry,applySourceTransition,sourceDefinitionReasons,sourceRunURL,SOURCE_POLICY,planSourceEvolution,dailyDiscoveryBudget} from '../lib/source-registry.mjs';
import {DEMAND_DISCOVERY_CATALOG,sourceRole} from '../lib/demand-sources.mjs';
import {isCurrentResearchSource,isJobOrTenderSource,DISCUSSION_PROVIDER_CATALOG,makeDiscussionSource,createProviderSourceValidation} from '../lib/discussion-sources.mjs';
import {loadApifyPool,validateApifyPoolProof} from '../lib/apify-sources.mjs';
import {registryInput} from './research-snapshot.mjs';

const definition=raw=>{const value=normalizeSourceDefinition(raw);return {id:value.id,name:value.name,url:value.url,kind:value.kind};};
const at=value=>new Date(value).toISOString();
export function admissionDecision(result,expected){
 try{return result?.eligible===true&&result.sourceId===expected.id&&stableJSON(result.definition)===stableJSON(expected)&&sourceValidationMatchesDefinition(result.validation,expected)&&Array.isArray(result.sampleItems)&&result.sampleItems.length===result.validation.itemCount&&result.sampleItems.length>0&&new Set(result.sampleItems.map(item=>item.id)).size===result.sampleItems.length&&result.sampleItems.every(item=>item.id===hash(canonicalURL(item.url))&&new URL(item.url).protocol==='https:'&&typeof item.title==='string'&&item.title.length>0&&item.title.length<=200&&typeof item.text==='string'&&item.text.length>0&&item.text.length<=1200&&Number.isFinite(Date.parse(item.fetchedAt)));}catch{return false;}
}
export function exclusionRecord({result,definition:source,runId,proposedBy}){
 const reason=String(result?.reason||'Guarded public validation did not produce a readable, complete source.').replace(/[\r\n]/g,' ').slice(0,500),checkedAt=at(result?.checkedAt||new Date());
 return {schema:1,id:`source-exclusion-${hash(runId+source.id+checkedAt)}`,sourceId:source.id,name:source.name,url:source.url,kind:source.kind,checkedAt,reason,code:String(result?.code||'ADMISSION_REFUSED').slice(0,100),robotsState:result?.code==='robots_disallowed'||result?.validation?.robots?.some(record=>record.allowed===false)?'disallowed':result?.validation?.robots?.length?'checked':'unavailable',runId,runUrl:sourceRunURL(runId),proposedBy};
}
export function transitionRecord({before,after,sourceId,reason,runId,validation=null,statistics=null,now}){
 const source=after.sources.find(item=>item.id===sourceId),previous=before.sources.find(item=>item.id===sourceId),createdAt=at(now);
 return {schema:1,id:`source-change-${hash(runId+sourceId+source.status+createdAt)}`,type:'source-change',sourceId,name:source.name,url:source.url,fromStatus:previous?.status||null,toStatus:source.status,reason,createdAt,runId,runUrl:sourceRunURL(runId),beforeSha256:sha256(stableJSON(before)),afterSha256:sha256(stableJSON(after)),validation,statistics};
}
export function sourceProposalAvailable(source,registry,{now=new Date()}={}){
 const url=canonicalURL(source.url),time=new Date(now).getTime();
 // Retired entries require a distinct re-admission contract. Never silently
 // reactivate them through an ordinary new-source discovery transition.
 if(registry.sources.some(item=>canonicalURL(item.url)===url))return false;
 const latest=registry.exclusions.filter(item=>canonicalURL(item.url)===url).reduce((at,item)=>Math.max(at,Date.parse(item.checkedAt)||0),0);
 return Number.isFinite(time)&&(!latest||time-latest>=7*86400000);
}
export async function discoverSourceProposals({registry,attributions=[],currentPolicy,fetchPage=fetchPublic,catalog=sourceSeedCatalog,demandCatalog=catalog===sourceSeedCatalog?DEMAND_DISCOVERY_CATALOG:[],stats={bySource:{}},now=new Date()}){
 const attempted=new Set(),proposals=[];
 const add=(raw,reason)=>{let source;try{source=definition(raw);}catch{return false;}if(!isCurrentResearchSource(source)||source.kind==='provider-discussion'||attempted.has(source.url)||!sourceProposalAvailable(source,registry,{now}))return false;proposals.push({...source,discoveryReason:reason});attempted.add(source.url);return true;};
 // Demand exploration does not depend on already having a passing AI idea.
 // That dependency exhausted the original finite seed list and then produced
 // zero probes forever. Rotate the fixed public pool deterministically daily.
 const day=localParts(now).day,pool=[...demandCatalog,...catalog.filter(source=>sourceRole(source)==='demand')],offset=pool.length?Number.parseInt(hash(day).slice(0,8),16)%pool.length:0;
 for(let index=0;index<pool.length;index++){const raw=pool[(offset+index)%pool.length];add(raw,'Rotating untried public demand feed; a real guarded quota-counted probe is required before admission.');if(proposals.length>=SOURCE_POLICY.maxDiscoveriesPerDay)return proposals;}
 // Current research is deliberately discussion-only. Historical successful
 // job, tender and builder URLs cannot silently re-enter through discovery.
 return proposals.slice(0,SOURCE_POLICY.maxDiscoveriesPerDay);
}
export function discussionOnlyRetirements(registry){return registry.sources.filter(source=>source.status!=='retired'&&isJobOrTenderSource(source)).map(source=>({sourceId:source.id,toStatus:'retired',reason:'Dan changed new research to public business discussions only; job advertisements and tenders are retired while all historical evidence is preserved.'}));}
function git(root,args,optional=false){const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});if(result.status!==0&&!optional)throw new Error(`Registry git operation failed: ${args[0]}`);return result;}
async function persistRegistry(root,registry,record,directory,message,discovery=null){await writeJSON(path.join(root,'data','sources','registry.json'),registry);await writeJSON(path.join(root,'data',directory,record.id+'.json'),record,{immutable:true});const paths=['data/sources/registry.json',`data/${directory}/${record.id}.json`];if(discovery){await writeJSON(path.join(root,'data','source-discovery',discovery.id+'.json'),discovery,{immutable:true});paths.push(`data/source-discovery/${discovery.id}.json`);}git(root,['add','--',...paths]);git(root,['commit','-m',message]);}
function trustedExecution(env,mode,runId){const match=runId.match(/^(source-bootstrap|research)-([1-9]\d{0,15})-([1-9]\d{0,3})$/);if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='xndanius/while-you-sleep'||!match||match[2]!==env.GITHUB_RUN_ID||Number(match[3])!==Number(env.GITHUB_RUN_ATTEMPT)||match[1]!== (mode==='bootstrap'?'source-bootstrap':'research')||mode==='bootstrap'&&env.GITHUB_EVENT_NAME!=='workflow_dispatch')throw new Error('Source evolution runs only in its fixed trusted hosted workflow.');}
export async function admitProviderPoolSources({runId,root=ROOT,env=process.env,loadPool=loadApifyPool,validateProof=validateApifyPoolProof,now=new Date(),push=true}={}){
 trustedExecution(env,'evolve',runId);
 if(env.GITHUB_WORKFLOW_REF!=='xndanius/while-you-sleep/.github/workflows/research.yml@refs/heads/main')throw new Error('Provider seeds run only in the trusted non-model research workflow.');
 if(!env.APIFY_TOKEN)return {committed:false,reason:'The public discussion provider is disabled.',changeIds:[]};
 git(root,['config','user.name','While You Sleep loop']);git(root,['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);
 if(git(root,['diff','--name-only']).stdout.trim()||git(root,['diff','--cached','--name-only']).stdout.trim())throw new Error('Provider source admission requires a clean tracked checkout.');
 for(let attempt=0;attempt<3;attempt++){
  const base=git(root,['rev-parse','HEAD']).stdout.trim(),pool=await loadPool(root,{now,maxAgeHours:8});let registry=await readPublicSourceRegistry(root);const changeIds=[];
  for(const raw of DISCUSSION_PROVIDER_CATALOG){
   const source=definition(raw);if(registry.sources.some(item=>item.id===source.id))continue;
   const entries=[];for(const item of pool){if(item.platform!==raw.platform||!await validateProof(root,item.proof,{definitionId:source.id,postUrl:item.post?.url,now,maxAgeHours:8}))continue;const safe=makeDiscussionSource(source,item.post,{fetchedAt:item.capturedAt});if(safe&&!entries.some(entry=>entry.source.id===safe.id))entries.push({source:safe,proof:item.proof});if(entries.length>=20)break;}
   if(!entries.length||registry.sources.filter(item=>item.status!=='retired').length>=SOURCE_POLICY.activeCap)continue;
   const validation=createProviderSourceValidation(source,entries,{fetchedAt:at(now)}),reason='Operator-approved fixed discussion provider seed; immutable public capture, exact receipt and bounded pool hashes verified. No own-site fetch or automatic discovery probe was used.',before=registry;
   registry=applySourceTransition(registry,{definition:source,toStatus:'probation',reason,validation,howAdded:'seed',now});const record=transitionRecord({before,after:registry,sourceId:source.id,reason,runId,validation,now});await persistRegistry(root,registry,record,'source-changes',`source: ${record.name} · probation · verified public provider seed`);changeIds.push(record.id);
  }
  if(!changeIds.length||!push)return {committed:changeIds.length>0,changeIds,reason:changeIds.length?'Verified fixed provider seeds admitted.':'No new verified fresh provider seeds.'};
  if(git(root,['push','origin','HEAD:main'],true).status===0)return {committed:true,changeIds};
  git(root,['reset','--hard',base]);git(root,['fetch','origin','main']);git(root,['reset','--hard','origin/main']);
 }
 throw new Error('Provider source admission could not push after three recomputed attempts.');
}
export async function updateSourceRegistry({mode,runId,root=ROOT,env=process.env,validate=validateSource,discover=discoverSourceProposals,now=new Date(),push=true}){
 if(!['bootstrap','evolve'].includes(mode))throw new Error('Unknown source registry operation.');trustedExecution(env,mode,runId);
 git(root,['config','user.name','While You Sleep loop']);git(root,['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);
 if(git(root,['diff','--name-only']).stdout.trim()||git(root,['diff','--cached','--name-only']).stdout.trim())throw new Error('Registry evolution requires a clean tracked checkout.');
 let committed=false;
 for(let attempt=0;attempt<3;attempt++){
  const base=git(root,['rev-parse','HEAD']).stdout.trim();let registry=await readPublicSourceRegistry(root);const changeIds=[],probes=[];
  for(const plan of discussionOnlyRetirements(registry)){
   const before=registry;registry=applySourceTransition(registry,{...plan,now});const record=transitionRecord({before,after:registry,sourceId:plan.sourceId,reason:plan.reason,runId,now});await persistRegistry(root,registry,record,'source-changes',`source: ${record.name} · retired · discussion-only research`);changeIds.push(record.id);committed=true;
  }
  const day=localParts(now).day,dayFile=path.join(root,'data','source-evolution',`source-evolution-${day}.json`);
  if(mode==='evolve'&&!registry.initializedAt)return {committed:false,reason:'Hosted seed bootstrap has not admitted the initial registry.'};
  const input=mode==='evolve'?await registryInput(root,now):null;
  const budget=mode==='evolve'?dailyDiscoveryBudget({day,...input}):null;
  if(budget?.review&&budget.remaining===0&&!committed)return {committed:false,reason:'The three guarded discovery probes for this Vilnius day are already recorded.'};
  if(mode==='evolve'&&!budget.review){
   for(const plan of planSourceEvolution({...input,now})){
    const before=registry;registry=applySourceTransition(registry,{...plan,now});const record=transitionRecord({before,after:registry,sourceId:plan.sourceId,reason:plan.reason,runId,statistics:plan.statistics,now});
    await persistRegistry(root,registry,record,'source-changes',`source: ${record.name} · ${plan.toStatus} · ${plan.reason}`);changeIds.push(record.id);committed=true;
   }
   const record={schema:1,id:`source-evolution-${day}`,type:'source-evolution',day,runId,runUrl:sourceRunURL(runId),createdAt:at(now),statisticsSha256:sha256(stableJSON(input.stats)),policySha256:input.currentPolicy.policySha256,probes:[],changeIds:[...changeIds]};await writeJSON(dayFile,record,{immutable:true});git(root,['add','--',`data/source-evolution/${record.id}.json`]);git(root,['commit','-m',`source review: ${day} · ${changeIds.length} reasoned transitions; discovery budget retained`]);committed=true;budget.review=record;
  }
  const proposed=mode==='bootstrap'?sourceSeedCatalog.filter(source=>isCurrentResearchSource(source)&&source.kind!=='provider-discussion'):(await discover({...input,registry,now}));
  const attempted=new Set((mode==='bootstrap'?[...registry.sources,...registry.exclusions]:(budget?.receipts||[]).map(receipt=>receipt.probe)).map(item=>canonicalURL(item.url))),proposals=[];
  for(const raw of proposed){if(mode==='evolve'&&budget.remaining===0)break;const source=definition(raw);if(attempted.has(source.url)||mode==='evolve'&&!sourceProposalAvailable(source,registry,{now}))continue;attempted.add(source.url);proposals.push(raw);if(mode==='evolve'&&proposals.length>=budget.remaining)break;}
  const discoveryFor=(probe,changeId,exclusionId)=>{if(mode!=='evolve')return null;const number=budget.used+1,previous=budget.receipts.at(-1);return {schema:1,id:`source-discovery-${day}-${number}`,type:'source-discovery',day,probeNumber:number,runId,runUrl:sourceRunURL(runId),createdAt:at(now),evolutionId:budget.review.id,evolutionSha256:sha256(stableJSON(budget.review)),previousSha256:previous?sha256(stableJSON(previous)):null,quotaBefore:SOURCE_POLICY.maxDiscoveriesPerDay-budget.used,quotaAfter:SOURCE_POLICY.maxDiscoveriesPerDay-number,statisticsSha256:sha256(stableJSON(input.stats)),policySha256:input.currentPolicy.policySha256,probe,changeId,exclusionId};};
  for(const raw of proposals){const source=definition(raw),result=await validate(source,{now}),eligible=admissionDecision(result,source)&&sourceDefinitionReasons(source).length===0,admitted=eligible&&registry.sources.filter(item=>item.status!=='retired').length<SOURCE_POLICY.activeCap;
   const rejected=eligible&&!admitted?{...result,eligible:false,code:'REGISTRY_CAP',reason:'The forty-source non-retired cap is already full.'}:result;
   const probe={sourceId:source.id,url:source.url,checkedAt:at(result.checkedAt||now),eligible:admitted,reason:String(rejected.reason||'Guarded admission refused this source.').replace(/[\r\n]/g,' ').slice(0,500),validation:result.validation||{},code:rejected.code||null};probes.push(probe);
   let discovery;
   if(admitted){
    const reason=(mode==='bootstrap'?'Guarded hosted seed validation admitted a readable public source on probation. ':raw.discoveryReason+' ').trim().slice(0,500),before=registry;registry=applySourceTransition(registry,{definition:source,toStatus:'probation',reason,validation:result.validation,howAdded:mode==='bootstrap'?'seed':'discovery',now});const record=transitionRecord({before,after:registry,sourceId:source.id,reason,runId,validation:result.validation,now});discovery=discoveryFor(probe,record.id,null);await persistRegistry(root,registry,record,'source-changes',`source: ${source.name} · probation · ${reason}`,discovery);changeIds.push(record.id);committed=true;
   }else{
    const record=exclusionRecord({result:{...rejected,checkedAt:probe.checkedAt,reason:probe.reason},definition:source,runId,proposedBy:mode==='bootstrap'?'seed':'discovery'});registry={...registry,exclusions:[...registry.exclusions,record].slice(-64)};if(registry.initializedAt)registry.updatedAt=at(now);if(validateSourceRegistry(registry).length)throw new Error('Blocked source exclusion invalidated the registry.');discovery=discoveryFor(probe,null,record.id);await persistRegistry(root,registry,record,'source-exclusions',`source excluded: ${source.name} · ${record.reason}`,discovery);committed=true;
   }
   if(discovery){budget.receipts.push(discovery);budget.used++;budget.remaining--;}
  }
  if(!committed||!push)return {committed,changeIds,probes:probes.length};
  if(git(root,['push','origin','HEAD:main'],true).status===0)return {committed,changeIds,probes:probes.length};
  // Only this isolated trusted runner's unpushed registry commits are discarded.
  // Recompute caps, samples and the day lease from the latest main before retry.
  git(root,['reset','--hard',base]);git(root,['fetch','origin','main']);git(root,['reset','--hard','origin/main']);committed=false;
 }
 throw new Error('Source registry could not push after three recomputed attempts.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{const result=process.argv[2]==='provider-seed'?await admitProviderPoolSources({runId:process.argv[3]}):await updateSourceRegistry({mode:process.argv[2],runId:process.argv[3]});if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,`committed=${result.committed}\n`);console.log(JSON.stringify(result));}catch(error){console.error(safeError(error));process.exitCode=1;}}
