# While You Sleep

Codex researches real autonomous AI projects, picks beginner-friendly ideas, writes them, and submits each to a fresh independent checker. A deterministic job publishes only checked files. Every research run, pick, rejection, post and rule change belongs in this public Git history.

[Website](https://xndanius.github.io/while-you-sleep/) · [Machine](https://xndanius.github.io/while-you-sleep/machine/) · [Follow on LinkedIn](https://www.linkedin.com/company/whileyousleep-ai/) · [Actions](https://github.com/xndanius/while-you-sleep/actions) · [History](https://github.com/xndanius/while-you-sleep/commits/main/)

## Scope and runtime

The v3 scope is **website + LinkedIn Page**. GitHub Actions runs the official `openai/codex-action` on disposable hosted runners. GitHub Pages serves the committed feed, machine and permanent post pages. The website RSS feed supplies the Zapier relay to the LinkedIn Page. Danielius connects Zapier and Claude configures the relay; this repository holds no relay credentials.

The default model remains `gpt-6-luna`, low effort. RULES.md controls research, picking, writing, checking and daily improvement. Writers and checkers have read-only GitHub permissions and separate workspaces. A publisher with no model access repeats schema, source, content-hash and duplicate checks. One repair is allowed, followed by a fresh independent check or rejection. No SSE Riga show or demo is used or changed.

## Schedule · Europe/Vilnius

- Publication slots: 08:07, 13:07 and 19:07; cheap gates at :07/:27/:47 every hour.
- Research slots: :23 every three hours; gates at :23/:53 every hour.
- Measurement: 21:37; gates at :13/:43 every hour.
- Improvement: 22:13; gates at :13/:43 every hour. Invalid proposals are recorded green rejections; valid proposals undergo held-out trials and blinded grading. Adoption requires a higher score without safety or factual regressions.

Skipped gates call no model, commit nothing and do not deploy. Publication catches up every unfulfilled elapsed slot of the current Vilnius day up to three posts, including launch posts. Durable per-slot reservations prevent repeats and retain partial batch results. Late GitHub starts stay visible on the machine. [Timing and guards](docs/SCHEDULER.md).

Real scheduled events now exist: the 10 October 19:07 loop started at 23:01 and correctly skipped the full daily cap. This proves a trigger; checked scheduled publication is a separate proof state. The earlier one-hour trial with zero events remains an immutable historical observation. [Current verification](data/scheduler/verification-20261011-052931.json).

## LinkedIn relay

RSS: https://xndanius.github.io/while-you-sleep/feed.xml

Each item has a permanent /p/<id>/ link, stable post-ID GUID, publication time, short plain-text description and absolute JPEG enclosure. Permanent pages contain the full checked post, sources, canonical URL and Open Graph metadata. The machine reports **Website -> RSS -> Zapier -> LinkedIn Page** and **waiting for first LinkedIn post** until a confirmed relay publication is recorded. [Relay contract](docs/PLATFORMS.md).

## Credentials and metrics

OPENAI_API_KEY is already installed in Actions through the OpenAI Developers secure flow. Keep secrets in GitHub Actions or the relay's private account UI, never chat or public files. The content models use the official action's secure API proxy.

Optional website analytics use aggregate GoatCounter counts. Missing metrics remain null, including LinkedIn metrics that have not been connected. [Analytics](docs/ANALYTICS.md).

## Development

Build outside iCloud at ~/Developer/while-you-sleep. Run `npm ci --ignore-scripts`, `npm run check && npm test`, `npm run build`, then `npm run dev`.

There are no hand-written seed posts. The cloud loop generated, independently checked and committed the first three posts on 10 October using manual dispatches. Public records retain their real trigger provenance; they do not prove automatic scheduling.

## Cost

GitHub-hosted standard runners and Pages are available for public repositories without a paid hosting subscription. [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

Target model budget is under $0.50/day. Recorded token estimates are not invoices; missing usage stays unknown. No account, subscription or payment was created for the v3 relay. [Calculation and rates](docs/COSTS.md).

<!-- MODEL_COSTS_START -->

| Vilnius date | Cloud runs | Estimated USD | Coverage |
| --- | ---: | ---: | --- |
| 2026-10-11 | 2 | $0.01790 | Reported CLI counters |
| 2026-10-10 | 4 | $0.07581 | Reported CLI counters |

Standard-rate token estimates, not invoices. Unreported billing adjustments remain unknown. [Calculation and rates](docs/COSTS.md).

<!-- MODEL_COSTS_END -->

The [W3 backup](docs/BACKUP.md) is configured for Monday 12 October at 19:31 Vilnius, subject to real unattended-run and accepted-improvement evidence. W1 remains incomplete until a real scheduled loop publishes a checked post.
