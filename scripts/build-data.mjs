import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ROOT, records, readJSON, writeJSON, safeError } from '../lib/storage.mjs';
import { INITIAL_RULES, schedule } from '../lib/config.mjs';
import { verifyPublishedPost } from '../lib/validation.mjs';
import { measuredPublication } from '../lib/publication-status.mjs';
import { effectiveUsageRecords } from '../lib/usage.mjs';

const xml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
try{
  const [allPosts,rawRuns,research,rawVersions,rejections,publications,measurements,rawUsageRecords]=await Promise.all(['posts','runs','research','versions','rejections','publications','measurements','usage'].map(records));
  const usageRecords=effectiveUsageRecords(rawUsageRecords);
  const usageByRun=new Map(usageRecords.map(record=>[record.runId,record]));
  const runs=rawRuns.map(run=>({...run,usage:usageByRun.get(run.id)||run.usage}));
  const versions=rawVersions.map(version=>({...version,usage:usageByRun.get(version.id)||version.usage}));
  const posts=allPosts.filter(verifyPublishedPost).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt));
  if(posts.length!==allPosts.length)throw new Error('A committed post failed checker provenance or content-integrity validation.');
  let metrics;try{metrics=await readJSON(path.join(ROOT,'metrics.json'));}catch(error){if(error.code==='ENOENT')metrics={site:{status:'not_connected',views:null,saves:null},social:{status:'not_connected'},measuredAt:null};else throw error;}
  const postMetrics=metrics.posts||metrics.social?.posts||[];
  const baseURL=(process.env.PUBLIC_BASE_URL||'https://xndanius.github.io/while-you-sleep').replace(/\/$/,'');
  const hydrated=posts.map(post=>({...post,imageUrl:`./cards/${post.id}.jpg`,publicUrl:`${baseURL}/#post-${post.id}`,metrics:{views:postMetrics.find(m=>m.postId===post.id)?.views??null,saves:postMetrics.find(m=>m.postId===post.id)?.saves??null}}));
  const improvementRuns=versions.filter(v=>v.evaluations).map(v=>({id:v.id,type:'improve',status:v.status,startedAt:v.createdAt,finishedAt:v.createdAt,githubRunUrl:v.githubRunUrl||null,version:v.id,usage:v.usage||{inputTokens:null,outputTokens:null,costUsd:null},steps:[{stage:'improve',status:v.status,at:v.createdAt,message:`${v.change} ${v.reason}`,baselineScore:v.baselineScore,challengerScore:v.challengerScore}]}));
  const sortedRuns=[...runs,...measurements,...improvementRuns].sort((a,b)=>(b.finishedAt||b.startedAt).localeCompare(a.finishedAt||a.startedAt));
  const sortedResearch=research.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const healthMap=new Map();
  for(const snapshot of sortedResearch)for(const health of snapshot.health||[])if(!healthMap.has(health.name))healthMap.set(health.name,health);
  const candidates=(await records('candidates')).reduce((n,r)=>n+(r.candidates?.length||0),0);
  const measuredCost=usageRecords.map(r=>r.costUsd).filter(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0);
  const modelRunCount=runs.length+improvementRuns.length;
  const stats={published:posts.length,candidates,rejected:rejections.length,views:metrics.site?.views??null,saves:metrics.site?.saves??null,totalCostUsd:measuredCost.length?measuredCost.reduce((a,b)=>a+b,0):null,costStatus:measuredCost.length===modelRunCount&&modelRunCount?'recorded_token_estimate':'invoice_or_usage_not_connected'};
  const status={state:posts.length?'running':'awaiting_first_cloud_run',hosted:true,engine:'GitHub Actions + official openai/codex-action',lastResearchAt:sortedResearch[0]?.createdAt||null,lastPublishedAt:posts[0]?.publishedAt||null,lastRunAt:sortedRuns[0]?.finishedAt||null,lastHostedRunUrl:sortedRuns.find(r=>r.githubRunUrl)?.githubRunUrl||null,lastMeasuredAt:metrics.measuredAt||null,measurementStatus:metrics.site?.status||'not_connected'};
  const cadence={...schedule(),verifiedHostedRunAt:sortedRuns.find(r=>r.githubRunUrl)?.finishedAt||null};
  const feed={posts:hydrated,stats,schedule:cadence,status};
  const platformNames=['x','instagram','linkedin'];
  const platforms=platformNames.map(platform=>{
    const receipt=publications.slice().sort((a,b)=>(b.publishedAt||b.submittedAt||'').localeCompare(a.publishedAt||a.submittedAt||'')).find(r=>r.platform===platform||r.results?.[platform]||r.social?.[platform]);
    const result=measuredPublication(receipt,receipt?.results?.[platform]||receipt?.social?.[platform]||receipt,platform,metrics);
    return {name:platform==='x'?'X':platform==='instagram'?'Instagram':'LinkedIn',id:platform,status:result?.status||'pending_setup',provider:result?.provider||'Postiz Cloud',lastPublishedAt:result?.publishedAt||null,message:result?.message||'Danielius needs to connect this account through the publishing service.'};
  });
  const versionHistory=versions.length?versions.sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')):[{id:INITIAL_RULES.id,createdAt:INITIAL_RULES.createdAt,status:'adopted',reason:INITIAL_RULES.reason,change:'Initial evidence-first writing and picking rules',baselineScore:null,challengerScore:null}];
  const machine={...feed,runs:sortedRuns.slice(0,100),versions:versionHistory,sourceHealth:[...healthMap.values()],platforms,metrics};
  await writeJSON(path.join(ROOT,'public','api','feed.json'),feed);
  await writeJSON(path.join(ROOT,'public','api','machine.json'),machine);
  const counter=process.env.GOATCOUNTER_SITE||'';
  const validCounter=/^https:\/\/[a-z0-9-]+\.goatcounter\.com\/?$/.test(counter);
  await writeJSON(path.join(ROOT,'public','api','analytics.json'),{provider:validCounter?'goatcounter':null,site:validCounter?counter.replace(/\/$/,''):null});
  await fs.mkdir(path.join(ROOT,'public','machine'),{recursive:true});
  const machineHTML=await fs.readFile(path.join(ROOT,'public','machine.html'),'utf8');
  await fs.writeFile(path.join(ROOT,'public','machine','index.html'),machineHTML.replace('<base href="./">','<base href="../">'));
  await fs.writeFile(path.join(ROOT,'public','.nojekyll'),'');
  const items=posts.map(post=>`<item><title>${xml(post.title)}</title><link>${xml(baseURL+'/#post-'+post.id)}</link><guid isPermaLink="false">${xml(post.id)}</guid><pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate><description>${xml([post.promise,post.whatItIs,'Who pays: '+post.whoPays,'Evidence: '+post.evidence,'Limits: '+post.uncertainty,'Loop: '+post.loop.join(' → '),'First 24 hours: '+post.first24Hours.join(' '),'Sources: '+post.sources.map(s=>s.url).join(' ')].join('\n\n'))}</description><enclosure url="${xml(baseURL+'/cards/'+post.id+'.jpg')}" type="image/jpeg" length="0"/></item>`);
  // File sizes are required by RSS enclosure; replace them from the actual JPEGs.
  for(let i=0;i<items.length;i++){const stat=await fs.stat(path.join(ROOT,'public','cards',posts[i].id+'.jpg'));items[i]=items[i].replace('length="0"',`length="${stat.size}"`);}
  const rss=`<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>While You Sleep</title><link>${xml(baseURL)}</link><description>Real autonomous AI projects, evidence, and small first steps. Published by a checked Codex cloud loop.</description><language>en</language>${items.join('')}</channel></rss>\n`;
  await fs.writeFile(path.join(ROOT,'public','feed.xml'),rss);
  console.log(JSON.stringify({posts:posts.length,runs:runs.length,path:'public/api/feed.json'}));
}catch(error){console.error(safeError(error));process.exitCode=1;}
