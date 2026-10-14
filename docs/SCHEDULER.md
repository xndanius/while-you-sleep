# Hosted scheduling and its evidence

The v4 scope is the website and the LinkedIn Page RSS relay. A chain of GitHub Actions environment waits supplies the primary clock; GitHub cron gates are recovery backups. No new account or secret is needed. Planned publication slots use Europe/Vilnius, including daylight-saving changes.

`clock.yml` claims the next authorized chain run, then a job referencing the `clock` environment waits 15 minutes. The wait happens before a runner is assigned; it is not a runner sleeping for 15 minutes. GitHub documents that environment wait time is not billable and that wait timers are available for public repositories on GitHub Free. The short claim and tick jobs still execute on hosted runners. [Environment wait timers](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#wait-timer).

After the wait, the tick checks which publication, research, measurement, improvement and LinkedIn-selection slots are due. It dispatches only eligible work, records the exact returned child run IDs, and dispatches the next `clock.yml` run. The existing deterministic gates retain the publication cap, reservation and retry guards. `GITHUB_TOKEN` can create `workflow_dispatch` runs without another credential. Ordinary pushes made with that token do not trigger another workflow, so a successful tick runs the reusable Pages job to expose the current record. [GitHub token trigger rules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

Exactly one chain is authorized by the latest validated GitHub Deployment payload in the `clock-runtime` environment. `data/clock/state.json` remains a committed fallback for content dispatch and recovery history. Deployment payloads bind the exact producer run and successor; they do not deploy a website or hold a runner. Expected run identity, attempt and generation bind the next claim; duplicate or superseded runs stop before ticking. Serialized clock claims and tick transitions prevent two chains from dispatching work. Cron backups check the clock and can restart it when no tick has been recorded for over 45 minutes, subject to authoritative run-state checks and the same singleton claim.

The 15-minute wait aims to check a newly elapsed slot promptly. Runner queues, dispatch latency, research, model work and checking can add delay, so the next tick is an **earliest estimate**, not an exact publication promise. A real live tick and checked publication are required before reporting unattended operation.

| Work | Planned slots | Backup cron gate |
| --- | --- | --- |
| Publish | Legacy 08:07, 13:07, 19:07; hourly :07 after relay confirmation and activation | Every 20 minutes at :07, :27, :47 |
| Research | Every three hours at :23 under legacy cadence; hourly :23 once hourly cadence is active | Every 30 minutes at :23, :53 |
| Measure | Daily 21:37 | Every 30 minutes at :13, :43 |
| Improve | Daily 22:13 | Every 30 minutes at :13, :43 |
| LinkedIn selection | 12:17, 18:17; minimum checked score 6, rolling 24-hour eligibility, cap 2 | Every 30 minutes at :17, :47 |

A backup gate that has no due work calls no model, commits no work record, and does not deploy Pages. Empty ticks and claims write only runtime metadata, with no Git commits and no Pages deploy. A tick that dispatches content commits its immutable receipt; chain restarts retain committed recovery history. An already waiting workflow may finish one legacy transition during migration. Backup frequency does not guarantee an on-time start: GitHub documents that scheduled jobs may start late or be dropped under load. The observed delays do not establish the underlying cause. [Official schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

The publication gate considers every elapsed slot of the **current Vilnius day**, earliest first. It reserves up to six unfulfilled eligible slots per batch within the configured daily cap: three in legacy mode, 24 after hourly activation. Completed slots cannot repeat. Launch posts count toward the same cap. A batch may publish one independently approved qualifying idea per reserved slot. A completed independent assessment can instead settle remaining slots with an honest no-post outcome; reaching a quota never overrides a check or score threshold. Yesterday's missed publication slots are not carried into a new day.

Before any model runs, immutable scheduling and reservation records are committed. Their fingerprint, target count and frozen repository revision bind the writer, fresh checker and deterministic publisher. Each checked post receives its own reserved slot identity. A batch cannot publish after its reserved Vilnius date ends. The model has no repository write credential; the publisher has no model access.

Reservations with unknown outcomes stay held. Recovery requires authoritative GitHub metadata proving that the exact repository's main-branch loop run is terminal, plus committed post state. Operationally failed slots retry after bounded backoff, up to three attempts; the third failure records retry_exhausted. Complete independently checked rejections or below-threshold decisions record no_post and do not retry that slot. Partial batch outcomes retain per-slot results, so a published slot cannot repeat during recovery. Workflow serialization prevents concurrent batches.

Research, measure and improve retain trusted slot keys and a frozen cadence. Historical research records remain bound to their legacy three-hour schedule; newly active hourly research records carry their own activation policy. A successful completion, whether scheduled or explicitly dispatched for diagnostics, suppresses repeated automatic ticks for that exact slot. Explicit manual diagnostics remain available and keep their real event name; they supply no automatic-trigger proof. Expected improver rejection is a terminal completed evaluation with a reason; it does not trigger repeated proposal spending. Operational failure remains eligible for retry.

The machine page reads the latest public GitHub runtime metadata every three minutes, with a committed fallback if it cannot refresh. It shows the last clock tick, the next earliest estimated tick and links to the current clock run and last tick. Its browser clock marks an overdue next tick late and a clock with no tick for over 45 minutes stalled, even when no rebuild has happened. The first pending wait is shown separately from a recorded tick.

The page separates planned slot time, attempt time, actual checked publication time and delay. Future slots stay planned; elapsed unfulfilled slots become waiting, late or missed, or show an active reservation, completed no-post decision, exhausted failure or cap skip. Current-day slots come from the browser clock, so a no-op gate cannot leave yesterday's timetable masquerading as today. A cheap gate skip never advances the last model loop time.

| Proof state | Evidence |
| --- | --- |
| unverified | No verified automatic trigger is recorded. |
| trigger_observed | A real GitHub cron event or a verified hosted-clock dispatch reached a hosted job. |
| loop_observed | A verified automatic publication loop reached model work. |
| publication_observed | A checked public post matches that automatic run's committed published IDs, run identity and GitHub URL. |

A clock-origin target run keeps its actual GitHub event, `workflow_dispatch`. The UI distinguishes **Hosted clock dispatch · workflow_dispatch**, **Manual dispatch · workflow_dispatch** and **GitHub cron · schedule**. Input markers alone do not establish clock origin. Immutable tick dispatch receipts must match the exact child run ID, and authoritative parent-run metadata must pass the deterministic verifier. Cron event counts remain counts of actual `schedule` events; clock dispatch counts are separate.

The one-hour UTC trial on 10 October ended at 16:58 Vilnius with zero schedule events; its [immutable result](../data/scheduler/verification-20261010-1358.json) remains historical evidence. GitHub subsequently fired five scheduled runs. The [11 October verification](../data/scheduler/verification-20261011-052931.json) records them. The 19:07 publication job started at **23:01 on 10 October** and correctly skipped because that day's three launch posts filled the cap. This proves the trigger, not unattended checked publication. The temporary probe and social publishing workflow are disabled.

Danielius chose three total posts on 10 October without a launch exemption. The new day has its own three-post cap. The website and RSS remain the publication record; LinkedIn relay completion is reported only after a confirmed LinkedIn post.

On 11 October the 13:07 Vilnius slot was dispatched by clock tick `clock-38130461675-1` at 13:17:25.983 and published at **13:20:06.032**. The live post was independently observed at 13:21:05.265. Both the child actor and triggering actor were `github-actions[bot]`, attempt 1. No human workflow dispatch or rerun was used. [Post](https://xndanius.github.io/while-you-sleep/p/b89af4e5c65cc81c424c080b/) · [Hosted run](https://github.com/xndanius/while-you-sleep/actions/runs/38131420022).

Hourly activation is explicitly held until Danielius or Claude confirms that the existing Zap reads /best.xml. `public/cadence-config.js` records the confirmation and activation instants. Only hourly slots on or after that activation are introduced; legacy elapsed slots keep their identities. Old in-flight reservations retain their cap, contract and frozen policy. /best.xml starts without historical items and freezes each checked selection score.
