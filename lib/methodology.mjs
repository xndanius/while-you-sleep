const CRITERIA = [
  ['ease','Ease to start','How readily a beginner can start a small version with accessible tools.'],
  ['profit','Profit potential','A buyer and business hypothesis, supported by evidence of a problem. It never promises earnings.'],
  ['feasibility','Feasibility','Whether a student could build a useful small version in two weeks, with obstacles stated.'],
  ['autonomy','Autonomy','How much of the specific repeatable loop runs by itself, and where humans still need to act.'],
  ['evidence','Evidence','What a working product, demonstration or attributed maker claim actually establishes.'],
];
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const display = value => number(value) === null ? 'Unavailable' : new Intl.NumberFormat('en',{maximumFractionDigits:1}).format(value);
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
function date(value) {
  return validDate(value) ? new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Vilnius',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value))+' Vilnius' : 'Time unavailable';
}
function publicURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function link(url,label,className='') {
  const safe = publicURL(url);
  return safe ? `<a${className ? ` class="${escape(className)}"` : ''} href="${escape(safe)}">${escape(label)}</a>` : `<span${className ? ` class="${escape(className)}"` : ''}>${escape(label)}</span>`;
}
const stat = (label,value) => `<div><dt>${escape(label)}</dt><dd${number(value) === null ? ' class="method-stat-unavailable"' : ''}>${escape(display(value))}</dd></div>`;
const heading = (id,eyebrow,title) => `<div class="method-section-heading"><div class="eyebrow">${escape(eyebrow)}</div><h2 id="${id}">${escape(title)}</h2></div>`;
function policySection(policy) {
  const weights = policy?.weights || {}, values = CRITERIA.map(([key])=>number(weights[key]));
  const validWeights = values.every(value=>value !== null && value > 0), total = validWeights ? values.reduce((sum,value)=>sum+value,0) : null;
  const threshold = number(policy?.threshold);
  return `<section class="method-section" aria-labelledby="method-scoring">${heading('method-scoring','Five questions, one score','What the score means')}
    <p>Every criterion is scored from 1 to 10, with a short reason tied to source evidence. A separate checker must support each score. Limited evidence calls for a modest rating.</p>
    <div class="method-policy"><p>Current publication threshold <strong>${threshold === null ? 'Unavailable' : escape(display(threshold))+'/10'}</strong></p><p>The overall score is the weighted mean: multiply each score by its weight, add the results, then divide by the total weight. The unrounded result decides eligibility; the website rounds only for display.</p></div>
    <div class="method-table-wrap"><table class="method-criteria-table"><caption>Current weights from RULES.md</caption><thead><tr><th scope="col">Criterion</th><th scope="col">What it asks</th><th scope="col">Weight</th></tr></thead><tbody>${CRITERIA.map(([key,title,description],index)=>`<tr><th scope="row">${title}</th><td>${description}</td><td><strong>${validWeights ? escape(display(values[index])) : 'Unavailable'}</strong>${validWeights ? `<small>${escape(display(values[index]/total*100))}% of the total</small>` : ''}</td></tr>`).join('')}</tbody></table></div>
    <p class="method-note">Current weights also make older checked ideas comparable in the website list. Publication decisions keep the policy used at the time; a LinkedIn pick keeps its selected score. A high score is an assessment, not proof of demand or future profit.</p>
  </section>`;
}
function cadenceSection(schedule={},clock={}) {
  const times = Array.isArray(schedule.publicationTimes) ? schedule.publicationTimes.filter(time=>/^\d{2}:\d{2}$/.test(time)) : [];
  const minute = Number.isInteger(schedule.publicationMinute) && schedule.publicationMinute >= 0 && schedule.publicationMinute < 60 ? String(schedule.publicationMinute).padStart(2,'0') : null;
  const hourly = schedule.cadenceMode === 'hourly' || schedule.hourlyActive === true;
  const rhythm = hourly && minute !== null ? `One publication slot every hour at :${minute}` : times.length ? `Publication slots at ${times.join(', ')}` : 'Publication times unavailable';
  const research = number(schedule.researchEveryHours), researchMinute = Number.isInteger(schedule.researchMinute) ? String(schedule.researchMinute).padStart(2,'0') : null;
  const researchText = research === 1 ? 'Fresh research is planned every hour' : research > 0 ? `Fresh research is planned every ${research} hours` : 'Research cadence unavailable';
  const wait = number(clock.waitMinutes);
  return `<section class="method-section" aria-labelledby="method-publishing">${heading('method-publishing','The rhythm','A slot is a chance to publish')}
    <div class="method-facts"><div><span>Website publication</span><strong>${escape(rhythm)}</strong><small>Europe/Vilnius · daily cap ${escape(display(schedule.dailyCap))}</small></div><div><span>Public research</span><strong>${escape(researchText)}</strong>${researchMinute ? `<small>At :${escape(researchMinute)} · Europe/Vilnius</small>` : ''}</div></div>
    <p>The hosted GitHub clock runs cheap gates${wait > 0 ? ` after a ${escape(display(wait))}-minute wait` : ''}. A gate calls the model only when work is due. GitHub cron is a backup. Planned times are targets: queueing and checks can delay a run, and the machine page shows the actual times.</p>
    <p>Missed slots of the current Vilnius day can catch up within the cap, without publishing an idea or a slot twice. A complete check with no eligible idea records an honest no-post result. A retrieval or checking failure stays a failure; it is never presented as a publication.</p>
  </section>`;
}
function curationSection(curation={},relay={},picks=[],baseURL) {
  const times = Array.isArray(curation.selectionTimes) ? curation.selectionTimes.filter(time=>/^\d{2}:\d{2}$/.test(time)) : [];
  const switched = relay.feedPath === 'best.xml' && relay.bestFeedSwitch?.state === 'confirmed' && validDate(relay.bestFeedSwitch.confirmedAt);
  const feedURL = switched ? baseURL+'/best.xml' : baseURL+'/feed.xml';
  const selection = times.length ? 'At '+times.join(' and ')+' Vilnius' : 'At the configured selection times';
  const sorted = picks.slice().sort((a,b)=>(b.pickedAt||'').localeCompare(a.pickedAt||''));
  const decision = curation.lastDecision;
  const decisions = {highest_eligible_checked_score:'The highest eligible independently checked score was selected.',no_eligible_checked_post:'No eligible checked post met the selection rules.',daily_curation_cap_reached:'The daily LinkedIn selection cap had been reached.'};
  return `<section class="method-section" aria-labelledby="method-linkedin">${heading('method-linkedin','A smaller selection','What goes to LinkedIn, and why')}
    ${curation.enabled === false ? '<p class="method-note">LinkedIn selection is not enabled yet. The following is its recorded policy.</p>' : ''}
    <p>${escape(selection)}, the deterministic selector considers ideas published in the preceding twelve hours. It picks the highest independently checked weighted score of at least <strong>${escape(display(curation.minimumScore))}/10</strong>, with a maximum of <strong>${escape(display(curation.dailyCap))} picks per Vilnius day</strong>.</p>
    <p>A post is picked once, and only if it was published after the selection feed was activated. There is no backfill. If nothing qualifies, the empty decision is recorded. The pick keeps its original post link, publication time, card and frozen selected scores.</p>
    <div class="method-relay"><p class="relay-path">Website → RSS → Zapier → LinkedIn Page</p><p>${switched ? `The switch to ${link(feedURL,'best.xml')} is confirmed. Hourly website posts are separate from the selected LinkedIn feed.` : `The confirmed switch to best.xml has not been recorded. The relay feed remains ${link(feedURL,'feed.xml')}.`}</p><p>${relay.state === 'published' && validDate(relay.firstPublishedAt) ? 'The first LinkedIn publication was confirmed at '+escape(date(relay.firstPublishedAt))+'.' : 'Waiting for a confirmed LinkedIn publication.'} Selection and relay submission do not by themselves prove that a LinkedIn post appeared.</p>${decision ? `<p class="method-note">Latest selection: ${escape(decisions[decision.reason] || decision.reason || 'Decision reason unavailable')} ${validDate(decision.selectedAt) ? escape(date(decision.selectedAt))+'.' : ''}</p>` : ''}</div>
    ${sorted.length ? `<ul class="method-picks">${sorted.slice(0,5).map(pick=>`<li>${link(pick.publicUrl,pick.title || pick.postId)}<span>Selected ${escape(date(pick.pickedAt))} · frozen score ${escape(display(pick.scoring?.overall))}/10</span></li>`).join('')}</ul>` : '<p class="method-note">No durable LinkedIn picks are recorded yet.</p>'}
    <div class="method-links">${link(baseURL+'/best.xml','Selected ideas RSS')}${link(baseURL+'/feed.xml','All ideas RSS')}${link(relay.linkedinUrl,'Follow on LinkedIn')}</div>
  </section>`;
}
function sourceRow(source) {
  const stats = source.stats || {}, health = source.health || {}, hasYield = ['itemsFetched','candidates','passedChecks','averageScore','published','linkedInPicks'].some(key=>number(stats[key]) !== null);
  const statuses = {active:'Active',probation:'Probation',retired:'Retired',configured:'Configured'};
  const status = statuses[source.status] || 'Status unavailable';
  const healthStatus = {ok:'Available',failed:'Fetch failed',unavailable:'Unavailable'}[health.status] || 'Unavailable';
  return `<li class="method-source"><div class="method-source-heading"><h3>${link(source.url,source.name || source.id || 'Unnamed source')}</h3><span class="method-source-status">${status}</span></div>
    <p class="method-source-health">Latest reported availability: ${healthStatus}${validDate(source.lastFetchAt) ? ' · '+escape(date(source.lastFetchAt)) : ''}</p>
    ${hasYield ? `<dl class="method-source-stats">${stat('Items fetched',stats.itemsFetched)}${stat('Candidates',stats.candidates)}${stat('Passed checks',stats.passedChecks)}${stat('Average checked score',stats.averageScore)}${stat('Published',stats.published)}${stat('LinkedIn picks',stats.linkedInPicks)}</dl>` : '<p class="method-yield-unavailable">Yield unavailable · no trustworthy attribution totals recorded</p>'}
    ${number(source.ranking?.value) !== null ? `<p class="method-note">Yield rank value ${escape(display(source.ranking.value))}${source.ranking.basis ? ' · '+escape(source.ranking.basis) : ''}${source.ranking.exploration === true ? ' · exploration sample' : ''}.</p>` : ''}
    <details class="method-source-details"><summary>Source record</summary>${source.reason ? `<p>${escape(source.reason)}</p>` : ''}${health.message ? `<p>${escape(health.message)}</p>` : ''}<dl>${stat('Fetch attempts',stats.fetchAttempts)}${stat('Successful fetches',stats.successfulFetches)}${stat('Distinct items',stats.distinctItems)}${stat('Independently checked candidates',stats.checkedCandidates)}</dl>${source.validation?.robotsState ? `<p>Recorded robots decision: ${escape(source.validation.robotsState)}${validDate(source.validation.checkedAt) ? ' · '+escape(date(source.validation.checkedAt)) : ''}.</p>` : ''}${validDate(source.addedAt) ? `<p>Added ${escape(date(source.addedAt))}${source.kind ? ' · '+escape(source.kind) : ''}.</p>` : ''}</details>
  </li>`;
}
function sourceSection(sources={}) {
  const rows = Array.isArray(sources.rows) ? sources.rows : [], changes = Array.isArray(sources.changes) ? sources.changes : [], enabled = sources.enabled === true;
  const policy = sources.policy || {};
  return `<section class="method-section" aria-labelledby="method-sources">${heading('method-sources','The input','Where the ideas come from')}
    <p>${enabled ? 'The live registry records which sources are active, on probation or retired. Yield rankings use measured, independently checked outcomes; exploration gives newer sources a chance.' : 'Source evolution is not enabled yet. These are the configured public inputs and their latest reported availability. A trusted source leaderboard is unavailable until registry yield accounting begins.'}</p>
    <p class="method-note">${escape(sources.coverage?.reason || 'Missing measurements are unavailable, never zero.')} ${number(sources.coverage?.trustedFetchSnapshots) !== null ? escape(display(sources.coverage.trustedFetchSnapshots))+' standalone research snapshots are available; this is not a source-yield total.' : ''}</p>
    ${enabled && (number(policy.liveCap) !== null || number(policy.dailyNewLimit) !== null) ? `<p>Recorded source policy: ${number(policy.liveCap) !== null ? 'at most '+escape(display(policy.liveCap))+' active and probation sources' : 'live source limit unavailable'}${number(policy.dailyNewLimit) !== null ? '; up to '+escape(display(policy.dailyNewLimit))+' new candidate sources per day' : ''}. New entries need a hosted public-HTTPS, robots and readable-format check before probation. Changes record their reason; enough measured samples are needed before a yield-based promotion or retirement.</p>` : ''}
    ${rows.length ? `<ol class="method-source-list" aria-label="${enabled ? 'Live source leaderboard' : 'Configured sources; yield ranking unavailable'}">${rows.map(sourceRow).join('')}</ol>` : '<p class="method-note">No source rows are recorded.</p>'}
    <h3 class="method-subheading">Recent source changes</h3>${changes.length ? `<ul class="method-change-list">${changes.slice(0,6).map(change=>`<li><div><strong>${escape(change.name || change.sourceId || 'Source change')}</strong><span>${escape(change.from || 'New')} → ${escape(change.to || 'Status unavailable')} · ${escape(date(change.at))}</span></div><p>${escape(change.reason || 'Reason unavailable')}</p><div class="method-links">${change.runUrl ? link(change.runUrl,'Cloud run') : ''}${change.commitUrl ? link(change.commitUrl,'Change commit') : ''}</div></li>`).join('')}</ul>` : `<p class="method-note">${enabled ? 'No source transitions are recorded yet.' : 'No automatic source promotions, retirements or admissions are running yet.'}</p>`}
    <p class="method-note">X is excluded: its API requires authenticated access and usage credits. ${link('https://docs.x.com/fundamentals/authentication/oauth-2-0/application-only','X authentication')}, ${link('https://docs.x.com/x-api/getting-started/pricing','X API pricing')}. A blocked source is recorded, never replaced with an invented result.</p>
  </section>`;
}
function improvementSection(versions=[],schedule={}) {
  const rows = Array.isArray(versions) ? versions : [], automatic = rows.filter(version=>/^improve-/.test(version.id || '') || version.evaluations), accepted = automatic.filter(version=>['adopted','accepted'].includes(version.status));
  const sorted = rows.slice().sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  const time = /^\d{2}:\d{2}$/.test(schedule.improvementTime || '') ? schedule.improvementTime+' Vilnius' : 'the configured daily time';
  return `<section class="method-section" aria-labelledby="method-improvement">${heading('method-improvement','Test before changing','How the rules improve')}
    <p>At ${escape(time)}, the improver can propose one writing or picking rule change, or a bounded change to the five scoring weights and threshold. A fresh grader compares current and proposed rules on unpublished held-out candidates, without knowing which version is which.</p>
    <p>A proposal is adopted only if it scores higher without factual, safety or score-calibration regressions. Checking, exclusions, secret isolation, duplicate protection and the publication cap stay protected. Rejected proposals remain in the public record; RULES.md changes only on acceptance.</p>
    <p class="method-note">${accepted.length ? escape(accepted.length)+' accepted automatic rule '+(accepted.length === 1 ? 'change is' : 'changes are')+' recorded.' : 'No accepted automatic rule change is recorded yet.'} Source evolution is described separately above, according to its current registry state.</p>
    ${sorted.length ? `<ul class="method-change-list">${sorted.slice(0,5).map(version=>`<li><div><strong>${escape(version.change || 'Rule proposal')}</strong><span>${escape({adopted:'Adopted',accepted:'Accepted',rejected:'Rejected'}[version.status] || 'Outcome unavailable')} · ${escape(date(version.createdAt))}</span></div><p>${escape((Array.isArray(version.reasons) && version.reasons.length ? version.reasons.join(' ') : version.reason) || 'Reason unavailable')}</p>${number(version.baselineScore) !== null || number(version.challengerScore) !== null ? `<p class="method-note">Held-out trial: current ${escape(display(version.baselineScore))}; proposed ${escape(display(version.challengerScore))}.</p>` : ''}<div class="method-links">${version.githubRunUrl ? link(version.githubRunUrl,'Independent trial run') : ''}</div></li>`).join('')}</ul>` : '<p class="method-note">No rule proposals are recorded.</p>'}
  </section>`;
}

/** Render only normalized trusted build inputs; never fetch, read files or invent counters. */
export function renderMethodology({baseURL,styleVersion,generatedAt,policy,schedule,clock,curation,relay,sources,versions,picks=[]}={}) {
  const base = publicURL(baseURL)?.replace(/\/$/,'');
  if(!base)throw new Error('Methodology requires a public HTTPS base URL without credentials.');
  const style = styleVersion && /^[a-f0-9]{12}$/.test(styleVersion) ? '?v='+styleVersion : '';
  const methodURL = base+'/method/';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#151915"><meta name="description" content="How While You Sleep researches, scores, checks and publishes ideas, with current rules, source records and LinkedIn selection policy."><title>The method — While You Sleep</title><link rel="canonical" href="${escape(methodURL)}"><link rel="stylesheet" href="${escape(base+'/styles.css'+style)}"><link rel="alternate" type="application/rss+xml" title="All ideas RSS" href="${escape(base+'/feed.xml')}"></head>
<body class="method-page"><a class="skip-link" href="#method-content">Skip to the methodology</a><div class="site-shell">
<header class="site-header"><a class="brand" href="${escape(base+'/')}"><span class="brand-mark" aria-hidden="true">◔</span><span>While You Sleep</span></a><nav class="main-nav" aria-label="Main navigation"><a href="${escape(base+'/')}">The feed</a><a href="${escape(base+'/machine/')}">The machine</a><a href="${escape(methodURL)}" aria-current="page">The method</a></nav></header>
<main id="method-content"><section class="method-hero" aria-labelledby="method-title"><div class="eyebrow"><span class="tiny-orbit" aria-hidden="true"></span> The rules behind the feed</div><h1 id="method-title">Ideas with<br><span>a visible method.</span></h1><p class="hero-intro">Real examples become small experiments you could try. Every idea needs sources, a clear operational loop and a separate check before it earns a place in the feed.</p><p class="method-generated">Generated from the current repository records · ${escape(date(generatedAt))}</p><nav class="method-jump-links" aria-label="Methodology sections"><a href="#method-scoring">Scores</a><a href="#method-process">Checks</a><a href="#method-publishing">Publishing</a><a href="#method-linkedin">LinkedIn</a><a href="#method-sources">Sources</a><a href="#method-improvement">Changes</a></nav></section>
${policySection(policy)}
<section class="method-section" aria-labelledby="method-process">${heading('method-process','From example to experiment','How an idea earns its place')}<ol class="method-process"><li><span>01</span><div><h3>Research public evidence</h3><p>Read public feeds and product pages as evidence. Keep source links and report unavailable sources. A listing is a lead; it does not establish users, revenue or a working business.</p></div></li><li><span>02</span><div><h3>Pick a concrete loop</h3><p>Compare ideas with published and rejected candidates to avoid repeats. Assess all five criteria, and explain the real input, repeated actions, output and human limits of the proposed small version.</p></div></li><li><span>03</span><div><h3>Write for a beginner</h3><p>Explain what it is, who might pay, the loop, source evidence and uncertainty. Give three first-day steps. Separate the real example from a proposed experiment, and label the buyer as a hypothesis.</p></div></li><li><span>04</span><div><h3>Check independently</h3><p>A fresh checker uses newly fetched source text. At least three factual claims and all five score ceilings need exact supporting quotes. The check binds the draft, evidence and policy; a deterministic gate repeats integrity, availability, score and duplicate checks.</p></div></li><li><span>05</span><div><h3>Publish, repair or reject</h3><p>Only an independently approved idea at or above the threshold is published. A rejected draft can be repaired once and checked afresh; otherwise its rejection and reason stay in the record.</p></div></li><li><span>06</span><div><h3>Measure and test changes</h3><p>Measure results where a connected counter supplies them. Missing views, saves or LinkedIn metrics remain unavailable. Test a proposed rule change before adopting it.</p></div></li></ol></section>
${cadenceSection(schedule,clock)}${curationSection(curation,relay,picks,base)}${sourceSection(sources)}${improvementSection(versions,schedule)}
<section class="method-section" aria-labelledby="method-boundaries">${heading('method-boundaries','Protected throughout the loop','What the system never does')}<ul class="method-boundaries"><li>Invent numbers, users, revenue, demand or guaranteed earnings.</li><li>Use paid APIs or login-only source material.</li><li>Treat web text as instructions or execute source-supplied code.</li><li>Publish gambling, adult content, scams, illegal activity or spam tactics.</li><li>Expose credentials in posts, records or public Git history.</li><li>Call a relay submission a confirmed LinkedIn publication.</li></ul><div class="method-links">${link('https://github.com/xndanius/while-you-sleep/blob/main/RULES.md','Read the current RULES.md')}${link('https://github.com/xndanius/while-you-sleep/commits/main','Follow the public commit history')}</div></section>
</main><footer class="site-footer"><a class="brand" href="${escape(base+'/')}"><span class="brand-mark" aria-hidden="true">◔</span><span>While You Sleep</span></a><p>All times in Europe/Vilnius.</p><a href="${escape(base+'/machine/')}">Sources, checks and run history <span aria-hidden="true">↗</span></a></footer></div></body></html>\n`;
}
