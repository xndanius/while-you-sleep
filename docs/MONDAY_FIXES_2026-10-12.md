# Monday audit — 12 October 2026

Read-only snapshot at 12/10/2026, 10:43:00; immutable main a098e3f0672bc6fe22e9c55f992c5415eeca236c.

Today 00:07–10:07: **11 elapsed slots, 0 posts**. There were **13 model attempts: 11 green, 2 red**; both red slots later completed green with an honest no-post result. Two extra cron runs were cheap gates with every model job skipped.

| Planned Vilnius | Actual Actions results | Actual run start Vilnius | Durable final record Vilnius | Posts | Durable final slot |
|---|---|---|---|---:|---|
| 00:07 | red [38175653238](https://github.com/xndanius/while-you-sleep/actions/runs/38175653238) → green [38176778193](https://github.com/xndanius/while-you-sleep/actions/runs/38176778193) | 00:16:16 → 00:32:29 | 12/10/2026, 00:37:05 | 0 | no_post |
| 01:07 | green [38180052902](https://github.com/xndanius/while-you-sleep/actions/runs/38180052902) | 01:21:05 | 12/10/2026, 01:25:42 | 0 | no_post |
| 02:07 | green [38183226436](https://github.com/xndanius/while-you-sleep/actions/runs/38183226436) | 02:09:58 | 12/10/2026, 02:12:57 | 0 | no_post |
| 03:07 | green [38187236474](https://github.com/xndanius/while-you-sleep/actions/runs/38187236474) | 03:14:31 | 12/10/2026, 03:19:29 | 0 | no_post |
| 04:07 | red [38191379928](https://github.com/xndanius/while-you-sleep/actions/runs/38191379928) → green [38192435855](https://github.com/xndanius/while-you-sleep/actions/runs/38192435855) | 04:18:46 → 04:35:08 | 12/10/2026, 04:38:15 | 0 | no_post |
| 05:07 | green [38194556984](https://github.com/xndanius/while-you-sleep/actions/runs/38194556984) | 05:07:41 | 12/10/2026, 05:12:07 | 0 | no_post |
| 06:07 | green [38198778993](https://github.com/xndanius/while-you-sleep/actions/runs/38198778993) | 06:11:42 | 12/10/2026, 06:14:14 | 0 | no_post |
| 07:07 | green [38203052650](https://github.com/xndanius/while-you-sleep/actions/runs/38203052650) | 07:15:47 | 12/10/2026, 07:20:27 | 0 | no_post |
| 08:07 | green [38207456044](https://github.com/xndanius/while-you-sleep/actions/runs/38207456044) | 08:19:59 | 12/10/2026, 08:22:35 | 0 | no_post |
| 09:07 | green [38211111812](https://github.com/xndanius/while-you-sleep/actions/runs/38211111812) | 09:08:51 | 12/10/2026, 09:11:44 | 0 | no_post |
| 10:07 | green [38216493294](https://github.com/xndanius/while-you-sleep/actions/runs/38216493294) | 10:13:05 | 12/10/2026, 10:15:50 | 0 | no_post |

## Clock

Verified **47 consecutive observed successful ticks**, from 11/10/2026, 22:07:34 through 12/10/2026, 10:29:04, all bound to actual bot-triggered first-attempt clock runs, with no dispatch failures or broken parent/child edges. Monday-midnight-only count: **40**.

Last tick 12/10/2026, 10:29:04; next wait release 12/10/2026, 10:45:47. Exactly one active clock run, [38217997628](https://github.com/xndanius/while-you-sleep/actions/runs/38217997628), waits in its timer environment with runner ID/name both null.

## Four overnight failures

- [38166690540](https://github.com/xndanius/while-you-sleep/actions/runs/38166690540), 11/10/2026, 22:07:38: Temporary Git test cleanup raised ENOTEMPTY in bootstrap test teardown; evidence assessment itself completed with no post.
- [38171186440](https://github.com/xndanius/while-you-sleep/actions/runs/38171186440), 11/10/2026, 23:11:58: Final live re-fetch of HN discovery evidence returned HTTP 429; report-status deliberately exited 1.
- [38175653238](https://github.com/xndanius/while-you-sleep/actions/runs/38175653238), 12/10/2026, 00:16:03: The final checker explicitly returned operational_failure with no manifest: fresh primary-fetch failure diagnostics were absent for VendIQ, wan777, Dooza Desk and Lumro. It correctly refused to verify the empty exclusion batch. No hash mismatch was observed.
- [38191379928](https://github.com/xndanius/while-you-sleep/actions/runs/38191379928), 12/10/2026, 04:18:30: The first checker similarly refused an empty exclusion batch with incomplete primary-fetch coverage. Artifact selection fell back to writer output and discarded the attempted checker context, obscuring the real refusal behind ENOENT. No hash mismatch was observed.

## Feeds and relay

[feed.xml](https://xndanius.github.io/while-you-sleep/feed.xml) and [best.xml](https://xndanius.github.io/while-you-sleep/best.xml) return 200 and parse as RSS 2.0; feed contains 7 posts, best feed contains 0 picks. The durable relay record says the Zap reads best.xml, human-confirmed 11/10/2026, 18:46:06. The first LinkedIn post is human-confirmed; metrics remain unconnected. No LinkedIn post is claimed for today.

## Verification limits

Frozen files, checked assessment fingerprints and durable slot outcomes were rederived; validation issues: 0. Clock validation issues: 0. Earlier red runs remain red in this audit. The snapshot above was read-only; fixes below change future behavior, not the historical records.

Latest follow-up at 10:46:35 Vilnius: tick 10:46:04, next release 11:01:19. [38219597456](https://github.com/xndanius/while-you-sleep/actions/runs/38219597456) is the next first-attempt bot run; its timer waits with runner ID/name null and no dispatch failure.

## v4.2 fixes

Git auto maintenance is disabled in the isolated source-registry test repositories, and teardown retries transient filesystem errors within a short bound. The source admission and validation assertions are unchanged; the full bootstrap test still requires all separate transition commits.

An hour that cannot verify closes without publication and records the exact verification stage and reason. It is an unverified no-post outcome, never a fabricated independent completion or a scored source success. Attempted checker artifacts remain available even when acceptance refuses them. Failed primary page fetches retain bounded public-access diagnostics. Score, claim, hash and provenance checks remain strict, and the 6/10 publication threshold is unchanged.

New proposed posts are checked against the preceding fourteen days of published product, workflow and customer memory. That memory is frozen into the independent checker context; novelty must be separately verified before publication. Specific workflow or customer duplication is rejected even when the product URL is different. The two previously published support inbox posts remain unchanged.

The lecture freeze is armed for **12 October 18:00 until 13 October 15:00 Vilnius**. Pages checks a sealed code inventory; code changes and RULES adoption are blocked during the window. The hosted clock, hourly assessments, source/content records and website/RSS updates continue. [Freeze contract](CODE_FREEZE_2026-10-12.md).

Local verification before deployment: 407 tests passed, JavaScript syntax checks passed, both workflow YAML files parsed, and the Pages data build retained all seven historical posts. The final sixteen novelty tests include different templates on a shared catalog host, same-item aliases and both directions of the actual support-post duplication. The actual sealed repository is also checked using a simulated time inside the freeze window, without running a content model.
