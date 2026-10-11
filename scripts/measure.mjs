import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, records, writeJSON, validId } from '../lib/storage.mjs';
import { trustedScheduledMetadata } from './prepare-scheduled-job.mjs';

const PROJECT_START = '2026-10-10T00:00:00.000Z';
const HOUR = 3_600_000;
const PLATFORMS = ['x', 'instagram', 'linkedin'];
const SOCIAL_KEYS = new Set(['views','impressions','likes','reactions','comments','replies','shares','reposts','followers','follows','clicks','reach','engagement','saves','post_clicks','post_impressions','profile_visits','new_followers']);
const SAFE_STATES = new Set(['measured','partial','unavailable','pending_setup','not_connected','failed','published','submitted','publication_unknown','weekly_digest_pending','blocked_unchecked']);
const count = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const metric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,160}$/.test(value) ? value : null;
const safeState = value => SAFE_STATES.has(value) ? value : 'unavailable';
const timestamp = value => typeof value === 'string' && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function goatCounterSite(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/' ||
      !/^[a-z0-9][a-z0-9-]{0,62}\.goatcounter\.com$/.test(url.hostname) || url.hostname === 'www.goatcounter.com') return null;
    return url.origin;
  } catch { return null; }
}

export function measurementPeriod(now = new Date()) {
  const end = new Date(Math.floor(new Date(now).getTime() / HOUR) * HOUR).toISOString();
  return { start: PROJECT_START, end, basis: 'project_to_date_complete_hours', timezone: 'UTC' };
}

function siteUnavailable(status, reason, period, posts, measuredAt) {
  return { site:{provider:'goatcounter',status,views:null,saves:null,measuredAt,period,reason},
    posts:posts.map(post => ({postId:post.id,views:null,saves:null,status,measuredAt,period})) };
}

/** Only aggregate totals and known public post IDs can leave this function. */
export async function measureGoatCounter(posts = [], env = process.env, options = {}) {
  const now = options.now || new Date();
  const measuredAt = new Date(now).toISOString();
  const period = measurementPeriod(now);
  const publicPosts = posts.filter(post => safeId(post?.id));
  const site = goatCounterSite(env.GOATCOUNTER_SITE);
  if (!env.GOATCOUNTER_SITE) return siteUnavailable('not_connected','A website counter has not been connected.',period,publicPosts,measuredAt);
  if (!site) return siteUnavailable('invalid_configuration','GOATCOUNTER_SITE must be an HTTPS hosted GoatCounter site origin.',period,publicPosts,measuredAt);
  if (!env.GOATCOUNTER_API_TOKEN) return siteUnavailable('awaiting_api_access','The counter is configured; its read-only API secret is not connected.',period,publicPosts,measuredAt);
  const fetcher = options.fetch || fetch;
  let previousRequest = 0;
  async function get(endpoint, query = {}) {
    if (!options.noDelay) await wait(Math.max(0,350 - (Date.now() - previousRequest)));
    previousRequest = Date.now();
    const url = new URL(`/api/v0/${endpoint}`,site);
    for (const [key,value] of Object.entries({...period,start:period.start,end:period.end,...query})) {
      if (['start','end','limit','path_by_name','include_paths','exclude_paths'].includes(key)) url.searchParams.set(key,String(value));
    }
    let response;
    try {
      response = await fetcher(url,{headers:{Authorization:`Bearer ${env.GOATCOUNTER_API_TOKEN}`,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});
    } catch { throw new Error('network_error'); }
    if (!response.ok) throw new Error(`http_${Number(response.status) || 'error'}`);
    try { return await response.json(); } catch { throw new Error('invalid_response'); }
  }
  let views = null;
  try {
    // Filtering the canonical feed path excludes /machine and every event.
    const total = await get('stats/total',{path_by_name:true,include_paths:'/'});
    if (count(total.total) === null || count(total.total_events) === null || total.total_events > total.total) throw new Error('invalid_response');
    views = total.total - total.total_events;
    const known = new Set(publicPosts.map(post => post.id));
    const counts = new Map(publicPosts.map(post => [post.id,{views:0,saves:0}]));
    const excluded = new Set();
    let complete = false;
    for (let page = 0; page < 100; page++) {
      const result = await get('stats/hits',{limit:100,...(excluded.size ? {exclude_paths:[...excluded].join(',')} : {})});
      if (!Array.isArray(result.hits)) throw new Error('invalid_response');
      let newPaths = 0;
      for (const hit of result.hits) {
        if (count(hit.path_id) !== null && excluded.has(hit.path_id)) continue;
        if (count(hit.path_id) !== null && !excluded.has(hit.path_id)) { excluded.add(hit.path_id); newPaths++; }
        if (hit.event !== true || typeof hit.path !== 'string') continue;
        const match = /^(view|save):([A-Za-z0-9][A-Za-z0-9_.-]{0,160})$/.exec(hit.path);
        if (!match || !known.has(match[2])) continue;
        if (count(hit.count) === null) throw new Error('invalid_response');
        const key = match[1] === 'view' ? 'views' : 'saves';
        counts.get(match[2])[key] += hit.count;
      }
      if (result.more !== true) { complete = true; break; }
      if (!newPaths) throw new Error('invalid_pagination');
    }
    if (!complete) throw new Error('pagination_limit');
    const measuredPosts = publicPosts.map(post => ({postId:post.id,...counts.get(post.id),status:'measured',source:'goatcounter',measuredAt,period}));
    return {site:{provider:'goatcounter',status:'measured',views,saves:measuredPosts.reduce((sum,post) => sum + post.saves,0),measuredAt,period,
      basis:'Feed page visits and observed save events; blocked tracking is not estimated.'},posts:measuredPosts};
  } catch (error) {
    const reason = /^http_\d+$/.test(error.message) ? `The counter API returned ${error.message.slice(5)}.`
      : error.message === 'network_error' ? 'The counter API could not be reached.' : 'The counter API did not return a complete valid measurement.';
    const result = siteUnavailable(views === null ? 'unavailable' : 'partial',reason,period,publicPosts,measuredAt);
    if (views !== null) result.site.views = views;
    return result;
  }
}

function sanitizedMetrics(values) {
  return Object.fromEntries(Object.entries(values || {}).filter(([key,value]) => SOCIAL_KEYS.has(key) && metric(value) !== null));
}

function socialMetric(value) {
  const metrics = sanitizedMetrics(value?.metrics);
  const result = {status:Object.keys(metrics).length ? 'measured' : value?.status === 'measured' ? 'unavailable' : safeState(value?.status),metrics};
  if (value?.publication) result.publication = {status:safeState(value.publication.status),
    ...(safeId(value.publication.providerPostId) ? {providerPostId:value.publication.providerPostId} : {})};
  return result;
}

export function sanitizeSocial(input, now = new Date()) {
  const posts = (Array.isArray(input?.posts) ? input.posts : []).filter(post => safeId(post?.postId)).map(post => ({postId:post.postId,
    ...Object.fromEntries(PLATFORMS.filter(platform => post[platform]).map(platform => [platform,socialMetric(post[platform])]))}));
  const channels = (Array.isArray(input?.channels) ? input.channels : []).filter(channel => safeId(channel?.channelId)).map(channel => ({channelId:channel.channelId,...socialMetric(channel)}));
  const states = [...posts.flatMap(post => PLATFORMS.map(platform => post[platform]?.status).filter(Boolean)),...channels.map(channel => channel.status)];
  const status = input?.status === 'pending_setup' || input?.status === 'not_connected' ? 'not_connected'
    : states.includes('measured') ? states.some(state => state !== 'measured') ? 'partial' : 'measured' : 'unavailable';
  return {provider:'postiz',status,measuredAt:timestamp(input?.measuredAt) || new Date(now).toISOString(),posts,channels};
}

/** Merge only the latest public receipt for each post/platform before querying. */
export function latestSocialRecords(publications) {
  const result = new Map();
  const sorted = [...publications].sort((a,b) => (timestamp(b.createdAt || b.submittedAt) || '').localeCompare(timestamp(a.createdAt || a.submittedAt) || ''));
  for (const record of sorted) {
    const postId = safeId(record.postId);
    if (!postId) continue;
    if (!result.has(postId)) result.set(postId,{postId,social:{}});
    const social = record.social || record.results || {};
    for (const platform of PLATFORMS) if (!result.get(postId).social[platform] && social[platform]) result.get(postId).social[platform] = social[platform];
  }
  return [...result.values()];
}

export async function collectMetrics({posts = [],publications = [],env = process.env,now = new Date(),fetch:fetcher,noDelay = false} = {}) {
  const site = await measureGoatCounter(posts,env,{now,fetch:fetcher,noDelay});
  const social = {provider:'zapier',status:'not_connected',measuredAt:new Date(now).toISOString(),posts:[],channels:[],
    reason:'LinkedIn Page posting is relayed from RSS. LinkedIn metrics have not been connected.'};
  return {schemaVersion:1,measuredAt:new Date(now).toISOString(),site:site.site,posts:site.posts,social,
    privacy:'Aggregate counts only. No provider response bodies, IP addresses, referrers, session identifiers, or credentials are committed.'};
}

export async function runMeasurement({env = process.env,now = new Date(),fetch:fetcher,root = ROOT} = {}) {
  const startedAt = new Date(now).toISOString();
  const runId = env.RUN_ID || `measure-${Date.now()}`;
  if (!validId(runId)) throw new Error('Invalid measurement run ID.');
  const [posts,publications] = await Promise.all([records('posts'),records('publications')]);
  const metrics = await collectMetrics({posts,publications,env,now,fetch:fetcher});
  await writeJSON(path.join(root,'metrics.json'),metrics);
  const finishedAt = new Date().toISOString();
  const states = [metrics.site.status,metrics.social.status];
  const status = states.some(state => ['unavailable','partial','invalid_configuration'].includes(state)) ? 'partial' : 'completed';
  const githubRunUrl = env.GITHUB_REPOSITORY && /^\d+$/.test(env.GITHUB_RUN_ID || '') ? `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null;
  const record = {id:runId,type:'measure',status,startedAt,finishedAt,githubRunUrl,...trustedScheduledMetadata('measure',env),scheduleStatus:'completed',
    message:'Aggregate measurement recorded. Unavailable metrics remain null.',
    steps:[{stage:'measure',at:metrics.measuredAt,status:metrics.site.status,message:`Website measurement: ${metrics.site.status}.`},
      {stage:'measure',at:metrics.social.measuredAt,status:metrics.social.status,message:`Social measurement: ${metrics.social.status}.`}],
    site:{status:metrics.site.status,views:metrics.site.views,saves:metrics.site.saves,period:metrics.site.period},
    social:{status:metrics.social.status,posts:metrics.social.posts.length,channels:metrics.social.channels.length},
    usage:{inputTokens:null,outputTokens:null,costUsd:null}};
  await writeJSON(path.join(root,'data','measurements',`${runId}.json`),record,{immutable:true});
  console.log(JSON.stringify({runId,status,siteStatus:metrics.site.status,socialStatus:metrics.social.status}));
  return metrics;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await runMeasurement(); }
  catch { console.error('Measurement failed before a safe record could be written.'); process.exitCode = 1; }
}
