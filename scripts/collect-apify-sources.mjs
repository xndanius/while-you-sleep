import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {ROOT,validId,sha256,stableJSON} from '../lib/storage.mjs';
import {APIFY_ACTORS,collectApifyPool,rereadApifyEvidence,apifyHealth,apifyBudget,apifyArtifactProducer,apifyAvailability} from '../lib/apify-sources.mjs';

const providerDirectories=['data/apify-reservations','data/apify-receipts','data/apify-pools','data/apify'];
function gitFor(root,env){return args=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8',env});if(r.status!==0)throw new Error('Apify record persistence failed; no provider details were logged.');return r.stdout.trim();};}
function configureBotIdentity(git){git(['config','user.name','Autonomous Startup Ideas retrieval']);git(['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);}
function trustedHosted(env){if(env.GITHUB_ACTIONS!=='true')return false;apifyArtifactProducer(env);return true;}
export async function persistApifyReservation({root=ROOT,receipt,file,env=process.env}){
 if(!trustedHosted(env))return;
 if(file!==`data/apify-reservations/${receipt.id}.json`)throw new Error('Provider reservation path is outside the fixed ledger.');
 const git=gitFor(root,env);configureBotIdentity(git);git(['add','--',file]);git(['commit','-m',`source budget: ${receipt.id} · reserve bounded public-discussion retrieval`]);git(['pull','--rebase','origin','main']);git(['push','origin','HEAD:main']);
 const committed=JSON.parse(git(['show',`HEAD:${file}`]));if(sha256(stableJSON(committed))!==sha256(stableJSON(receipt)))throw new Error('Committed Apify reservation differs from its sealed request.');
}
export async function persistApifyRecords({root=ROOT,env=process.env,runId}){
 if(!trustedHosted(env))return false;const git=gitFor(root,env);configureBotIdentity(git);
 for(const dir of providerDirectories){try{await fs.access(path.join(root,dir));git(['add','--',dir]);}catch{/* No token or no eligible batch produces no provider record directory. */}}
 if(!git(['diff','--cached','--name-only']).split('\n').some(file=>providerDirectories.some(dir=>file.startsWith(dir+'/'))))return false;
 git(['commit','-m',`sources: ${runId} · record sanitized Apify batches and actor health`]);git(['pull','--rebase','origin','main']);git(['push','origin','HEAD:main']);return true;
}
export async function runApifySources({root=ROOT,runId,phase='research',env=process.env,fetchImpl=fetch,now=new Date()}={}){
 if(!validId(runId)||!['research','check'].includes(phase))throw new Error('Invalid bounded provider retrieval identity.');
 const producer=env.GITHUB_ACTIONS==='true'?apifyArtifactProducer(env):null;let result;
 if(phase==='research')result=await collectApifyPool({root,runId,env,fetchImpl,now,persistReservation:input=>persistApifyReservation({...input,root,env})});
 else{
  const file=path.join(root,'data/research',runId+'.json'),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>3_000_000)throw new Error('Independent provider read requires bounded original research.');
  const research=JSON.parse(await fs.readFile(file,'utf8')),urls=[...new Set((research.sources||[]).filter(source=>source.providerProof?.provider==='apify'||source.providerEvidence?.proof?.provider==='apify'||source.evidenceAuthority==='trusted_provider_public_post'||source.discussionMetadataVersion===1).map(source=>source.url))].slice(0,10),items=[];
  for(const url of urls){try{const evidence=await rereadApifyEvidence(root,url,{token:env.APIFY_TOKEN,fetchImpl,now});if(evidence)items.push(evidence);}catch{/* A failed independent read supplies no evidence. */}}
  result={items,receipts:[],health:await apifyHealth(root),budget:await apifyBudget(root,{now,monthlyBudgetUsd:env.APIFY_MONTHLY_BUDGET_USD})};
 }
 const availability=apifyAvailability(env),states=await apifyHealth(root),health=availability.map(setting=>{const state=states.find(row=>row.platform===setting.platform),last=result.health.find(row=>row.platform===setting.platform);return {platform:setting.platform,status:!setting.enabled?'disabled':state?.status==='probation'?'probation':last?.status||state?.status||'active',reason:!setting.enabled?setting.reason:last?.reason||state?.lastReason||'not_collected',actorName:APIFY_ACTORS[setting.platform][state?.actorIndex||0].name};});
 const status={schema:1,runId,updatedAt:new Date(now).toISOString(),status:availability.every(row=>!row.enabled)?'disabled':result.budget.remainingUsd<=0?'budget_capped':'enabled',health,availability,sources:states,lastCollection:result.health,budget:{month:result.budget.month,limitUsd:result.budget.limitUsd,usedOrReservedUsd:result.budget.usedOrReservedUsd,measuredUsageUsd:result.budget.measuredUsageUsd,remainingUsd:result.budget.remainingUsd},poolItems:result.items.length};
 await fs.mkdir(path.join(root,'data/apify'),{recursive:true});await fs.writeFile(path.join(root,'data/apify/status.json'),JSON.stringify(status,null,2)+'\n');
 const committed=await persistApifyRecords({root,env,runId});
 const artifact={schema:1,runId,phase,createdAt:new Date(now).toISOString(),items:result.items,receipts:result.receipts,health:result.health,budget:{month:result.budget.month,limitUsd:result.budget.limitUsd,usedOrReservedUsd:result.budget.usedOrReservedUsd,measuredUsageUsd:result.budget.measuredUsageUsd,remainingUsd:result.budget.remainingUsd},...(producer?{producer}:{})};
 const relative=`.run/apify-${phase}.json`;await fs.mkdir(path.join(root,'.run'),{recursive:true});await fs.writeFile(path.join(root,relative),JSON.stringify(artifact,null,2)+'\n',{flag:'wx'});
 if(env.GITHUB_OUTPUT)await fs.appendFile(env.GITHUB_OUTPUT,`apify_path=${relative}\napify_items=${artifact.items.length}\napify_sha256=${sha256(stableJSON(artifact))}\napify_head_sha=${artifact.producer?.headSha||''}\napify_committed=${committed}\ncommitted=${committed}\n`);
 console.log(JSON.stringify({runId,phase,items:artifact.items.length,health:artifact.health,budget:artifact.budget}));return artifact;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runApifySources({runId:process.argv[2],phase:process.argv[3]||'research'}).catch(()=>{console.error('Public discussion provider retrieval did not complete; credentials and private responses were withheld.');process.exitCode=1;});
