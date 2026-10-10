# While You Sleep

Codex researches real autonomous AI projects, picks a beginner-friendly idea, writes it, and submits it to a fresh independent Codex checker. A separate job publishes only checked files. Every research run, pick, rejection, post and rule change lives in this public repository.

Public feed: https://xndanius.github.io/while-you-sleep/ · Live loop: https://xndanius.github.io/while-you-sleep/machine/ · [Actions](https://github.com/xndanius/while-you-sleep/actions) · [History](https://github.com/xndanius/while-you-sleep/commits/main/)

## Cloud runtime

The brain is the official `openai/codex-action` running the Codex CLI on disposable GitHub-hosted Linux runners. The default configured model is `gpt-6-luna`, low effort. `RULES.md` controls research, picking, writing, checking and daily improvement. The writer and checker run in separate jobs with read-only GitHub permissions and an API proxy. Neither has a repository write credential. The publishing job has no model access; it rechecks content hashes, source quotes and duplicates before making commits. One repair is allowed, then a fresh check or rejection.

GitHub Pages rebuilds from committed records. The linked Netlify project is retained as a static-hosting option; no Netlify Functions or laptop scheduler is part of this architecture. Nothing in the SSE Riga show or its demo is used or changed.

## Schedule · Europe/Vilnius

- Public source scan every three hours.
- Full Codex loop at 08:00, 13:00 and 19:00.
- Measurement at 21:30.
- Improvement at 22:00: propose one change, run held-out trials and a separate blinded grader, and change `RULES.md` only if it scores higher without safety or factual regressions.
- LinkedIn Page digest each Monday, using already checked posts.

GitHub cron uses its documented IANA timezone support, including daylight-saving changes. Runs may start late when GitHub is busy. The daily cap is three posts per Vilnius date, including the initial three-post bootstrap. A manual bootstrap uses the exact same workflow as the scheduled loop. Nothing requires this Mac, a browser, or the desktop app to stay open.

## Credentials and owner setup

Secrets belong only in repository **Settings → Secrets and variables → Actions**. Never paste keys or passwords into chat. `OPENAI_API_KEY` is provisioned with the OpenAI Developers secure flow and delivered directly to Actions through stdin without a plaintext local file. The temporary recipient key is removed after successful delivery. The content agents cannot read the API key: the official action supplies a secure Responses proxy.

Social: Postiz Cloud Standard, US$29/month for five channels, API and analytics. Danielius connects X, Instagram and a LinkedIn Page with OAuth; no platform developer apps are needed. The posting job is inactive until `POSTIZ_API_KEY` is installed. [Exact account steps and official pricing/terms](docs/PLATFORMS.md).

Site analytics: optional GoatCounter, free for reasonable public use. The browser collects page views and save events without cookies; daily read-only measurements are committed to `metrics.json`. Metrics stay `null` until connected or when unavailable. Browser saves work without analytics. [Setup](docs/ANALYTICS.md).

## Development

Build outside iCloud: `~/Developer/while-you-sleep`.

- `npm ci --ignore-scripts`
- `npm run check && npm test`
- `npm run build`
- `npm run dev`

There are no hand-written seed posts. `data/posts/` starts empty; the cloud loop creates the first posts. Research snapshots, draft/check hashes, rejected candidates, exact claim checks, publication records and rules history form the audit trail. The UI displays only posts that pass content-integrity checks.

## Cost

GitHub-hosted standard runners and Pages are available for public repositories without a paid hosting subscription. See [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) and [Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

Model standard rates verified 10 Oct 2026: GPT-6 Luna US$0.10/M input, $0.01/M cached input, $0.125/M cache write and $0.50/M output for prompts up to 272K tokens ([official pricing](https://developers.openai.com/api/docs/pricing)). Target model budget under $0.50/day; actual costs depend on runner token usage and the OpenAI invoice. Missing usage is not recorded as zero. Postiz costs US$29/month when Danielius starts the subscription; GoatCounter reasonable public use is free. No subscription or payment has been made by this build.

Completed model workflows automatically reconcile incomplete counters from their terminal job logs. Original usage records stay immutable; the feed and table use one verified effective record per run, so a correction does not count the run twice. Retrieval failures keep usage unknown. [Reconciliation and calculation](docs/COSTS.md#completed-run-reconciliation).

<!-- MODEL_COSTS_START -->

| Vilnius date | Cloud runs | Estimated USD | Coverage |
| --- | ---: | ---: | --- |
| 2026-10-10 | 2 | $0.04770 | Reported CLI counters |

Standard-rate token estimates, not invoices. Unreported billing adjustments remain unknown. [Calculation and rates](docs/COSTS.md).

<!-- MODEL_COSTS_END -->

The [W3 backup workflow](docs/BACKUP.md) records the real public machine and GitHub history on Monday, 12 October at 19:30 Vilnius, after its unattended-run and accepted-improvement gates pass.

Hosted checks on 10 Oct 2026: [Pages deployment](https://github.com/xndanius/while-you-sleep/actions/runs/38030166542), [133-source research and commit](https://github.com/xndanius/while-you-sleep/actions/runs/38030175806), and [measurement and commit](https://github.com/xndanius/while-you-sleep/actions/runs/38030178078) completed successfully on GitHub runners. All core cron/deployment workflows and the Monday backup are active. No model request or social post has been made yet.

W1 is not achieved until a GitHub-hosted run has generated, independently checked and committed three posts, Pages displays them and the enabled cron workflows are verified. Verification will be recorded here after the run.
