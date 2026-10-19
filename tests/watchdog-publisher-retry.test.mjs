import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {runWatchdog,repairPublisherRetryEligible,watchdogRequestAllowed} from '../scripts/watchdog.mjs';

const repo='xndanius/while-you-sleep',episodeId='starvation-'+'a'.repeat(20),runId='123',head='c'.repeat(40);
const bot={login:'github-actions[bot]',type:'Bot'};
const metadata={id:123,run_attempt:1,event:'workflow_dispatch',status:'completed',conclusion:'failure',path:'.github/workflows/repair.yml',head_branch:'main',head_sha:head,repository:{full_name:repo},head_repository:{full_name:repo,fork:false},actor:bot,triggering_actor:bot};
const jobs={total_count:3,jobs:['gate','propose','publish-draft'].map((name,index)=>({id:1000+index,run_id:123,run_attempt:1,head_sha:head,name,status:'completed',conclusion:index===2?'failure':'success'}))};
const actions={issueNumber:12,issueEpisode:episodeId,repairEpisode:episodeId,repairStatus:'dispatched',repairRunUrl:`https://github.com/${repo}/actions/runs/${runId}`};
const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:repo,GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'900',GITHUB_RUN_ATTEMPT:'1'};
const caller={...metadata,id:900,path:'.github/workflows/clock.yml',status:'in_progress',conclusion:null};
const now=new Date('2026-10-19T09:30:00Z');
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'watchdog-publisher-retry-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'data','posts'),{recursive:true});await fs.mkdir(path.join(root,'data','runs'));await fs.mkdir(path.join(root,'data','watchdog'));
 const previous={schema:1,mode:'repair',episode:{id:episodeId,mode:'repair',raisedAt:'2026-10-19T00:00:00Z',since:'2026-10-17T00:00:00Z'},actions};
 await fs.writeFile(path.join(root,'data','watchdog','state.json'),JSON.stringify(previous));await fs.writeFile(path.join(root,'data','runs','old.json'),JSON.stringify({id:'old',type:'loop',startedAt:'2026-10-17T00:00:00Z',finishedAt:'2026-10-17T01:00:00Z',status:'completed_no_post',published:[],rejected:[{reason:'No fresh lead'}]}));
 const order=[],commits=[];const commit=async(_root,state)=>{commits.push(structuredClone(state));order.push('commit-'+state.actions.publisherRetryStatus);await fs.writeFile(path.join(root,'data','watchdog','state.json'),JSON.stringify(state));return true;};return{root,order,commits,commit};
}
test('publisher retry accepts only exact original bot run and successful gate/model jobs',()=>{
 assert.equal(repairPublisherRetryEligible(metadata,jobs,{runId,episodeId,actions}),true);
 for(const change of [{status:'in_progress'},{conclusion:'success'},{run_attempt:2},{head_sha:'wrong'},{path:'.github/workflows/loop.yml'},{triggering_actor:{login:'xndanius',type:'User'}},{head_repository:{full_name:repo,fork:true}}])assert.equal(repairPublisherRetryEligible({...metadata,...change},jobs,{runId,episodeId,actions}),false);
 for(const name of ['gate','propose']){const changed=structuredClone(jobs);changed.jobs.find(job=>job.name===name).conclusion='failure';assert.equal(repairPublisherRetryEligible(metadata,changed,{runId,episodeId,actions}),false);}
 for(const change of [{run_attempt:2},{run_id:999},{head_sha:'d'.repeat(40)},{status:'queued'}]){const changed=structuredClone(jobs);Object.assign(changed.jobs[2],change);assert.equal(repairPublisherRetryEligible(metadata,changed,{runId,episodeId,actions}),false);}
 assert.equal(repairPublisherRetryEligible(metadata,{...jobs,total_count:4},{runId,episodeId,actions}),false);
 assert.equal(repairPublisherRetryEligible(metadata,jobs,{runId,episodeId,actions:{...actions,publisherRetryRunId:runId,publisherRetryEpisode:episodeId}}),false);
});
test('watchdog reserves one failed-job retry durably before POST and never dispatches the model again',async t=>{
 const f=await fixture(t);let posts=0;
 const api=async(endpoint,options={})=>{
  if(options.method==='POST'){assert.equal(endpoint,`repos/${repo}/actions/runs/123/rerun-failed-jobs`);const saved=JSON.parse(await fs.readFile(path.join(f.root,'data/watchdog/state.json'),'utf8'));assert.equal(saved.actions.publisherRetryStatus,'reserved');assert.equal(saved.actions.publisherRetryAttempt,2);f.order.push('rerun');posts++;return null;}
  if(endpoint.endsWith('/runs/900'))return caller;if(endpoint.endsWith('/runs/123'))return metadata;if(endpoint.endsWith('/attempts/1/jobs?per_page=100'))return jobs;throw Error('No other API operation allowed.');
 };
 const result=await runWatchdog({...f,env,now,api});assert.equal(result.health.actions.publisherRetryStatus,'requested');assert.deepEqual(f.order,['commit-reserved','rerun','commit-requested']);assert.equal(posts,1);
 await runWatchdog({...f,env,now,api});assert.equal(posts,1);
});
test('uncertain retry POST remains reserved against duplicate billing and incomplete model jobs never retry',async t=>{
 for(const broken of ['post','model','caller']){
  const f=await fixture(t);let posts=0;
  const api=async(endpoint,options={})=>{
   if(options.method==='POST'){posts++;throw Error('Uncertain response.');}
   if(endpoint.endsWith('/runs/900'))return broken==='caller'?{...caller,triggering_actor:{login:'xndanius',type:'User'}}:caller;
   if(endpoint.endsWith('/runs/123'))return metadata;if(endpoint.endsWith('/attempts/1/jobs?per_page=100'))return broken==='model'?{...jobs,jobs:jobs.jobs.map(job=>job.name==='propose'?{...job,conclusion:'failure'}:job)}:jobs;throw Error('Unexpected request.');
  };
  const result=await runWatchdog({...f,env,now,api});assert.equal(posts,broken==='post'?1:0);if(broken==='post'){assert.equal(result.health.actions.publisherRetryStatus,'unverified');await runWatchdog({...f,env,now,api});assert.equal(posts,1);}else assert.equal(result.health.actions.publisherRetryRunId,undefined);
 }
});
test('watchdog API permits immutable attempt-one job reads and only failed-job retry mutation',()=>{
 assert.equal(watchdogRequestAllowed(`repos/${repo}/actions/runs/123/attempts/1/jobs?per_page=100`),true);assert.equal(watchdogRequestAllowed(`repos/${repo}/actions/runs/123/rerun-failed-jobs`,'POST'),true);
 for(const [endpoint,method] of [[`repos/${repo}/actions/runs/123/rerun`,'POST'],[`repos/${repo}/actions/runs/123/attempts/2/jobs?per_page=100`,'GET'],[`repos/${repo}/actions/runs/123/rerun-failed-jobs`,'GET'],[`repos/${repo}/actions/runs/123`,'POST'],[`repos/${repo}/actions/workflows/loop.yml/dispatches`,'POST']])assert.equal(watchdogRequestAllowed(endpoint,method),false);
});
