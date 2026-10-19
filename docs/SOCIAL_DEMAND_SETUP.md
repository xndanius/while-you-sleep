# Official social demand inputs

Implemented on 19 October 2026. Both integrations are off when their secrets are absent. They are optional inputs; public job, tender and request feeds continue without them. No scraper, alternate RSS host, proxy, user password or copied browser session is used.

## Reddit: Dan's setup

1. Sign in to the existing Reddit account. Open Reddit's [Data API access request](https://support.reddithelp.com/hc/en-us/requests/new?ticket_form_id=14868593862164). Describe the project accurately: a public educational business-idea channel, read-only searches for recurring nontechnical business chores, a separate AI fact checker, no private messages, no profiles, no training or model fine-tuning, and only minimal anonymous task excerpts with public source links. State the public Git evidence-retention design and ask whether that retention and AI-assisted editorial use are approved. Request the scope the project actually needs. If the use is commercial, obtain written commercial-use permission; an ordinary app registration is not that permission.
2. Wait for explicit approval covering this use. Reddit's [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy) requires approval before Data API access. The [Data API overview](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data) distinguishes developer, commercial and academic-research access. Do not describe this channel as a moderation tool or academic research to obtain unrelated access.
3. Follow Reddit's approved-app instructions. For an approved confidential script or web app, open [app preferences](https://www.reddit.com/prefs/apps), choose **create another app**, name it **Autonomous Startup Ideas**, and choose **script** if that is the type Reddit approved. Use the project homepage for its about URL. If the form requires a redirect URI, use `https://xndanius.github.io/while-you-sleep/`; the application-only flow never uses a browser redirect. The client ID is the short identifier below the app name; the other value is labelled **secret**. Reddit may require its access application before this form is available.
4. Open the repository's **Settings → Secrets and variables → Actions → Secrets → New repository secret**. Save the client ID as `REDDIT_CLIENT_ID` and the app secret as `REDDIT_CLIENT_SECRET`. Enter the values only in GitHub's private secret UI.
5. Under **Variables**, add `REDDIT_API_ACCESS_APPROVED` with value `true` only after Reddit has approved the described use and retention. Leave it absent while approval is pending. No account password or refresh token is needed.

The implementation uses the documented [application-only OAuth flow](https://github.com/reddit-archive/reddit/wiki/OAuth2#application-only-oauth): a short-lived token obtained with confidential client credentials, then read-only requests to `oauth.reddit.com`. It searches public posts, rejects mature/deleted/removed material, retains only complete privacy-safe task sentences and a public post identity, and independently re-reads exact post IDs for the checker. It never requests profiles, voting, posting or private-message permissions. An unavailable or removed post supplies no independent approval. Approval and use remain subject to Reddit's current terms; the public source does not imply a right to retain deleted content forever.

The recovery release currently feeds these optional API results to the writer as separately sealed discovery hints. They do not acquire the ordinary public-feed registry's demand authority. A proposed post still needs a separately fetched and independently checked public job, tender, pricing page or review; neither an approved Reddit API call nor an xAI answer silently replaces that requirement.

## X through xAI: Dan's setup

1. Open the existing [xAI API console](https://console.x.ai/). Select the intended team/project and ensure it has API access and billing. This is an API key, separate from a Grok chat subscription.
2. Create a key for **Autonomous Startup Ideas — X discovery**. Keep it private. In GitHub's repository secret UI above, save it as `XAI_API_KEY`. The collector uses the official Responses API with the `x_search` tool; it does not require an X developer app or an X account password.
3. Dan explicitly selected a cap of **100 posts entering this loop per Vilnius day**. The default `XAI_INGESTION_CAP_MODE=ingested` expresses that policy; the variable may be omitted. Any other value disables X retrieval. Every request reserves ten ingestion slots before a network call; unsuccessful requests consume their reservation, and an exact repeated run/phase is skipped. Thus at most ten reserved requests and at most 100 returned records can enter the loop per day. Source/candidate selection still admits at most ten leads in an hourly batch.

This ingestion cap is **not a cap on posts fetched internally by xAI**. Its current [X Search documentation](https://docs.x.ai/developers/tools/x-search) exposes date/handle filters and usage counters, but no hard fetched-post limit. The [tool usage documentation](https://docs.x.ai/developers/tools/tool-usage-details) states that a turn can include multiple tool calls. The collector limits its requested answer to ten, one turn and no parallel calls, and records the provider's actual fetched-post/profile counts. These settings do not prove a provider-side maximum. Provider tool charges and model tokens remain separate from the loop's ingestion count; see [current official pricing](https://docs.x.ai/developers/pricing).

xAI returns a model answer with cited URLs rather than exposing its raw server-side search results. Therefore every X item is explicitly **discovery only**, with `evidenceAuthority=model_cited_summary_not_primary_quote` and `role=building`. It cannot by itself satisfy a factual demand quote or an independent demand approval. Its public linked job, tender, pricing page or review must be fetched and independently checked as the demand signal. Uncited posts and oversized result batches are rejected, never silently promoted to primary evidence.

## Hosted wiring and trust boundaries

Only trusted retrieval jobs receive the three API secrets. The writer, checker and repair models receive the privacy-checked artifact, never these secrets or an API token. Retrieval jobs use the existing record concurrency group. Before an X request, the collector commits and pushes its immutable ten-slot reservation under `data/social-demand-quota/`; it refuses hosted requests if persistence fails. Quota rows contain no key, account or raw response.

The commands are:

```sh
node scripts/collect-social-demand.mjs "$RUN_ID" research
node scripts/collect-social-demand.mjs "$RUN_ID" check
```

The first produces `.run/social-demand-research.json`. The second reads only social references from the original research snapshot and produces `.run/social-demand-check.json` from independent requests. Both expose `social_demand_path`, `social_demand_sha256`, `social_demand_head_sha` and `social_demand_sources` as job outputs. Expected job names are `social_research` and `social_check`; the producer binds repository, workflow, run, attempt, job and code head. Consumers call `loadSocialDemandArtifact` using the trusted job's exact hash and producer expectations. Merely placing a JSON file in a model workspace grants no source authority.

Only canonical public post identities, bounded task excerpts, provider aggregate usage, source/result hashes and immutable quota/retrieval receipts cross this boundary. API errors are recorded as static reasons without upstream bodies or credentials. Missing credentials are shown as disabled, not as a failed source or fabricated demand.
