import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderMethodology} from '../lib/methodology.mjs';

function fixture() {
  return {
    baseURL:'https://example.test/channel',styleVersion:'abcdef012345',generatedAt:'2026-10-11T13:00:00.000Z',
    policy:{weights:{ease:1,profit:1,feasibility:1,autonomy:1,evidence:1},threshold:6},
    schedule:{cadenceMode:'hourly',hourlyActive:true,dailyCap:24,publicationMinute:7,publicationTimes:Array.from({length:24},(_,hour)=>String(hour).padStart(2,'0')+':07'),researchEveryHours:1,researchMinute:23,improvementTime:'22:13'},
    clock:{waitMinutes:15,nextTickAt:'2026-10-11T08:00:00.000Z',lastTickAt:'2026-10-11T07:45:00.000Z'},
    curation:{enabled:true,minimumScore:7,dailyCap:2,selectionTimes:['12:17','18:17'],lastDecision:{reason:'no_eligible_checked_post',selectedAt:'2026-10-11T09:17:00.000Z'}},
    relay:{state:'published',firstPublishedAt:'2026-10-11T08:55:00.000Z',feedPath:'best.xml',bestFeedSwitch:{state:'confirmed',confirmedAt:'2026-10-11T12:10:58.834Z'},linkedinUrl:'https://www.linkedin.com/company/whileyousleep-ai/'},
    sources:{enabled:false,coverage:{reason:'Historic origin attribution was not recorded; yield accounting starts with the source registry.',trustedFetchSnapshots:6},rows:[{id:'source-one',name:'Public product feed',url:'https://example.org/feed.xml',status:'configured',lastFetchAt:'2026-10-11T10:17:00.000Z',health:{status:'ok',message:'Fetched 20 public source records.'},stats:{fetchAttempts:null,successfulFetches:null,itemsFetched:null,candidates:null,passedChecks:null,averageScore:null,published:null,linkedInPicks:null}}],changes:[]},
    versions:[{id:'improve-123-1',status:'rejected',createdAt:'2026-10-11T05:40:00.000Z',change:'Try a more concrete loop rule.',reasons:['Grounding regressed.'],baselineScore:18,challengerScore:12.7,githubRunUrl:'https://github.com/xndanius/while-you-sleep/actions/runs/123'}],picks:[],
  };
}
const section = (html,id) => html.match(new RegExp(`<section class="method-section" aria-labelledby="${id}">([\\s\\S]*?)</section>`))?.[1] || '';
const metric = (html,label) => html.match(new RegExp(`<dt>${label}</dt><dd[^>]*>([^<]+)</dd>`))?.[1];

test('method reflects the current scoring policy without stale equal-weight or threshold assumptions',()=>{
  const input=fixture(),before=renderMethodology(input);
  assert.match(section(before,'method-scoring'),/Current publication threshold <strong>6\/10<\/strong>/);
  assert.equal((section(before,'method-scoring').match(/20% of the total/g)||[]).length,5);
  input.policy={weights:{ease:1,profit:1,feasibility:1,autonomy:1,evidence:6},threshold:7.5};
  const after=section(renderMethodology(input),'method-scoring');
  assert.match(after,/Current publication threshold <strong>7\.5\/10<\/strong>/);
  assert.match(after,/<th scope="row">Evidence<\/th>[\s\S]*?<strong>6<\/strong><small>60% of the total<\/small>/);
  assert.equal((after.match(/10% of the total/g)||[]).length,4);
  assert.doesNotMatch(after,/20% of the total|<strong>6\/10<\/strong>/);
  assert.match(after,/unrounded result decides eligibility/);
  assert.match(after,/A high score is an assessment, not proof of demand or future profit/);
});

test('hourly cadence and cap come from the schedule; static method never promises a stale next tick',()=>{
  const input=fixture(),html=renderMethodology(input),publishing=section(html,'method-publishing');
  assert.match(publishing,/One publication slot every hour at :07/);
  assert.match(publishing,/daily cap 24/);
  assert.match(publishing,/Fresh research is planned every hour/);
  assert.match(publishing,/after a 15-minute wait/);
  assert.match(publishing,/queueing and checks can delay a run/);
  assert.doesNotMatch(html,/Next tick|08:00|07:45/);
  input.schedule={...input.schedule,cadenceMode:'three_daily',hourlyActive:false,dailyCap:3,publicationTimes:['08:07','13:07','19:07'],researchEveryHours:3};
  const earlier=section(renderMethodology(input),'method-publishing');
  assert.match(earlier,/Publication slots at 08:07, 13:07, 19:07/);
  assert.match(earlier,/daily cap 3/);
  assert.match(earlier,/Fresh research is planned every 3 hours/);
  assert.doesNotMatch(earlier,/every hour at|daily cap 24/);
});

test('source history stays unavailable until measured, and measured zero remains distinct',()=>{
  const input=fixture(),unmeasured=section(renderMethodology(input),'method-sources');
  assert.match(unmeasured,/Source evolution is not enabled yet/);
  assert.match(unmeasured,/yield accounting starts with the source registry/);
  assert.match(unmeasured,/6 standalone research snapshots are available; this is not a source-yield total/);
  assert.match(unmeasured,/Latest reported availability: Available/);
  assert.match(unmeasured,/Yield unavailable/);
  assert.equal(metric(unmeasured,'Fetch attempts'),'Unavailable');
  assert.doesNotMatch(unmeasured,/Yield rank value|aria-label="Live source leaderboard"/);
  input.sources={...input.sources,enabled:true,policy:{liveCap:40,dailyNewLimit:3},coverage:{reason:'Measured since the registry activation.'},rows:[{...input.sources.rows[0],status:'probation',stats:{fetchAttempts:1,successfulFetches:1,itemsFetched:20,distinctItems:20,candidates:0,checkedCandidates:0,passedChecks:0,averageScore:null,published:0,linkedInPicks:0},ranking:{value:0.15,basis:'Smoothed checked yield',exploration:true}}]};
  const measured=section(renderMethodology(input),'method-sources');
  assert.match(measured,/aria-label="Live source leaderboard"/);
  assert.match(measured,/40 active and probation sources/);
  assert.match(measured,/up to 3 new candidate sources per day/);
  assert.match(measured,/exploration sample/);
  assert.equal(metric(measured,'Items fetched'),'20');
  assert.equal(metric(measured,'Candidates'),'0');
  assert.equal(metric(measured,'Passed checks'),'0');
  assert.equal(metric(measured,'Average checked score'),'Unavailable');
  assert.equal(metric(measured,'Published'),'0');
  assert.equal(metric(measured,'LinkedIn picks'),'0');
  assert.doesNotMatch(measured,/Source evolution is not enabled yet/);
});

test('relay feed is best only after a dated switch confirmation, and selections are separate from confirmed publications',()=>{
  const input=fixture(),confirmed=section(renderMethodology(input),'method-linkedin');
  assert.match(confirmed,/12:17 and 18:17 Vilnius/);
  assert.match(confirmed,/preceding twelve hours/);
  assert.match(confirmed,/at least <strong>7\/10/);
  assert.match(confirmed,/2 picks per Vilnius day/);
  assert.match(confirmed,/switch to <a href="https:\/\/example.test\/channel\/best.xml">best.xml<\/a> is confirmed/);
  assert.match(confirmed,/Hourly website posts are separate/);
  assert.match(confirmed,/first LinkedIn publication was confirmed/);
  assert.match(confirmed,/Selection and relay submission do not by themselves prove/);
  input.relay.bestFeedSwitch.confirmedAt=null;
  input.relay.state='waiting_for_first_linkedin_post';
  const waiting=section(renderMethodology(input),'method-linkedin');
  assert.match(waiting,/confirmed switch to best.xml has not been recorded/);
  assert.match(waiting,/relay feed remains <a href="https:\/\/example.test\/channel\/feed.xml">feed.xml/);
  assert.match(waiting,/Waiting for a confirmed LinkedIn publication/);
  assert.doesNotMatch(waiting,/is confirmed|first LinkedIn publication was confirmed/);
});

test('picks retain their frozen selected scores and link, without making a publication claim',()=>{
  const input=fixture();
  input.picks=[{postId:'fixture-post',title:'A checked example',publicUrl:'https://example.test/channel/p/fixture-post/',publishedAt:'2026-10-11T10:00:00.000Z',pickedAt:'2026-10-11T12:17:00.000Z',scoring:{overall:7.8}}];
  input.curation.lastDecision={reason:'highest_eligible_checked_score',selectedAt:'2026-10-11T12:17:00.000Z'};
  input.policy.weights.evidence=9;
  const html=section(renderMethodology(input),'method-linkedin');
  assert.match(html,/highest eligible independently checked score was selected/);
  assert.match(html,/href="https:\/\/example.test\/channel\/p\/fixture-post\/"/);
  assert.match(html,/frozen score 7.8\/10/);
  assert.match(html,/Selected 11 Oct 2026, 15:17 Vilnius/);
  assert.doesNotMatch(html,/No durable LinkedIn picks/);
});

test('accepted automatic rule changes are distinguished from initial setup and rejected trials',()=>{
  const input=fixture();
  input.versions.unshift({id:'v1',status:'adopted',change:'Initial policy.',createdAt:'2026-10-10T05:00:00.000Z'});
  let html=section(renderMethodology(input),'method-improvement');
  assert.match(html,/No accepted automatic rule change is recorded yet/);
  assert.match(html,/Rejected ·/);
  assert.match(html,/Grounding regressed/);
  assert.match(html,/Held-out trial: current 18; proposed 12.7/);
  assert.match(html,/At 22:13 Vilnius/);
  input.versions.push({id:'improve-124-1',status:'adopted',createdAt:'2026-10-11T19:20:00.000Z',change:'An independently accepted change.',reason:'The blinded held-out score improved.',githubRunUrl:'https://github.com/xndanius/while-you-sleep/actions/runs/124'});
  html=section(renderMethodology(input),'method-improvement');
  assert.match(html,/1 accepted automatic rule change is recorded/);
  assert.match(html,/An independently accepted change/);
  assert.doesNotMatch(html,/No accepted automatic rule change/);
});

test('source names, proposal reasons and registry transitions cannot inject HTML or executable links',()=>{
  const input=fixture(),payload='<img src=x onerror="alert(1)"> & injected';
  input.sources.rows.push({id:'evil',name:payload,url:'javascript:alert(1)',status:'<script>',health:{status:'failed',message:payload},reason:payload,stats:{published:0}});
  input.sources.rows.push({id:'credentials',name:'Credential URL',url:'https://user:password@example.org/feed'});
  input.sources.changes=[{name:payload,from:'<script>',to:'<img>',at:'2026-10-11T13:00:00.000Z',reason:payload,runUrl:'javascript:alert(1)',commitUrl:'https://example.org/change?a=1&b=2'}];
  input.versions[0].change=payload;input.versions[0].reasons=[payload];input.versions[0].githubRunUrl='data:text/html,unsafe';
  const html=renderMethodology(input);
  assert.match(html,/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; injected/);
  assert.match(html,/href="https:\/\/example.org\/change\?a=1&amp;b=2"/);
  assert.doesNotMatch(html,/<img|<script|href="(?:javascript|data):|user:password/);
  assert.match(html,/<span>Cloud run<\/span>/);
  assert.match(html,/X is excluded: its API requires authenticated access and usage credits/);
  assert.match(html,/https:\/\/docs.x.com\/fundamentals\/authentication\/oauth-2-0\/application-only/);
});

test('the renderer keeps input records unchanged and supplies canonical navigation, versioned CSS and unknown defaults',async()=>{
  const input=fixture(),before=structuredClone(input),html=renderMethodology(input);
  assert.deepEqual(input,before);
  assert.match(html,/<link rel="canonical" href="https:\/\/example.test\/channel\/method\/">/);
  assert.match(html,/href="https:\/\/example.test\/channel\/styles.css\?v=abcdef012345"/);
  assert.match(html,/href="https:\/\/example.test\/channel\/method\/" aria-current="page"/);
  assert.match(html,/href="https:\/\/example.test\/channel\/machine\/"/);
  assert.match(html,/Generated from the current repository records · 11 Oct 2026, 16:00 Vilnius/);
  const missing=renderMethodology({baseURL:input.baseURL});
  assert.match(missing,/Current publication threshold <strong>Unavailable/);
  assert.match(missing,/Publication times unavailable/);
  assert.match(missing,/No source rows are recorded/);
  assert.throws(()=>renderMethodology({baseURL:'javascript:alert(1)'}),/HTTPS base URL/);
  assert.throws(()=>renderMethodology({baseURL:'https://user:password@example.org'}),/without credentials/);
  for(const file of ['public/index.html','public/machine.html'])assert.match(await readFile(new URL('../'+file,import.meta.url),'utf8'),/<a href="method\/">The method<\/a>/);
});
