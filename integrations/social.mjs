import { createHash, createHmac, randomBytes } from 'node:crypto';

// These adapters only act when called by the hosted publish job with configured secrets.
// They never log provider bodies, tokens, OAuth headers, or token-refresh results.
export const SOCIAL_ENV_KEYS = Object.freeze([
  'PUBLIC_BASE_URL', 'URL', 'X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN',
  'X_ACCESS_TOKEN_SECRET', 'X_OAUTH2_ACCESS_TOKEN', 'X_RESEARCH_ENABLED',
  'X_RESEARCH_BUDGET_USD', 'IG_USER_ID', 'IG_ACCESS_TOKEN', 'IG_API_VERSION',
  'LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_PERSON_URN', 'LINKEDIN_API_VERSION',
  'SOCIAL_PROVIDER', 'POSTIZ_API_KEY', 'POSTIZ_X_CHANNEL_ID', 'POSTIZ_INSTAGRAM_CHANNEL_ID', 'POSTIZ_LINKEDIN_PAGE_CHANNEL_ID',
]);

const get = (env, key) => typeof env === 'function' ? env(key) : env?.[key];
const clean = value => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
const sha = value => createHash('sha256').update(value).digest('hex');
const encode = value => encodeURIComponent(String(value)).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clock = options => options.now === undefined ? new Date()
  : new Date(typeof options.now === 'function' ? options.now() : options.now);
const iso = options => clock(options).toISOString();
const io = options => options.fetch ?? globalThis.fetch;
const pending = missing => ({ status: 'pending_setup', missing, estimatedCostUsd: 0 });
const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isId = value => /^\d+$/.test(String(value ?? ''));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

class ProviderError extends Error {
  constructor(status, code, uncertain = false) {
    super('Platform request did not complete');
    this.status = status;
    this.code = /^[A-Za-z0-9_-]{1,50}$/.test(String(code)) ? String(code) : 'provider_error';
    this.uncertain = uncertain;
  }
}

function safeFailure(error, publishing = false) {
  return {
    status: publishing && error.uncertain ? 'publication_unknown' : 'failed',
    httpStatus: error.status ?? null,
    errorCode: error.code ?? 'adapter_error',
    reason: error.uncertain && publishing ? 'Check the platform before retrying; the response was lost.'
      : error.status === 401 || error.status === 403 ? 'Reconnect the account or grant the required permission.'
      : error.status === 402 ? 'X API credits are exhausted.'
      : error.status === 429 ? 'The platform rate limit was reached.' : 'The platform request failed.',
    estimatedCostUsd: 0,
  };
}

async function request(url, options, init = {}) {
  let response;
  try {
    response = await io(options)(url, { ...init, signal: init.signal ?? AbortSignal.timeout(25_000) });
  } catch {
    throw new ProviderError(null, 'network_error', true);
  }
  let data = {};
  try { data = await response.json(); } catch { /* LinkedIn creation can have an empty body. */ }
  if (!response.ok || data.error) {
    // Providers can echo credentials or request values in error messages. Keep only an error code.
    const code = Number.isInteger(data.error?.code) ? `platform_${data.error.code}` : `http_${response.status}`;
    throw new ProviderError(response.status, code, response.status >= 500);
  }
  return { data, response };
}

function xCredentials(env) {
  if (get(env, 'X_OAUTH2_ACCESS_TOKEN')) return { type: 'oauth2', token: get(env, 'X_OAUTH2_ACCESS_TOKEN') };
  const keys = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET'];
  const missing = keys.filter(key => !get(env, key));
  return missing.length ? { missing } : { type: 'oauth1' };
}

// RFC 5849: URL query parameters participate in the signature, JSON body fields do not.
export function createOAuth1Header(method, url, env, options = {}) {
  const parsed = new URL(url);
  const oauth = {
    oauth_consumer_key: get(env, 'X_API_KEY'),
    oauth_nonce: options.nonce ?? randomBytes(18).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(options.timestamp ?? Math.floor(clock(options).getTime() / 1000)),
    oauth_token: get(env, 'X_ACCESS_TOKEN'), oauth_version: '1.0',
  };
  const parameters = [...parsed.searchParams, ...Object.entries(oauth)]
    .map(([key, value]) => [encode(key), encode(value)])
    .sort((a, b) => compare(a[0], b[0]) || compare(a[1], b[1]));
  const normalized = parameters.map(pair => pair.join('=')).join('&');
  const endpoint = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  const base = [method.toUpperCase(), encode(endpoint), encode(normalized)].join('&');
  const secret = `${encode(get(env, 'X_API_SECRET'))}&${encode(get(env, 'X_ACCESS_TOKEN_SECRET'))}`;
  oauth.oauth_signature = createHmac('sha1', secret).update(base).digest('base64');
  return `OAuth ${Object.entries(oauth).sort(([a], [b]) => compare(a, b)).map(([key, value]) => `${encode(key)}="${encode(value)}"`).join(', ')}`;
}

function xAuth(method, url, env, options) {
  const credentials = xCredentials(env);
  return credentials.type === 'oauth2' ? `Bearer ${credentials.token}` : createOAuth1Header(method, url, env, options);
}

function noLinks(value) {
  return clean(value).replace(/(?:https?:\/\/|www\.)\S+/gi, '')
    .replace(/\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}(?::\d+)?(?:\/\S*)?/gi, '')
    .replace(/@[A-Za-z0-9_]+/g, '').replace(/\$/g, '').replace(/\s+/g, ' ').trim();
}

// Conservative weighting keeps non-Latin text and emoji under X's standard 280 limit.
function truncateWeighted(value, limit) {
  let weight = 0;
  let text = '';
  for (const char of value) {
    const code = char.codePointAt(0);
    const cost = code <= 0x10ff || (code >= 0x2000 && code <= 0x200d) || (code >= 0x2010 && code <= 0x201f) || (code >= 0x2032 && code <= 0x2037) ? 1 : 2;
    if (weight + cost > limit) return `${text.trimEnd()}…`;
    weight += cost;
    text += char;
  }
  return text;
}

export function formatXPost(post) {
  const title = noLinks(post.title);
  const promise = noLinks(post.promise ?? post.whatItIs);
  const first = noLinks(Array.isArray(post.first24Hours) ? post.first24Hours[0] : post.first24Hours);
  const body = [title, promise, first && `First 24h: ${first}`].filter(Boolean).join('\n');
  return `${truncateWeighted(body, 252)}\nSources + full loop: bio.`;
}

export function formatInstagramCaption(post) {
  const loop = Array.isArray(post.loop) ? post.loop.map(clean).join(' → ') : clean(post.loop);
  const first = Array.isArray(post.first24Hours) ? post.first24Hours.map((step, i) => `${i + 1}. ${clean(step)}`).join('\n') : clean(post.first24Hours);
  const sources = (post.sources ?? []).map(source => `${clean(source.title)}: ${clean(source.url)}`).join('\n');
  return [clean(post.title), clean(post.promise), clean(post.whatItIs),
    post.whoPays && `Who pays: ${clean(post.whoPays)}`, loop && `The loop: ${loop}`,
    post.evidence && `Evidence: ${clean(post.evidence)}`, first && `Build a small version — first 24 hours:\n${first}`,
    sources && `Sources:\n${sources}`, 'Automated research and writing. Full feed in bio.']
    .filter(Boolean).join('\n\n').slice(0, 2200);
}

function imageURL(post, env) {
  let url;
  try { url = new URL(post.imageUrl ?? post.cardUrl ?? `/cards/${encode(post.id)}.jpg`, get(env, 'PUBLIC_BASE_URL') ?? get(env, 'URL')); }
  catch { throw new ProviderError(null, 'public_jpeg_url_required'); }
  if (url.protocol !== 'https:' || url.username || url.password || !/\.jpe?g$/i.test(url.pathname)
    || /^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[|.*\.local$)/i.test(url.hostname)) {
    throw new ProviderError(null, 'public_jpeg_url_required');
  }
  return url.href;
}

function igBase(env) {
  const version = get(env, 'IG_API_VERSION') ?? 'v25.0';
  if (!/^v\d+\.\d+$/.test(version)) throw new ProviderError(null, 'invalid_api_version');
  return `https://graph.instagram.com/${version}`;
}

async function publishX(post, env, options) {
  const credentials = xCredentials(env);
  if (credentials.missing) return pending(credentials.missing);
  const url = 'https://api.x.com/2/tweets';
  try {
    const text = formatXPost(post);
    const { data } = await request(url, options, {
      method: 'POST', headers: { Authorization: xAuth('POST', url, env, options), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, made_with_ai: true }),
    });
    if (!isId(data.data?.id)) throw new ProviderError(null, 'missing_publication_receipt', true);
    return { status: 'published', platformPostId: data.data.id, publishedAt: iso(options),
      url: `https://x.com/i/web/status/${data.data.id}`, estimatedCostUsd: 0.015, text };
  } catch (error) { return safeFailure(error, true); }
}

async function publishInstagram(post, env, options) {
  const missing = ['IG_USER_ID', 'IG_ACCESS_TOKEN'].filter(key => !get(env, key));
  if (missing.length) return pending(missing);
  let containerId = options.instagramContainerId;
  let publishing = false;
  try {
    if (!isId(get(env, 'IG_USER_ID'))) throw new ProviderError(null, 'invalid_instagram_user_id');
    const base = igBase(env);
    const headers = { Authorization: `Bearer ${get(env, 'IG_ACCESS_TOKEN')}`, 'Content-Type': 'application/json' };
    const image = imageURL(post, env);
    if (containerId && !isId(containerId)) throw new ProviderError(null, 'invalid_container_id');
    const account = `${base}/${get(env, 'IG_USER_ID')}`;
    if (!containerId) {
    // A public URL alone does not prove that Meta can retrieve a JPEG.
    const head = await io(options)(image, { method: 'HEAD', signal: AbortSignal.timeout(25_000) });
    if (!head.ok || !/^image\/(?:jpeg|jpg)(?:;|$)/i.test(head.headers.get('content-type') ?? '')) {
      throw new ProviderError(null, 'jpeg_not_public');
    }
    const { data: usage } = await request(`${account}/content_publishing_limit?fields=quota_usage,config`, options, { headers });
    const limit = usage.data?.[0];
    if (numeric(limit?.quota_usage) && limit.quota_usage >= (limit.config?.quota_total ?? 100)) {
      return { status: 'rate_limited', reason: 'Instagram publishing quota is full.', estimatedCostUsd: 0 };
    }
    const { data: created } = await request(`${account}/media`, options, {
      method: 'POST', headers, body: JSON.stringify({ image_url: image,
        caption: formatInstagramCaption(post), alt_text: clean(`${post.title}. ${post.promise}. Loop: ${(post.loop ?? []).join(' then ')}.`).slice(0, 1000), is_ai_generated: true }),
    });
    if (!isId(created.id)) throw new ProviderError(null, 'missing_container_receipt');
    containerId = created.id;
    }
    const attempts = Math.min(5, Math.max(1, options.instagramPollAttempts ?? 5));
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt) await (options.sleep ?? sleep)(60_000);
      const { data } = await request(`${base}/${containerId}?fields=status_code`, options, { headers });
      if (data.status_code === 'FINISHED') {
        publishing = true;
        const { data: published } = await request(`${account}/media_publish`, options, {
          method: 'POST', headers, body: JSON.stringify({ creation_id: containerId }),
        });
        if (!isId(published.id)) throw new ProviderError(null, 'missing_publication_receipt', true);
        return { status: 'published', platformPostId: published.id, containerId,
          publishedAt: iso(options), imageUrl: image, estimatedCostUsd: 0 };
      }
      if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') {
        throw new ProviderError(null, `container_${data.status_code.toLowerCase()}`);
      }
      if (data.status_code === 'PUBLISHED') {
        return { status: 'publication_unknown', containerId, reason: 'Container is published; reconcile its media ID before retrying.', estimatedCostUsd: 0 };
      }
    }
    return { status: 'pending_processing', containerId, reason: 'Image is still processing; resume this container, do not create another.', estimatedCostUsd: 0 };
  } catch (error) { return { ...safeFailure(error, publishing), ...(containerId ? { containerId } : {}) }; }
}

/** Pure weekly draft. The ID changes if the approved content or included posts change. */
export function prepareDigest(posts, options = {}) {
  const seen = new Set();
  const selected = [...(posts ?? [])].filter(post => post?.id && !seen.has(post.id) && seen.add(post.id))
    .sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? ''))).slice(0, 7);
  const postIds = selected.map(post => post.id);
  const postHashes = selected.map(post => post.contentSha256 ?? null);
  const items = selected.map((post, index) => [
    `${index + 1}. ${clean(post.title)}`, clean(post.promise),
    `Small version: ${clean(post.first24Hours?.[0])}`, post.publicUrl || post.sources?.[0]?.url,
  ].filter(Boolean).join('\n'));
  const text = ['While You Sleep — this week’s autonomous project ideas',
    'This feed researches, checks and publishes real examples on a hosted schedule. Here are ideas students can test in a small version.',
    ...items, 'Each idea links to its evidence. Numbers are source claims, not promises of results.'].join('\n\n').slice(0, 2900);
  const id = `digest-${sha(JSON.stringify({ text, postIds })).slice(0, 24)}`;
  return { id, status: options.provider === 'direct' ? 'awaiting_owner_approval' : 'awaiting_check',
    text, postIds, postHashes, generatedAt: iso(options), requiresApproval: options.provider === 'direct' };
}

async function publishLinkedInDigest(env, options) {
  if (!options.digest) return { status: 'draft_only', reason: 'A weekly digest requires Danielius’s approval of the exact draft.', estimatedCostUsd: 0 };
  const digest = options.digest;
  const expected = `digest-${sha(JSON.stringify({ text: digest.text, postIds: digest.postIds })).slice(0, 24)}`;
  if (!digest.postIds?.length || digest.id !== expected || options.linkedinApproval !== expected) {
    return { status: 'awaiting_owner_approval', digestId: digest.id, estimatedCostUsd: 0 };
  }
  const missing = ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_PERSON_URN'].filter(key => !get(env, key));
  if (missing.length) return pending(missing);
  if (!/^urn:li:person:[A-Za-z0-9_-]+$/.test(get(env, 'LINKEDIN_PERSON_URN'))) {
    return safeFailure(new ProviderError(null, 'personal_profile_required'));
  }
  const version = get(env, 'LINKEDIN_API_VERSION') ?? '202609';
  if (!/^\d{6}$/.test(version)) return safeFailure(new ProviderError(null, 'invalid_api_version'));
  try {
    const { data, response } = await request('https://api.linkedin.com/rest/posts', options, {
      method: 'POST', headers: { Authorization: `Bearer ${get(env, 'LINKEDIN_ACCESS_TOKEN')}`,
        'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0', 'LinkedIn-Version': version },
      body: JSON.stringify({ author: get(env, 'LINKEDIN_PERSON_URN'), commentary: digest.text,
        visibility: 'PUBLIC', distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false }),
    });
    const id = response.headers.get('x-restli-id') ?? data.id;
    if (!/^urn:li:(share|ugcPost):\d+$/.test(id ?? '')) throw new ProviderError(null, 'missing_publication_receipt', true);
    return { status: 'published', digestId: digest.id, platformPostId: id, publishedAt: iso(options), estimatedCostUsd: 0 };
  } catch (error) { return safeFailure(error, true); }
}

/**
 * Returns safe, public publication receipts. Caller persists them before another run.
 * Pass receipts from a previous call in options.receipts to avoid re-posting.
 * LinkedIn needs options.digest + options.linkedinApproval equal to the draft content ID;
 * the protected caller must obtain that approval directly from the human owner.
 */
async function publishDirect(post, env = process.env, options = {}) {
  const result = {};
  for (const [platform, publish] of [['x', publishX], ['instagram', publishInstagram], ['linkedin', (_, e, o) => publishLinkedInDigest(e, o)]]) {
    if (options.platforms && !options.platforms.includes(platform)) continue;
    if (platform !== 'linkedin' && !post) continue;
    const previous = options.receipts?.[platform];
    if (previous && ['published', 'publication_unknown'].includes(previous.status)) {
      result[platform] = previous;
    } else if (options.dryRun) {
      result[platform] = { status: 'dry_run', provider: 'direct', estimatedCostUsd: 0 };
    } else result[platform] = await publish(post, env, previous?.status === 'pending_processing' && platform === 'instagram'
      ? { ...options, instagramContainerId: previous.containerId } : options);
  }
  return result;
}

/** SECRET result: caller must store this only in private server-side state. */
export async function refreshInstagramToken(env = process.env, options = {}) {
  if (!get(env, 'IG_ACCESS_TOKEN')) return pending(['IG_ACCESS_TOKEN']);
  // Only refresh a token at least 24 hours old; caller supplies the private issuance timestamp.
  const issuedAt = new Date(options.issuedAt).getTime();
  if (!Number.isFinite(issuedAt) || clock(options).getTime() - issuedAt < 86_400_000) {
    return { status: 'not_due' };
  }
  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', get(env, 'IG_ACCESS_TOKEN'));
  const { data } = await request(url.href, options);
  if (!data.access_token || !numeric(data.expires_in)) throw new ProviderError(null, 'invalid_refresh_receipt');
  return { status: 'refreshed', accessToken: data.access_token, refreshedAt: iso(options),
    expiresAt: new Date(clock(options).getTime() + data.expires_in * 1000).toISOString() };
}

/** One paid search page, no pagination; hard cap assessed before the API call. */
export async function researchX(query, env = process.env, options = {}) {
  if (get(env, 'X_RESEARCH_ENABLED') !== 'true' && options.enabled !== true) return { status: 'disabled', candidates: [], estimatedCostUsd: 0 };
  const credentials = xCredentials(env);
  if (credentials.missing) return { ...pending(credentials.missing), candidates: [] };
  const budget = Number(options.maxCostUsd ?? get(env, 'X_RESEARCH_BUDGET_USD') ?? 0.05);
  const maxResults = Math.min(100, Math.max(0, Math.floor(budget / 0.005)), Math.floor(options.maxResults ?? 10));
  if (!Number.isFinite(budget) || !Number.isFinite(maxResults) || maxResults < 10) return { status: 'budget_limit', candidates: [], estimatedCostUsd: 0 };
  const url = new URL('https://api.x.com/2/tweets/search/recent');
  url.searchParams.set('query', clean(query));
  url.searchParams.set('max_results', String(maxResults));
  url.searchParams.set('tweet.fields', 'created_at,author_id,entities');
  try {
    const { data } = await request(url.href, options, { headers: { Authorization: xAuth('GET', url.href, env, options) } });
    const candidates = (data.data ?? []).filter(post => isId(post.id)).map(post => ({
      title: clean(post.text).slice(0, 150), text: post.text, url: `https://x.com/i/web/status/${post.id}`,
      source: 'X', publishedAt: post.created_at, authorId: post.author_id,
      sourceLinks: (post.entities?.urls ?? []).map(link => link.expanded_url ?? link.url).filter(Boolean),
    }));
    return { status: 'researched', candidates, estimatedCostUsd: candidates.length * 0.005, maxCostUsd: maxResults * 0.005 };
  } catch (error) { return { ...safeFailure(error), candidates: [] }; }
}

/** Missing and delayed analytics remain unavailable, never manufactured zeros. */
async function measureDirect(records, env = process.env, options = {}) {
  const entries = (Array.isArray(records) ? records : [records]).filter(Boolean);
  const measured = entries.map(record => ({ postId: record.postId ?? record.id ?? null,
    x: { status: 'unavailable', reason: 'No published X receipt or access token.' },
    instagram: { status: 'unavailable', reason: 'No published Instagram receipt or access token.' } }));
  let cost = 0;
  const xEntries = entries.map((record, index) => ({ receipt: (record.social ?? record).x, index }))
    .filter(item => item.receipt?.status === 'published' && isId(item.receipt.platformPostId)).slice(0, 100);
  if (xEntries.length && !xCredentials(env).missing) {
    const url = new URL('https://api.x.com/2/tweets');
    url.searchParams.set('ids', xEntries.map(item => item.receipt.platformPostId).join(','));
    url.searchParams.set('tweet.fields', 'public_metrics');
    try {
      const { data } = await request(url.href, options, { headers: { Authorization: xAuth('GET', url.href, env, options) } });
      const returned = new Map((data.data ?? []).map(post => [post.id, post]));
      cost += returned.size * 0.005;
      for (const item of xEntries) {
        const raw = returned.get(item.receipt.platformPostId)?.public_metrics;
        const metrics = {};
        for (const [key, name] of Object.entries({ like_count: 'likes', retweet_count: 'reposts', repost_count: 'reposts', reply_count: 'replies', quote_count: 'quotes', bookmark_count: 'saves', impression_count: 'views' })) {
          if (numeric(raw?.[key])) metrics[name] = raw[key];
        }
        measured[item.index].x = Object.keys(metrics).length ? { status: 'measured', metrics }
          : { status: 'unavailable', reason: 'X returned no metrics for this post.' };
      }
    } catch (error) { for (const item of xEntries) measured[item.index].x = { ...safeFailure(error), status: 'unavailable' }; }
  }
  for (let index = 0; index < entries.length; index++) {
    const receipt = (entries[index].social ?? entries[index]).instagram;
    if (receipt?.status !== 'published' || !isId(receipt.platformPostId) || !get(env, 'IG_ACCESS_TOKEN')) continue;
    const headers = { Authorization: `Bearer ${get(env, 'IG_ACCESS_TOKEN')}` };
    const metrics = {};
    let insightsAvailable = false;
    try {
      const { data } = await request(`${igBase(env)}/${receipt.platformPostId}?fields=like_count,comments_count,permalink`, options, { headers });
      if (numeric(data.like_count)) metrics.likes = data.like_count;
      if (numeric(data.comments_count)) metrics.comments = data.comments_count;
      const { data: insights } = await request(`${igBase(env)}/${receipt.platformPostId}/insights?metric=views,saved,shares,follows,reach,reposts`, options, { headers });
      for (const metric of insights.data ?? []) {
        const value = metric.total_value?.value ?? metric.values?.[0]?.value;
        if (numeric(value)) { metrics[metric.name === 'saved' ? 'saves' : metric.name] = value; insightsAvailable = true; }
      }
    } catch { /* Some metrics require instagram_business_manage_insights; retain basic metrics. */ }
    measured[index].instagram = Object.keys(metrics).length ? { status: 'measured', metrics, insightsAvailable,
      ...(insightsAvailable ? {} : { reason: 'Insights unavailable; grant instagram_business_manage_insights or wait for data.' }) }
      : { status: 'unavailable', reason: 'Instagram returned no metrics or permissions were unavailable.' };
  }
  return { measuredAt: iso(options), posts: measured, estimatedCostUsd: cost };
}

const POSTIZ_API = 'https://api.postiz.com/public/v1';
const serviceId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const excludedHashKeys = new Set(['checker', 'contentSha256', 'metrics', 'publicUrl', 'imageUrl']);

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
  return value;
}

export function publishedPostHash(post) {
  return sha(JSON.stringify(sorted(Object.fromEntries(Object.entries(post ?? {}).filter(([key]) => !excludedHashKeys.has(key))))));
}

function verifiedPost(post, verification) {
  return Boolean(post?.checker?.passed === true && post.checker.checkerRunId &&
    post.contentSha256 === publishedPostHash(post) && verification?.passed === true &&
    verification.postHash === post.contentSha256 && verification.checkerRunId === post.checker.checkerRunId);
}

function digestHash(digest) {
  return sha(JSON.stringify(sorted({ text: digest?.text, postIds: digest?.postIds, postHashes: digest?.postHashes })));
}

export function verifiedDigestHash(digest) { return digestHash(digest); }

async function postiz(path, env, options, body) {
  return request(`${POSTIZ_API}${path}`, options, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: get(env, 'POSTIZ_API_KEY'), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

/** Read-only list; only public account metadata is returned, never OAuth credentials. */
export async function listPublishingChannels(env = process.env, options = {}) {
  if (!get(env, 'POSTIZ_API_KEY')) return { ...pending(['POSTIZ_API_KEY']), channels: [] };
  try {
    const { data } = await postiz('/integrations', env, options);
    if (!Array.isArray(data)) throw new ProviderError(null, 'invalid_channel_response');
    return { status: 'connected', channels: data.filter(channel => serviceId(channel.id)).map(channel => ({
      id: channel.id, name: clean(channel.name), identifier: clean(channel.identifier),
      disabled: channel.disabled === true, profile: clean(channel.profile),
    })) };
  } catch (error) { return { ...safeFailure(error), channels: [] }; }
}

function selectChannel(platform, channels, env) {
  const key = { x: 'POSTIZ_X_CHANNEL_ID', instagram: 'POSTIZ_INSTAGRAM_CHANNEL_ID', linkedin: 'POSTIZ_LINKEDIN_PAGE_CHANNEL_ID' }[platform];
  const identifiers = { x: ['x'], instagram: ['instagram-standalone', 'instagram'], linkedin: ['linkedin-page'] }[platform];
  const matches = channels.filter(channel => identifiers.includes(channel.identifier) && !channel.disabled &&
    (!get(env, key) || channel.id === get(env, key)));
  return matches.length === 1 ? { channel: matches[0] }
    : { result: { status: matches.length > 1 ? 'ambiguous_channel' : 'pending_setup',
      reason: matches.length > 1 ? `Choose the channel by setting ${key}.` : `Connect ${platform === 'linkedin' ? 'the LinkedIn Page' : platform} in Postiz.`,
      provider: 'postiz', estimatedCostUsd: 0 } };
}

function serviceSettings(channel) {
  return channel.identifier === 'x' ? { __type: 'x', who_can_reply_post: 'everyone', made_with_ai: true }
    : channel.identifier.startsWith('instagram') ? { __type: channel.identifier, post_type: 'post', is_trial_reel: false, collaborators: [] }
    : { __type: 'linkedin-page', post_as_images_carousel: false };
}

async function submitPostiz(platform, content, sourcePost, channel, env, options) {
  let publishing = false;
  try {
    const images = [];
    if (platform === 'instagram') {
      const image = imageURL(sourcePost, env);
      if (!options.dryRun) {
        const { data: uploaded } = await postiz('/upload-from-url', env, options, { url: image });
        if (!serviceId(uploaded.id) || !/^https:\/\//.test(uploaded.path ?? '')) throw new ProviderError(null, 'invalid_media_receipt');
        images.push({ id: uploaded.id, path: uploaded.path });
      } else images.push({ id: 'dry-run-media', path: image });
    }
    const payload = { type: 'now', date: iso(options), shortLink: false, tags: [], posts: [{
      integration: { id: channel.id }, value: [{ content, image: images }], settings: serviceSettings(channel),
    }] };
    if (options.dryRun) return { status: 'dry_run', provider: 'postiz', channelId: channel.id, payload, estimatedCostUsd: 0 };
    publishing = true;
    const { data } = await postiz('/posts', env, options, payload);
    const receipt = Array.isArray(data) ? data.find(item => item.integration === channel.id) : null;
    if (!serviceId(receipt?.postId)) throw new ProviderError(null, 'missing_publication_receipt', true);
    // A create receipt proves acceptance by the hosted service, not publication on the network.
    return { status: 'submitted', provider: 'postiz', providerPostId: receipt.postId, channelId: channel.id,
      submittedAt: iso(options), contentSha256: sha(content), estimatedCostUsd: 0 };
  } catch (error) { return { ...safeFailure(error, publishing), provider: 'postiz', channelId: channel.id }; }
}

async function publishViaPostiz(post, env, options) {
  const platforms = options.platforms ?? ['x', 'instagram', 'linkedin'];
  const result = {};
  if (!get(env, 'POSTIZ_API_KEY') && !options.dryRun) {
    for (const platform of platforms) result[platform] = { ...pending(['POSTIZ_API_KEY']), provider: 'postiz' };
    return result;
  }
  const checked = post && verifiedPost(post, options.verification);
  const digestChecked = options.digest && options.digestVerification?.passed === true &&
    options.digestVerification.digestHash === digestHash(options.digest) && options.digestVerification.checkerRunId &&
    typeof options.digest.text === 'string' && options.digest.text.trim().length > 0 && options.digest.text.length <= 3000 &&
    Array.isArray(options.digest.postIds) && options.digest.postIds.length > 0 &&
    options.digest.postIds.length === options.digest.postHashes?.length &&
    options.digest.postHashes.every(hash => /^[a-f0-9]{64}$/.test(hash));
  // This check comes before any network access. The publish job must supply the checker envelope.
  if ((post && !checked) || (options.digest && !digestChecked)) {
    for (const platform of platforms) result[platform] = { status: 'blocked_unchecked', provider: 'postiz',
      reason: 'The checker approval does not match this content.', estimatedCostUsd: 0 };
    return result;
  }
  const channelList = options.channels ? { status: 'connected', channels: options.channels }
    : await listPublishingChannels(env, options);
  if (channelList.status !== 'connected') {
    for (const platform of platforms) result[platform] = { ...channelList, channels: undefined };
    return result;
  }
  for (const platform of platforms) {
    const previous = options.receipts?.[platform];
    if (previous && ['published', 'submitted', 'publication_unknown'].includes(previous.status)) { result[platform] = previous; continue; }
    if (platform === 'linkedin' && !options.digest) {
      result.linkedin = { status: 'weekly_digest_pending', provider: 'postiz', reason: 'LinkedIn Page receives the Monday digest.', estimatedCostUsd: 0 };
      continue;
    }
    if (platform !== 'linkedin' && !post) continue;
    const selected = selectChannel(platform, channelList.channels, env);
    if (selected.result) { result[platform] = selected.result; continue; }
    const content = platform === 'x' ? formatXPost(post) : platform === 'instagram' ? formatInstagramCaption(post) : options.digest.text;
    result[platform] = await submitPostiz(platform, content, post, selected.channel, env, options);
  }
  return result;
}

/** Default v2 route. Direct platform APIs stay dormant unless deliberately selected. */
export async function publishSocial(post, env = process.env, options = {}) {
  const provider = options.provider ?? get(env, 'SOCIAL_PROVIDER') ?? 'postiz';
  if (provider === 'postiz') return publishViaPostiz(post, env, options);
  if (provider !== 'direct') return { status: 'unsupported_provider', estimatedCostUsd: 0 };
  if (post && !verifiedPost(post, options.verification)) return { status: 'blocked_unchecked', estimatedCostUsd: 0 };
  return publishDirect(post, env, options);
}

function parseServiceMetrics(series) {
  const metrics = {};
  const history = [];
  for (const item of Array.isArray(series) ? series : []) {
    const label = clean(item.label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (!label || label.length > 80) continue;
    const values = (item.data ?? []).filter(value => value.total !== '' && value.total !== null && value.total !== undefined &&
      Number.isFinite(Number(value.total)) && Number(value.total) >= 0)
      .map(value => ({ date: clean(value.date), total: Number(value.total) })).sort((a, b) => a.date.localeCompare(b.date));
    if (values.length) { metrics[label] = values.at(-1).total; history.push({ label, data: values }); }
  }
  return { status: Object.keys(metrics).length ? 'measured' : 'unavailable', metrics, history,
    ...(Object.keys(metrics).length ? {} : { reason: 'The provider returned no analytics; unavailable is not zero.' }) };
}

async function measureViaPostiz(records, env, options) {
  const entries = (Array.isArray(records) ? records : [records]).filter(Boolean);
  const result = { measuredAt: iso(options), provider: 'postiz', posts: [], channels: [], estimatedCostUsd: 0 };
  if (!get(env, 'POSTIZ_API_KEY')) return { ...result, status: 'pending_setup', missing: ['POSTIZ_API_KEY'] };
  let listed = [];
  const start = new Date(clock(options).getTime() - 8 * 86_400_000).toISOString();
  const end = new Date(clock(options).getTime() + 86_400_000).toISOString();
  try {
    const { data } = await postiz(`/posts?startDate=${encode(start)}&endDate=${encode(end)}`, env, options);
    listed = data.posts ?? [];
  } catch { /* Keep submitted receipts without falsely marking them published. */ }
  const channelIds = new Set();
  for (const entry of entries) {
    const measurement = { postId: entry.postId ?? entry.id ?? null };
    for (const platform of ['x', 'instagram', 'linkedin']) {
      const receipt = (entry.social ?? entry)[platform];
      if (receipt?.provider !== 'postiz' || !serviceId(receipt.providerPostId)) {
        measurement[platform] = { status: 'unavailable', reason: 'No Postiz publication receipt.' };
        continue;
      }
      if (serviceId(receipt.channelId)) channelIds.add(receipt.channelId);
      const remote = listed.find(item => item.id === receipt.providerPostId);
      const publication = remote?.state === 'PUBLISHED' ? { status: 'published', providerPostId: receipt.providerPostId,
        platformPostId: serviceId(remote.releaseId) ? remote.releaseId : undefined,
        url: /^https:\/\//.test(remote.releaseURL ?? '') ? remote.releaseURL : undefined }
        : remote?.state === 'ERROR' ? { status: 'failed', reason: 'Postiz reports the network rejected this post.' }
        : { status: receipt.status };
      try {
        const { data } = await postiz(`/analytics/post/${encode(receipt.providerPostId)}?date=7`, env, options);
        measurement[platform] = { ...parseServiceMetrics(data), publication };
      } catch { measurement[platform] = { status: 'unavailable', reason: 'Postiz analytics are unavailable for this post.', publication }; }
    }
    result.posts.push(measurement);
  }
  const channelList = await listPublishingChannels(env, options);
  for (const channel of channelList.channels ?? []) {
    if (!channel.disabled && ['x', 'instagram', 'instagram-standalone', 'linkedin-page'].includes(channel.identifier)) channelIds.add(channel.id);
  }
  for (const channelId of channelIds) {
    try {
      const { data } = await postiz(`/analytics/${encode(channelId)}?date=7`, env, options);
      result.channels.push({ channelId, ...parseServiceMetrics(data) });
    } catch { result.channels.push({ channelId, status: 'unavailable', reason: 'Postiz channel analytics are unavailable.' }); }
  }
  return result;
}

export async function measureSocial(records, env = process.env, options = {}) {
  return (options.provider ?? get(env, 'SOCIAL_PROVIDER') ?? 'postiz') === 'direct'
    ? measureDirect(records, env, options) : measureViaPostiz(records, env, options);
}
