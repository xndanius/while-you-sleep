import { promises as fs } from 'node:fs';
import path from 'node:path';

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

export function metaDescription(post){
  const promise=fitSentences(post.promise,300);
  const buyer=fitSentences(buyerText(post.whoPays),260);
  const combined=`${promise} Who might pay: Hypothesis: ${buyer}`;
  return buyer&&combined.length<=300?combined:promise;
}

export function renderPostPage(post,baseURL){
  const canonical=publicPostURL(baseURL,post.id),image=`${baseURL}/cards/${post.id}.jpg`;
  const description=metaDescription(post);
  const loop=Array.isArray(post.loop)?post.loop:post.loop?[post.loop]:[];
  const first=Array.isArray(post.first24Hours)?post.first24Hours:post.first24Hours?[post.first24Hours]:[];
  const published=new Date(post.publishedAt);
  if(!Number.isFinite(published.getTime()))throw new Error(`Invalid publication time for ${post.id}.`);
  const date=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Vilnius',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(published);
  const sources=(post.sources||[]).map(source=>{
    const item=typeof source==='string'?{url:source}:source;
    const url=safeSource(item?.url);
    return url?`<a class="source-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(item.title||item.publisher||new URL(url).hostname)} <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>`:'';
  }).filter(Boolean).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escape(post.title)} · While You Sleep</title>
  <meta name="description" content="${escape(description)}">
  <link rel="canonical" href="${escape(canonical)}">
  <link rel="alternate" type="application/rss+xml" title="While You Sleep RSS" href="${escape(baseURL+'/feed.xml')}">
  <meta property="og:title" content="${escape(post.title)}">
  <meta property="og:description" content="${escape(description)}">
  <meta property="og:image" content="${escape(image)}">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="1080">
  <meta property="og:image:height" content="1350">
  <meta property="og:image:alt" content="${escape(post.title+' — '+post.promise)}">
  <meta property="og:url" content="${escape(canonical)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="While You Sleep">
  <meta property="article:published_time" content="${escape(published.toISOString())}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escape(post.title)}">
  <meta name="twitter:description" content="${escape(description)}">
  <meta name="twitter:image" content="${escape(image)}">
  <link rel="stylesheet" href="${escape(baseURL+'/styles.css')}">
  <meta name="theme-color" content="#151915">
</head>
<body class="post-page">
  <a class="skip-link" href="#post-content">Skip to the idea</a>
  <div class="site-shell">
    <header class="site-header"><a class="brand" href="${escape(baseURL+'/')}"><span class="brand-mark" aria-hidden="true">◔</span>While You Sleep</a><nav class="main-nav" aria-label="Main navigation"><a href="${escape(baseURL+'/')}">Feed</a><a href="${escape(baseURL+'/machine/')}">The machine</a></nav></header>
    <main id="post-content" class="single-post-main">
      <p class="eyebrow"><span class="tiny-orbit" aria-hidden="true"></span>One checked idea</p>
      <article class="post single-post" aria-labelledby="post-title">
        <div class="post-top"><div class="post-meta"><time datetime="${escape(post.publishedAt)}">${escape(date)} Vilnius</time></div><div class="verified-label"><span aria-hidden="true">✓</span>Checked by the loop</div></div>
        <div class="post-content"><div class="post-image-column"><a class="post-image-link" href="${escape(image)}" target="_blank" rel="noopener noreferrer" aria-label="Open image card for ${escape(post.title)}"><img class="post-image" src="${escape(image)}" alt="${escape(post.title+' — '+post.promise)}" width="1080" height="1350"></a><p class="post-image-caption">One idea. A small version you can build.<br>Open the card to see it full size.</p></div>
          <div class="post-copy"><h1 id="post-title">${escape(post.title)}</h1><p class="post-promise">${paragraphs(post.promise)}</p>
            <div class="post-body-grid"><section class="post-field"><h2>What it is</h2><p>${paragraphs(post.whatItIs)}</p></section><section class="post-field"><h2>Who pays</h2><p>${paragraphs(post.whoPays)}</p></section><section class="post-field full"><h2>How the loop runs</h2><ol class="idea-loop">${loop.map(step=>`<li>${escape(step)}</li>`).join('')}</ol></section></div>
            <section class="post-evidence"><h2>The evidence</h2><p>${paragraphs(post.evidence)}</p>${post.uncertainty||post.limitations?`<p class="uncertainty"><strong>What we don’t know:</strong> ${paragraphs(post.uncertainty||post.limitations)}</p>`:''}</section>
            <section class="first-hours"><h2>Build a small version · your first 24 hours</h2><ol>${first.map(step=>`<li>${escape(step)}</li>`).join('')}</ol></section>
          </div>
        </div>
        <div class="post-bottom"><div class="source-list"><span class="source-heading">Read the sources</span>${sources}</div></div>
      </article>
      <div class="single-post-links"><a class="button" href="${escape(baseURL+'/')}">More ideas <span aria-hidden="true">↗</span></a><a class="button" href="${LINKEDIN_PAGE_URL}" target="_blank" rel="noopener noreferrer">Follow on LinkedIn <span aria-hidden="true">↗</span></a></div>
    </main>
    <footer class="site-footer"><a class="brand" href="${escape(baseURL+'/')}"><span class="brand-mark" aria-hidden="true">◔</span>While You Sleep</a><p>Real projects. Sources you can read.</p><a href="${escape(baseURL+'/feed.xml')}">RSS feed <span aria-hidden="true">↗</span></a></footer>
  </div>
</body>
</html>
`;
}

export async function writeSiteArtifacts({root,posts,baseURL}){
  const url=new URL(baseURL);
  if(!['https:','http:'].includes(url.protocol)||url.search||url.hash)throw new Error('Invalid public base URL.');
  baseURL=url.href.replace(/\/$/,'');
  const seen=new Set();
  const sorted=[...posts].sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt));
  const items=[],postUrls=[];
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
    await fs.writeFile(path.join(directory,'index.html'),renderPostPage(post,baseURL));
    items.push(`<item><title>${escape(rssTitle(post.title))}</title><link>${escape(canonical)}</link><guid isPermaLink="false">${escape(post.id)}</guid><pubDate>${published.toUTCString()}</pubDate><description>${escape(rssDescription(post))}</description><enclosure url="${escape(image)}" type="image/jpeg" length="${stat.size}"/><media:content url="${escape(image)}" type="image/jpeg" medium="image" fileSize="${stat.size}" width="1080" height="1350"/></item>`);
    postUrls.push(canonical);
  }
  const feedUrl=baseURL+'/feed.xml';
  const rss=`<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>While You Sleep</title><link>${escape(baseURL+'/')}</link><description>Real autonomous AI projects, evidence, and small first steps. Published by a checked Codex cloud loop.</description><language>en</language><atom:link href="${escape(feedUrl)}" rel="self" type="application/rss+xml"/>${sorted[0]?`<lastBuildDate>${new Date(sorted[0].publishedAt).toUTCString()}</lastBuildDate>`:''}${items.join('')}</channel></rss>\n`;
  await fs.writeFile(path.join(root,'public','feed.xml'),rss);
  return {feedUrl,postUrls,items:items.length};
}
