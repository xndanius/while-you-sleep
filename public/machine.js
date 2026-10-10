(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const plain = (value) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const presentNumber = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const number = (value) => presentNumber(value) ? new Intl.NumberFormat('en-GB').format(Number(value)) : '—';
  const money = (value) => presentNumber(value) ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:4}).format(Number(value)) : '—';
  const validDate = (value) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value) : null;
  const formatDate = (value, options = {}) => {
    const date = validDate(value);
    return date ? new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Vilnius',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:false,...options}).format(date) : 'Not recorded';
  };
  const shortTime = (value) => {
    const date = validDate(value);
    return date ? new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Vilnius',hour:'2-digit',minute:'2-digit',hour12:false}).format(date) : '—';
  };
  const day = (value) => {
    const date = validDate(value);
    return date ? new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Vilnius',day:'numeric',month:'short',year:'numeric'}).format(date) : 'Date not recorded';
  };
  const safeURL = (value) => {
    if (!value) return '';
    try { const url = new URL(String(value), document.baseURI); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; }
    catch { return ''; }
  };
  const human = (value) => plain(value).replace(/[_-]/g,' ').replace(/\b\w/g,(letter) => letter.toUpperCase());
  const anchorId = (id) => `post-${String(id).replace(/[^a-zA-Z0-9_-]/g,'-')}`;
  const list = (value, name = 'name') => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.entries(value).map(([key, item]) => typeof item === 'object' && item ? {[name]:key,...item} : {[name]:key,status:item}) : [];
  const stateClass = (value) => {
    const state = plain(value).toLowerCase();
    if (['success','succeeded','completed','complete','published','healthy','ok','active','live','connected','adopted','shipped','passed','available','enabled'].includes(state)) return 'good';
    if (['failed','failure','error','unhealthy','rejected','unavailable'].includes(state)) return 'bad';
    if (['running','pending','pending_setup','awaiting_first_cloud_run','awaiting_access','awaiting_connection','restricted','partial','degraded','skipped','not_connected','disabled','dry_run'].includes(state)) return 'warning';
    return '';
  };
  const stateLabel = (state) => ({awaiting_key:'Awaiting model access',awaiting_first_cloud_run:'Awaiting the first cloud run',awaiting_access:'Needs access',awaiting_connection:'Needs connection',pending_setup:'Needs setup',not_connected:'Not connected',dry_run:'Dry run',succeeded:'Completed',success:'Completed',ok:'Available',enabled:'Connected'}[state] || human(state) || 'Not recorded');
  const chip = (state, label) => `<span class="status-chip ${stateClass(state)}">${escape(label || stateLabel(state))}</span>`;
  const link = (url, title) => safeURL(url) ? `<a href="${escape(safeURL(url))}" target="_blank" rel="noopener noreferrer">${escape(title)} <span aria-hidden="true">↗</span></a>` : '';
  let fetching = false;
  let loaded = false;
  let data;
  document.querySelector('.skip-link').setAttribute('href',`${location.pathname}#machine-content`);

  function renderStats(stats) {
    const values = [['Published',number(stats?.published)],['Candidates',number(stats?.candidates)],['Rejected',number(stats?.rejected)],['Feed views',number(stats?.views)],['Saves',number(stats?.saves)],['Model cost',money(stats?.totalCostUsd)]];
    $('machine-stats').innerHTML = values.map(([label,value]) => `<div><span>${label}${value === '—' && ['Feed views','Saves'].includes(label) ? ' · unavailable' : ''}</span><strong>${escape(value)}</strong></div>`).join('');
  }

  function renderStatus() {
    const status = data.status || {};
    $('machine-state').textContent = status.state ? stateLabel(status.state) : 'Record connected';
    const verified = Boolean(data.schedule?.verifiedHostedRunAt || status.lastHostedRunUrl);
    $('machine-signal').className = `signal-dot${stateClass(status.state) === 'bad' ? ' error' : verified ? ' live' : ''}`;
    $('last-research').textContent = formatDate(status.lastResearchAt);
    $('last-published').textContent = formatDate(status.lastPublishedAt);
    $('next-published').textContent = data.schedule?.nextPublicationAt ? formatDate(data.schedule.nextPublicationAt) : 'Not recorded';
    $('hosting-note').textContent = verified ? 'Hosted in GitHub Actions · laptops can close' : status.hosted === true ? 'Cloud schedule configured · first run not yet verified' : 'Hosted execution is not yet confirmed';
  }

  function runTitle(type) {
    return ({loop:'Research & publish',bootstrap:'First publishing run',research:'Research',measure:'Measure results',measurement:'Measure results',improve:'Improve the rules',improvement:'Improve the rules',publish:'Publish checked posts'}[type] || human(type) || 'Loop run');
  }

  function renderRuns() {
    const open = new Set([...$('runs').querySelectorAll('details[open]')].map((run) => run.dataset.runId));
    const runs = list(data.runs).sort((a,b) => (validDate(b.startedAt)?.getTime() || 0) - (validDate(a.startedAt)?.getTime() || 0));
    $('runs').setAttribute('aria-busy','false');
    if (!runs.length) {
      $('runs').innerHTML = '<div class="empty-state"><span class="empty-symbol" aria-hidden="true">◔</span><h3>The record starts with the first run.</h3><p>Research, checks, rejected ideas, and publications will appear here as the hosted loop records them.</p></div>';
      return;
    }
    $('runs').innerHTML = runs.map((run,index) => {
      const id = String(run.id || index);
      const rejected = Array.isArray(run.rejected) ? run.rejected : [];
      const published = Array.isArray(run.published) ? run.published : [];
      const steps = Array.isArray(run.steps) ? run.steps : [];
      const candidateCount = run.candidatesFound ?? run.candidates;
      const picked = Array.isArray(run.picked) ? run.picked.length : run.picked;
      const parts = [];
      if (presentNumber(candidateCount)) parts.push(`<strong>${number(candidateCount)}</strong> candidates`);
      if (presentNumber(picked)) parts.push(`<strong>${number(picked)}</strong> picked`);
      if (Array.isArray(run.rejected)) parts.push(`<strong>${rejected.length}</strong> rejected`);
      if (Array.isArray(run.published)) parts.push(`<strong>${published.length}</strong> published`);
      const runLink = link(run.githubRunUrl || run.runUrl || run.htmlUrl || run.workflowUrl, 'View hosted run');
      const commitLink = link(run.commitUrl || run.githubCommitUrl, 'View commit');
      return `<details class="run" data-run-id="${escape(id)}"${open.has(id) || (!loaded && index === 0) ? ' open' : ''}>
        <summary><div class="run-summary-date">${escape(day(run.startedAt))}<strong>${escape(shortTime(run.startedAt))}</strong></div><div class="run-summary-main"><h3>${escape(runTitle(run.type))}</h3><p>${parts.length ? parts.join(' · ') : escape(plain(run.summary) || 'No counts recorded for this run.')}</p></div>${chip(run.status)}<span class="run-chevron" aria-hidden="true">+</span></summary>
        <div class="run-body"><div class="run-facts">${run.finishedAt ? `<span>Finished <strong>${escape(formatDate(run.finishedAt))}</strong></span>` : ''}${presentNumber(run.usage?.costUsd) ? `<span>Model cost <strong>${escape(money(run.usage.costUsd))}</strong></span>` : ''}${run.version ? `<span>Rules <strong>${escape(run.version)}</strong></span>` : ''}${runLink}${commitLink}</div>
        ${run.message || run.error ? `<p class="muted">${escape(plain(run.message || run.error))}</p>` : ''}
        ${steps.length ? `<ol class="run-timeline">${steps.map((step) => `<li class="${stateClass(step.status) === 'bad' ? 'failed' : ''}"><time datetime="${escape(step.at || '')}">${escape(shortTime(step.at))}</time><span class="stage">${escape(human(step.stage || step.name || 'Step'))}</span><span class="stage-message">${escape(plain(step.message || step.summary || step.status))}</span></li>`).join('')}</ol>` : '<p class="muted">No stage messages recorded for this run.</p>'}
        ${rejected.length ? `<div class="run-rejections"><h4>Rejected ideas · ${rejected.length}</h4>${rejected.map((item) => typeof item === 'string' ? `<div class="rejection"><strong>${escape(item)}</strong><p>Reason not recorded.</p></div>` : `<div class="rejection"><strong>${escape(plain(item.title || item.name) || 'Candidate')}</strong><p>${escape(plain(item.reason || item.message) || 'Reason not recorded.')}</p></div>`).join('')}</div>` : ''}
        ${published.length ? `<div class="run-published"><span>Published: </span>${published.map((post) => { const postId = typeof post === 'string' ? post : post.id; const title = typeof post === 'string' ? data.posts?.find((item) => item.id === post)?.title || post : post.title || postId; return `<a href="./#${escape(anchorId(postId))}">${escape(title)} <span aria-hidden="true">↗</span></a>`; }).join('')}</div>` : ''}
        </div></details>`;
    }).join('');
  }

  function renderSchedule() {
    const schedule = data.schedule;
    if (!schedule || typeof schedule !== 'object') { $('schedule').innerHTML = '<p class="muted">The hosted schedule has not been recorded yet.</p>'; return; }
    const hours = Array.isArray(schedule.publicationHours) ? schedule.publicationHours.map((hour) => typeof hour === 'number' ? `${String(hour).padStart(2,'0')}:00` : plain(hour).includes(':') ? plain(hour) : `${plain(hour).padStart(2,'0')}:00`).join(' · ') : '';
    const rows = [];
    if (hours) rows.push(['Research & publish',hours]);
    if (schedule.researchEveryHours) rows.push(['Research scan',`Every ${schedule.researchEveryHours} hours`]);
    if (schedule.measurementTime || schedule.measureAt) rows.push(['Measure results',`${schedule.measurementTime || schedule.measureAt} daily`]);
    if (schedule.improvementTime || schedule.improveAt) rows.push(['Improve rules',`${schedule.improvementTime || schedule.improveAt} daily`]);
    if (schedule.weeklyDigestTime) rows.push(['LinkedIn digest',schedule.weeklyDigestTime]);
    if (schedule.nextResearchAt) rows.push(['Next research',formatDate(schedule.nextResearchAt)]);
    $('schedule').innerHTML = rows.map(([label,value]) => `<div class="schedule-row"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`).join('') + `<p class="schedule-footnote">${escape(schedule.timezone || 'Time zone not recorded')}${data.status?.hosted === true ? ' · GitHub Actions' : ''}. The log records what actually ran.</p>`;
  }

  function renderPlatforms() {
    const platforms = list(data.platforms);
    if (!platforms.length) { $('platforms').innerHTML = '<p class="muted">No platform connections have been recorded yet.</p>'; return; }
    $('platforms').innerHTML = platforms.map((platform) => {
      const name = platform.name || platform.platform || platform.id;
      const status = plain(platform.status || platform.state) || (platform.connected === true || platform.configured === true ? 'connected' : platform.connected === false || platform.configured === false ? 'not_connected' : 'not_recorded');
      const note = plain(platform.note || platform.message || platform.reason || platform.description);
      const metrics = [];
      for (const [key,label] of [['likes','likes'],['reposts','reposts'],['followers','followers'],['published','posts']]) if (presentNumber(platform.metrics?.[key])) metrics.push(`${number(platform.metrics[key])} ${label}`);
      return `<div class="platform-row"><div><div class="platform-name">${escape(name === 'x' ? 'X' : name === 'linkedin' ? 'LinkedIn' : human(name))}</div>${note ? `<p class="platform-note">${escape(note)}</p>` : ''}</div><div class="platform-right">${chip(status)}${metrics.length ? `<div class="platform-metrics">${escape(metrics.join(' · '))}</div>` : ''}</div></div>`;
    }).join('');
  }

  function renderVersions() {
    const versions = list(data.versions).sort((a,b) => (validDate(b.at || b.createdAt || b.adoptedAt)?.getTime() || 0) - (validDate(a.at || a.createdAt || a.adoptedAt)?.getTime() || 0));
    if (!versions.length) { $('versions').innerHTML = '<div class="empty-state compact"><h3>The first improvement is still ahead.</h3><p>A proposed rule change ships only after a separate grader scores it higher on held-out candidates. The reason and test results will appear here.</p></div>'; return; }
    $('versions').innerHTML = versions.map((version) => {
      const title = plain(version.change || version.summary || version.title || version.name) || 'Rules recorded';
      const reason = plain(version.reason || version.description);
      const baseline = version.baselineScore ?? version.test?.baselineScore ?? version.testResult?.baselineScore;
      const proposal = version.proposedScore ?? version.challengerScore ?? version.candidateScore ?? version.test?.proposedScore ?? version.testResult?.proposedScore;
      const heldout = version.heldoutCount ?? version.test?.heldoutCount ?? version.testResult?.heldoutCount;
      const scores = [];
      if (presentNumber(baseline)) scores.push(`Before <strong>${number(baseline)}</strong>`);
      if (presentNumber(proposal)) scores.push(`After <strong>${number(proposal)}</strong>`);
      if (presentNumber(heldout)) scores.push(`<strong>${number(heldout)}</strong> held-out candidates`);
      const commit = link(version.commitUrl || version.githubCommitUrl, 'Commit & reason');
      return `<article class="version"><div><div class="version-number">${escape(plain(version.version || version.id) || '—')}</div><div class="version-date">${escape(day(version.at || version.createdAt || version.adoptedAt))}</div></div><div><h3>${escape(title)}</h3>${reason ? `<p>${escape(reason)}</p>` : ''}${plain(version.testResult?.summary || version.test?.summary) ? `<p>${escape(plain(version.testResult?.summary || version.test?.summary))}</p>` : ''}${scores.length || commit ? `<div class="version-scores">${scores.map((score) => `<span>${score}</span>`).join('')}${commit}</div>` : ''}</div><div class="version-status">${chip(version.status || (version.adopted === true ? 'adopted' : 'recorded'))}</div></article>`;
    }).join('');
  }

  function renderSources() {
    const sources = list(data.sourceHealth);
    if (!sources.length) { $('source-health').innerHTML = '<p class="muted">No source checks have been recorded yet. The loop will log successful fetches and access failures here.</p>'; return; }
    $('source-health').innerHTML = sources.map((source) => {
      const name = plain(source.name || source.publisher || source.source || source.id) || 'Source';
      const status = source.status || source.state || (source.ok === true ? 'available' : source.ok === false ? 'unavailable' : 'not_recorded');
      const note = plain(source.note || source.message || source.error || source.reason);
      const count = source.candidatesFound ?? source.candidates ?? source.itemsFound ?? source.count;
      return `<article class="health-card"><div class="health-header"><h3>${safeURL(source.url) ? link(source.url,name) : escape(name)}</h3>${chip(status)}</div>${note ? `<p>${escape(note)}</p>` : ''}${presentNumber(count) ? `<p>${number(count)} candidates found in the recorded scan.</p>` : ''}<footer>Last check: ${escape(formatDate(source.checkedAt || source.lastCheckedAt || source.fetchedAt || source.at))}</footer></article>`;
    }).join('');
  }

  async function refresh() {
    if (fetching) return;
    fetching = true;
    $('refresh-machine').disabled = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(),20000);
    try {
      const response = await fetch('api/machine.json',{signal:controller.signal,cache:'no-store',headers:{Accept:'application/json'}});
      if (!response.ok) throw new Error(`Machine request failed (${response.status}).`);
      const result = await response.json();
      if (!result || typeof result !== 'object' || !Array.isArray(result.runs)) throw new Error('The machine returned an unexpected response.');
      data = result;
      renderStatus();
      renderStats(data.stats);
      renderRuns();
      renderSchedule();
      renderPlatforms();
      renderVersions();
      renderSources();
      loaded = true;
      $('machine-notice').classList.remove('visible');
      $('machine-notice').textContent = '';
      $('machine-updated').textContent = `Refreshed ${shortTime(new Date())} Vilnius`;
    } catch {
      $('machine-state').textContent = 'Connection interrupted';
      $('machine-signal').className = 'signal-dot error';
      $('machine-notice').textContent = loaded ? 'The record could not refresh. The last loaded record remains visible. We’ll try again in a minute.' : 'The machine record could not load. We’ll try again in a minute, or you can refresh now.';
      $('machine-notice').classList.add('visible');
      $('runs').setAttribute('aria-busy','false');
      if (!loaded) {
        $('hosting-note').textContent = 'The hosted schedule could not be read';
        $('runs').innerHTML = '<div class="empty-state"><span class="empty-symbol" aria-hidden="true">◔</span><h3>We couldn’t reach the record.</h3><p>Recorded runs will appear when the connection returns.</p></div>';
        $('schedule').innerHTML = '<p class="muted">The schedule is unavailable while the connection is interrupted.</p>';
        $('platforms').innerHTML = '<p class="muted">Connection status is unavailable while the record cannot be reached.</p>';
        $('versions').innerHTML = '<div class="empty-state compact"><h3>Version history is unavailable.</h3><p>Recorded rule changes will appear when the connection returns.</p></div>';
        $('source-health').innerHTML = '<p class="muted">Source health is unavailable while the record cannot be reached.</p>';
      }
    } finally {
      clearTimeout(timeout);
      fetching = false;
      $('refresh-machine').disabled = false;
    }
  }

  $('refresh-machine').addEventListener('click',refresh);
  document.addEventListener('visibilitychange',() => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); },60000);
  refresh();
})();
