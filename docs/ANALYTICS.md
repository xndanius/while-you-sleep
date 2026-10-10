# Optional analytics

The feed works without analytics. Unconnected or failed measurements stay `null`; a successful response containing zero stays `0`. GoatCounter is currently free for reasonable public use, including small and medium businesses. Danielius must create the account himself. [Pricing and account terms](https://www.goatcounter.com/help/terms).

## Connect the website counter

1. Open [GoatCounter](https://www.goatcounter.com/), click **Sign up**, choose an available site code, and finish registration yourself. Use `https://xndanius.github.io/while-you-sleep/` as the website.
2. Copy the resulting counter origin, such as `https://your-code.goatcounter.com`. In [repository Actions variables](https://github.com/xndanius/while-you-sleep/settings/variables/actions), click **New repository variable**, name it `GOATCOUNTER_SITE`, enter that origin without `/count`, and save.
3. In GoatCounter, open your username in the top menu → **API**. Create a key with permission to read statistics, leaving write permissions off. Copy it directly into [repository Actions secrets](https://github.com/xndanius/while-you-sleep/settings/secrets/actions): **New repository secret** → `GOATCOUNTER_API_TOKEN` → save. Never put it in chat, a repository file, or a public variable. [API authentication](https://www.goatcounter.com/help/api).
4. In repository **Actions**, choose **Publish Pages** → **Run workflow**. Open the public feed, view an idea, and save it. Then run **Measure the loop** manually to verify the integration. GoatCounter can take about ten seconds to receive hits, and the daily snapshot covers only complete hours. [Getting started](https://www.goatcounter.com/help/start).

## What is collected

`public/api/analytics.json` contains only the public counter origin. When configured, `analytics.js` loads the official counter script. It sends canonical page names `/` and `/machine`, plus `view:<public-post-id>` and `save:<public-post-id>` events. It strips query strings, URL fragments, and referrers; no persistent reader identifier is added by this site. Saved preferences remain in the reader's browser. [JavaScript API](https://www.goatcounter.com/help/js), [events](https://www.goatcounter.com/help/events).

A post view means its article entered the viewport. Saves are observed save events, not the current number of saved items. GoatCounter deduplicates events according to its session rules. Ad blockers and unavailable scripts can prevent observations; the loop does not estimate missing visits.

## The daily record

**Measure the loop** is scheduled for 21:37 in `Europe/Vilnius` and can also be dispatched manually. GitHub's time zone setting follows daylight saving time; hosted schedules can be delayed or dropped. The active timer is unproven until real `event=schedule` evidence appears. [GitHub scheduling](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

The job calls the read-only GoatCounter API with its Actions secret and pulls Postiz analytics with `POSTIZ_API_KEY`. It commits only aggregate counts, public post IDs, measurement timestamps, range/status metadata, and a run record. No model is called. The site token is available only to the measurement step.

GoatCounter requests cover the project start through the last complete hour. Feed visits exclude `/machine` and events. Post views and saves include only known published post IDs. Pagination must finish before save totals are published. The job preserves an independently measured feed-view total if event retrieval later fails. [API endpoints and response fields](https://www.goatcounter.com/api.html).

To disable website tracking, remove `GOATCOUNTER_SITE` and run **Publish Pages** again. Remove `GOATCOUNTER_API_TOKEN` to revoke this job's API access. Existing public aggregate records remain in GitHub history.
