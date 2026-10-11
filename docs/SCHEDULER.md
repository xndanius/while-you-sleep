# Hosted scheduling and its evidence

The v3 scope is the website and the LinkedIn Page RSS relay. GitHub Actions remains the hosted clock and Codex runtime; no new scheduling account is needed. All schedules use Europe/Vilnius, including daylight-saving changes.

| Work | Planned slots | Cheap gate |
| --- | --- | --- |
| Publish | Daily 08:07, 13:07, 19:07 | Every 20 minutes at :07, :27, :47 |
| Research | Every three hours at :23 | Every 30 minutes at :23, :53 |
| Measure | Daily 21:37 | Every 30 minutes at :13, :43 |
| Improve | Daily 22:13 | Every 30 minutes at :13, :43 |

A scheduled gate that has no due work calls no model, commits no record, and does not deploy Pages. Frequency reduces dependence on a single missed cron event; it does not guarantee an on-time start. GitHub documents that scheduled jobs may start late or be dropped under load. The observed delays do not establish the underlying cause. [Official schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

The publication gate considers every elapsed slot of the **current Vilnius day**, earliest first. It reserves all unfulfilled eligible slots up to the remaining three-post daily cap. Completed slots cannot repeat. Launch posts count toward the same cap. A batch produces one independently checked post per reserved slot; partial publication fulfils only the slots actually published. Yesterday's missed publication slots are not carried into a new day.

Before any model runs, immutable scheduling and reservation records are committed. Their fingerprint, target count and frozen repository revision bind the writer, fresh checker and deterministic publisher. Each checked post receives its own reserved slot identity. A batch cannot publish after its reserved Vilnius date ends. The model has no repository write credential; the publisher has no model access.

Reservations with unknown outcomes stay held. Recovery requires authoritative GitHub metadata proving that the exact repository's main-branch loop run is terminal, plus committed post state. Failed slots with no publication retry after 10, 20, 40 and at most 60 minutes. Partial batch outcomes retain per-slot results, so a published slot cannot repeat during recovery. Workflow serialization prevents concurrent batches.

Research, measure and improve retain trusted daily/three-hour slot keys. A successful scheduled completion suppresses a repeated tick. Manual diagnostic runs keep their real event name. Expected improver rejection is a terminal completed evaluation with a reason; it does not trigger repeated proposal spending. Operational failure remains eligible for retry.

The machine page separates planned slot time, attempt time, actual checked publication time and delay. Future slots stay planned; elapsed unfulfilled slots become waiting, late or missed, or show an active reservation, rejection or cap skip. A cheap gate skip never advances the last model loop time.

| Proof state | Evidence |
| --- | --- |
| unverified | No real schedule event is recorded. |
| trigger_observed | A real GitHub schedule event reached a hosted job, even if it skipped at the cap. |
| loop_observed | A real scheduled publication loop reached model work. |
| publication_observed | A checked public post matches that scheduled run's committed published IDs, run identity and GitHub URL. |

The one-hour UTC trial on 10 October ended at 16:58 Vilnius with zero schedule events; its [immutable result](../data/scheduler/verification-20261010-1358.json) remains historical evidence. GitHub subsequently fired five scheduled runs. The [11 October verification](../data/scheduler/verification-20261011-052931.json) records them. The 19:07 publication job started at **23:01 on 10 October** and correctly skipped because that day's three launch posts filled the cap. This proves the trigger, not unattended checked publication. The temporary probe and social publishing workflow are disabled.

Danielius chose three total posts on 10 October without a launch exemption. The new day has its own three-post cap. The website and RSS remain the publication record; LinkedIn relay completion is reported only after a confirmed LinkedIn post.
