# Hosted scheduling and its evidence

GitHub Actions owns the schedule on this repository's default branch, `main`. Every job runs on hosted infrastructure. The public machine page distinguishes a configured schedule, a real scheduled trigger, a publication-loop attempt, and a checked post actually published from that scheduled run. A successful manual run proves the cloud pipeline works; it retains `workflow_dispatch` and cannot prove unattended scheduling.

The normal schedules use `timezone: Europe/Vilnius`:

| Job | Local time | Cron |
| --- | --- | --- |
| Publication loop | Daily 08:07, 13:07, 19:07 | `7 8,13,19 * * *` |
| Public-source research | 00:23, 03:23, 06:23, 09:23, 12:23, 15:23, 18:23, 21:23 | `23 */3 * * *` |
| Measurement | Daily 21:37 | `37 21 * * *` |
| Improvement evaluation | Daily 22:13 | `13 22 * * *` |
| Weekly checked social/digest job | Monday 08:17 | `17 8 * * 1` |

The times deliberately avoid the start of each hour. GitHub documents possible schedule delays and dropped jobs under high load, default-branch execution, and IANA timezone support. These are scheduling constraints, not evidence of the cause of this repository's missing events. [Official GitHub schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

Before any publication model runs, a trusted gate reads committed posts and selects the latest elapsed publication slot. A delayed event catches up that slot once; it does not replay every historical slot or blindly generate a batch. Earlier unfulfilled slots on that slot's local date are recorded in `missedSlots`. A committed post for the selected slot suppresses a repeat. Older launch records without slot metadata can fulfil an elapsed slot through their actual publication time. Attempts without a published post do not fulfil a slot.

The gate commits immutable `data/scheduling/<runId>.json` and, when eligible, `data/slot-reservations/<runId>.json` before calling Codex. Its SHA-256 and frozen repository commit pass through trusted job outputs. The writer's target count, final publisher's slot and count, and publication provenance must match that decision. Model artifacts cannot replace it. The separate checker and deterministic source/hash gates still apply. Normal attempts target one post; the cap remains three published posts per Vilnius date, including launch posts. Bootstrap can only fill the first three posts within the same cap.

The trusted record job writes a final run and immutable `data/slot-outcomes/<reservationId>.json`. A published outcome completes the slot. A known failure with no committed post may retry after 10 minutes, then 20, 40, and at most 60 minutes between further attempts. An unfinished or unknown reservation stays held. Time alone never clears it: recovery requires authoritative GitHub metadata showing that exact repository's `main` loop run is terminal, plus the current committed post state. An unavailable metadata request holds the reservation. A terminal run with committed posts completes it; a terminal run without posts records a retryable failure. Shared record-job serialization and the loop's own workflow queue prevent concurrent reservations and publication races.

Research, measurement and improvement use their own trusted slot keys. A successful scheduled completion suppresses the same slot; a failed slot remains eligible. Manual diagnostics retain their real event and do not pretend to complete a scheduled slot.

The machine page computes timing from the current browser clock and the shared Europe/Vilnius schedule, rather than a frozen build timestamp. If no publication-loop attempt is recorded at or after the latest slot, it shows **Waiting** for the first 30 minutes, **Late** from 30 to under 60 minutes, and **Missed** from 60 minutes onward. A no-model gate skip does not advance `lastLoopAt` or count as a model run. **Recorded** describes an attempt and does not imply successful publication.

The proof states are intentionally separate:

| State | Required evidence |
| --- | --- |
| `unverified` | No recorded real `schedule` event. Active cron definitions and manual hosted runs are insufficient. |
| `trigger_observed` | A real scheduled event reaches a hosted job, including a cheap probe or a cap skip. |
| `loop_observed` | A scheduled publication-loop attempt is recorded beyond a no-model gate skip. This does not establish model completion or publication. |
| `publication_observed` | A public checked post belongs to the matching scheduled run's published IDs and shares its run ID and trusted GitHub run URL. |

The temporary UTC control cron was `3,13,23,33,43,53 * 10 10 *`, with no timezone override, on the publication loop and a separate cheap probe. Its runtime deadline was **10 October 2026, 13:58 UTC / 16:58 Europe/Vilnius**. The loop rejects this control at or after the deadline, including a delayed invocation or a later year; normal schedules are unaffected. The probe never generates or publishes posts. Its success could establish only `trigger_observed`.

The [committed diagnosis](../data/scheduler/diagnosis-20261010.json), checked at **13:01:55 UTC on 10 October 2026**, records **zero** GitHub `event=schedule` runs, Actions enabled, default branch `main`, and active workflow metadata. The schedule inventory remained empty during this documentation review. These are observations, not an established GitHub outage, disabled scheduler, timezone defect, or another underlying cause.

The [hosted guard test](https://github.com/xndanius/while-you-sleep/actions/runs/38055146700) completed successfully as a **manual dispatch** on 10 October. The trusted gate recorded `daily_cap_reached` with today's three launch posts; every Codex model job was skipped, the audit was committed, and Pages deployed. This validates the hosted no-model guard path without changing the cap or claiming scheduled publication. The deadline outcome and any later real schedule evidence are reported separately in the repository's current status.

The [final authoritative verification](../data/scheduler/verification-20261010-1358.json) at **13:58:38 UTC / 16:58 Vilnius** still found **zero scheduled events**, after the full one-hour trial. Both controls were active during that trial. The temporary loop cron was then removed, the probe intentionally disabled, and all eight normal workflows remained active. No configuration defect or underlying cause was established. Unattended publishing remains unproven; the [external-clock setup](EXTERNAL_TRIGGER.md) requires owner-provided service access and exact callback evidence before claiming a scheduled publication.

The [manual hosted research catch-up](https://github.com/xndanius/while-you-sleep/actions/runs/38057259822) also passed and deployed 133 source records for the latest elapsed **15:23** slot. Its event remains `workflow_dispatch`; it cannot count as scheduled evidence or suppress a future automatic slot as a manual diagnostic.
