import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SOCIAL_DEMAND_SOURCES,socialAvailability,safeSocialTaskExcerpts,canonicalSocialPostURL,parseRedditDemand,parseXDiscovery,reserveXIngestion,collectSocialDemand,officialSocialJSON,loadSocialDemandArtifact,socialArtifactProducer} from '../lib/social-demand.mjs';
import {privateArtifactReasons} from '../lib/privacy.mjs';
import {sha256,stableJSON} from '../lib/storage.mjs';

const now=new Date('2026-10-19T08:00:00.000Z'),task='Every week I manually copy customer invoices into spreadsheets and check unpaid balances';
const xUrl='https://x.com/i/status/1234567890123456789';
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const reddit=()=>({data:{children:[{kind:'t3',data:{id:'abc123',title:'A recurring invoice task',selftext:task,over_18:false,subreddit_type:'public',removed_by_category:null,created_utc:now.getTime()/1000-3600,author:'Never retain this account',author_fullname:'Never retain this profile'}}]}});
const xData=(posts=[{postUrl:xUrl,quote:task,publicEvidenceUrls:['https://example.com/service-pricing']}])=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({posts}),annotations:[{type:'url_citation',url:xUrl}]}]}],usage:{server_side_tool_usage_details:{x_posts_fetched:300,x_users_fetched:0,x_search_calls:1}}});
async function temp(t){const root=await mkdtemp(path.join(os.tmpdir(),'social-demand-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}

test('credentials absent or approval missing disables sources without network or quota writes',async t=>{
 const root=await temp(t);let calls=0;const result=await collectSocialDemand({root,runId:'loop-123-1',env:{},now,fetchImpl:()=>{calls++;throw new Error('No network allowed');}});
 assert.equal(calls,0);assert.deepEqual(result.sources,[]);assert.equal(result.health.every(row=>row.status==='disabled'),true);assert.equal(socialAvailability({REDDIT_CLIENT_ID:'fake',REDDIT_CLIENT_SECRET:'fake'})[0].reason,'awaiting_reddit_access_approval');assert.equal(socialAvailability({XAI_API_KEY:'fake'},{capMode:'unconfirmed'})[1].enabled,false);assert.deepEqual(await readdir(root),[]);
});
test('Reddit OAuth performs only token plus read search and excludes all account/contact fields',async t=>{
 const root=await temp(t),calls=[],env={REDDIT_CLIENT_ID:'fake-id',REDDIT_CLIENT_SECRET:'fake-secret',REDDIT_API_ACCESS_APPROVED:'true'};
 const result=await collectSocialDemand({root,runId:'loop-123-1',platform:'reddit',env,now,fetchImpl:async(url,options)=>{calls.push({url:String(url),options});return String(url).includes('/access_token')?json({access_token:'fake-short-lived-access-token',token_type:'bearer',expires_in:3600}):json(reddit());}});
 assert.equal(calls.length,2);assert.equal(calls[0].options.body,'grant_type=client_credentials');assert.equal(calls[0].options.redirect,'manual');assert.match(calls[1].url,/^https:\/\/oauth\.reddit\.com\/search\?/);assert.equal(result.sources.length,1);assert.equal(result.sources[0].role,'demand');assert.equal(result.sources[0].evidenceAuthority,'direct_official_api');assert.deepEqual(privateArtifactReasons(result),[]);assert.equal(/fake-secret|fake-short|Never retain|author/.test(JSON.stringify(result)),false);
});
test('independent Reddit retrieval fetches exact IDs and does not substitute search results',async t=>{
 const root=await temp(t),calls=[];const result=await collectSocialDemand({root,runId:'loop-123-1',phase:'check',platform:'reddit',sourceIds:['https://www.reddit.com/comments/not123'],env:{REDDIT_CLIENT_ID:'fake',REDDIT_CLIENT_SECRET:'fake',REDDIT_API_ACCESS_APPROVED:'true'},now,fetchImpl:async url=>{calls.push(String(url));return String(url).includes('/access_token')?json({access_token:'fake-access-token',token_type:'bearer',expires_in:3600}):json(reddit());}});
 assert.equal(calls[1].startsWith('https://oauth.reddit.com/api/info?'),true);assert.match(calls[1],/id=t3_not123/);assert.equal(result.sources.length,0);assert.equal(result.receipts[0].independentlyRefetched,true);
});
test('complete task sentences are kept verbatim; contacts, names, usernames and sensitive content are omitted whole',()=>{
 assert.deepEqual(safeSocialTaskExcerpts(task),[task]);for(const input of [task+' Contact me at person@example.invalid',task+' with Alice handling the reports',task+' @account',task+' for my cancer treatment'])assert.deepEqual(safeSocialTaskExcerpts(input),[]);
 const unsafe=reddit();unsafe.data.children[0].data.selftext=task+' Email person@example.invalid';assert.deepEqual(parseRedditDemand(unsafe,{now}),[]);const removed=reddit();removed.data.children[0].data.removed_by_category='deleted';assert.deepEqual(parseRedditDemand(removed,{now}),[]);
});
test('X quoted model output is discovery only and requires a real cited post identity',()=>{
 const result=parseXDiscovery(xData(),{now});assert.equal(result.sources.length,1);assert.equal(result.sources[0].role,'building');assert.equal(result.sources[0].demand,false);assert.equal(result.sources[0].verifiedAt,undefined);assert.equal(result.sources[0].evidenceAuthority,'model_cited_summary_not_primary_quote');assert.equal(result.providerUsage.postsFetched,300,'provider retrieval is explicitly distinct from the ingestion cap');
 const uncited=xData([{postUrl:'https://x.com/i/status/9999999999999999999',quote:task,publicEvidenceUrls:[]}]);assert.deepEqual(parseXDiscovery(uncited,{now}).sources,[]);assert.throws(()=>parseXDiscovery(xData(Array.from({length:11},()=>({postUrl:xUrl,quote:task,publicEvidenceUrls:[]}))),{now}),/bounded complete JSON/);
});
test('normalized public post URLs never retain usernames or query credentials',()=>{
 assert.equal(canonicalSocialPostURL('https://x.com/account_name/status/1234567890123456789?ref=tracking','x'),xUrl);assert.equal(canonicalSocialPostURL('https://www.reddit.com/r/smallbusiness/comments/abc123/request/','reddit'),'https://www.reddit.com/comments/abc123');for(const value of ['https://x.com/account_name','https://oauth.reddit.com/user/someone','https://secret@example.com/comments/abc123'])assert.throws(()=>canonicalSocialPostURL(value,'reddit'));
});
test('X reserves ten ingestion slots before network, counts failed requests, and stops at100',async t=>{
 const root=await temp(t);let calls=0;for(let index=0;index<10;index++){const result=await collectSocialDemand({root,runId:`loop-${index+1}-1`,platform:'x',env:{XAI_API_KEY:'fake'},now,fetchImpl:async()=>{calls++;throw new Error('private credential fake-secret must not be logged');}});assert.equal(result.health[0].reason,'social_api_unavailable');assert.equal(JSON.stringify(result).includes('fake-secret'),false);}
 const denied=await collectSocialDemand({root,runId:'loop-999-1',platform:'x',env:{XAI_API_KEY:'fake'},now,fetchImpl:async()=>{calls++;return json(xData());}});assert.equal(calls,10);assert.equal(denied.health[0].reason,'social_cap_exhausted');assert.equal((await readdir(path.join(root,'data/social-demand-quota'))).length,10);
});
test('a duplicate failed X attempt cannot reuse its reservation for another request',async t=>{
 const root=await temp(t);let calls=0;const input={root,runId:'loop-123-1',platform:'x',env:{XAI_API_KEY:'fake'},now,fetchImpl:async()=>{calls++;throw new Error('Uncertain transport failure');}};await collectSocialDemand(input);const duplicate=await collectSocialDemand(input);assert.equal(calls,1);assert.equal(duplicate.health[0].reason,'social_duplicate');
});
test('hosted X cannot call the provider until its immutable reservation has been persisted',async t=>{
 const root=await temp(t);let calls=0;const blocked=await collectSocialDemand({root,runId:'loop-123-1',platform:'x',env:{GITHUB_ACTIONS:'true',XAI_API_KEY:'fake'},now,fetchImpl:async()=>{calls++;return json(xData());}});assert.equal(calls,0);assert.equal(blocked.health[0].reason,'social_quota_persistence');
 let persisted=false;const success=await collectSocialDemand({root,runId:'loop-456-1',platform:'x',env:{GITHUB_ACTIONS:'true',XAI_API_KEY:'fake'},now,persistReservation:async({file,receipt})=>{assert.equal(JSON.parse(await readFile(path.join(root,file),'utf8')).id,receipt.id);persisted=true;},fetchImpl:async()=>{assert.equal(persisted,true);calls++;return json(xData());}});assert.equal(calls,1);assert.equal(success.sources.length,1);assert.equal(success.receipts[0].retained,1);
});
test('quota dates use Vilnius midnight and malformed receipts fail closed',async t=>{
 const root=await temp(t);const before=await reserveXIngestion({root,runId:'loop-1-1',now:new Date('2026-10-19T20:59:00Z')});const after=await reserveXIngestion({root,runId:'loop-2-1',now:new Date('2026-10-19T21:00:00Z')});assert.equal(before.day,'2026-10-19');assert.equal(after.day,'2026-10-20');await writeFile(path.join(root,'data/social-demand-quota/forged.json'),'{}');await assert.rejects(reserveXIngestion({root,runId:'loop-3-1',now}),/ledger could not/);
});
test('official API transport rejects alternate origins and redirects without exposing response bodies',async()=>{
 let calls=0;for(const url of ['http://api.x.ai/v1/responses','https://api.x.ai/v1/responses?secret=bad','https://api.x.ai/other','https://attacker.invalid/v1/responses'])await assert.rejects(officialSocialJSON(url,{method:'POST',fetchImpl:()=>{calls++;}}),/outside its fixed scope/);assert.equal(calls,0);
 await assert.rejects(officialSocialJSON('https://api.x.ai/v1/responses',{method:'POST',fetchImpl:async()=>new Response('private upstream credential',{status:302,headers:{location:'https://attacker.invalid'}})}),/^Error: Official social source request failed/);
});
test('social artifact acceptance binds exact trusted producer, hash, source identity and fresh retrieval receipt',async t=>{
 const root=await temp(t),env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'xndanius/while-you-sleep',GITHUB_REF:'refs/heads/main',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:'social_research',GITHUB_WORKFLOW_REF:'xndanius/while-you-sleep/.github/workflows/loop.yml@refs/heads/main',GITHUB_SHA:'a'.repeat(40)},producer=socialArtifactProducer(env),result=await collectSocialDemand({root,runId:'loop-123-1',env:{},now});result.producer=producer;const file=path.join(root,'artifact.json');await writeFile(file,JSON.stringify(result));const input={file,runId:'loop-123-1',phase:'research',expectedProducer:producer,expectedSha256:sha256(stableJSON(result))};assert.deepEqual(await loadSocialDemandArtifact(input),result);await assert.rejects(loadSocialDemandArtifact({...input,expectedProducer:{...producer,job:'writer'}}),/outside its fixed scope/);await assert.rejects(loadSocialDemandArtifact({...input,expectedSha256:'b'.repeat(64)}),/bounded complete JSON/);
 const changed={...result,sources:[{id:'fabricated',url:'https://www.reddit.com/comments/abc123',registrySourceId:SOCIAL_DEMAND_SOURCES[0].id}]};await writeFile(file,JSON.stringify(changed));await assert.rejects(loadSocialDemandArtifact({...input,expectedSha256:sha256(stableJSON(changed))}),/bounded complete JSON/);
});
