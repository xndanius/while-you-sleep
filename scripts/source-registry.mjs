import {promises as fs} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {ROOT,hash,sha256,stableJSON,canonicalURL,writeJSON,safeError} from '../lib/storage.mjs';
import {localParts} from '../lib/config.mjs';
import {sourceSeedCatalog,normalizeSourceDefinition,validateSource,fetchPublic,extractPublicFeedLinks,inferSourceKind} from '../lib/research.mjs';
import {readPublicSourceRegistry,readBoundedJSON,validSourceAdmission,validateSourceRegistry,applySourceTransition,sourceDefinitionReasons,sourceRunURL,SOURCE_POLICY,planSourceEvolution,dailyDiscoveryBudget} from '../lib/source-registry.mjs';
import {weightedOverall} from '../lib/scoring.mjs';
import {registryInput} from './research-snapshot.mjs';

const definition=raw=>{const value=normalizeSourceDefinition(raw);return {id:value.id,name:value.name,url:value.url,kind:value.kind};};
const at=value=>new Date(value).toISOString();
export function admissionDecision(result,expected){
 try{return result?.eligible===true&&result.sourceId===expected.id&&stableJSON(result.definition)===stableJSON(expected)&&validSourceAdmission(result.validation)&&canonicalURL(result.validation.robots[0].evaluatedUrl)===expected.url&&Array.isArray(result.sampleItems)&&result.sampleItems.length===result.validation.itemCount&&result.sampleItems.length>0&&new Set(result.sampleItems.map(item=>item.id)).size===result.sampleItems.length&&result.sampleItems.every(item=>item.id===hash(canonicalURL(item.url))&&new URL(item.url).protocol==='https:'&&typeof item.title==='string'&&item.title.length>0&&item.title.length<=200&&typeof item.text==='string'&&item.text.length>0&&item.text.length<=1200&&Number.isFinite(Date.parse(item.fetchedAt)));}catch{return false;}
}
export function exclusionRecord({result,definition:source,runId,proposedBy}){
 const reason=String(result?.reason||'Guarded public validation did not produce a readable, complete source.').replace(/[\r\n]/g,' ').slice(0,500),checkedAt=at(result?.checkedAt||new Date());
 return {schema:1,id:`source-exclusion-${hash(runId+source.id+checkedAt)}`,sourceId:source.id,name:source.name,url:source.url,kind:source.kind,checkedAt,reason,code:String(result?.code||'ADMISSION_REFUSED').slice(0,100),robotsState:result?.code==='robots_disallowed'||result?.validation?.robots?.some(record=>record.allowed===false)?'disallowed':result?.validation?.robots?.length?'checked':'unavailable',runId,runUrl:sourceRunURL(runId),proposedBy};
}
export function transitionRecord({before,after,sourceId,reason,runId,validation=null,statistics=null,now}){
 const source=after.sources.find(item=>item.id===sourceId),previous=before.sources.find(item=>item.id===sourceId),createdAt=at(now);
 return {schema:1,id:`source-change-${hash(runId+sourceId+source.status+createdAt)}`,type:'source-change',sourceId,name:source.name,url:source.url,fromStatus:previous?.status||null,toStatus:source.status,reason,createdAt,runId,runUrl:sourceRunURL(runId),beforeSha256:sha256(stableJSON(before)),afterSha256:sha256(stableJSON(after)),validation,statistics};
}
export async function discoverSourceProposals({registry,attributions,currentPolicy,fetchPage=fetchPublic,catalog=sourceSeedCatalog}){
 const attempted=new Set([...registry.sources,...registry.exclusions].map(item=>canonicalURL(item.url))),domains=new Map(),proposals=[];
 for(const receipt of attributions)for(const candidate of receipt.candidates){if(candidate.checkStatus!=='passed'||!candidate.scoreSupported||!candidate.criteria||weightedOverall(candidate.criteria,currentPolicy.weights)<7)continue;for(const raw of candidate.evidenceUrls){const url=new URL(raw);if(!domains.has(url.origin))domains.set(url.origin,{products:new Set(),url:raw});domains.get(url.origin).products.add(candidate.productUrl);}}
 for(const [origin,value] of [...domains].sort((a,b)=>b[1].products.size-a[1].products.size||a[0].localeCompare(b[0]))){if(value.products.size<2)continue;try{const page=await fetchPage(value.url);for(const link of extractPublicFeedLinks(page)){const source=definition({name:`Discovered feed · ${new URL(link.url).hostname}`,url:link.url,kind:link.kind});if(!attempted.has(source.url)){proposals.push({...source,discoveryReason:'Literal public alternate feed on a recurring independently checked evidence domain.'});attempted.add(source.url);}}const url=canonicalURL(value.url);if(!attempted.has(url)){proposals.push({...definition({name:`Evidence page · ${new URL(url).hostname}`,url,kind:'html'}),discoveryReason:'Recurring primary evidence domain from at least two distinct independently checked products with current scores of seven or higher.'});attempted.add(url);}}catch{/* A guarded discovery failure never creates an eligible source. */}if(proposals.length>=3)break;}
 for(const raw of catalog){const source=definition(raw);if(attempted.has(source.url))continue;proposals.push({...source,discoveryReason:raw.reason||'Previously untried fixed public source catalog entry.'});attempted.add(source.url);if(proposals.length>=3)break;}
 return proposals.slice(0,SOURCE_POLICY.maxDiscoveriesPerDay);
}
function git(root,args,optional=false){const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});if(result.status!==0&&!optional)throw new Error(`Registry git operation failed: ${args[0]}`);return result;}
async function persistRegistry(root,registry,record,directory,message,discovery=null){await writeJSON(path.join(root,'data','sources','registry.json'),registry);await writeJSON(path.join(root,'data',directory,record.id+'.json'),record,{immutable:true});const paths=['data/sources/registry.json',`data/${directory}/${record.id}.json`];if(discovery){await writeJSON(path.join(root,'data','source-discovery',discovery.id+'.json'),discovery,{immutable:true});paths.push(`data/source-discovery/${discovery.id}.json`);}git(root,['add','--',...paths]);git(root,['commit','-m',message]);}
function trustedExecution(env,mode,runId){const match=runId.match(/^(source-bootstrap|research)-([1-9]\d{0,15})-([1-9]\d{0,3})$/);if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='xndanius/while-you-sleep'||!match||match[2]!==env.GITHUB_RUN_ID||Number(match[3])!==Number(env.GITHUB_RUN_ATTEMPT)||match[1]!== (mode==='bootstrap'?'source-bootstrap':'research')||mode==='bootstrap'&&env.GITHUB_EVENT_NAME!=='workflow_dispatch')throw new Error('Source evolution runs only in its fixed trusted hosted workflow.');}
export async function updateSourceRegistry({mode,runId,root=ROOT,env=process.env,validate=validateSource,discover=discoverSourceProposals,now=new Date(),push=true}){
 if(!['bootstrap','evolve'].includes(mode))throw new Error('Unknown source registry operation.');trustedExecution(env,mode,runId);
 git(root,['config','user.name','While You Sleep loop']);git(root,['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);
 if(git(root,['diff','--name-only']).stdout.trim()||git(root,['diff','--cached','--name-only']).stdout.trim())throw new Error('Registry evolution requires a clean tracked checkout.');
 let committed=false;
 for(let attempt=0;attempt<3;attempt++){
  const base=git(root,['rev-parse','HEAD']).stdout.trim();let registry=await readPublicSourceRegistry(root);const changeIds=[],probes=[];
  const day=localParts(now).day,dayFile=path.join(root,'data','source-evolution',`source-evolution-${day}.json`);
  if(mode==='evolve'&&!registry.initializedAt)return {committed:false,reason:'Hosted seed bootstrap has not admitted the initial registry.'};
  const input=mode==='evolve'?await registryInput(root,now):null;
  const budget=mode==='evolve'?dailyDiscoveryBudget({day,...input}):null;
  if(budget?.review&&budget.remaining===0)return {committed:false,reason:'The three guarded discovery probes for this Vilnius day are already recorded.'};
  if(mode==='evolve'&&!budget.review){
   for(const plan of planSourceEvolution({...input,now})){
    const before=registry;registry=applySourceTransition(registry,{...plan,now});const record=transitionRecord({before,after:registry,sourceId:plan.sourceId,reason:plan.reason,runId,statistics:plan.statistics,now});
    await persistRegistry(root,registry,record,'source-changes',`source: ${record.name} · ${plan.toStatus} · ${plan.reason}`);changeIds.push(record.id);committed=true;
   }
   const record={schema:1,id:`source-evolution-${day}`,type:'source-evolution',day,runId,runUrl:sourceRunURL(runId),createdAt:at(now),statisticsSha256:sha256(stableJSON(input.stats)),policySha256:input.currentPolicy.policySha256,probes:[],changeIds:[...changeIds]};await writeJSON(dayFile,record,{immutable:true});git(root,['add','--',`data/source-evolution/${record.id}.json`]);git(root,['commit','-m',`source review: ${day} · ${changeIds.length} reasoned transitions; discovery budget retained`]);committed=true;budget.review=record;
  }
  const proposed=mode==='bootstrap'?sourceSeedCatalog:(await discover({...input,registry}));
  const attempted=new Set([...registry.sources,...registry.exclusions,...(budget?.receipts||[]).map(receipt=>receipt.probe)].map(item=>canonicalURL(item.url))),proposals=[];
  for(const raw of proposed){const source=definition(raw);if(attempted.has(source.url))continue;attempted.add(source.url);proposals.push(raw);if(mode==='evolve'&&proposals.length>=budget.remaining)break;}
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
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{const result=await updateSourceRegistry({mode:process.argv[2],runId:process.argv[3]});if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,`committed=${result.committed}\n`);console.log(JSON.stringify(result));}catch(error){console.error(safeError(error));process.exitCode=1;}}
