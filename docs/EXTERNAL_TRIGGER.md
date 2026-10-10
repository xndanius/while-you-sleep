# Prepared external clock fallback

Status: the one-hour GitHub schedule trial ended on 10 October 2026 with zero scheduled events. The fallback configuration is prepared; no service, account, credential or schedule has been created. This is a clock for the existing Codex workflow; all model work and publication remain in GitHub Actions. Social publishing service selection is separate and remains undecided.

Danielius chose to keep three total posts on 10 October, including the launch posts. Test an automatic trigger without generating another post today; publication proof must wait until 11 October or later. Keep the existing daily cap and record a real automatic cap skip separately from a checked publication. QStash has not yet been selected: Danielius requested an explanation before account setup.

Upstash QStash is the proposed first option. Its current free tier lists 1,000 messages/day and 10 schedules, enough for one ten-minute loop watchdog (144 initial deliveries/day). Confirm the free plan in Danielius's account before enabling it. [Official pricing](https://upstash.com/pricing/qstash).

Danielius creates or signs into the service account and approves its access. The brief assigns account creation, terms and access approval to him. He creates a short-lived fine-grained GitHub token selecting only `xndanius/while-you-sleep`, with repository **Actions: write**. No Contents write permission or OpenAI key is needed. This permission covers this repository's Actions operations, not only one workflow. [GitHub dispatch permissions](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).

Keep credentials in the service's secure setup UI. Never paste them into chat, public files, shell history or a source-controlled request. QStash must hold the dispatch token to send requests; header redaction hides it in returned message details, not from the provider itself.

The concrete destination is:

```
https://api.github.com/repos/xndanius/while-you-sleep/actions/workflows/loop.yml/dispatches
```

Request method: `POST`. JSON body:

```json
{"ref":"main","inputs":{"bootstrap":false}}
```

Configure a QStash schedule using its documented `POST /v2/schedules/{destination}` endpoint and the region URL from the account. The reviewable settings are below; token placeholders must be supplied privately during setup. [Create-schedule API](https://upstash.com/docs/qstash/api-reference/schedules/create-a-schedule).

| Setting/header | Value |
| --- | --- |
| `Upstash-Schedule-Id` | `while-you-sleep-loop-watchdog` |
| `Upstash-Cron` | `CRON_TZ=Europe/Vilnius 7,17,27,37,47,57 * * * *` |
| `Content-Type` | `application/json` |
| `Upstash-Method` | `POST` |
| `Upstash-Timeout` | `20s` |
| `Upstash-Retries` | `1` |
| `Upstash-Forward-Authorization` | `Bearer <private dedicated GitHub token>` |
| `Upstash-Forward-Accept` | `application/vnd.github+json` |
| `Upstash-Forward-X-GitHub-Api-Version` | `2026-03-10` |
| `Upstash-Redact-Fields` | `header[Authorization]` |
| `Upstash-Label` | `while-you-sleep-loop-clock` |

The QStash request itself authenticates with its separate private service token. Cron timezones and a first-trigger loading delay are documented by the provider. [Schedules](https://upstash.com/docs/qstash/features/schedules).

The existing loop already applies latest-slot, daily-cap, durable-reservation and duplicate-publication guards to API dispatches. Repeated ticks cannot republish a completed slot. Pending reservations hold, and known failed attempts follow the bounded backoff. A successful HTTP dispatch response proves request acceptance; the subsequent workflow must still pass the independent checker and publisher.

Verification must retain the provider's actual scheduled delivery ID/time and the GitHub run ID returned by the dispatch API, then confirm that exact run and its committed checked publication. API version `2026-03-10` documents a response containing the workflow run ID and URLs. These runs remain GitHub **`workflow_dispatch`** events. Never relabel them `schedule`, and never infer an external scheduled delivery from a caller-supplied input or a successful manual test. The machine currently verifies GitHub-native scheduled events; verified external-clock receipts need their own explicit provenance before any unattended-publication claim.

The documented QStash log API records schedule ID, destination, time and delivery state, but only supplies response status/body/headers for **errors**. Its message API supplies request details, not the successful GitHub response. Therefore a read-only log reconciler alone cannot establish the exact delivery-to-run link above. Successful callbacks can supply the response body and schedule identity; a separately authenticated callback capture must preserve that evidence before enabling exact external-publication proof. That capture has not been built or deployed. [Log API](https://upstash.com/docs/qstash/api-reference/logs/list-logs), [message API](https://upstash.com/docs/qstash/api-reference/messages/get-a-message), [callbacks](https://upstash.com/docs/qstash/features/callbacks).

Start with the loop watchdog. Research, measurement and improvement retain their GitHub crons. Their manual diagnostic modes intentionally run again; before mirroring those endpoints externally, add an explicit idempotent automatic-dispatch mode and preserve the real event provenance. The publishing-service adapter is unrelated to this trigger.
