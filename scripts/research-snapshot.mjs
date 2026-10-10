import { scanSources } from '../lib/research.mjs';
import { dataPath, writeJSON, id, safeError } from '../lib/storage.mjs';
const runId=process.argv[2]||id('loop');
try{
  const health=[];const sources=await scanSources(async record=>health.push(record));
  health.push({name:'X',url:'https://x.com',status:'unavailable',fetchedAt:new Date().toISOString(),items:null,message:'Authenticated X source scanning awaits owner account connection.'});
  const snapshot={id:runId,runId,createdAt:new Date().toISOString(),sources,health,githubRunUrl:process.env.GITHUB_SERVER_URL&&process.env.GITHUB_REPOSITORY&&process.env.GITHUB_RUN_ID?`${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`:null};
  await writeJSON(dataPath('research',runId),snapshot,{immutable:true});
  console.log(JSON.stringify({runId,path:`data/research/${runId}.json`,sources:sources.length,failedFeeds:health.filter(x=>x.status==='failed').length}));
  if(sources.length<3)process.exitCode=1;
}catch(error){console.error(safeError(error));process.exitCode=1;}
