import {loopTiming} from './schedule.js';
import {slotPresentation} from './slot-display.js';

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const plain = (value) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const paragraphs = (value) => escape(Array.isArray(value) ? value.filter((item) => typeof item === 'string').join('\n') : plain(value)).replace(/\n/g, '<br>');
  const anchorId = (id) => `post-${String(id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const validDate = (value) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value) : null;
  const dateLabel = (value) => {
    const date = validDate(value);
    return date ? new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Vilnius', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hour12:false}).format(date) : 'Publication time not recorded';
  };
  const safeURL = (value) => {
    try { const url = new URL(String(value), document.baseURI); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; }
    catch { return ''; }
  };
  const hostname = (value) => { try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return 'Source'; } };
  const readStorage = (storage, key, fallback) => { try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const writeStorage = (storage, key, value) => { try { storage.setItem(key, JSON.stringify(value)); } catch { /* Saving remains usable for this page when storage is unavailable. */ } };
  const saved = new Set(readStorage(localStorage, 'wys-saved', []));
  let posts = [];
  let currentTab = 'all';
  let fetching = false;
  let hasLoaded = false;
  let observer;
  let toastTimer;
  let record;

  function toast(message) {
    const element = $('toast');
    element.textContent = message;
    element.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('visible'), 3500);
  }

  function sourceMarkup(source) {
    const raw = typeof source === 'string' ? {url:source} : source || {};
    const url = safeURL(raw.url || raw.link);
    if (!url) return '';
    const sourceTitle = plain(raw.title);
    const label = sourceTitle ? sourceTitle.length > 80 ? `${sourceTitle.slice(0,77)}…` : sourceTitle : plain(raw.publisher) || hostname(url);
    const title = [plain(raw.publisher),sourceTitle].filter(Boolean).join(' · ') || label;
    return `<a class="source-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer" title="${escape(title)}">${escape(label)} <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>`;
  }

  function postMarkup(post, index) {
    const id = String(post.id);
    const title = plain(post.title) || 'Untitled idea';
    const loop = Array.isArray(post.loop) ? post.loop.filter((item) => typeof item === 'string') : plain(post.loop) ? [post.loop] : [];
    const actions = Array.isArray(post.first24Hours) ? post.first24Hours.filter((item) => typeof item === 'string') : plain(post.first24Hours) ? [post.first24Hours] : [];
    const sources = Array.isArray(post.sources) ? post.sources.map(sourceMarkup).filter(Boolean) : [];
    const imageURL = safeURL(post.imageUrl || `cards/${encodeURIComponent(id)}.jpg`);
    const publicURL = safeURL(post.publicUrl || `p/${encodeURIComponent(id)}/`);
    const isSaved = saved.has(id);
    const recordedSaves = typeof post.metrics?.saves === 'number' && Number.isFinite(post.metrics.saves) && post.metrics.saves >= 0 ? new Intl.NumberFormat('en-GB').format(post.metrics.saves) : null;
    const uncertainty = post.uncertainty || post.limitations;
    const imageAlt = `${title} — ${plain(post.promise)}`;
    const imageFallback = `<div class="post-image-fallback"><small>While You Sleep</small>${escape(title)}</div>`;
    return `<article class="post" id="${escape(anchorId(id))}" data-post-id="${escape(id)}" aria-labelledby="title-${escape(anchorId(id))}">
      <div class="post-top"><div class="post-meta"><span class="post-number">${String(index + 1).padStart(2, '0')}</span><span class="meta-separator" aria-hidden="true"></span><time datetime="${escape(post.publishedAt || '')}">${escape(dateLabel(post.publishedAt))}</time></div><div class="verified-label"><span aria-hidden="true">✓</span> Checked by the loop</div></div>
      <div class="post-content"><div class="post-image-column"><a class="post-image-link" href="${escape(imageURL)}" target="_blank" rel="noopener noreferrer" aria-label="Open image card for ${escape(title)}"><img class="post-image" src="${escape(imageURL)}" alt="${escape(imageAlt)}" loading="lazy" width="1080" height="1350" data-fallback="${escape(imageFallback)}"></a><p class="post-image-caption">One idea. A small version you can build.<br>Open the card to see it full size.</p></div>
      <div class="post-copy"><h3 id="title-${escape(anchorId(id))}"><a href="${escape(publicURL)}">${escape(title)}</a></h3>${post.promise ? `<p class="post-promise">${paragraphs(post.promise)}</p>` : ''}
        <div class="post-body-grid">${post.whatItIs ? `<section class="post-field"><h4>What it is</h4><p>${paragraphs(post.whatItIs)}</p></section>` : ''}${post.whoPays ? `<section class="post-field"><h4>Who pays</h4><p>${paragraphs(post.whoPays)}</p></section>` : ''}${loop.length ? `<section class="post-field full"><h4>How the loop runs</h4><ol class="idea-loop">${loop.map((step) => `<li>${escape(step)}</li>`).join('')}</ol></section>` : ''}</div>
        ${post.evidence || uncertainty ? `<section class="post-evidence"><h4>The evidence</h4>${post.evidence ? `<p>${paragraphs(post.evidence)}</p>` : ''}${uncertainty ? `<p class="uncertainty"><strong>What we don’t know:</strong> ${paragraphs(uncertainty)}</p>` : ''}</section>` : ''}
        ${actions.length ? `<section class="first-hours"><h4>Build a small version · your first 24 hours</h4><ol>${actions.map((action) => `<li>${escape(action)}</li>`).join('')}</ol></section>` : ''}
      </div></div>
      <div class="post-bottom"><div class="source-list"><span class="source-heading">Read the sources</span>${sources.length ? sources.join('') : '<span class="muted">Source links are not available.</span>'}</div><button class="save-button${isSaved ? ' saved' : ''}" type="button" data-save="${escape(id)}" aria-pressed="${isSaved}" aria-label="${isSaved ? 'Remove saved idea' : 'Save idea'}: ${escape(title)}"><svg viewBox="0 0 14 17" aria-hidden="true"><path d="M2 1.5h10v14L7 12l-5 3.5z" stroke-width="1.4" stroke-linejoin="round"/></svg><span>${isSaved ? 'Saved' : 'Save idea'}</span>${recordedSaves === null ? '' : `<span class="save-metric" title="Observed save events; measured daily">${escape(recordedSaves)}</span>`}</button></div>
    </article>`;
  }

  function updateSavedCount() {
    $('saved-count').textContent = saved.size ? String(saved.size) : '';
    $('all-tab').classList.toggle('active', currentTab === 'all');
    $('saved-tab').classList.toggle('active', currentTab === 'saved');
    $('all-tab').setAttribute('aria-pressed', String(currentTab === 'all'));
    $('saved-tab').setAttribute('aria-pressed', String(currentTab === 'saved'));
  }

  function render() {
    updateSavedCount();
    const filtered = currentTab === 'saved' ? posts.filter((post) => saved.has(String(post.id))) : posts;
    $('post-count').textContent = hasLoaded ? `(${filtered.length})` : '';
    $('posts').setAttribute('aria-busy', 'false');
    observer?.disconnect();
    if (!filtered.length) {
      $('posts').innerHTML = currentTab === 'saved'
        ? '<div class="empty-state"><span class="empty-symbol" aria-hidden="true">◔</span><h3>A place for the ideas you keep.</h3><p>Tap “Save idea” on any post to keep it here on this browser.</p><a href="#feed" data-show-all>Browse all ideas <span aria-hidden="true">↗</span></a></div>'
        : '<div class="empty-state"><span class="empty-symbol" aria-hidden="true">◔</span><h3>The first ideas are on their way.</h3><p>The loop publishes after research and a separate source check. Its recorded progress is on the machine page.</p><a href="machine/">See the loop log <span aria-hidden="true">↗</span></a></div>';
      return;
    }
    $('posts').innerHTML = filtered.map((post) => postMarkup(post, posts.indexOf(post))).join('');
    $('posts').querySelectorAll('.post-image').forEach((image) => {
      image.addEventListener('error', () => { image.parentNode.innerHTML = image.dataset.fallback; }, {once:true});
    });
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        window.wysAnalytics?.view(entry.target.dataset.postId);
        observer.unobserve(entry.target);
      }),{threshold:0.15});
      $('posts').querySelectorAll('.post').forEach((post) => observer.observe(post));
    }
    if (window.location.hash && !hasLoaded) {
      try {
        const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
        if (target?.classList.contains('post')) target.scrollIntoView();
      } catch { /* A malformed fragment should not interrupt the feed. */ }
    }
  }

  function renderSchedule() {
    if (!record) return;
    const cadence=loopTiming(record.status?.lastLoopAt),proof=record.schedule?.proof;
    $('cadence-summary').textContent = 'Three slots a day';
    $('cadence-times').innerHTML = `${cadence.publicationTimes.map(label=>`<span>${escape(label)}</span>`).join('')}<small>Vilnius time</small>`;
    const slots=(record.schedule?.slots||[]).map(slot=>slotPresentation(slot));
    const latest=slots.filter(slot=>validDate(slot.plannedAt)?.getTime()<=Date.now()).at(-1);
    const slotLabel=dateLabel(latest?.plannedAt||cadence.latestSlotAt);
    const slotNote=latest?latest.state==='published'?`The ${slotLabel} slot published at ${dateLabel(latest.actualAt)}.`:latest.state==='cap_reached'?`The ${slotLabel} slot reached the three-post daily cap.`:latest.state==='running'?`The ${slotLabel} slot is running; publication is not yet recorded.`:`The ${slotLabel} slot is ${latest.state.replace(/_/g,' ')}; no publication is recorded.`:cadence.slotState==='recorded'?'Latest slot has a recorded attempt.':`Publication for the ${slotLabel} slot is not recorded.`;
    const proofNote=proof?.state==='publication_observed'?'Scheduled publishing is verified.':proof?.state==='loop_observed'?'A scheduled loop is recorded; scheduled publication is not yet verified.':proof?.state==='trigger_observed'?'A schedule trigger is recorded; scheduled publishing is not yet verified.':'Scheduled publishing is not yet verified.';
    $('cadence-note').textContent=`Next planned loop: ${dateLabel(cadence.nextPublicationAt)} Vilnius. ${slotNote} ${proofNote}`;
  }

  async function refresh() {
    if (fetching) return;
    fetching = true;
    $('refresh-feed').disabled = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('api/feed.json', {signal:controller.signal, cache:'no-store', headers:{Accept:'application/json'}});
      if (!response.ok) throw new Error(`Feed request failed (${response.status}).`);
      const data = await response.json();
      if (!data || !Array.isArray(data.posts)) throw new Error('The feed returned an unexpected response.');
      const nextPosts = data.posts.filter((post) => post && post.id).sort((a,b) => (validDate(b.publishedAt)?.getTime() || 0) - (validDate(a.publishedAt)?.getTime() || 0));
      const changed = !hasLoaded || JSON.stringify(posts) !== JSON.stringify(nextPosts);
      posts = nextPosts;
      record = data;
      renderSchedule();
      const hostedVerified = Boolean(data.schedule?.verifiedHostedRunAt || data.status?.lastHostedRunUrl);
      const proof=data.schedule?.proof,scheduledVerified=proof?.state==='publication_observed';
      $('feed-status').textContent = data.status?.state === 'awaiting_first_cloud_run' ? hostedVerified ? 'Waiting for the first idea' : 'Waiting for the first run' : scheduledVerified ? 'Scheduled publishing verified' : proof?.state==='loop_observed'?'Scheduled loop observed':proof?.state==='trigger_observed'?'Schedule trigger observed':'Scheduled publishing unverified';
      $('feed-signal').className = `signal-dot${scheduledVerified?' live':''}`;
      $('feed-notice').classList.remove('visible');
      $('feed-notice').textContent = '';
      if (changed) render();
      hasLoaded = true;
      $('post-count').textContent = `(${currentTab === 'saved' ? posts.filter((post) => saved.has(String(post.id))).length : posts.length})`;
      $('feed-updated').textContent = `Refreshed ${new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Vilnius',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date())} Vilnius · every minute`;
    } catch {
      $('feed-signal').className = 'signal-dot error';
      $('feed-status').textContent = 'Connection interrupted';
      $('feed-notice').textContent = hasLoaded ? 'The feed could not refresh. These are the last posts loaded. We’ll try again in a minute.' : 'The feed could not load. We’ll try again in a minute, or you can refresh now.';
      $('feed-notice').classList.add('visible');
      $('posts').setAttribute('aria-busy', 'false');
      if (!hasLoaded) $('posts').innerHTML = '<div class="empty-state"><span class="empty-symbol" aria-hidden="true">◔</span><h3>We couldn’t reach the feed.</h3><p>The latest ideas will appear when the connection returns.</p><a href="machine/">Check the machine <span aria-hidden="true">↗</span></a></div>';
    } finally {
      clearTimeout(timeout);
      fetching = false;
      $('refresh-feed').disabled = false;
    }
  }

  $('all-tab').addEventListener('click', () => { currentTab = 'all'; render(); });
  $('saved-tab').addEventListener('click', () => { currentTab = 'saved'; render(); });
  $('refresh-feed').addEventListener('click', refresh);
  $('posts').addEventListener('click', (click) => {
    if (click.target.closest('[data-show-all]')) { click.preventDefault(); currentTab = 'all'; render(); return; }
    const button = click.target.closest('[data-save]');
    if (!button) return;
    const id = button.dataset.save;
    const wasSaved = saved.has(id);
    if (wasSaved) saved.delete(id); else saved.add(id);
    writeStorage(localStorage, 'wys-saved', [...saved]);
    render();
    const nextButton = [...$('posts').querySelectorAll('[data-save]')].find((item) => item.dataset.save === id);
    (nextButton || $('saved-tab')).focus({preventScroll:true});
    toast(wasSaved ? 'Removed from your saved ideas.' : 'Saved on this browser.');
    if (!wasSaved) window.wysAnalytics?.save(id);
  });
  window.addEventListener('storage', (change) => {
    if (change.key !== 'wys-saved') return;
    saved.clear();
    readStorage(localStorage, 'wys-saved', []).forEach((id) => saved.add(String(id)));
    render();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderSchedule(); refresh(); } });
  setInterval(() => { renderSchedule(); if (!document.hidden) refresh(); }, 60000);
  updateSavedCount();
  refresh();
})();
