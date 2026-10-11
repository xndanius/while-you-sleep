import {loopTiming,nextLocalTime} from './schedule.js?v=33ebd896a74f';
import {slotPresentation,currentDaySlots} from './slot-display.js?v=33ebd896a74f';
import {clockTiming,runTriggerLabel} from './clock-display.js?v=33ebd896a74f';
import {CLOCK_RUNTIME_URL,CLOCK_RUNTIME_REFRESH_MS,publicClockRuntime,newerClockRecord} from './clock-runtime.js?v=33ebd896a74f';

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
    if (['failed','failure','error','unhealthy','unavailable'].includes(state)) return 'bad';
    if (['running','pending','pending_setup','awaiting_first_cloud_run','awaiting_access','awaiting_connection','restricted','partial','degraded','skipped','not_connected','disabled','dry_run','rejected','late','missed','cap_reached','waiting_for_first_linkedin_post','stalled','waiting','not_started','unverified','recovering'].includes(state)) return 'warning';
    return '';
  };
  const stateLabel = (state) => ({awaiting_key:'Awaiting model access',awaiting_first_cloud_run:'Awaiting the first cloud run',awaiting_access:'Needs access',awaiting_connection:'Needs connection',pending_setup:'Needs setup',not_connected:'Not connected',dry_run:'Dry run',succeeded:'Completed',success:'Completed',ok:'Available',enabled:'Connected'}[state] || human(state) || 'Not recorded');
  const chip = (state, label) => `<span class="status-chip ${stateClass(state)}">${escape(label || stateLabel(state))}</span>`;
  const link = (url, title) => safeURL(url) ? `<a href="${escape(safeURL(url))}" target="_blank" rel="noopener noreferrer">${escape(title)} <span aria-hidden="true">↗</span></a>` : '';
  let fetching = false;
  let loaded = false;
  let data;
  let runtimeClock=null,runtimeCheckedAt=0,runtimeFetching=false,runtimeUnavailable=false;
  try{
    const cached=JSON.parse(localStorage.getItem('wys-clock-runtime-v1')||'null');
    runtimeClock=publicClockRuntime(cached?.deployment);
    if(runtimeClock&&Number.isFinite(cached?.checkedAt)&&cached.checkedAt<=Date.now()+60000)runtimeCheckedAt=cached.checkedAt;
  }catch{}
  document.querySelector('.skip-link').setAttribute('href',`${location.pathname}#machine-content`);

  function renderStats(stats) {
    const values = [['Published',number(stats?.published)],['Candidates',number(stats?.candidates)],['Rejected',number(stats?.rejected)],['Feed views',number(stats?.views)],['Saves',number(stats?.saves)],['Model cost',money(stats?.totalCostUsd)]];
    $('machine-stats').innerHTML = values.map(([label,value]) => `<div><span>${label}${value === '—' && ['Feed views','Saves'].includes(label) ? ' · unavailable' : ''}</span><strong>${escape(value)}</strong></div>`).join('');
  }

  function renderStatus() {
    const status = data.status || {};
    const hosted = Boolean(data.schedule?.verifiedHostedRunAt || status.lastHostedRunUrl),proof=data.schedule?.proof;
    $('machine-state').textContent = proof?.state==='publication_observed'?'Automatic publishing verified':proof?.state==='loop_observed'?'Automatic loop observed':proof?.state==='trigger_observed'?'Automatic trigger observed':status.state==='awaiting_first_cloud_run'?(hosted?'Awaiting the first publication':'Awaiting the first cloud run'):'Automatic publishing unverified';
    $('machine-signal').className = `signal-dot${proof?.state==='publication_observed'?' live':''}`;
    $('last-research').textContent = formatDate(status.lastResearchAt);
    $('last-published').textContent = formatDate(status.lastPublishedAt);
    renderTiming();
    $('hosting-note').textContent = proof?.state==='publication_observed'?`${proof.publicationSource==='github-environment-clock'?'Hosted clock':'GitHub cron'} publication verified · GitHub Actions`:hosted?'Hosted runs recorded · automatic publication unverified':'Cloud clock configured · execution unverified';
  }

  function renderTiming() {
    if (!data) return;
    renderClock();
    const latestLoop=data.runs?.filter(run=>run.type==='loop'&&run.modelExecuted!==false).sort((a,b)=>(b.startedAt||'').localeCompare(a.startedAt||''))[0];
    const cadence=loopTiming(data.status?.lastLoopAt||latestLoop?.startedAt);
    $('next-published').textContent=formatDate(cadence.nextPublicationAt);
    const slots=currentDaySlots(data);
    const latest=slots.filter(slot=>validDate(slot.plannedAt)?.getTime()<=Date.now()).at(-1)||slots[0];
    $('loop-slot-state').textContent=latest?`${latest.state==='cap_reached'?'Daily cap reached':latest.state==='scheduled'?'Upcoming':human(latest.state)} · ${shortTime(latest.plannedAt)}${latest.actualAt?` · published ${shortTime(latest.actualAt)}`:''}`:'No slot recorded';
    renderPublicationSlots(slots);
  }

  function renderClock(){
    const clock=newerClockRecord(data.clock||{},runtimeClock),timing=clockTiming(clock);
    const currentRun=link(clock.clockRunUrl,'View current clock run'),tickRun=link(clock.lastTickRunUrl,'View last tick');
    const dispatches=Array.isArray(clock.dispatches)?clock.dispatches:[];
    $('hosted-clock').innerHTML=`<div class="clock-heading">${chip(timing.state,timing.label)}${timing.elapsedMinutes!==null?`<span>Last record ${number(Math.floor(timing.elapsedMinutes))} min ago</span>`:''}</div><dl class="clock-facts"><div><dt>Last tick</dt><dd>${clock.lastTickAt?escape(formatDate(clock.lastTickAt)):'No tick recorded'}</dd></div><div><dt>Next tick, no earlier than</dt><dd>${clock.nextTickAt?escape(formatDate(clock.nextTickAt)):'Not recorded'}${timing.state==='late'&&timing.lateMinutes!==null?` <small>${number(timing.lateMinutes)} min past this estimate</small>`:''}</dd></div></dl>${currentRun||tickRun?`<div class="clock-links">${currentRun}${tickRun}</div>`:''}${dispatches.length?`<p class="clock-dispatches">Last tick dispatched: ${dispatches.map(item=>link(item.githubRunUrl,human(item.workflow?.replace(/\.yml$/,'')||'Workflow'))).filter(Boolean).join(' · ')}</p>`:''}<p class="schedule-footnote">${runtimeUnavailable?'Live clock metadata could not refresh; the last known record remains visible. ':clock.runtimeSource==='github-deployment-metadata'?'Live clock timing comes from GitHub metadata, refreshed every three minutes. ':''}Empty ticks keep no Git commits. The clock waits ${number(clock.waitMinutes||15)} minutes in a GitHub environment without holding a runner, then checks due slots and dispatches its next wait. Queue time can add delay; the next tick is an earliest estimate. A record older than 45 minutes is marked stalled. GitHub cron gates remain a recovery backup.</p>`;
  }

  async function refreshClockRuntime(){
    if(runtimeFetching||Date.now()-runtimeCheckedAt<CLOCK_RUNTIME_REFRESH_MS)return;
    runtimeFetching=true;runtimeCheckedAt=Date.now();
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch(CLOCK_RUNTIME_URL,{signal:controller.signal,cache:'no-store',headers:{Accept:'application/vnd.github+json'}});
      if(!response.ok)throw new Error('Clock metadata unavailable.');
      const raw=await response.text();if(raw.length>262144)throw new Error('Clock metadata too large.');
      const rows=JSON.parse(raw);if(!Array.isArray(rows))throw new Error('Invalid clock metadata.');
      if(rows.length){
        const record=publicClockRuntime(rows[0]);if(!record)throw new Error('Invalid clock metadata.');
        runtimeClock=record;
        try{localStorage.setItem('wys-clock-runtime-v1',JSON.stringify({deployment:rows[0],checkedAt:runtimeCheckedAt}));}catch{}
      }
      runtimeUnavailable=false;
    }catch{runtimeUnavailable=true;}
    finally{clearTimeout(timeout);runtimeFetching=false;if(data)renderClock();}
  }

  function renderPublicationSlots(slots){
    const todayIds=new Set(slots.map(slot=>slot.id));
    const previousById=new Map([...(data.schedule?.previousSlots||[]),...(data.schedule?.slots||[])].filter(slot=>!todayIds.has(slot.id)).map(slot=>[slot.id,slot]));
    const previous=[...previousById.values()].map(slot=>slotPresentation(slot)).sort((a,b)=>new Date(a.plannedAt)-new Date(b.plannedAt));
    if(!slots.length&&!previous.length){$('publication-slots').innerHTML='<p class="muted">No slot receipts are recorded for the current day.</p>';return;}
    const table=rows=>rows.length?`<div class="slot-table-wrap"><table class="slot-table"><caption>${escape(day(rows[0].plannedAt))}</caption><thead><tr><th scope="col">Planned · Vilnius</th><th scope="col">Actual publication / run</th><th scope="col">Publication delay</th><th scope="col">State</th></tr></thead><tbody>${rows.map(slot=>{
      const actual=slot.actualAt?formatDate(slot.actualAt):'Not published';
      const attemptDelay=validDate(slot.attemptedAt)&&validDate(slot.plannedAt)?Math.max(0,Math.floor((validDate(slot.attemptedAt).getTime()-validDate(slot.plannedAt).getTime())/60000)):null;
      const attempt=slot.attemptedAt?`<small>Run started ${escape(formatDate(slot.attemptedAt))}${attemptDelay!==null?` · ${number(attemptDelay)} min late`:''} · ${escape(runTriggerLabel(slot))}</small>`:'';
      const url=link(slot.githubRunUrl,'View run');
      const stateLabel=slot.state==='cap_reached'?'Daily cap reached':slot.state==='scheduled'?'Upcoming':human(slot.state);
      const elapsed=validDate(slot.plannedAt)?Math.max(0,Math.floor((Date.now()-validDate(slot.plannedAt).getTime())/60000)):null;
      const delay=slot.actualAt?`${number(slot.delayMinutes)} min`:['late','missed'].includes(slot.state)&&elapsed!==null?`${number(elapsed)} min overdue`:'—';
      return `<tr><td><time datetime="${escape(slot.plannedAt)}">${escape(formatDate(slot.plannedAt))}</time></td><td>${escape(actual)}${attempt}${url?`<small>${url}</small>`:''}</td><td>${escape(delay)}</td><td>${chip(slot.state,stateLabel)}${slot.reason?`<small>${escape(slot.reason)}</small>`:''}${slot.postId?`<small><a href="p/${escape(encodeURIComponent(slot.postId))}/">Read post ↗</a></small>`:''}</td></tr>`;
    }).join('')}</tbody></table></div>`:'';
    const pastDays=new Map();
    for(const slot of previous){const date=day(slot.plannedAt);if(!pastDays.has(date))pastDays.set(date,[]);pastDays.get(date).push(slot);}
    $('publication-slots').innerHTML=table(slots)+[...pastDays.values()].reverse().map(table).join('')+`<p class="schedule-footnote">Publication times come from committed posts. Run starts and their delays are shown separately. Delayed gates catch up unfinished slots within the same Vilnius day, up to ${escape(data.schedule?.dailyCap||3)} posts. A completed check with no qualifying idea settles its slot without a post. Source failures and incomplete checks stay retryable, with at most three attempts per slot.</p>`;
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
      const event=run.eventName||run.scheduling?.eventName||run.scheduling?.event;
      const provenance=runTriggerLabel(run);
      const commitLink = link(run.commitUrl || run.githubCommitUrl, 'View commit');
      return `<details class="run" data-run-id="${escape(id)}"${open.has(id) || (!loaded && index === 0) ? ' open' : ''}>
        <summary><div class="run-summary-date">${escape(day(run.startedAt))}<strong>${escape(shortTime(run.startedAt))}</strong></div><div class="run-summary-main"><h3>${escape(runTitle(run.type))}</h3><p>${parts.length ? parts.join(' · ') : escape(plain(run.summary) || 'No counts recorded for this run.')}</p></div>${chip(run.status)}<span class="run-chevron" aria-hidden="true">+</span></summary>
        <div class="run-body"><div class="run-facts"><span>${escape(provenance)}</span>${run.scheduling?.localTime?`<span>Slot <strong>${escape(run.scheduling.localTime)} Vilnius</strong>${run.scheduling.catchUp?' · catch-up':''}</span>`:''}${run.finishedAt ? `<span>Finished <strong>${escape(formatDate(run.finishedAt))}</strong></span>` : ''}${presentNumber(run.usage?.costUsd) ? `<span>Model cost <strong>${escape(money(run.usage.costUsd))}</strong></span>` : ''}${run.version ? `<span>Rules <strong>${escape(run.version)}</strong></span>` : ''}${runLink}${commitLink}</div>
        ${run.message || run.error ? `<p class="muted">${escape(plain(run.message || run.error))}</p>` : ''}
        ${steps.length ? `<ol class="run-timeline">${steps.map((step) => `<li class="${stateClass(step.status) === 'bad' ? 'failed' : ''}"><time datetime="${escape(step.at || '')}">${escape(shortTime(step.at))}</time><span class="stage">${escape(human(step.stage || step.name || 'Step'))}</span><span class="stage-message">${escape(plain(step.message || step.summary || step.status))}</span></li>`).join('')}</ol>` : '<p class="muted">No stage messages recorded for this run.</p>'}
        ${rejected.length ? `<div class="run-rejections"><h4>Rejected ideas · ${rejected.length}</h4>${rejected.map((item) => typeof item === 'string' ? `<div class="rejection"><strong>${escape(item)}</strong><p>Reason not recorded.</p></div>` : `<div class="rejection"><strong>${escape(plain(item.title || item.name) || 'Candidate')}</strong><p>${escape(plain(item.reason || item.message) || 'Reason not recorded.')}</p></div>`).join('')}</div>` : ''}
        ${published.length ? `<div class="run-published"><span>Published: </span>${published.map((post) => { const postId = typeof post === 'string' ? post : post.id; const title = typeof post === 'string' ? data.posts?.find((item) => item.id === post)?.title || post : post.title || postId; return `<a href="p/${escape(encodeURIComponent(postId))}/">${escape(title)} <span aria-hidden="true">↗</span></a>`; }).join('')}</div>` : ''}
        </div></details>`;
    }).join('');
  }

  function renderSchedule() {
    const schedule=loopTiming(data.status?.lastLoopAt),proof=data.schedule?.proof;
    const hours=schedule.hourlyActive?'Every hour at :07':schedule.publicationTimes.join(' · ');
    const rows = [];
    if (hours) rows.push(['Research & publish',hours]);
    rows.push(['Hosted clock','15-minute environment waits · checks due slots'],['Backup publishing gate','Every 20 minutes · runs only when due'],['Other backup gates','Every 30 minutes · run only when due']);
    if (schedule.researchEveryHours) rows.push(['Research scan',`${schedule.researchEveryHours===1?'Every hour':`Every ${schedule.researchEveryHours} hours`} at :${schedule.researchMinute}`]);
    rows.push(['Daily publication cap',String(schedule.dailyCap||3)],['Scoring threshold',`${data.scoringPolicy?.threshold??6} / 10`]);
    if(schedule.hourlyActive)rows.push(['Hourly cadence activated',formatDate(schedule.cadence?.activatedAt)]);
    else rows.push(['Hourly cadence','Ready after the best-feed relay switch is confirmed']);
    if (schedule.measurementTime || schedule.measureAt) rows.push(['Measure results',`${schedule.measurementTime || schedule.measureAt} daily`]);
    if (schedule.improvementTime || schedule.improveAt) rows.push(['Improve rules',`${schedule.improvementTime || schedule.improveAt} daily`]);
    if (schedule.nextResearchAt) rows.push(['Next research',formatDate(schedule.nextResearchAt)]);
    rows.push(['Next measurement',formatDate(schedule.nextMeasurementAt)],['Next improvement',formatDate(schedule.nextImprovementAt)]);
    const proofLabel=proof?.state==='publication_observed'?'Automatic publication recorded':proof?.state==='loop_observed'?'Automatic loop recorded; publication unverified':proof?.state==='trigger_observed'?'Automatic trigger observed; publishing unverified':'No automatic event verified';
    rows.push(['Automatic publishing proof',proofLabel]);
    if (Number.isSafeInteger(proof?.scheduledRunCount)) rows.push(['GitHub cron events recorded',number(proof.scheduledRunCount)]);
    if (Number.isSafeInteger(proof?.clockRunCount)) rows.push(['Verified clock gate runs',number(proof.clockRunCount)]);
    if (Number.isSafeInteger(proof?.clockTickCount)) rows.push(['Clock ticks recorded',number(proof.clockTickCount)]);
    if (proof?.checkedAt) rows.push(['Scheduler checked',formatDate(proof.checkedAt)]);
    const proofLink=link(proof?.lastAutomaticPublicationRunUrl||proof?.lastAutomaticLoopRunUrl||proof?.lastAutomaticRunUrl||proof?.lastScheduledPublicationRunUrl||proof?.lastScheduledLoopRunUrl||proof?.lastScheduledRunUrl,'View automatic-run evidence');
    $('schedule').innerHTML = rows.map(([label,value]) => `<div class="schedule-row"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`).join('') + `<p class="schedule-footnote">Europe/Vilnius · planned slots in GitHub Actions. Timers use the current clock. Configuration or a manual hosted run alone does not verify automatic publishing. Clock dispatches retain their real GitHub event.${proofLink?`<br>${proofLink}`:''}</p>`;
  }

  function renderRelay() {
    const relay=data.relay||{},verified=relay.state==='published';
    const curation=data.curation||{},picks=Array.isArray(curation.picks)?curation.picks:[];
    const switched=relay.bestFeedSwitch?.state==='confirmed'&&validDate(relay.bestFeedSwitch.confirmedAt)&&relay.feedUrl?.endsWith('/best.xml');
    const last=curation.lastDecision;
    const selectionTimes=Array.isArray(curation.selectionTimes)?curation.selectionTimes.map(plain).join(' · '):'Not recorded';
    const times=new Set((curation.selectionTimes||[]).filter(value=>/^\d{2}:\d{2}$/.test(value)));
    const nextSelectionAt=curation.enabled&&times.size?nextLocalTime(part=>times.has(`${String(part.hour).padStart(2,'0')}:${String(part.minute).padStart(2,'0')}`)):null;
    const dueAt=validDate(curation.nextSelectionAt),dueMinutes=dueAt?Math.floor((Date.now()-dueAt.getTime())/60000):null;
    const dueNote=curation.enabled&&dueMinutes!==null&&dueMinutes>=0?`<p class="muted">The ${escape(formatDate(curation.nextSelectionAt))} selection is ${dueMinutes>=30?'late':'due'}; no decision is recorded yet.</p>`:'';
    const pickList=picks.length?`<ol class="relay-picks">${picks.slice(0,10).map(pick=>`<li>${link(pick.publicUrl,pick.title)}<span>Score ${typeof pick.scoring?.overall==='number'?escape(pick.scoring.overall.toFixed(1)):'unavailable'} / 10 · picked ${escape(formatDate(pick.pickedAt))}</span></li>`).join('')}</ol>`:'<p class="muted">No LinkedIn pick yet. Posts published before activation stay out of this feed.</p>';
    $('relay').innerHTML=`<p class="relay-path">Website -&gt; RSS -&gt; Zapier -&gt; LinkedIn Page</p><p class="relay-state">${escape(verified?relay.message||'LinkedIn publication recorded':'waiting for first LinkedIn post')}</p><p class="muted">${verified?`First publication ${escape(formatDate(relay.firstPublishedAt))}, confirmed by Danielius via Claude. LinkedIn metrics are not connected.`:'The website and RSS are the relay source. LinkedIn publishing is verified only after a post receipt is recorded.'}</p><div class="relay-links">${link(relay.feedUrl||'feed.xml','Current relay feed')}${link(relay.linkedinUrl||'https://www.linkedin.com/company/whileyousleep-ai/','Follow on LinkedIn')}${verified&&relay.postUrl?link(relay.postUrl,'View LinkedIn post'):''}</div><section class="relay-selection" aria-labelledby="selection-heading"><h3 id="selection-heading">The LinkedIn picks</h3><p>The highest checked score from the last 12 hours, at least ${escape(curation.minimumScore??7)} / 10. Up to ${escape(curation.dailyCap??2)} picks a day; each idea is picked once.</p><dl class="clock-facts"><div><dt>Selection times · Vilnius</dt><dd>${escape(selectionTimes)}</dd></div><div><dt>Next planned selection</dt><dd>${nextSelectionAt?escape(formatDate(nextSelectionAt)):'Not activated'}</dd></div><div><dt>Last selection</dt><dd>${last?`${escape(formatDate(last.selectedAt))} · ${escape(human(last.status))}${last.reason?`<small>${escape(last.reason)}</small>`:''}`:'No selection recorded'}</dd></div></dl>${dueNote}${pickList}${relay.bestFeedSwitch?.latestCorrection?'<p class="muted">Earlier report corrected: the Zap still read feed.xml when hourly mode started. No hourly website post was published during the mismatch; Claude reported no hourly LinkedIn post.</p>':''}<p class="relay-switch">${switched?`Zapier feed switch confirmed ${escape(formatDate(relay.bestFeedSwitch.confirmedAt))}.`:'The best feed is ready for Claude. The Zapier switch is awaiting confirmation; the recorded relay still uses the current feed.'}</p><div class="relay-links">${link(relay.recommendedFeedUrl||'best.xml','Open best feed')}</div></section>`;
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
    const registry=data.sources;
    if(registry?.enabled===true&&registry.schema===1&&Array.isArray(registry.sources)){
      const sourceNumber=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?new Intl.NumberFormat('en-GB',{maximumFractionDigits:1}).format(value):'Unavailable';
      const metric=(label,value)=>`<div><dt>${escape(label)}</dt><dd${sourceNumber(value)==='Unavailable'?' class="source-stat-unavailable"':''}>${escape(sourceNumber(value))}</dd></div>`;
      const publicSourceLink=(url,title)=>{
        try{const parsed=new URL(url);if(parsed.protocol==='https:'&&!parsed.username&&!parsed.password)return link(parsed.href,title);}catch{}
        return `<span>${escape(title)}</span>`;
      };
      const unknown=registry.unknownAttribution||{},changes=Array.isArray(registry.recentChanges)?registry.recentChanges:[],exclusions=Array.isArray(registry.exclusions)?registry.exclusions:[];
      const considerationGaps=Object.hasOwn(unknown,'unmappedConsiderations')?metric('Unmapped considered ideas',unknown.unmappedConsiderations)+metric('Invalid considered entries',unknown.invalidConsiderations)+metric('Entries beyond the counting limit',unknown.omittedConsiderations):'';
      $('sources-heading').textContent='Source leaderboard';
      $('source-health').innerHTML=`<div class="source-registry-summary"><p>Measured yield since ${escape(formatDate(registry.coverageStartedAt))}. New measured zeroes are separate from unknown historical attribution.</p><p>Candidates are distinct considered or proposed ideas matched to frozen source items. Checked counts and scores require independent evidence.</p><dl class="source-registry-history">${metric('Legacy scans',unknown.legacyScans)}${metric('Legacy model runs',unknown.legacyRuns)}${metric('Legacy posts',unknown.legacyPosts)}${metric('Legacy LinkedIn picks',unknown.legacyPicks)}${metric('Unmapped candidates',unknown.unmappedCandidates)}${considerationGaps}</dl><div class="relay-links">${link('method/#method-sources','Source method and policy')}${link('api/sources.json','Public registry JSON')}${link('https://github.com/xndanius/while-you-sleep/blob/main/data/sources/registry.json','Registry in GitHub')}</div></div>
      ${registry.sources.length?registry.sources.map(source=>{
        const yieldRecord=source.yield||{},health=source.health||source.latestObservation||{},rank=source.rank||{};
        const rankValue=typeof rank.value==='number'&&Number.isFinite(rank.value)&&rank.value>=0?new Intl.NumberFormat('en-GB',{maximumFractionDigits:3}).format(rank.value):null;
        return `<article class="health-card source-registry-card"><div class="health-header"><h3>${publicSourceLink(source.url,plain(source.name)||source.id||'Source')}</h3>${chip(source.status,source.status==='probation'?'Probation':source.status==='retired'?'Retired':stateLabel(source.status))}</div><p class="source-registry-status">${escape(source.statusReason||'Status reason unavailable')}</p><dl class="source-registry-stats">${metric('Items fetched',yieldRecord.itemsFetched)}${metric('Candidates',yieldRecord.candidates)}${metric('Passed checks',yieldRecord.passedChecks)}${metric('Average supported checked score',yieldRecord.averageScore)}${metric('Published',yieldRecord.published)}${metric('LinkedIn picks',yieldRecord.linkedInPicks)}</dl>${source.historicalAttribution==='unknown'?'<p>Historical attribution unknown. These totals start with the registry.</p>':''}${rankValue!==null?`<p>${Number.isInteger(rank.position)&&rank.position>0?`Position ${escape(rank.position)} · `:''}Yield metric ${escape(rankValue)}${rank.exploration===true?' · reserved exploration slot for the next scan':''}.</p>`:''}<details class="source-registry-details"><summary>Source record</summary><p>${source.howAdded?'Added through '+escape(source.howAdded)+'. ':''}${source.addedAt?'Added '+escape(formatDate(source.addedAt))+'.':''}</p><dl class="source-registry-stats">${metric('Scans',yieldRecord.scans)}${metric('Successful scans',yieldRecord.successfulScans)}${metric('Checked candidates',yieldRecord.checkedCandidates)}${metric('Verified score samples',yieldRecord.scoreSamples)}</dl>${rank.basis?`<p>${escape(rank.basis)}</p>`:''}<p>Latest recorded scan: ${escape(formatDate(health.fetchedAt||source.lastScannedAt))}${health.status?' · '+escape(stateLabel(health.status)):''}. ${escape(health.message||'No fetch result is recorded yet.')}</p></details></article>`;
      }).join(''):'<p class="muted">No admitted sources are recorded.</p>'}
      <section class="source-registry-changes"><h3>Recent source changes</h3>${changes.length?`<ul>${changes.slice(0,4).map(change=>`<li><strong>${escape(change.name||change.sourceId||'Source')}</strong><span>${escape(change.fromStatus||'New')} → ${escape(change.toStatus||'Status unavailable')} · ${escape(formatDate(change.createdAt))}</span><p>${escape(change.reason||'Reason unavailable')}</p>${change.runUrl?publicSourceLink(change.runUrl,'Cloud run'):''}</li>`).join('')}</ul>`:'<p class="muted">No registry transitions are recorded yet.</p>'}</section>
      <section class="source-registry-exclusions"><h3>Excluded or not admitted</h3>${exclusions.length?`<ul>${exclusions.map(exclusion=>`<li><strong>${publicSourceLink(exclusion.url,plain(exclusion.name)||exclusion.sourceId||'Source')}</strong><p>${escape(exclusion.reason||'Admission reason unavailable')}</p><span>Checked ${escape(formatDate(exclusion.checkedAt))}${exclusion.robotsState?' · robots '+escape(exclusion.robotsState):''}</span>${exclusion.runUrl?publicSourceLink(exclusion.runUrl,'Hosted admission check'):''}</li>`).join('')}</ul>`:'<p class="muted">No admission exclusions are recorded.</p>'}</section>`;
      return;
    }
    $('sources-heading').textContent='Source health';
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
      void refreshClockRuntime();
      renderStatus();
      renderStats(data.stats);
      renderRuns();
      renderSchedule();
      renderRelay();
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
        $('hosted-clock').innerHTML = '<p class="muted">The clock record is unavailable while the connection is interrupted.</p>';
        $('relay').innerHTML = '<p class="muted">Relay status is unavailable while the record cannot be reached.</p>';
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
  document.addEventListener('visibilitychange',() => { if (!document.hidden) { renderTiming(); if (data) renderSchedule(); refresh(); } });
  setInterval(() => { renderTiming(); if (data) renderSchedule(); if (!document.hidden) refresh(); },60000);
  refresh();
})();
