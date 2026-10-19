import {promises as fs} from 'node:fs';
import path from 'node:path';
import {hash,sha256,stableJSON,validId,canonicalURL} from './storage.mjs';
import {localParts} from './config.mjs';
import {privateArtifactReasons} from './privacy.mjs';
import {validateSocialReservation} from './social-demand.mjs';

// Fixed public-discussion adapters. Prices were checked against the public
// Actors API on 19 October 2026; live pricing is checked again before a run.
const actor=(name,id,unitUsd,startUsd,memory=512,extra={})=>Object.freeze({name,id,unitUsd,startUsd,memory,storeUrl:`https://apify.com/${name}`,...extra});
export const APIFY_ACTORS=Object.freeze({
 reddit:[actor('eiv/reddit-posts-comments-scraper','iE3TbAgb7Mcmwi4jz',.0015,.00005,1024),actor('trudax/reddit-scraper-lite','oAuCIx3ItNrs2okjQ',.004,.04,2048)],
 x:[actor('tweetapi/twitter-x-search-scraper','9057jzXTntFQ1bUA6',.00025,.001,256,{minimumCapUsd:.03}),actor('apidojo/twitter-scraper-lite','nfp1fpt5gUlBwPcor',.0004,.016,256,{minimumCapUsd:.02})],
 indiehackers:[actor('antishock/indiehackers-scraper','XfXDyutNFc1dlrdF8',.001,.002,512),actor('parseforge/indiehackers-posts-scraper','Igm5r98JzxnzQIV6b',.011,.02,4096)],
 producthunt:[actor('philzx/ph-launch-intelligence','ziPUD005zx8Ec0NzD',.00045,0,4096),actor('neuro-scraper/product-hunt-launches-scraper','JvOaG44V53KrUNMqr',.00299,0,1024)],
});
export const APIFY_DAILY_CAPS=Object.freeze({reddit:100,x:100,indiehackers:50,producthunt:50});
export const APIFY_MAX_AGE_HOURS=8;
export const APIFY_RUN_CAP_USD=.20;
export const APIFY_SUBREDDITS=Object.freeze(['smallbusiness','Entrepreneur','SaaS','startups','ecommerce','shopify','sweatystartup','freelance','agency','nocode','automation']);
export const APIFY_SCOPE_URLS=Object.freeze({reddit:'https://www.reddit.com/',x:'https://x.com/',indiehackers:'https://www.indiehackers.com/post',producthunt:'https://www.producthunt.com/' });
const folders={reservations:'apify-reservations',receipts:'apify-receipts',pools:'apify-pools'};
const terminal=new Set(['SUCCEEDED','FAILED','ABORTED','TIMED-OUT']);
const digest=value=>sha256(stableJSON(value));
const safeID=value=>typeof value==='string'&&/^[A-Za-z0-9]{5,60}$/.test(value);
const definitionId=platform=>hash(canonicalURL(APIFY_SCOPE_URLS[platform]));
const fileFor=(root,folder,id)=>path.join(root,'data',folders[folder],`${id}.json`);
async function put(root,folder,id,value){await fs.mkdir(path.dirname(fileFor(root,folder,id)),{recursive:true});await fs.writeFile(fileFor(root,folder,id),JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
async function boundedJSON(file,max=2_000_000){const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw new Error('Invalid bounded provider record.');return JSON.parse(await fs.readFile(file,'utf8'));}
async function records(root,folder){let names;try{names=await fs.readdir(path.join(root,'data',folders[folder]));}catch(e){if(e.code==='ENOENT')return [];throw e;}return Promise.all(names.filter(n=>/^[A-Za-z0-9_.-]+\.json$/.test(n)).sort().map(n=>boundedJSON(path.join(root,'data',folders[folder],n))));}
function stamp(now){return new Date(now).toISOString();}
function bucket(now){const p=localParts(new Date(now));return {day:p.day,index:Math.floor(Number(p.hour)/6)};}
function maxMonthlyUsd(value){const parsed=Number(value??10);return Number.isFinite(parsed)&&parsed>=0?Math.min(10,parsed):0;}
export function apifyAvailability(env={}, {officialPrimaryPlatforms=[]}={}){return Object.keys(APIFY_ACTORS).map(platform=>{
 const configured=platform==='reddit'&&env.REDDIT_CLIENT_ID&&env.REDDIT_CLIENT_SECRET&&env.REDDIT_API_ACCESS_APPROVED==='true'||platform==='x'&&env.XAI_API_KEY;
 return {platform,enabled:!!env.APIFY_TOKEN&&!configured&&!officialPrimaryPlatforms.includes(platform),reason:!env.APIFY_TOKEN?'awaiting_apify_token':officialPrimaryPlatforms.includes(platform)?'official_provider_preferred':configured?'official_primary_unavailable_until_validated':'enabled'};
});}
export function apifyArtifactProducer(env={}){
 const workflow=String(env.GITHUB_WORKFLOW_REF||'').match(/^xndanius\/while-you-sleep\/\.github\/workflows\/(loop|research)\.yml@refs\/heads\/main$/)?.[1],job=env.GITHUB_JOB;
 if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='xndanius/while-you-sleep'||env.GITHUB_REF!=='refs/heads/main'||!workflow||!/^\d+$/.test(env.GITHUB_RUN_ID||'')||!/^\d+$/.test(env.GITHUB_RUN_ATTEMPT||'')||!['social_research','social_check',...(workflow==='research'?['research']:[])].includes(job)||!/^[a-f0-9]{40}$/.test(env.APIFY_SOURCE_HEAD_SHA||env.SOCIAL_SOURCE_HEAD_SHA||env.GITHUB_SHA||''))throw new Error('Apify producer is outside trusted main-branch retrieval.');
 return {repository:env.GITHUB_REPOSITORY,runId:env.GITHUB_RUN_ID,runAttempt:Number(env.GITHUB_RUN_ATTEMPT),workflow:workflow+'.yml',job,stage:'trusted_api_retrieval',headSha:env.APIFY_SOURCE_HEAD_SHA||env.SOCIAL_SOURCE_HEAD_SHA||env.GITHUB_SHA};
}

export function canonicalApifyPostURL(raw,platform){
 const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.port)throw new Error('Non-public provider URL.');
 if(platform==='reddit'){
  if(!['www.reddit.com','reddit.com','old.reddit.com'].includes(u.hostname))throw new Error('Invalid Reddit post.');const m=u.pathname.match(/^\/(?:r\/[A-Za-z0-9_]+\/)?comments\/([a-z0-9]+)(?:\/|$)/i);if(!m)throw new Error('Invalid Reddit post.');return `https://www.reddit.com/comments/${m[1].toLowerCase()}`;
 }
 if(platform==='x'){
  if(!['x.com','www.x.com','twitter.com','www.twitter.com'].includes(u.hostname))throw new Error('Invalid X post.');const m=u.pathname.match(/^\/(?:[A-Za-z0-9_]+|i)\/(?:web\/)?status\/(\d+)(?:\/|$)/);if(!m)throw new Error('Invalid X post.');return `https://x.com/i/status/${m[1]}`;
 }
 const host=platform==='indiehackers'?'www.indiehackers.com':'www.producthunt.com';if(![host,host.slice(4)].includes(u.hostname))throw new Error('Invalid public discussion.');
 if(platform==='indiehackers'&&!/^\/post\/[a-z0-9-]+\/?$/i.test(u.pathname))throw new Error('Indie Hackers products and profiles are not discussions.');
 if(platform==='producthunt'&&!/^\/(?:posts\/[a-z0-9-]+|products\/[a-z0-9-]+(?:\/launches\/[a-z0-9-]+)?)\/?$/i.test(u.pathname))throw new Error('Invalid Product Hunt discussion.');
 const comment=u.hash.match(/^#comment-([0-9]+)$/)?.[1]||u.searchParams.get('comment');return `https://${host}${u.pathname.replace(/\/$/,'')}${platform==='producthunt'&&comment&&/^\d+$/.test(comment)?`?comment=${comment}`:''}`;
}
function literalText(value,max){
 if(typeof value!=='string')return '';
 const s=value.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
 // Drop a whole unsafe excerpt; do not put redacted or rewritten quotes in evidence.
 if(!s||privateArtifactReasons({text:s}).length||/(?:\B@[A-Za-z0-9_]+|\bu\/[A-Za-z0-9_-]+|https?:\/\/\S+|\b(?:patient|diagnosis|medical record|passport|ssn)\b)/i.test(s))return '';
 if(s.length<=max)return s;const sentences=s.match(/[^.!?]+[.!?](?:\s|$)/g)||[];let out='';for(const sentence of sentences){if((out+sentence).trim().length>max)break;out+=sentence;}return out.trim()||s.slice(0,max+1).replace(/\s+\S*$/,'').trim();
}
function dateValue(value){if(typeof value==='number')value=value<1e12?value*1000:value;const d=new Date(value);return value&&Number.isFinite(d.getTime())?d.toISOString():null;}
export function normalizeApifyPosts(platform,raw,{limit=25,now=new Date()}={}){
 if(!APIFY_ACTORS[platform]||!Array.isArray(raw))return [];
 let rows=raw;
 if(platform==='producthunt')rows=raw.flatMap(parent=>{
  if(parent.type==='comment'||parent.commentUrl||parent.comment_url)return [parent];
  return (Array.isArray(parent.comments)?parent.comments:[]).map(comment=>({...comment,commentUrl:comment.url||comment.commentUrl||comment.comment_url||(comment.id?`${parent.url||parent.productUrl||parent.product_url||''}#comment-${comment.id}`:''),discussionTitle:parent.name||parent.productName||parent.title}));
 });
 const out=[],seen=new Set();
 for(const row of rows){
  if(!row||row.isMock||row.mock||row.isPrivate||row.private||row.nsfw||row.over_18||row.deleted||row.removed||['error','summary','product'].includes(row.type))continue;
  try{
   const url=canonicalApifyPostURL(row.commentUrl||row.comment_url||row.url||row.postUrl||row.permalink||row.sourceUrl,platform);if(seen.has(url))continue;
   const title=literalText(row.title||row.discussionTitle||row.postTitle||row.productName||row.product_name||(platform==='x'?row.text||row.fullText||row.full_text:''),160),excerpt=literalText(row.selftext||row.selfText||row.body||row.content||row.text||row.fullText||row.full_text||row.discussionThread||row.description||row.title,200);
   if(!title||!excerpt)continue;
   const subreddit=String(row.subreddit||row.communityName||row.community||'').replace(/^r\//,'');
   if(platform==='reddit'&&!APIFY_SUBREDDITS.some(s=>s.toLowerCase()===subreddit.toLowerCase()))continue;
   if(platform==='x'&&row.lang&&row.lang!=='en')continue;
   const date=dateValue(row.createdAt||row.created_at||row.created_utc||row.publishedAt||row.date||row.postedAt);if(date&&new Date(date)>new Date(now))continue;
   const post={url,community:platform==='reddit'?`Reddit r/${APIFY_SUBREDDITS.find(s=>s.toLowerCase()===subreddit.toLowerCase())}`:platform==='x'?'X':platform==='indiehackers'?'Indie Hackers':'Product Hunt',date,title,excerpt};
   if(privateArtifactReasons(post).length)continue;out.push(post);seen.add(url);if(out.length>=limit)break;
  }catch{/* An unsupported public URL is not evidence. */}
 }
 return out;
}

export async function apifyJSON(endpoint,{token,method='GET',body,fetchImpl=fetch,timeoutMs=30_000}={}){
 const u=new URL(endpoint);if(u.origin!=='https://api.apify.com'||!/^\/v2\/(?:acts\/[A-Za-z0-9_~.-]+|actors\/[A-Za-z0-9_~.-]+\/runs|actor-runs\/[A-Za-z0-9]+|datasets\/[A-Za-z0-9]+\/items)$/.test(u.pathname)||[...u.searchParams.keys()].some(k=>!['timeout','memory','maxItems','maxTotalChargeUsd','waitForFinish','restartOnError','clean','limit','offset','format'].includes(k))||!['GET','POST'].includes(method)||method==='POST'&&!/^\/v2\/actors\//.test(u.pathname))throw new Error('Provider request outside its fixed public scope.');
 let response;try{response=await fetchImpl(u,{method,redirect:'manual',signal:AbortSignal.timeout(Math.min(timeoutMs,30_000)),headers:{accept:'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body),headers:{accept:'application/json','content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})}}:{})});}catch{throw new Error('Apify request unavailable; response and credentials withheld.');}
 if(!response.ok||Number(response.headers.get('content-length')||0)>2_000_000)throw new Error('Apify request failed; response and credentials withheld.');
 let text='';if(response.body?.getReader){const reader=response.body.getReader();try{while(true){const {done,value}=await reader.read();if(done)break;if(Buffer.byteLength(text)+value.length>2_000_000){await reader.cancel();throw new Error('Provider response exceeds limit.');}text+=new TextDecoder().decode(value);}}finally{reader.releaseLock();}}else text=await response.text();
 try{return JSON.parse(text);}catch{throw new Error('Apify returned no bounded complete JSON.');}
}

export function apifyHealthFromReceipts(receipts=[]){return Object.keys(APIFY_ACTORS).map(platform=>{
 const rows=receipts.filter(r=>r.platform===platform&&r.kind==='collection').sort((a,b)=>b.finishedAt.localeCompare(a.finishedAt));let streak=0;for(const row of rows){if(row.status==='succeeded'&&row.retained>0)break;streak++;}
 const switched=rows.some(r=>r.actorIndex===1);return {platform,status:streak>=2||switched?'probation':'active',consecutiveEmptyOrFailed:streak,actorIndex:streak>=2||switched?1:0,lastReason:rows[0]?.reason||'not_collected',lastCollectedAt:rows[0]?.finishedAt||null};
});}
export async function apifyHealth(root){return apifyHealthFromReceipts(await records(root,'receipts'));}
export async function apifyBudget(root,{now=new Date(),monthlyBudgetUsd=10}={}){
 const reservations=await records(root,'reservations'),receipts=await records(root,'receipts'),month=localParts(new Date(now)).day.slice(0,7),limit=maxMonthlyUsd(monthlyBudgetUsd);
 let used=0,measured=0;for(const r of reservations){if(r.schema!==1||!validId(r.id)||r.kind!=='apify_reservation'||!APIFY_ACTORS[r.platform]||!Number.isInteger(r.slots)||r.slots<1||r.slots>100||!Number.isFinite(r.maxChargeUsd)||r.maxChargeUsd<=0||r.maxChargeUsd>APIFY_RUN_CAP_USD||!/^\d{4}-\d{2}-\d{2}$/.test(r.day)||r.month!==r.day.slice(0,7))throw new Error('Apify budget ledger could not be validated.');if(r.month!==month)continue;used+=r.maxChargeUsd;const observation=receipts.find(s=>s.reservationId===r.id&&s.chargeKnown===true&&Number.isFinite(s.usageTotalUsd)&&s.usageTotalUsd>=0&&s.usageTotalUsd<=r.maxChargeUsd);if(observation)measured+=observation.usageTotalUsd;}
 // Terminal usage figures can still be preliminary. Every immutable request
 // cap remains charged to this month's allowance; observations release none.
 return {month,limitUsd:limit,usedOrReservedUsd:Number(used.toFixed(8)),measuredUsageUsd:Number(measured.toFixed(8)),remainingUsd:Math.max(0,Number((limit-used).toFixed(8))),reservations};
}
export async function apifyReservedSlots(root,{platform,day}={}){return (await records(root,'reservations')).filter(row=>row.platform===platform&&row.day===day).reduce((n,row)=>{if(row.kind!=='apify_reservation'||!Number.isSafeInteger(row.slots)||row.slots<1||row.slots>APIFY_DAILY_CAPS[platform])throw new Error('Apify daily ledger is invalid.');return n+row.slots;},0);}
async function officialReservedSlots(root,platform,day){if(platform!=='x')return 0;const dir=path.join(root,'data/social-demand-quota');let names;try{names=await fs.readdir(dir);}catch(e){if(e.code==='ENOENT')return 0;throw e;}let used=0;for(const name of names.filter(n=>n.endsWith('.json'))){const row=validateSocialReservation(await boundedJSON(path.join(dir,name),10_000));if(name!==row.id+'.json')throw new Error('Official social quota ledger is invalid.');if(row.day===day)used+=row.reservedPosts;}return used;}
export async function reserveApifyBatch({root,platform,runId,now=new Date(),monthlyBudgetUsd=10,persistReservation,hosted=false,actorIndex=0,kind='collection',slots:requestedSlots}={}){
 if(!validId(runId)||!APIFY_ACTORS[platform]||![0,1].includes(actorIndex))throw new Error('Invalid provider reservation identity.');
 const lock=path.join(root,'.discussion-ingestion-lock');await fs.mkdir(root,{recursive:true});try{await fs.mkdir(lock);}catch{throw new Error('Apify budget is locked; no request was made.');}
 try{
  const {day,index}=bucket(now),id=`apify-${platform}-${day}-${kind==='collection'?`b${index}`:hash(runId)}`;const budget=await apifyBudget(root,{now,monthlyBudgetUsd});if(budget.reservations.some(r=>r.id===id))return {allowed:false,reason:'apify_batch_already_reserved'};
  const used=budget.reservations.filter(r=>r.day===day&&r.platform===platform).reduce((n,r)=>n+r.slots,0)+await officialReservedSlots(root,platform,day),dailyRemaining=APIFY_DAILY_CAPS[platform]-used,slots=Math.min(requestedSlots||Math.ceil(APIFY_DAILY_CAPS[platform]/4),dailyRemaining);
  if(slots<1)return {allowed:false,reason:'apify_daily_item_cap'};
  const cfg=APIFY_ACTORS[platform][actorIndex],maxChargeUsd=Math.min(APIFY_RUN_CAP_USD,Math.max(cfg.minimumCapUsd||0,Number((slots*cfg.unitUsd+cfg.startUsd+.005).toFixed(6))));
  if(budget.remainingUsd+1e-9<maxChargeUsd)return {allowed:false,reason:'apify_monthly_budget_cap'};
  const receipt={schema:1,kind:'apify_reservation',id,runId,platform,actorIndex,actorName:cfg.name,day,month:day.slice(0,7),batch:index,slots,maxChargeUsd,createdAt:stamp(now)};
  await put(root,'reservations',id,receipt);if(hosted&&!persistReservation)throw new Error('Hosted Apify reservation must be committed before any request.');if(persistReservation)await persistReservation({root,receipt,file:`data/${folders.reservations}/${id}.json`});return {allowed:true,...receipt};
 }finally{await fs.rmdir(lock);}
}
function currentPricing(meta,now){return (meta.pricingInfos||[]).filter(p=>new Date(p.startedAt)<=new Date(now)).sort((a,b)=>b.startedAt.localeCompare(a.startedAt))[0];}
function validateActor(meta,cfg,reservation,now){
 if(!meta||meta.isDeprecated||meta.isUnderMaintenance||meta.notice&&meta.notice!=='NONE'||cfg.id&&meta.id!==cfg.id||!safeID(meta.id))throw new Error('Apify actor unavailable or identity changed.');const pricing=currentPricing(meta,now);if(!pricing||!['PRICE_PER_DATASET_ITEM','PAY_PER_EVENT'].includes(pricing.pricingModel)||Number(pricing.minimalMaxTotalChargeUsd||0)>reservation.maxChargeUsd)throw new Error('Actor pricing is not bounded pay per result.');
 if(new Date(meta.modifiedAt)<new Date(now)-180*86400_000)throw new Error('Apify actor has not been maintained recently.');return meta.id;
}
function buildInput(platform,index,slots,now,{stage='posts',urls=[]}={}){
 const phrase=['"is there a tool"','"how do you handle"','"I would pay"','"every week"'][bucket(now).index],query=`(${phrase} OR "I'd pay for") (business OR invoice OR customer OR shop OR client) lang:en -filter:retweets since:${new Date(new Date(now)-7*86400_000).toISOString().slice(0,10)}`;
 if(platform==='x')return index===0?{query,mode:'Latest',maxItems:slots}:{searchTerms:[query],sort:'Latest',maxItems:slots};
 if(platform==='reddit')return index===0?{searchQueries:[`${phrase} OR "I'd pay for"`],searchInSubreddits:APIFY_SUBREDDITS,sort:'new',timeframe:'week',postType:'text',includeComments:false,includeNsfw:false,skipStickied:true,maxPostsPerSource:3,maxTotalPosts:slots,maxPagesPerSource:1,maxConcurrency:2}:{startUrls:APIFY_SUBREDDITS.map(name=>({url:`https://www.reddit.com/r/${name}/search/?q=${encodeURIComponent(phrase)}&restrict_sr=1&sort=new&t=week`})),skipComments:true,skipUserPosts:true,skipCommunity:true,searchUsers:false,searchCommunities:false,searchComments:false,includeNSFW:false,maxItems:slots,maxPostCount:3,maxComments:0,sort:'new',time:'week'};
 if(platform==='indiehackers')return index===0?{type:'posts',maxItems:slots,minUpvotes:0,searchQuery:['tool','customer','manual','invoice'][bucket(now).index]}:{maxItems:slots,keywordFilter:['tool','customer','manual','invoice'][bucket(now).index]};
 if(index===0)return {mode:'leaderboard',leaderboardType:'daily',maxEntries:Math.min(3,slots),maxProducts:Math.min(3,slots),enrichProducts:true,includeComments:true,maxCommentsPerProduct:Math.min(5,slots),enrichCommenters:false,enrichMakers:false,includeBuiltWith:false,includeMedia:false,includePromotedAds:false,includeMomentum:false,includeLaunchHistory:false,includeWebsiteText:false,detectTechStack:false,extractEmails:false,featuredOnly:true};
 return stage==='discovery'?{mode:'leaderboard',leaderboardPeriod:'daily',maxItems:1}:{mode:'comments',productUrls:urls.slice(0,1),maxItems:slots};
}
async function runActor({cfg,actorId,reservation,input,token,fetchImpl}){
 const url=new URL(`https://api.apify.com/v2/actors/${cfg.name.replace('/','~')}/runs`);for(const [key,value] of Object.entries({timeout:120,memory:cfg.memory,maxItems:reservation.slots,maxTotalChargeUsd:reservation.maxChargeUsd,waitForFinish:25,restartOnError:false}))url.searchParams.set(key,String(value));
 // This POST is never retried: an uncertain response consumes the reservation.
 let run=(await apifyJSON(url,{method:'POST',body:input,token,fetchImpl})).data;if(!safeID(run?.id)||run.actId!==actorId)throw new Error('Apify run identity was not confirmed.');
 for(let n=0;n<5&&!terminal.has(run.status);n++)run=(await apifyJSON(`https://api.apify.com/v2/actor-runs/${run.id}?waitForFinish=25`,{token,fetchImpl})).data;
 if(!terminal.has(run.status))throw new Error('Apify run did not complete within its bounded wait.');
 if(!safeID(run.defaultDatasetId)||run.actId!==actorId||Number(run.options?.maxTotalChargeUsd)!==reservation.maxChargeUsd)throw new Error('Apify dataset identity or hard charge bound was not confirmed.');
 // Apify documents preliminary costs immediately after terminal completion.
 // Reopen after ten seconds for an informational observation only. Even an
 // unchanged observation never releases the immutable monthly reservation.
 let stable=false;try{const wait=Math.max(0,10_000-(Date.now()-Date.parse(run.finishedAt)));if(Number.isFinite(wait)&&wait<=10_000){if(wait)await new Promise(resolve=>setTimeout(resolve,wait));const confirmed=(await apifyJSON(`https://api.apify.com/v2/actor-runs/${run.id}`,{token,fetchImpl})).data;if(confirmed.id===run.id&&confirmed.actId===actorId&&confirmed.status===run.status&&confirmed.defaultDatasetId===run.defaultDatasetId&&Number(confirmed.options?.maxTotalChargeUsd)===reservation.maxChargeUsd){run=confirmed;stable=true;}}}catch{/* Unknown final billing retains the entire monetary reservation. */}
 const known=stable&&Number.isFinite(run.usageTotalUsd)&&run.usageTotalUsd>=0&&run.usageTotalUsd<=reservation.maxChargeUsd;
 if(run.status!=='SUCCEEDED')return {run,rows:[],known};
 const rows=await apifyJSON(`https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?clean=true&limit=${reservation.slots}&format=json`,{token,fetchImpl});if(!Array.isArray(rows))throw new Error('Apify dataset was not a bounded post list.');return {run,rows:rows.slice(0,reservation.slots),known};
}
export async function collectApifyPool({root,runId,env={},now=new Date(),platforms=Object.keys(APIFY_ACTORS),fetchImpl=fetch,persistReservation}={}){
 if(!validId(runId))throw new Error('Invalid provider collection identity.');const health=[],receipts=[],items=[];const existing=await records(root,'receipts'),states=apifyHealthFromReceipts(existing);
 for(const platform of platforms){const available=apifyAvailability(env).find(r=>r.platform===platform);if(!available?.enabled){health.push({...available,status:'disabled'});continue;}
  const actorIndex=states.find(r=>r.platform===platform).actorIndex,cfg=APIFY_ACTORS[platform][actorIndex];let reservation;
  try{reservation=await reserveApifyBatch({root,platform,runId,now,monthlyBudgetUsd:env.APIFY_MONTHLY_BUDGET_USD,persistReservation,hosted:env.GITHUB_ACTIONS==='true',actorIndex});}catch{health.push({platform,status:'unavailable',reason:'apify_quota_persistence'});continue;}
  if(!reservation.allowed){health.push({platform,status:'skipped',reason:reservation.reason});continue;}
  const receipt={schema:1,kind:'collection',id:reservation.id,runId,platform,definitionId:definitionId(platform),reservationId:reservation.id,actorName:cfg.name,actorIndex,maxChargeUsd:reservation.maxChargeUsd,reservedSlots:reservation.slots,startedAt:stamp(now),finishedAt:stamp(now),status:'failed',reason:'apify_request_unavailable',retained:0,chargeKnown:false};
  try{
   const meta=(await apifyJSON(`https://api.apify.com/v2/acts/${cfg.name.replace('/','~')}`,{token:env.APIFY_TOKEN,fetchImpl})).data,actorId=validateActor(meta,cfg,reservation,now);
   if(platform==='producthunt'&&actorIndex===1){
    // A separate reservation pays for launch discovery; only comment rows ever
    // enter the demand pool. Failed discovery consumes its day/month allowance.
    const discovery=await reserveApifyBatch({root,platform,runId:`${runId}-discovery`,now,monthlyBudgetUsd:env.APIFY_MONTHLY_BUDGET_USD,persistReservation,hosted:env.GITHUB_ACTIONS==='true',actorIndex,kind:'discovery',slots:1});if(!discovery.allowed)throw new Error('No bounded Product Hunt discovery budget.');
    const found=await runActor({cfg,actorId,reservation:discovery,input:buildInput(platform,actorIndex,1,now,{stage:'discovery'}),token:env.APIFY_TOKEN,fetchImpl});
    const discoveryReceipt={schema:1,kind:'discovery',id:discovery.id,runId,platform,reservationId:discovery.id,finishedAt:stamp(now),status:found.run.status==='SUCCEEDED'?'succeeded':'failed',chargeKnown:found.known,...(found.known?{usageTotalUsd:found.run.usageTotalUsd}:{})};await put(root,'receipts',discovery.id,discoveryReceipt);
    const urls=found.rows.map(row=>row.productUrl||row.product_url||row.url).filter(url=>{try{return new URL(url).hostname==='www.producthunt.com';}catch{return false;}});if(!urls.length)throw new Error('No public Product Hunt discussion to read.');receipt.discoveryReceiptId=discovery.id;receipt.discoveryUrls=urls.slice(0,1);
   }
   const fetched=await runActor({cfg,actorId,reservation,input:buildInput(platform,actorIndex,reservation.slots,now,{urls:receipt.discoveryUrls||[]}),token:env.APIFY_TOKEN,fetchImpl}),posts=normalizeApifyPosts(platform,fetched.rows,{limit:reservation.slots,now});
   Object.assign(receipt,{actorId,actorRunId:fetched.run.id,datasetId:fetched.run.defaultDatasetId,status:fetched.run.status==='SUCCEEDED'?'succeeded':'failed',reason:fetched.run.status==='SUCCEEDED'?(posts.length?'collected':'apify_empty_public_discussions'):'apify_actor_failed',capturedAt:dateValue(fetched.run.finishedAt)||stamp(now),chargeKnown:fetched.known,...(fetched.known?{usageTotalUsd:fetched.run.usageTotalUsd}:{}),retained:posts.length,poolPath:`data/${folders.pools}/${receipt.id}.json`,poolHash:digest(posts)});
   await put(root,'pools',receipt.id,posts);
  }catch{/* Raw actor data, exception bodies and credentials are never persisted. */}
  receipt.finishedAt=stamp(new Date());await put(root,'receipts',receipt.id,receipt);receipts.push(receipt);health.push({platform,status:receipt.status,reason:receipt.reason,retained:receipt.retained,actorName:cfg.name});
 }
 const readAt=new Date(Math.max(new Date(now).getTime(),...receipts.map(receipt=>Date.parse(receipt.capturedAt)||0)));
 items.push(...await loadApifyPool(root,{now:readAt}));return {schema:1,runId,createdAt:stamp(now),items,receipts,health,budget:await apifyBudget(root,{now,monthlyBudgetUsd:env.APIFY_MONTHLY_BUDGET_USD})};
}
export async function validateApifyPoolProof(root,proof,{definitionId:expectedDefinition,postUrl,now=new Date(),maxAgeHours=APIFY_MAX_AGE_HOURS}={}){
 try{
  if(proof?.provider!=='apify'||!APIFY_ACTORS[proof.platform]||!validId(proof.receiptId)||proof.definitionId!==definitionId(proof.platform)||expectedDefinition&&proof.definitionId!==expectedDefinition)return false;
  const receipt=await boundedJSON(fileFor(root,'receipts',proof.receiptId)),reservation=await boundedJSON(fileFor(root,'reservations',proof.receiptId));
  const cfg=APIFY_ACTORS[proof.platform][receipt.actorIndex];
  if(receipt.schema!==1||receipt.kind!=='collection'||receipt.status!=='succeeded'||receipt.retained<1||receipt.platform!==proof.platform||receipt.definitionId!==proof.definitionId||receipt.poolHash!==proof.poolHash||receipt.id!==reservation.id||receipt.actorName!==cfg?.name||receipt.actorId!==cfg.id||reservation.actorName!==receipt.actorName||reservation.platform!==receipt.platform||reservation.maxChargeUsd!==receipt.maxChargeUsd||reservation.slots<receipt.retained||receipt.poolPath!==`data/${folders.pools}/${receipt.id}.json`||!safeID(receipt.actorRunId)||!safeID(receipt.datasetId)||!safeID(receipt.actorId))return false;
  const age=new Date(now)-new Date(receipt.capturedAt);if(!Number.isFinite(age)||age<0||age>Math.min(APIFY_MAX_AGE_HOURS,maxAgeHours)*3600_000)return false;
  const posts=await boundedJSON(fileFor(root,'pools',receipt.id));if(!Array.isArray(posts)||posts.length!==receipt.retained||posts.length>reservation.slots||digest(posts)!==proof.poolHash)return false;
  return posts.some(post=>post.url===postUrl&&digest(post)===proof.postHash&&Object.keys(post).sort().join(',')==='community,date,excerpt,title,url'&&canonicalApifyPostURL(post.url,proof.platform)===post.url&&post.excerpt.length<=200&&!privateArtifactReasons(post).length);
 }catch{return false;}
}
export async function loadApifyPool(root,{now=new Date(),platforms=Object.keys(APIFY_ACTORS),maxAgeHours=APIFY_MAX_AGE_HOURS}={}){
 const all=await records(root,'receipts'),items=[],seen=new Set();for(const receipt of all.filter(r=>r.kind==='collection'&&r.status==='succeeded'&&platforms.includes(r.platform)).sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt))){
  let posts;try{posts=await boundedJSON(fileFor(root,'pools',receipt.id));}catch{continue;}if(!Array.isArray(posts))continue;
  for(const post of posts){const proof={provider:'apify',platform:receipt.platform,definitionId:receipt.definitionId,receiptId:receipt.id,poolHash:receipt.poolHash,postHash:digest(post)};if(seen.has(post.url)||!await validateApifyPoolProof(root,proof,{postUrl:post.url,now,maxAgeHours}))continue;seen.add(post.url);items.push({platform:receipt.platform,post,proof,capturedAt:receipt.capturedAt,actorId:receipt.actorId,runId:receipt.actorRunId,datasetId:receipt.datasetId,poolPath:receipt.poolPath});}
 }return items;
}
export async function rereadApifyEvidence(root,postUrl,{token,fetchImpl=fetch,now=new Date(),maxAgeHours=APIFY_MAX_AGE_HOURS}={}){
 const item=(await loadApifyPool(root,{now,maxAgeHours})).find(row=>row.post.url===postUrl);if(!item)return null;
 // An independent model may reopen the exact sealed public capture without a
 // secret. This is explicitly a receipt reread, never a new public-site fetch.
 if(!token)return {platform:item.platform,post:item.post,proof:item.proof,capturedAt:item.capturedAt,independentlyReadAt:stamp(now),independentlyReread:true,providerDatasetReread:false,evidenceAuthority:'trusted_provider_public_post',livePostRefetched:false};
 const receipt=await boundedJSON(fileFor(root,'receipts',item.proof.receiptId)),run=(await apifyJSON(`https://api.apify.com/v2/actor-runs/${receipt.actorRunId}`,{token,fetchImpl})).data;
 if(run?.status!=='SUCCEEDED'||run.actId!==receipt.actorId||run.defaultDatasetId!==receipt.datasetId||run.id!==receipt.actorRunId)return null;
 const raw=await apifyJSON(`https://api.apify.com/v2/datasets/${receipt.datasetId}/items?clean=true&limit=${receipt.reservedSlots}&format=json`,{token,fetchImpl}),posts=normalizeApifyPosts(receipt.platform,raw,{limit:receipt.reservedSlots,now});
 const post=posts.find(p=>p.url===postUrl&&digest(p)===item.proof.postHash);if(!post)return null;
 return {platform:item.platform,post,proof:item.proof,capturedAt:receipt.capturedAt,independentlyReadAt:stamp(now),independentlyReread:true,providerDatasetReread:true,evidenceAuthority:'trusted_provider_public_post',livePostRefetched:false};
}
export async function loadApifyArtifact({file,runId,phase,expectedSha256,expectedProducer,now=new Date()}={}){
 if(!validId(runId)||!['research','check'].includes(phase)||!expectedProducer||expectedProducer.repository!=='xndanius/while-you-sleep'||expectedProducer.stage!=='trusted_api_retrieval'||![(phase==='check'?'social_check':'social_research'),...(phase==='research'&&expectedProducer.workflow==='research.yml'?['research']:[])].includes(expectedProducer.job)||!['loop.yml','research.yml'].includes(expectedProducer.workflow)||!/^\d+$/.test(expectedProducer.runId||'')||!Number.isSafeInteger(expectedProducer.runAttempt)||expectedProducer.runAttempt<1||!/^[a-f0-9]{40}$/.test(expectedProducer.headSha||'')||runId!==`loop-${expectedProducer.runId}-${expectedProducer.runAttempt}`&&runId!==`research-${expectedProducer.runId}-${expectedProducer.runAttempt}`||!/^[a-f0-9]{64}$/.test(expectedSha256||''))throw new Error('Apify artifact producer is outside its trusted retrieval stage.');
 const data=await boundedJSON(file);if(data.schema!==1||data.runId!==runId||data.phase!==phase||digest(data)!==expectedSha256||stableJSON(data.producer)!==stableJSON(expectedProducer)||!Array.isArray(data.items)||data.items.length>300||privateArtifactReasons(data).length)throw new Error('Apify artifact is not bounded complete trusted JSON.');
 for(const item of data.items){const age=new Date(now)-new Date(item.capturedAt);if(!APIFY_ACTORS[item.platform]||item.proof?.provider!=='apify'||item.proof.platform!==item.platform||item.proof.definitionId!==definitionId(item.platform)||digest(item.post)!==item.proof.postHash||canonicalApifyPostURL(item.post.url,item.platform)!==item.post.url||Object.keys(item.post).sort().join(',')!=='community,date,excerpt,title,url'||item.post.excerpt.length>200||!Number.isFinite(age)||age<0||age>APIFY_MAX_AGE_HOURS*3600_000||phase==='check'&&(!item.independentlyReread||!Number.isFinite(Date.parse(item.independentlyReadAt))))throw new Error('Apify artifact contains unsupported or stale evidence.');}
 return data;
}
