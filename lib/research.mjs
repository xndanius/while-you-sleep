import { lookup } from 'node:dns/promises';
import { XMLParser } from 'fast-xml-parser';
import { hash, canonicalURL } from './storage.mjs';

const FEEDS = [
  { name: 'Hacker News · Show HN', kind: 'hn', url: 'https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=40&query=AI' },
  { name: 'Hacker News · automation', kind: 'hn', url: 'https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=30&query=automation' },
  ...['SideProject', 'Entrepreneur', 'n8n', 'AI_Agents'].map(name => ({ name: `Reddit · r/${name}`, kind: 'rss', url: `https://www.reddit.com/r/${name}/new/.rss?limit=20` })),
  { name: 'Product Hunt', kind: 'rss', url: 'https://www.producthunt.com/feed' },
  { name: 'Indie Hackers', kind: 'html', url: 'https://www.indiehackers.com/' },
  { name: 'TechCrunch · AI', kind: 'rss', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  // First-party product documentation is useful even when community feeds block bots.
  { name: 'n8n · official AI workflows', kind: 'html', url: 'https://n8n.io/ai/' },
  { name: 'Apify · official platform', kind: 'html', url: 'https://apify.com/' },
  { name: 'Browser Use · official project', kind: 'html', url: 'https://browser-use.com/' },
  { name: 'Dify · official project', kind: 'html', url: 'https://dify.ai/' },
];

function privateAddress(address) {
  if (address.startsWith('::ffff:')) {
    const tail = address.slice(7);
    if (tail.includes('.')) return privateAddress(tail);
    const [high, low] = tail.split(':').map(x => parseInt(x, 16));
    return privateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  if (address.includes(':')) return /^(::|::1$|fc|fd|fe[89ab])/i.test(address) || address.includes('127.0.0.1');
  const [a, b] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

export async function validateURL(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || /(^|\.)(localhost|local|internal|test|invalid)$/i.test(url.hostname)) throw new Error('Source URL must be a public HTTPS page.');
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(x => privateAddress(x.address))) throw new Error('Source URL resolves to a private address.');
  return url;
}

export async function fetchPublic(raw, depth = 0) {
  if (depth > 3) throw new Error('Source redirected too many times.');
  const url = await validateURL(raw);
  const response = await fetch(url, { redirect: 'manual', headers: { 'user-agent': 'WhileYouSleep/1.0 (public research; evidence-only)', accept: 'text/html, application/json, application/rss+xml, application/atom+xml, text/xml;q=0.9' }, signal: AbortSignal.timeout(14000) });
  if (response.status >= 300 && response.status < 400 && response.headers.get('location')) return fetchPublic(new URL(response.headers.get('location'), url).toString(), depth + 1);
  if (!response.ok) throw new Error(`Public source returned HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type') || '';
  if (!/(text|json|xml|html)/i.test(contentType)) throw new Error('Source is not readable text.');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  while (size < 350000) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value); size += value.length;
  }
  await reader.cancel();
  return { url: response.url || url.toString(), text: new TextDecoder().decode(Buffer.concat(chunks.map(x => Buffer.from(x)))).slice(0, 350000), fetchedAt: new Date().toISOString(), status: response.status };
}

export function plainText(html) {
  return String(html || '').replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (entity, hex, decimal) => {
    const point = Number.parseInt(hex || decimal, hex ? 16 : 10);
    // Invalid scalar values remain literal evidence; never throw or erase them.
    return Number.isInteger(point) && point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
  }).replace(/\s+/g, ' ').trim();
}

function source(title, url, publisher, text, fetchedAt, extras = {}) {
  return { id: hash(canonicalURL(url)), title: plainText(title).slice(0, 200), url: canonicalURL(url), publisher, text: plainText(text).slice(0, 1200), fetchedAt, ...extras };
}

function parseFeed(feed, page) {
  if (feed.kind === 'hn') {
    const json = JSON.parse(page.text);
    return (json.hits || []).filter(x => x.title).map(x => source(x.title, `https://news.ycombinator.com/item?id=${x.objectID}`, feed.name, [x.title, x.story_text || '', x.url ? `Product URL: ${x.url}` : ''].join('\n'), page.fetchedAt, { productUrl: x.url || null, discoveredAt: x.created_at || null }));
  }
  if (feed.kind === 'rss') {
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(page.text);
    let entries = parsed.rss?.channel?.item || parsed.feed?.entry || [];
    if (!Array.isArray(entries)) entries = [entries];
    return entries.slice(0, 20).map(x => {
      const links = Array.isArray(x.link) ? x.link : [x.link];
      const link = links.find(l => typeof l === 'string' || !l?.['@_rel'] || l?.['@_rel'] === 'alternate');
      const url = typeof link === 'string' ? link : link?.['@_href'];
      const text = typeof x.content === 'object' ? x.content?.['#text'] : x.content;
      return url && /^https:\/\//.test(url) ? source(x.title?.['#text'] || x.title || feed.name, url, feed.name, text || x.description || x.summary || '', page.fetchedAt, { discoveredAt: x.published || x.pubDate || x.updated || null }) : null;
    }).filter(Boolean);
  }
  const title = page.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || feed.name;
  return [source(title, feed.url, feed.name, page.text, page.fetchedAt)];
}

export async function scanSources(onHealth = async () => {}) {
  const results = await Promise.allSettled(FEEDS.map(async feed => {
    const startedAt = new Date().toISOString();
    try {
      const page = await fetchPublic(feed.url);
      const sources = parseFeed(feed, page);
      await onHealth({ name: feed.name, url: feed.url, status: 'ok', fetchedAt: page.fetchedAt, startedAt, items: sources.length, message: `Fetched ${sources.length} public source records.` });
      return sources;
    } catch (error) {
      await onHealth({ name: feed.name, url: feed.url, status: 'failed', fetchedAt: new Date().toISOString(), startedAt, items: 0, message: error.message });
      return [];
    }
  }));
  const sources = results.flatMap(x => x.status === 'fulfilled' ? x.value : []);
  return [...new Map(sources.map(s => [s.id, s])).values()];
}

export async function verifySources(candidate) {
  const verified = [];
  for (const s of candidate.sources.slice(0, 3)) {
    const page = await fetchPublic(s.url);
    const text = plainText(page.text).slice(0, 12000);
    if (text.length < 100) throw new Error('Source page contained too little evidence to check.');
    verified.push({ ...s, text, fetchedAt: page.fetchedAt, verifiedAt: page.fetchedAt });
  }
  return verified;
}

export const sourceDefinitions = FEEDS.map(({ name, url }) => ({ name, url }));
