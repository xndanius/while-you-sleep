# Hosted scheduling and its evidence

The v3.2 scope is the website and the LinkedIn Page RSS relay. A chain of GitHub Actions environment waits supplies the primary clock; GitHub cron gates are recovery backups. No new account or secret is needed. Planned publication slots use Europe/Vilnius, including daylight-saving changes.

`clock.yml` claims the next authorized chain run, then a job referencing the `clock` environment waits 15 minutes. The wait happens before a runner is assigned; it is not a runner sleeping for 15 minutes. GitHub documents that environment wait time is not billable and that wait timers are available for public repositories on GitHub Free. The short claim and tick jobs still execute on hosted runners. [Environment wait timers](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#wait-timer).

After the wait, the tick checks which publication, research, measurement and improvement slots are due. It dispatches only eligible work, records the exact returned child run IDs, and dispatches the next `clock.yml` run. The existing deterministic gates retain the publication cap, reservation and retry guards. `GITHUB_TOKEN` can create `workflow_dispatch` runs without another credential. Ordinary pushes made with that token do not trigger another workflow, so a successful tick runs the reusable Pages job to expose the current record. [GitHub token trigger rules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

Exactly one chain is authorized by `data/clock/state.json`. Expected run identity, attempt and generation bind the next claim; duplicate or superseded runs stop before ticking. Serialized clock claims and tick transitions prevent two chains from dispatching work. Cron backups check the clock and can restart it when no tick has been recorded for over 45 minutes, subject to authoritative run-state checks and the same singleton claim.

The 15-minute wait aims to check a newly elapsed slot promptly. Runner queues, dispatch latency, research, model work and checking can add delay, so the next tick is an **earliest estimate**, not an exact publication promise. A real live tick and checked publication are required before reporting unattended operation.

| Work | Planned slots | Backup cron gate |
| --- | --- | --- |
| Publish | Daily 08:07, 13:07, 19:07 | Every 20 minutes at :07, :27, :47 |
| Research | Every three hours at :23 | Every 30 minutes at :23, :53 |
| Measure | Daily 21:37 | Every 30 minutes at :13, :43 |
| Improve | Daily 22:13 | Every 30 minutes at :13, :43 |

A backup gate that has no due work calls no model, commits no work record, and does not deploy Pages. The primary clock records its own tick and singleton state even when content work is not due. Backup frequency does not guarantee an on-time start: GitHub documents that scheduled jobs may start late or be dropped under load. The observed delays do not establish the underlying cause. [Official schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

The publication gate considers every elapsed slot of the **current Vilnius day**, earliest first. It reserves all unfulfilled eligible slots up to the remaining three-post daily cap. Completed slots cannot repeat. Launch posts count toward the same cap. A batch produces one independently checked post per reserved slot; partial publication fulfils only the slots actually published. Yesterday's missed publication slots are not carried into a new day.

Before any model runs, immutable scheduling and reservation records are committed. Their fingerprint, target count and frozen repository revision bind the writer, fresh checker and deterministic publisher. Each checked post receives its own reserved slot identity. A batch cannot publish after its reserved Vilnius date ends. The model has no repository write credential; the publisher has no model access.

Reservations with unknown outcomes stay held. Recovery requires authoritative GitHub metadata proving that the exact repository's main-branch loop run is terminal, plus committed post state. Failed slots with no publication retry after 10, 20, 40 and at most 60 minutes. Partial batch outcomes retain per-slot results, so a published slot cannot repeat during recovery. Workflow serialization prevents concurrent batches.

Research, measure and improve retain trusted daily/three-hour slot keys. A successful completion, whether scheduled or explicitly dispatched for diagnostics, suppresses repeated automatic ticks for that exact slot. Explicit manual diagnostics remain available and keep their real event name; they supply no automatic-trigger proof. Expected improver rejection is a terminal completed evaluation with a reason; it does not trigger repeated proposal spending. Operational failure remains eligible for retry.

The machine page shows the last committed clock tick, the next earliest estimated tick and links to the current clock run and last tick. Its browser clock marks an overdue next tick late and a clock with no tick for over 45 minutes stalled, even when no rebuild has happened. The first pending wait is shown separately from a recorded tick.

The page separates planned slot time, attempt time, actual checked publication time and delay. Future slots stay planned; elapsed unfulfilled slots become waiting, late or missed, or show an active reservation, rejection or cap skip. Current-day slots come from the browser clock, so a no-op gate cannot leave yesterday's timetable masquerading as today. A cheap gate skip never advances the last model loop time.

| Proof state | Evidence |
| --- | --- |
| unverified | No verified automatic trigger is recorded. |
| trigger_observed | A real GitHub cron event or a verified hosted-clock dispatch reached a hosted job. |
| loop_observed | A verified automatic publication loop reached model work. |
| publication_observed | A checked public post matches that automatic run's committed published IDs, run identity and GitHub URL. |

A clock-origin target run keeps its actual GitHub event, `workflow_dispatch`. The UI distinguishes **Hosted clock dispatch · workflow_dispatch**, **Manual dispatch · workflow_dispatch** and **GitHub cron · schedule**. Input markers alone do not establish clock origin. Immutable tick dispatch receipts must match the exact child run ID, and authoritative parent-run metadata must pass the deterministic verifier. Cron event counts remain counts of actual `schedule` events; clock dispatch counts are separate.

The one-hour UTC trial on 10 October ended at 16:58 Vilnius with zero schedule events; its [immutable result](../data/scheduler/verification-20261010-1358.json) remains historical evidence. GitHub subsequently fired five scheduled runs. The [11 October verification](../data/scheduler/verification-20261011-052931.json) records them. The 19:07 publication job started at **23:01 on 10 October** and correctly skipped because that day's three launch posts filled the cap. This proves the trigger, not unattended checked publication. The temporary probe and social publishing workflow are disabled.

Danielius chose three total posts on 10 October without a launch exemption. The new day has its own three-post cap. The website and RSS remain the publication record; LinkedIn relay completion is reported only after a confirmed LinkedIn post.
