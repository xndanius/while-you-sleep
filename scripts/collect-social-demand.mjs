import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {ROOT,validId,sha256,stableJSON} from '../lib/storage.mjs';
import {collectSocialDemand,socialArtifactProducer} from '../lib/social-demand.mjs';

// This deterministic retrieval step runs before either content model, in the
// trusted record concurrency group. Models must never receive its credentials.
export async function persistSocialReservation({root=ROOT,receipt,file,env=process.env}){
 if(env.GITHUB_ACTIONS!=='true')return;
 if(env.GITHUB_REPOSITORY!=='xndanius/while-you-sleep'||env.GITHUB_REF!=='refs/heads/main'||file!==`data/social-demand-quota/${receipt.id}.json`)throw new Error('Hosted social quota persistence requires the trusted main-branch retrieval job.');
 const git=args=>{const result=spawnSync('git',args,{cwd:root,encoding:'utf8',env});if(result.status!==0)throw new Error('Social quota persistence failed before any request.');return result.stdout.trim();};
 git(['config','user.name','Autonomous Startup Ideas retrieval']);git(['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);git(['add','--',file]);git(['commit','-m',`source budget: ${receipt.id} · reserve ten X ingestion slots before retrieval`]);git(['pull','--rebase','origin','main']);git(['push','origin','HEAD:main']);
 const remote=JSON.parse(git(['show',`HEAD:${file}`]));if(sha256(stableJSON(remote))!==sha256(stableJSON(receipt)))throw new Error('Committed social quota differs from its reserved request.');
}
export async function runSocialDemand({root=ROOT,runId,phase='research',env=process.env}={}){
 if(!validId(runId)||!['research','check'].includes(phase))throw new Error('Invalid bounded social retrieval identity.');
 const producer=env.GITHUB_ACTIONS==='true'?socialArtifactProducer(env):null;
 let sourceIds=null;if(phase==='check'){
  const file=path.join(root,'data','research',runId+'.json'),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>3000000)throw new Error('Independent social retrieval requires a bounded original research snapshot.');
  const research=JSON.parse(await fs.readFile(file,'utf8'));sourceIds=(research.sources||[]).filter(source=>['official-reddit-post','provider-cited-discovery'].includes(source.evidenceKind)).slice(0,10).map(source=>source.url);
 }
 const platforms=phase==='check'?['reddit','x']:null,results=[];
 if(platforms){for(const platform of platforms){const selected=sourceIds.filter(url=>platform==='reddit'?new URL(url).hostname.endsWith('reddit.com'):new URL(url).hostname==='x.com');if(selected.length)results.push(await collectSocialDemand({root,runId,phase,env,platform,sourceIds:selected,persistReservation:input=>persistSocialReservation({...input,root,env})}));}}
 else results.push(await collectSocialDemand({root,runId,phase,env,persistReservation:input=>persistSocialReservation({...input,root,env})}));
 const result={schema:1,runId,phase,createdAt:new Date().toISOString(),sources:results.flatMap(row=>row.sources),health:results.flatMap(row=>row.health),receipts:results.flatMap(row=>row.receipts),...(producer?{producer}:{})};
 await fs.mkdir(path.join(root,'.run'),{recursive:true});await fs.writeFile(path.join(root,'.run',`social-demand-${phase}.json`),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 await fs.mkdir(path.join(root,'data','social-demand-receipts'),{recursive:true});for(const receipt of result.receipts)await fs.writeFile(path.join(root,'data','social-demand-receipts',receipt.id+'.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 if(env.GITHUB_OUTPUT)await fs.appendFile(env.GITHUB_OUTPUT,`social_demand_path=.run/social-demand-${phase}.json\nsocial_demand_sources=${result.sources.length}\nsocial_demand_sha256=${sha256(stableJSON(result))}\nsocial_demand_head_sha=${result.producer?.headSha||''}\n`);
 console.log(JSON.stringify({runId,phase,sources:result.sources.length,health:result.health}));return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runSocialDemand({runId:process.argv[2],phase:process.argv[3]||'research'}).catch(()=>{console.error('Social demand retrieval did not complete; no private response or credential was logged.');process.exitCode=1;});
