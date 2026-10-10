# While You Sleep

Codex researches real autonomous AI projects, picks a beginner-friendly idea, writes it, and submits it to a fresh independent Codex checker. A separate job publishes only checked files. Every research run, pick, rejection, post and rule change lives in this public repository.

Public feed: https://xndanius.github.io/while-you-sleep/ · Live loop: https://xndanius.github.io/while-you-sleep/machine/ · [Actions](https://github.com/xndanius/while-you-sleep/actions) · [History](https://github.com/xndanius/while-you-sleep/commits/main/)

## Cloud runtime

The brain is the official `openai/codex-action` running the Codex CLI on disposable GitHub-hosted Linux runners. The default configured model is `gpt-6-luna`, low effort. `RULES.md` controls research, picking, writing, checking and daily improvement. The writer and checker run in separate jobs with read-only GitHub permissions and an API proxy. Neither has a repository write credential. The publishing job has no model access; it rechecks content hashes, source quotes and duplicates before making commits. One repair is allowed, then a fresh check or rejection.

GitHub Pages rebuilds from committed records. The linked Netlify project is retained as a static-hosting option; no Netlify Functions or laptop scheduler is part of this architecture. Nothing in the SSE Riga show or its demo is used or changed.

## Schedule · Europe/Vilnius

- Public source scan at :23 every three hours.
- Full Codex loop at 08:07, 13:07 and 19:07.
- Measurement at 21:37.
- Improvement at 22:13: propose one change, run held-out trials and a separate blinded grader, and change `RULES.md` only if it scores higher without safety or factual regressions.
- LinkedIn Page digest each Monday at 08:17, using already checked posts, after a publishing service is selected and connected.

GitHub cron uses its documented IANA timezone support, including daylight-saving changes. Runs may start late or be dropped when GitHub is busy. The daily cap is three posts per Vilnius date, including the initial three-post bootstrap. A manual bootstrap uses the same cloud workflow. **Unattended publishing is not yet proven:** the GitHub API still showed zero `event=schedule` runs at 16:58 Vilnius on 10 October, after the one-hour odd-minute UTC control trial. Active cron definitions and successful manual runs do not prove a working timer. [Verified trial outcome](data/scheduler/verification-20261010-1358.json).

## Credentials and owner setup

Secrets belong only in repository **Settings → Secrets and variables → Actions**. Never paste keys or passwords into chat. `OPENAI_API_KEY` is provisioned with the OpenAI Developers secure flow and delivered directly to Actions through stdin without a plaintext local file. The temporary recipient key is removed after successful delivery. The content agents cannot read the API key: the official action supplies a secure Responses proxy.

Social service is **undecided**. Danielius is creating X, Instagram and LinkedIn pages with Claude's help and will report when they exist. The Postiz adapter remains a prepared option, with no account, subscription or secret installed. [Researched option and official pricing/terms](docs/PLATFORMS.md).

Site analytics: optional GoatCounter, free for reasonable public use. The browser collects page views and save events without cookies; daily read-only measurements are committed to `metrics.json`. Metrics stay `null` until connected or when unavailable. Browser saves work without analytics. [Setup](docs/ANALYTICS.md).

## Development

Build outside iCloud: `~/Developer/while-you-sleep`.

- `npm ci --ignore-scripts`
- `npm run check && npm test`
- `npm run build`
- `npm run dev`

There are no hand-written seed posts. `data/posts/` started empty; the cloud loop generated, independently checked and committed the first three posts. Research snapshots, draft/check hashes, rejected candidates, exact claim checks, publication records and rules history form the audit trail. The UI displays only posts that pass content-integrity checks.

## Cost

GitHub-hosted standard runners and Pages are available for public repositories without a paid hosting subscription. See [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) and [Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

Model standard rates verified 10 Oct 2026: GPT-6 Luna US$0.10/M input, $0.01/M cached input, $0.125/M cache write and $0.50/M output for prompts up to 272K tokens ([official pricing](https://developers.openai.com/api/docs/pricing)). Target model budget under $0.50/day; actual costs depend on runner token usage and the OpenAI invoice. Missing usage is not recorded as zero. Postiz costs US$29/month when Danielius starts the subscription; GoatCounter reasonable public use is free. No subscription or payment has been made by this build.

Completed model workflows automatically reconcile incomplete counters from their terminal job logs. Original usage records stay immutable; the feed and table use one verified effective record per run, so a correction does not count the run twice. Retrieval failures keep usage unknown. [Reconciliation and calculation](docs/COSTS.md#completed-run-reconciliation).

<!-- MODEL_COSTS_START -->

| Vilnius date | Cloud runs | Estimated USD | Coverage |
| --- | ---: | ---: | --- |
| 2026-10-11 | 1 | $0.00288 | Reported CLI counters |
| 2026-10-10 | 4 | $0.07581 | Reported CLI counters |

Standard-rate token estimates, not invoices. Unreported billing adjustments remain unknown. [Calculation and rates](docs/COSTS.md).

<!-- MODEL_COSTS_END -->

The [W3 backup workflow](docs/BACKUP.md) is configured to record the real public machine and GitHub history on Monday, 12 October at 19:31 Vilnius, after its unattended-run and accepted-improvement gates pass. Its timer also requires real scheduled evidence.

The feed portion of W1 was verified on 10 Oct 2026 at 10:15 Vilnius; the earlier full W1 claim was premature. The manually dispatched [bootstrap run](https://github.com/xndanius/while-you-sleep/actions/runs/38032271902) published two checked posts; the manually dispatched [normal loop run](https://github.com/xndanius/while-you-sleep/actions/runs/38033544598) published the third at 10:13. All three are live on the [feed](https://xndanius.github.io/while-you-sleep/) and [machine](https://xndanius.github.io/while-you-sleep/machine/), with source links, independently verified content/check hashes, committed publication records and public 1080×1350 JPEG cards. Desktop and phone checks passed.

W1 remains incomplete until an actual scheduled run publishes a checked post by itself. The one-hour UTC trial ended at 16:58 Vilnius with zero scheduled events. Its temporary loop cron was removed and its probe disabled; all eight normal workflows remain active with their revised odd-minute schedules. The cause of the absent GitHub events remains unproven. An [external hosted clock is prepared](docs/EXTERNAL_TRIGGER.md) but requires Danielius's service account and dedicated dispatch credential; it has not been configured. No social post or paid subscription has been made by this build.

[Scheduling, catch-up guards and proof levels](docs/SCHEDULER.md) explain the hosted timer and the distinction between a trigger, a loop attempt and checked publication. The [manual guard test](https://github.com/xndanius/while-you-sleep/actions/runs/38055146700) passed with every model job skipped because today's three launch posts fill the daily cap.
