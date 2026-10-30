import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BRAND_NAME, BRAND_DESCRIPTION, BRAND_MARK } from './brand.mjs';
import { historicalOverlapFor } from '../public/historical-overlaps.js';
import {rssEligible} from './publication-distribution.mjs';

export const LINKEDIN_PAGE_URL='https://www.linkedin.com/company/whileyousleep-ai/';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=value=>String(value??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const linkedinText=value=>text(value).replace(/[()[\]{}<>@#*_~|\\]/g,' ').replace(/\s+/g,' ').trim();
const sentenceSegments=new Intl.Segmenter('en',{granularity:'sentence'});
const ended=value=>/[.!?…]["'”’]*$/.test(value)?value:value+'.';
const fitSentences=(value,limit)=>{
  const cleaned=linkedinText(value);
  if(!cleaned)return '';
  const sentences=[...sentenceSegments.segment(cleaned)].map(part=>ended(part.segment.trim())).filter(Boolean);
  const kept=[];
  for(const sentence of sentences){
    if([...kept,sentence].join(' ').length<=limit)kept.push(sentence);
  }
  if(kept.length)return kept.join(' ');
  // Only an individually overlong sentence needs an ellipsis. Never slice a
  // word, and never append a chopped second sentence to complete sentences.
  const first=sentences[0],prefix=first.slice(0,limit-1);
  const boundary=prefix.lastIndexOf(' ');
  return boundary>0?prefix.slice(0,boundary).trimEnd()+'…':'';
};
const buyerText=value=>linkedinText(value).replace(/^(?:(?:who (?:might )?pays?|hypothesis)\s*[:.–—-]\s*)+/i,'');
const paragraphs=value=>escape(Array.isArray(value)?value.join('\n'):value).replace(/\n/g,'<br>');
const safeSource=value=>{try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:'';}catch{return '';}};
const sourceCredit=item=>{try{const u=new URL(item.url),h=u.hostname.replace(/^www\./,'');if(h==='reddit.com'){const c=u.pathname.match(/^\/r\/([A-Za-z0-9_]+)\//)?.[1]||String(item.community||'').match(/^Reddit r\/([A-Za-z0-9_]+)$/)?.[1];if(c)return 'Spotted on Reddit r/'+c;}if(['x.com','twitter.com'].includes(h))return 'Spotted on X';if(h==='indiehackers.com')return 'Spotted on Indie Hackers';if(h==='producthunt.com')return 'Spotted on Product Hunt';}catch{}return item.title||item.publisher||new URL(item.url).hostname;};
const SCORE_LABELS={ease:'Ease to start',profit:'Profit potential',feasibility:'Student build in 4 weeks',autonomy:'Autonomy',evidence:'Evidence'};
const scoreNumber=value=>{
  if(typeof value!=='number'||!Number.isFinite(value)||value<1||value>10)throw new Error('Invalid hydrated presentation score.');
  return value.toFixed(1);
};
const scoreDate=value=>{
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))throw new Error('Invalid score check time.');
  return new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Vilnius',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(date)+' Vilnius';
};

function scoreSection(post){
  const scoring=post.scoring;
  if(!scoring)return '<section class="idea-scoring scoring-pending"><h2>Idea score</h2><p>Score pending independent check.</p></section>';
  const overall=scoreNumber(scoring.overall);
  const sources=new Map((post.sources||[]).filter(source=>typeof source==='object'&&source?.id).map(source=>[source.id,source]));
  const criteria=Object.entries(SCORE_LABELS).map(([key,label])=>{
    const criterion=scoring.criteria[key];
    const value=scoreNumber(criterion.value);
    const links=(criterion.sourceIds||[]).map(id=>{
      const source=sources.get(id),url=safeSource(source?.url);
      return url?`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(source.title||source.publisher||new URL(url).hostname)} <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>`:'';
    }).filter(Boolean).join('');
    return `<li><div class="criterion-heading"><h3>${label}</h3><strong>${value.replace(/\.0$/,'')}<span> / 10</span></strong></div><p>${escape(criterion.reason)}</p><div class="score-evidence-links">${links}</div></li>`;
  }).join('');
  const weights=Object.entries(SCORE_LABELS).map(([key,label])=>`${label.toLowerCase()} ${scoring.weights[key]}`).join(' · ');
  return `<section class="idea-scoring" aria-labelledby="idea-score-heading"><div class="score-heading"><h2 id="idea-score-heading">Idea score</h2><p class="overall-score"><strong>${overall}</strong><span> / 10</span></p></div><p class="score-context">A checked estimate based on the linked evidence. Profit potential is a hypothesis.</p><ol class="score-criteria">${criteria}</ol><p class="score-weights">Weighted mean with current rules: ${escape(weights)}.</p><details class="score-provenance"><summary>Independent score check</summary><dl><div><dt>Checked</dt><dd><time datetime="${escape(scoring.checkedAt)}">${escape(scoreDate(scoring.checkedAt))}</time></dd></div><div><dt>Checker run</dt><dd>${escape(scoring.checkerRunId)}</dd></div><div><dt>Assessment policy</dt><dd>${escape(scoring.assessmentPolicySha256||scoring.policySha256)}</dd></div><div><dt>Current policy</dt><dd>${escape(scoring.policySha256)}</dd></div></dl></details></section>`;
}

export function publicPostURL(baseURL,id){
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(String(id)))throw new Error('Invalid public post ID.');
  return `${baseURL.replace(/\/$/,'')}/p/${id}/`;
}

export const rssTitle=value=>linkedinText(value);

export function rssDescription(post){
  // Fixed field budgets include room for labels, numbering and blank lines;
  // every section survives within 1,000 characters without mid-word cuts.
  const promise=fitSentences(post.promise,220);
  const buyer=fitSentences(buyerText(post.whoPays),260);
  const first=(Array.isArray(post.first24Hours)?post.first24Hours:[post.first24Hours])
    .map(value=>linkedinText(value).replace(/^\d+\.\s*/,''))
    .filter(Boolean).slice(0,3).map(value=>fitSentences(value,150)).filter(Boolean);
  return `${promise}\n\nWho might pay: Hypothesis: ${buyer}\n\nFirst 24 hours:\n${first.map((step,index)=>`${index+1}. ${step}`).join('\n')}`;
}

export function bestRSSDescription(post,scoring){
  const values=Object.keys(SCORE_LABELS).map(key=>{
    const value=scoring?.criteria?.[key]?.value;
    if(!Number.isInteger(value)||value<1||value>10)throw new Error('Invalid frozen pick criterion score.');
    return `${key} ${value}`;
  });
  const scoreLine=`Score ${scoreNumber(scoring?.overall)}/10 - ${values.join(', ')}`;
  const [,buyer,first]=rssDescription(post).split('\n\n');
  // Reserve the prefix inside the existing promise budget. Buyer and starter
  // paragraphs retain the relay format, with no score-driven mid-word cuts.
  const promise=fitSentences(post.promise,220-scoreLine.length-1);
  return `${scoreLine}\n${promise}\n\n${buyer}\n\n${first}`;
}

export function metaDescription(post){
  const promise=fitSentences(post.promise,300);
  const buyer=fitSentences(buyerText(post.whoPays),260);
  const combined=`${promise} Who might pay: Hypothesis: ${buyer}`;
  return buyer&&combined.length<=300?combined:promise;
}

export function renderPostPage(post,baseURL,{styleVersion}={}){
  if(styleVersion!==undefined&&!/^[a-f0-9]{12}$/.test(styleVersion))throw new Error('Invalid stylesheet version.');
  const canonical=publicPostURL(baseURL,post.id),image=`${baseURL}/cards/${post.id}.jpg`;
  const description=metaDescription(post),overlap=historicalOverlapFor(post);
  const loop=Array.isArray(post.loop)?post.loop:post.loop?[post.loop]:[];
  const first=Array.isArray(post.first24Hours)?post.first24Hours:post.first24Hours?[post.first24Hours]:[];
  const published=new Date(post.publishedAt);
  if(!Number.isFinite(published.getTime()))throw new Error(`Invalid publication time for ${post.id}.`);
  const date=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Vilnius',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(published);
  const sources=(post.sources||[]).map(source=>{
    const item=typeof source==='string'?{url:source}:source;
    const url=safeSource(item?.url);
    return url?`<a class="source-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(sourceCredit(item))} <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>`:'';
  }).filter(Boolean).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="icon" href="${escape(baseURL+'/brand-icon.svg')}">
  <title>${escape(post.title)} · ${escape(BRAND_NAME)}</title>
  <meta name="description" content="${escape(description)}">
  <link rel="canonical" href="${escape(canonical)}">
  <link rel="alternate" type="application/rss+xml" title="${escape(BRAND_NAME)} RSS" href="${escape(baseURL+'/feed.xml')}">
  <meta property="og:title" content="${escape(post.title)}">
  <meta property="og:description" content="${escape(description)}">
  <meta property="og:image" content="${escape(image)}">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="1080">
  <meta property="og:image:height" content="1350">
  <meta property="og:image:alt" content="${escape(post.title+' — '+post.promise)}">
  <meta property="og:url" content="${escape(canonical)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${escape(BRAND_NAME)}">
  <meta property="article:published_time" content="${escape(published.toISOString())}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escape(post.title)}">
  <meta name="twitter:description" content="${escape(description)}">
  <meta name="twitter:image" content="${escape(image)}">
  <link rel="stylesheet" href="${escape(baseURL+'/styles.css'+(styleVersion?'?v='+styleVersion:''))}">
  <meta name="theme-color" content="#151915">
</head>
<body class="post-page">
  <a class="skip-link" href="#post-content">Skip to the idea</a>
  <div class="site-shell">
    <header class="site-header"><a class="brand" href="${escape(baseURL+'/')}"><span class="brand-mark" aria-hidden="true">${escape(BRAND_MARK)}</span>${escape(BRAND_NAME)}</a><nav class="main-nav" aria-label="Main navigation"><a href="${escape(baseURL+'/')}">Ideas</a><a href="${escape(baseURL+'/machine/')}">Research log</a><a href="${escape(baseURL+'/method/')}">How it works</a></nav></header>
    <main id="post-content" class="single-post-main">
      <p class="eyebrow"><span class="tiny-orbit" aria-hidden="true"></span>One checked idea</p>
      <article class="post single-post" aria-labelledby="post-title">
        <div class="post-top"><div class="post-meta"><time datetime="${escape(post.publishedAt)}">${escape(date)} Vilnius</time></div><div class="verified-label"><span aria-hidden="true">✓</span>${post.assistantExecution?'Independently checked':'Checked by the loop'}</div></div>
        <div class="post-content"><div class="post-image-column"><a class="post-image-link" href="${escape(image)}" target="_blank" rel="noopener noreferrer" aria-label="Open image card for ${escape(post.title)}"><img class="post-image" src="${escape(image)}" alt="${escape(post.title+' — '+post.promise)}" width="1080" height="1350"></a><p class="post-image-caption">One idea. A small version you can build.<br>Open the card to see it full size.</p></div>
          <div class="post-copy"><h1 id="post-title">${escape(post.title)}</h1><p class="post-promise">${paragraphs(post.promise)}</p>
            ${scoreSection(post)}
            ${overlap ? `<aside class="post-overlap"><strong>${escape(overlap.label)}</strong><p>This historical repeat was published before the stronger novelty check on 12 October. Compare <a href="${escape(publicPostURL(baseURL,overlap.earlierPostId))}">${escape(overlap.earlierTitle)}</a>; a different tool does not make it a different business idea.</p></aside>` : ''}
            <div class="post-body-grid"><section class="post-field"><h2>What it is</h2><p>${paragraphs(post.whatItIs)}</p></section><section class="post-field"><h2>Who pays</h2><p>${paragraphs(post.whoPays)}</p></section><section class="post-field full"><h2>How the loop runs</h2><ol class="idea-loop">${loop.map(step=>`<li>${escape(step)}</li>`).join('')}</ol></section></div>
            <section class="post-evidence"><h2>The evidence</h2><p>${paragraphs(post.evidence)}</p>${post.uncertainty||post.limitations?`<p class="uncertainty"><strong>What we don’t know:</strong> ${paragraphs(post.uncertainty||post.limitations)}</p>`:''}</section>
            <section class="first-hours"><h2>Build a small version · your first 24 hours</h2><ol>${first.map(step=>`<li>${escape(step)}</li>`).join('')}</ol></section>
          </div>
        </div>
        <div class="post-bottom"><div class="source-list"><span class="source-heading">Read the sources</span>${sources}</div></div>
      </article>
      <div class="single-post-links"><a class="button" href="${escape(baseURL+'/')}">More ideas <span aria-hidden="true">↗</span></a><a class="button" href="${LINKEDIN_PAGE_URL}" target="_blank" rel="noopener noreferrer">Follow on LinkedIn <span aria-hidden="true">↗</span></a></div>
    </main>
    <footer class="site-footer"><a class="brand" href="${escape(baseURL+'/')}"><span class="brand-mark" aria-hidden="true">${escape(BRAND_MARK)}</span>${escape(BRAND_NAME)}</a><p>Business ideas. Sources you can read.</p><a href="${escape(baseURL+'/feed.xml')}">RSS feed <span aria-hidden="true">↗</span></a></footer>
  </div>
</body>
</html>
`;
}

export async function writeSiteArtifacts({root,posts,baseURL,styleVersion,picks=[]}){
  const url=new URL(baseURL);
  if(!['https:','http:'].includes(url.protocol)||url.search||url.hash)throw new Error('Invalid public base URL.');
  baseURL=url.href.replace(/\/$/,'');
  const seen=new Set();
  const sorted=[...posts].sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt));
  if(!Array.isArray(picks))throw new Error('LinkedIn picks must be validated durable records.');
  const items=[],postUrls=[],publishedItems=new Map();
  for(const post of sorted){
    const canonical=publicPostURL(baseURL,post.id);
    if(seen.has(post.id))throw new Error(`Duplicate published post ID: ${post.id}.`);
    seen.add(post.id);
    const published=new Date(post.publishedAt);
    if(!Number.isFinite(published.getTime()))throw new Error(`Invalid publication time for ${post.id}.`);
    const image=`${baseURL}/cards/${post.id}.jpg`;
    const stat=await fs.stat(path.join(root,'public','cards',post.id+'.jpg'));
    if(!stat.isFile()||stat.size===0)throw new Error(`Missing JPEG card for ${post.id}.`);
    const directory=path.join(root,'public','p',post.id);
    await fs.mkdir(directory,{recursive:true});
    await fs.writeFile(path.join(directory,'index.html'),renderPostPage(post,baseURL,{styleVersion}));
    if(rssEligible(post))items.push(`<item><title>${escape(rssTitle(post.title))}</title><link>${escape(canonical)}</link><guid isPermaLink="false">${escape(post.id)}</guid><pubDate>${published.toUTCString()}</pubDate><description>${escape(rssDescription(post))}</description><enclosure url="${escape(image)}" type="image/jpeg" length="${stat.size}"/><media:content url="${escape(image)}" type="image/jpeg" medium="image" fileSize="${stat.size}" width="1080" height="1350"/></item>`);
    publishedItems.set(post.id,{post,canonical,image,size:stat.size});
    postUrls.push(canonical);
  }
  const latestRSS=sorted.find(rssEligible);
  const feedUrl=baseURL+'/feed.xml';
  const rss=`<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${escape(BRAND_NAME)}</title><link>${escape(baseURL+'/')}</link><description>${escape(BRAND_DESCRIPTION)}</description><language>en</language><atom:link href="${escape(feedUrl)}" rel="self" type="application/rss+xml"/>${latestRSS?`<lastBuildDate>${new Date(latestRSS.publishedAt).toUTCString()}</lastBuildDate>`:''}${items.join('')}</channel></rss>\n`;
  await fs.writeFile(path.join(root,'public','feed.xml'),rss);
  const bestFeedUrl=baseURL+'/best.xml',pickedIds=new Set();
  const selected=[...picks].sort((a,b)=>new Date(b.pickedAt)-new Date(a.pickedAt));
  const bestItems=selected.map(pick=>{
    const item=publishedItems.get(pick.postId);
    if(!item)throw new Error('A LinkedIn pick references an unknown published post.');
    if(!rssEligible(item.post))throw new Error('A website-only post cannot be relayed through a LinkedIn pick.');
    if(pickedIds.has(pick.postId))throw new Error('Duplicate LinkedIn pick for the same post.');
    pickedIds.add(pick.postId);
    const {post,canonical,image,size}=item;
    if(pick.postContentSha256!==post.contentSha256||pick.publishedAt!==post.publishedAt||!Number.isFinite(Date.parse(pick.pickedAt)))throw new Error('LinkedIn pick does not match its frozen publication metadata.');
    return `<item><title>${escape(rssTitle(post.title))}</title><link>${escape(canonical)}</link><guid isPermaLink="false">${escape(post.id)}</guid><pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate><description>${escape(bestRSSDescription(post,pick.scoring))}</description><enclosure url="${escape(image)}" type="image/jpeg" length="${size}"/><media:content url="${escape(image)}" type="image/jpeg" medium="image" fileSize="${size}" width="1080" height="1350"/></item>`;
  });
  const bestRSS=`<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${escape(BRAND_NAME)} · LinkedIn picks</title><link>${escape(baseURL+'/')}</link><description>Selected checked ideas for LinkedIn, with their scores frozen when picked.</description><language>en</language><atom:link href="${escape(bestFeedUrl)}" rel="self" type="application/rss+xml"/>${selected[0]?`<lastBuildDate>${new Date(selected[0].pickedAt).toUTCString()}</lastBuildDate>`:''}${bestItems.join('')}</channel></rss>\n`;
  await fs.writeFile(path.join(root,'public','best.xml'),bestRSS);
  return {feedUrl,bestFeedUrl,postUrls,items:items.length,bestItems:bestItems.length};
}
