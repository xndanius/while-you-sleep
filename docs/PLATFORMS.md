# Social publishing setup

Verified against official documentation on **10 October 2026**. The v2 brief governs this setup: GitHub Actions runs the brain, GitHub Pages serves the public feed, and a hosted publishing service handles social OAuth. Danielius connects accounts and approves the subscription; the loop supplies checked posts.

## Chosen service

**Postiz Cloud Standard**, billed monthly at **US$29 before tax**, includes five channels, unlimited posts, API access and analytics. Three channels cover X, Instagram and a LinkedIn Page. A seven-day trial is available. The checkout determines the euro total; $29 is a price near the brief's €30 target, not a guaranteed €30 total. [Official pricing](https://postiz.com/pricing)

Postiz holds the platform developer apps and approvals. Danielius authorizes the accounts through OAuth; he does not create X, Meta or LinkedIn developer apps. Paid subscriptions renew automatically, and applicable taxes are additional. [Service terms](https://postiz.com/terms-of-service)

Buffer is cheaper at $6 per channel monthly, but its API page says analytics are still coming, so it does not yet cover the requested daily measurement loop. [Buffer plans](https://support.buffer.com/article/595-features-available-on-each-buffer-plan), [Buffer API](https://buffer.com/api)

Use the Postiz API route. It receives the exact checked text and media from GitHub Actions. This project does not enable Postiz's AI generation, RSS rewriting, repeated posts or engagement plugs.

## Stage 1 — X

Complete this stage and verify its first publication before moving to Instagram.

1. Danielius opens [Postiz Cloud](https://platform.postiz.com/), creates his account and chooses **Standard → Monthly**, reviewing the checkout price.
2. He creates or selects the While You Sleep X account. Suggested bio: `Autonomous research feed by Danielius. Real projects, evidence, small first steps. Automated writing and publishing.` Put the deployed feed URL in the profile website field.
3. In Postiz, open **Calendar → Add Channel → X**. On X's authorization screen, select the intended account and approve access. Return to Postiz and confirm its avatar appears without a red attention marker. [Official connection guide](https://docs.postiz.com/general/channels/connect)
4. In Postiz, open **Settings → Developers → Your API key** and copy the public API key. This is the key for Danielius's own automation; do not create a Postiz OAuth app. [Developer settings](https://docs.postiz.com/general/settings/developers)
5. In the `while-you-sleep` GitHub repository, open **Settings → Secrets and variables → Actions → Secrets → New repository secret**. Set **Name** to `POSTIZ_API_KEY`, paste the key into **Secret**, then click **Add secret**. Never paste it into chat, a repository file or a command shown in logs. [GitHub's secure fields](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets?tool=webui)
6. Run the repository's publishing workflow against the checked posts. Confirm the workflow saves a service receipt, then confirm Postiz and the X profile show the same post. A receipt marked `submitted` means Postiz accepted it; it becomes `published` only when the service reports publication.

X receives a short original summary with the first small step and “Sources + full loop: bio.” The adapter removes outbound URLs, mentions and cashtags, and marks the post as AI generated using Postiz's supported `made_with_ai` setting. [X provider schema](https://docs.postiz.com/public-api/providers/x)

If more than one X channel is connected, the adapter stops with `ambiguous_channel`. Copy the intended public channel ID from the read-only channel listing into the optional `POSTIZ_X_CHANNEL_ID` repository variable under **Settings → Secrets and variables → Actions → Variables → New repository variable**. Do not resolve ambiguity by guessing.

## Stage 2 — Instagram

Start after X is confirmed working.

1. Danielius creates or selects the While You Sleep Instagram account. It must be a public **Creator or Business** account; Postiz cannot publish to a personal account. Use the direct Instagram connection, called `instagram-standalone` in the API. [Postiz's Instagram requirements](https://postiz.com/paperclip/instagram)
2. To convert a personal account in the Instagram app, open the profile's **☰ → Account type and tools → Switch to professional account**, choose the category and select **Creator**. Follow Instagram's remaining prompts. [Instagram's official instructions](https://www.facebook.com/help/instagram/2358103564437429)
3. In Postiz, open **Calendar → Add Channel → Instagram (Standalone)**, approve through Instagram and finish the redirect. This route uses Instagram Login and does not require a Facebook Page. [Connection guide](https://docs.postiz.com/general/channels/connect), [Meta Instagram Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login)
4. Add the public feed URL to the Instagram profile and use the same automation disclosure. Leave `POSTIZ_API_KEY` in GitHub; no second credential is needed.
5. Run the checked-post publishing workflow and verify one image and its complete caption on the Instagram profile. The adapter uploads the hosted JPEG to Postiz, then submits the resulting media receipt. [Upload from URL](https://docs.postiz.com/public-api/uploads/upload-from-url), [Standalone post settings](https://docs.postiz.com/public-api/providers/instagram-standalone)

If two Instagram channels exist, set `POSTIZ_INSTAGRAM_CHANNEL_ID` to the intended public channel ID. A red marker means reconnect the channel before retrying. [Channel management](https://docs.postiz.com/general/channels/manage)

## Stage 3 — LinkedIn Page

Start after Instagram is confirmed working. The v2 destination is the **While You Sleep Page**; the loop's normal route does not select a personal LinkedIn profile.

1. Danielius creates or selects a LinkedIn Page he administers. [Postiz's Page requirements](https://postiz.com/paperclip/linkedin)
2. In Postiz, open **Calendar → Add Channel → LinkedIn Page**, authorize with Danielius's LinkedIn account, select the While You Sleep company/Page in the follow-up screen, and finish **Continue integration**. [Official connection guide](https://docs.postiz.com/general/channels/connect)
3. Confirm the connected channel's identifier is `linkedin-page`. If multiple Pages are connected, set `POSTIZ_LINKEDIN_PAGE_CHANNEL_ID` to the intended public channel ID. The adapter never substitutes a `linkedin` personal-profile channel. [Page API settings](https://docs.postiz.com/public-api/providers/linkedin-page)
4. The weekly Monday digest copies published, independently checked summaries. A deterministic validation binds its exact text and included post hashes before the publish job submits it. Verify the first digest on the Page. Ordinary daily ideas return `weekly_digest_pending` for LinkedIn.

## What runs after connection

The publish step runs no model. It reads committed posts, verifies the matching checker record, original draft, source snapshot and content hash, and calls `publishSocial`. X and Instagram receive each daily idea; the LinkedIn Page receives the weekly validated digest. Postiz's `type: now` operation returns its internal post ID. The publisher skips existing `submitted`, `published` or `publication_unknown` receipts. [Create-post contract](https://docs.postiz.com/public-api/posts/create)

Before any send, the workflow commits an immutable reservation to GitHub. After the send, it commits safe service receipts. A reservation without a final receipt holds future sends for reconciliation, including when a runner stops between the request and its receipt commit.

A lost response during a create request produces `publication_unknown`. Check Postiz before retrying; an automatic retry could publish twice. Missing credentials produce `pending_setup`. A changed claim or source after approval produces `blocked_unchecked` before any network request.

Daily measurement calls the service's post and channel analytics endpoints. It preserves the reported history and latest available sample. Empty or restricted data remains `unavailable`; an explicit measured zero remains zero. Metrics and publication receipts contain no OAuth tokens or provider response bodies. [Post analytics](https://docs.postiz.com/public-api/analytics/post), [Channel analytics](https://docs.postiz.com/public-api/analytics/platform), [Publication listing](https://docs.postiz.com/public-api/posts/list)

The API base is `https://api.postiz.com/public/v1`. Its authorization header is the API key itself, without a `Bearer` prefix. Cloud create-post requests are limited to 100 per hour, well above this feed's cadence. [API overview](https://docs.postiz.com/public-api/introduction)

| GitHub Actions name | Purpose | Required |
| --- | --- | --- |
| `POSTIZ_API_KEY` | Postiz publishing and measurement credential | Once X is connected |
| `POSTIZ_X_CHANNEL_ID` | Public repository variable selecting X when several channels exist | Only for ambiguity |
| `POSTIZ_INSTAGRAM_CHANNEL_ID` | Public repository variable selecting Instagram when several channels exist | Only for ambiguity |
| `POSTIZ_LINKEDIN_PAGE_CHANNEL_ID` | Public repository variable selecting the intended LinkedIn Page | Only for ambiguity |
| `PUBLIC_BASE_URL` | Deployed Pages base URL used to resolve public JPEGs | Workflow configuration; not a secret |
| `SOCIAL_PROVIDER` | `postiz`, the default | Optional configuration |

The API key does not expire automatically; rotate it in Postiz and replace the GitHub secret if necessary. Channel OAuth can expire independently; reconnect in Postiz when its channel shows attention. [Developer settings](https://docs.postiz.com/general/settings/developers), [Connection markers](https://docs.postiz.com/general/channels/connect)

## Adapter contract

```js
import { publishSocial, prepareDigest, measureSocial } from '../integrations/social.mjs';

// The publish job first validates the committed check file and source snapshot.
await publishSocial(post, process.env, {
  verification: {
    passed: true,
    postHash: post.contentSha256,
    checkerRunId: post.checker.checkerRunId,
  },
  receipts: previousReceipts,
});

// Preparation creates a draft, not permission to publish it.
const digest = prepareDigest(checkedPosts);
// Submit only after the checker binds text + postIds + postHashes to its digestHash.
await publishSocial(null, process.env, {
  platforms: ['linkedin'],
  digest,
  digestVerification: { passed: true, digestHash: checkedDigestHash, checkerRunId },
  receipts: previousDigestReceipts,
});

await measureSocial([{ postId: post.id, social: publicationReceipts }], process.env);
```

`env` may be an object or a function that returns an environment value by name. `options.dryRun: true` and a supplied safe channel list prepare payloads without uploads or post creation. `publishedPostHash` uses sorted JSON keys and excludes only top-level `checker`, `contentSha256`, `metrics`, `publicUrl` and `imageUrl`; the upstream checker binds the source snapshot separately.

## Direct API fallback retained from v1

The direct adapters remain dormant unless `SOCIAL_PROVIDER=direct` is deliberately selected. They do not remove the checked-post gate. No developer accounts or credentials were created during this build.

- **X:** User-context OAuth 1.0a or OAuth 2.0 is required. Current pay-per-use write pricing is $0.015 for a normal post and $0.200 for a URL post. Optional paid recent search is disabled by default and has a per-call budget cap. The service route avoids Danielius managing these apps and credits. [X pricing](https://docs.x.com/x-api/getting-started/pricing), [User authentication](https://docs.x.com/x-api/posts/manage-tweets/introduction)
- **Instagram:** Instagram Login supports Creator/Business accounts without a Facebook Page. The direct adapter creates a media container from a public JPEG, polls it, and publishes only after processing finishes. The API permits up to 100 published posts in a rolling 24-hour window. [Meta publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing)
- **Tokens:** Direct Instagram long-lived tokens last 60 days and can be refreshed once at least 24 hours old while unexpired. `refreshInstagramToken` returns a secret to a private caller; never persist its response in public feed data or logs. [Meta login and tokens](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)
- **Personal LinkedIn:** The fallback is a draft for Danielius's approval. It publishes only when `options.linkedinApproval` equals the ID derived from that exact digest. `w_member_social` permits posting for the consenting member, and normal access tokens expire after 60 days. This is separate from the v2 hosted LinkedIn Page flow. [Share on LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin), [Token lifetime](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)

The v1 brief's direct X prices and Instagram 100-post limit remain consistent with current official docs. V2 changes the setup route to Postiz Cloud and the LinkedIn destination to a Page. It also moves secrets and scheduling from Netlify to GitHub Actions.

Offline verification: `node --test integrations/social.test.mjs`. Tests cover content tampering, source tampering, duplicate prevention, uncertain publication, public media validation, channel ambiguity, Page-only digests, missing analytics, private provider errors and direct fallback authorization.
