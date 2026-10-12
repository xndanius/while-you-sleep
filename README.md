# While You Sleep

Codex researches real autonomous AI projects, picks beginner-friendly ideas, writes them, and submits each to a fresh independent checker. A deterministic job publishes only checked files. Every research run, pick, rejection, post and rule change belongs in this public Git history.

[Website](https://xndanius.github.io/while-you-sleep/) · [Machine](https://xndanius.github.io/while-you-sleep/machine/) · [Method](https://xndanius.github.io/while-you-sleep/method/) · [Follow on LinkedIn](https://www.linkedin.com/company/whileyousleep-ai/) · [Actions](https://github.com/xndanius/while-you-sleep/actions) · [History](https://github.com/xndanius/while-you-sleep/commits/main/)

## Scope and runtime

The v4 scope is **website + LinkedIn Page**. GitHub Actions runs the official `openai/codex-action` on disposable hosted runners. A self-dispatching chain of 15-minute GitHub environment waits supplies the clock; cron gates remain recovery backups. Waiting jobs hold no runner. GitHub Pages serves the committed feed, machine and permanent post pages. The website RSS feed supplies the Zapier relay to the LinkedIn Page. Danielius connects Zapier and Claude configures the relay; this repository holds no relay credentials.

The default model remains `gpt-6-luna`, low effort. RULES.md controls research, picking, writing, checking and daily improvement. Writers and checkers have read-only GitHub permissions and separate workspaces. A publisher with no model access repeats schema, source, content-hash and duplicate checks. One repair is allowed, followed by a fresh independent check or rejection. No SSE Riga show or demo is used or changed.

Before each loop's writer starts, a deterministic fetch enriches up to 12 discovered leads with their public product page or GitHub README. The fetch uses three concurrent requests, a 90-second total budget, complete bounded responses and the existing HTTPS, DNS, redirect and robots guards. Access failures are recorded; a listing alone does not establish product capabilities. The original feed receipt stays frozen, and documentation retains its discovery origin. The independent checker fetches attached evidence again.

An independently completed assessment with no eligible post is a successful `completed_no_post` run. Missing evidence, incomplete model jobs or a missing, stale or contradictory checker output remain failures. Repair completion comes from trusted Actions job results. Every checker starts without an inherited verdict and returns a structured verdict bound to the current frozen draft, context, sources, rules and scoring policy.

## Checked scores

Each idea is assessed from 1 to 10 for ease to start, profit potential, feasibility for a student in two weeks, autonomy and evidence. Every value has a short evidence-linked reason; profit potential is always a hypothesis. A fresh independent checker sets the highest supported value for each criterion. The trusted publisher rejects inflated scores and calculates the weighted mean itself. The initial weights are equal and the publication threshold is 6; the current policy lives in RULES.md.

Historical posts keep their original checked content, IDs and publication times. A separate cloud scoring workflow records independently checked assessments alongside them, including assessments below today's threshold. Post pages show the five reasons and sources, and the JPEG card includes a compact score line. Display scores use the current policy weights, while a publication decision retains the policy frozen for its own run. The daily improver can propose a narrowly bounded policy change with a stated reason; adoption still requires independent held-out trials and no factual or safety regression.

## Schedule · Europe/Vilnius

- Primary clock: one authorized chain waits 15 minutes in the `clock` environment, checks due slots, records its tick and dispatches its successor. Queue time can add delay.
- Publication slots are controlled by `public/cadence-config.js`: legacy 08:07, 13:07 and 19:07 until the best-feed Zap switch is confirmed; then hourly at :07 with a recorded activation instant and cap24. Backup cron gates stay at :07/:27/:47.
- Research slots: :23 every three hours under legacy cadence, then every hour once hourly cadence is active. Backup gates stay at :23/:53.
- Measurement: 21:37; backup gates at :13/:43 every hour.
- Improvement: 22:13; backup gates at :13/:43 every hour. Invalid proposals are recorded green rejections; valid proposals undergo held-out trials and blinded grading. Adoption requires a higher score without safety or factual regressions.

Skipped content gates call no model, commit no work record and do not deploy. The clock retains committed immutable receipts when it dispatches content. Empty ticks and claims keep their lease in public GitHub metadata without commits or Pages rebuilds. Duplicates stop before dispatching work; cron backups can restart a chain with no tick for over 45 minutes. Publication catches up every unfulfilled elapsed slot of the current Vilnius day up to the configured cap, including launch posts. Hourly catch-up batches contain at most six slots; complete independently checked refusals settle without a post, and operational failures stop after three attempts. Durable per-slot reservations prevent repeats and retain partial batch results. The machine shows tick time, the next earliest estimated tick, and planned versus actual slot times; it marks a stale clock stalled. [Timing and guards](docs/SCHEDULER.md).

Real cron events exist: the 10 October 19:07 loop started at 23:01 and correctly skipped the full daily cap. This proves a trigger; checked automatic publication is a separate proof state. Clock-origin runs keep the GitHub event `workflow_dispatch` and require exact dispatch receipts plus authoritative parent metadata to distinguish them from manual diagnostics. The earlier one-hour cron trial with zero events remains an immutable historical observation. [Verification](data/scheduler/verification-20261011-052931.json).

## Measured source registry

[Source registry](data/sources/registry.json) records admitted public inputs, their status and how each was added. The [public source report](https://xndanius.github.io/while-you-sleep/api/sources.json) joins frozen scans with recorded candidate identities and independently checked outcomes to show fetched items, candidates, passed checks, average checked score, publications and LinkedIn picks. Candidates include distinct considered leads that match their original frozen source items; they do not contribute checked scores or successful outcomes without independent approval. Historical attribution remains unknown; zeros describe measured coverage after activation. Models cannot mint yield by changing an origin label or declaring a count.

Each scan selects at most 20 of up to 40 active and probation sources. Five positions provide exploration; the remaining positions favour verified yield. On the first due research scan of each Vilnius date, a deterministic review can promote good probation entries, retire sufficiently sampled poor performers and check up to three new candidate sources. New admissions require public HTTPS, readable content and permission under robots rules, including redirects. Hosted bootstrap checks the requested seed expansion and records blocked or unreadable proposals as exclusions. Every actual registry transition is committed separately with its reason. Current sample thresholds, coverage and exclusions appear on the method page.

## LinkedIn relay

All ideas RSS: https://xndanius.github.io/while-you-sleep/feed.xml

LinkedIn relay RSS: https://xndanius.github.io/while-you-sleep/best.xml

Each item has a permanent /p/<id>/ link, stable post-ID GUID, publication time, short plain-text description and absolute JPEG enclosure. Permanent pages contain the full checked post, sources, canonical URL and Open Graph metadata. The machine reports **Website -> RSS -> Zapier -> LinkedIn Page**. Danielius via Claude confirmed the first LinkedIn post at 11:55 Vilnius on 11 October and the active Zap; engagement metrics remain unknown. [Relay contract](docs/PLATFORMS.md).

The separate [best feed](https://xndanius.github.io/while-you-sleep/best.xml) contains only recorded LinkedIn picks. At 12:17 and 18:17 Vilnius, a deterministic job chooses the highest current checked weighted score from the preceding 12 hours, at least 7, excluding previous picks and posts published before activation. It records a pick or an honest empty window, with at most two picks a day. Each RSS item freezes the score used to select it; later rule changes cannot rewrite its relay text. The approval reported at 15:10:58 Vilnius on 11 October was later corrected: the Zap still read `/feed.xml` when hourly mode started. No hourly website post was published during that mismatch, and Claude reported no hourly LinkedIn post. Danielius subsequently confirmed that the corrected Zap was published and reads `/best.xml`. The relay status records that actual confirmation and preserves both reports in [relay history](data/relay/history). Hosted hourly gates also check current relay readiness before reserving a model run; frozen scheduling history is not proof of the external relay state.

## Credentials and metrics

The public [method page](https://xndanius.github.io/while-you-sleep/method/) is generated during each Pages build from the current scoring policy, cadence, checked LinkedIn selections, source records and rule-change history. It explains what has been measured and what remains unavailable. The clock's current last and next tick come from runtime metadata on the machine page.

OPENAI_API_KEY is already installed in Actions through the OpenAI Developers secure flow. Keep secrets in GitHub Actions or the relay's private account UI, never chat or public files. The content models use the official action's secure API proxy.

Optional website analytics use aggregate GoatCounter counts. Missing metrics remain null, including LinkedIn metrics that have not been connected. [Analytics](docs/ANALYTICS.md).

## Development

Build outside iCloud at ~/Developer/while-you-sleep. Run `npm ci --ignore-scripts`, `npm run check && npm test`, `npm run build`, then `npm run dev`.

There are no hand-written seed posts. The cloud loop generated, independently checked and committed the first three posts on 10 October using manual dispatches. Public records retain their real trigger provenance; they do not prove automatic scheduling.

## Cost

GitHub-hosted standard runners and Pages are available for public repositories without a paid hosting subscription. Environment wait time is not billable; the short claim and tick jobs still run normally. [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [environment waits](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#wait-timer), [Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

The hourly planning target is about $0.03 per loop run, roughly $0.70/day at 24 runs. This is a target, not measured hourly spending; extra repairs and daily improvement can increase it. Recorded token estimates are not invoices; missing usage stays unknown. No account, subscription or payment was created for the v3 relay. [Calculation and rates](docs/COSTS.md).

<!-- MODEL_COSTS_START -->

| Vilnius date | Cloud runs | Estimated USD | Coverage |
| --- | ---: | ---: | --- |
| 2026-10-12 | 10 | $0.28546 | Reported CLI counters |
| 2026-10-11 | 18 | Unknown | Missing or partial counters |
| 2026-10-10 | 4 | $0.07581 | Reported CLI counters |

Standard-rate token estimates, not invoices. Unreported billing adjustments remain unknown. [Calculation and rates](docs/COSTS.md).

<!-- MODEL_COSTS_END -->

The [W3 backup](docs/BACKUP.md) is configured for Monday 12 October at 19:31 Vilnius, subject to real unattended-run and accepted-improvement evidence. W1 automatic publication is verified: the 11 October 13:07 slot published at 13:20:06 Vilnius from the hosted clock, without a human trigger. [Post](https://xndanius.github.io/while-you-sleep/p/b89af4e5c65cc81c424c080b/) · [Run](https://github.com/xndanius/while-you-sleep/actions/runs/38131420022).
