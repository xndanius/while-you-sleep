# Historical repeat audit — 14 October 2026

This audit compares the live public feed, immutable published JSON, current duplicate gates and durable RSS-selection records. It made no model calls, placed no orders and changed no original post, publication URL, RSS GUID, publication date or historical receipt.

## What repeated

These are two tools for substantially the same proposed support-inbox business loop:

| Published · Vilnius | Original checked post | Product | Original content SHA-256 |
| --- | --- | --- | --- |
| 11 Oct 2026, 20:15:34 | [A human checked support inbox loop](https://xndanius.github.io/while-you-sleep/p/e20bcacf021524725d3fc275/) | n8n | `bd7b87ce08f86736bcdaeabbab4686ac3b0e889c60b987612bc4a77f7293008e` |
| 11 Oct 2026, 23:31:22 | [A small AI support inbox loop](https://xndanius.github.io/while-you-sleep/p/98b4f6281cc3de4ecdfa95f6/) | Auxx | `2a0a33b3585bd9f622c7223a8ed6eddd7069666d828ea302207d91ef3ed818c3` |

Both propose classifying support messages, drafting a reply from approved material, having a person decide whether to send it, and recording the outcome. Both suggest an online shop or support team as a hypothetical customer. Auxx additionally retrieves customer records; the original tools and wording differ. They are a historical semantic repeat, not identical post bytes or a repeated public ID.

The original cloud runs are [38158686735](https://github.com/xndanius/while-you-sleep/actions/runs/38158686735) and [38172337873](https://github.com/xndanius/while-you-sleep/actions/runs/38172337873). Their independent checks predate the semantic-memory requirement. Their content fingerprints still verify.

## Why it passed then and what blocks it now

The earlier deterministic gate compared canonical product URL, product-derived candidate identity and normalized title. Different product URLs and titles let these two examples through.

[Commit 57275e6](https://github.com/xndanius/while-you-sleep/commit/57275e6ec9979007de2cc3e6c0ced8bf682962cb), 12 October 2026 at 11:04 Vilnius, added frozen fourteen-day product, workflow and specific-customer memory plus a separate independent novelty verdict. It deployed in [Pages run 38221355573](https://github.com/xndanius/while-you-sleep/actions/runs/38221355573). The current deterministic guard identifies the actual pair in both directions as `support_inbox` workflow and `online_retailers` customer overlap. The publisher repeats this guard against the current committed posts before publishing.

No new threshold, weakened checker or changed novelty window was introduced in this audit. Equal broad categories can produce conservative matches; the AI-agent reliability, coding-feedback and developer-documentation posts are different tasks, so they have not been labelled as historical duplicate businesses merely because a broad category matches.

The later support post now carries a visible “Another tool for the same support-inbox loop” annotation and a link to the earlier post. The bounded metadata in `public/historical-overlaps.js` binds the exact original ID, content hash and publication date. Both checked source records remain available.

## The website and RSS did not repeat an identity

At the audit snapshot, [api/feed.json](https://xndanius.github.io/while-you-sleep/api/feed.json) returned 200 with **7 posts and 7 distinct IDs**. [feed.xml](https://xndanius.github.io/while-you-sleep/feed.xml) returned 200 with **7 items and 7 distinct GUIDs**. Their IDs agreed. The website replaces its rendered post list on refresh; it does not append copies. A regression exercises repeated identical refreshes and then an updated feed, confirming each post still appears once and result counts remain correct.

RSS generation preserves each original GUID and publication date on rebuild and rebranding. It rejects a duplicate published ID instead of writing it twice. A selection receipt cannot pick an already selected post again.

## LinkedIn: confirmed source state, unknown publication duplicates

At the audit snapshot, [best.xml](https://xndanius.github.io/while-you-sleep/best.xml) returned 200 with **0 items**. All five available durable curation receipts were terminal empty decisions; none selected a post. The recorded Zapier switch to `best.xml` was human-confirmed on 11 October at 18:46:06 Vilnius, before either support post was published. The original LinkedIn post was human-confirmed earlier that day; LinkedIn metrics and per-post relay receipts are not connected.

This evidence establishes no twice-selected idea and no duplicate GUID in either source feed. It does **not** establish what appeared on LinkedIn, what a Zap rerun did, or whether LinkedIn displayed an older repeated post. No unsupported claim of a repaired or duplicate-free LinkedIn relay is made. An actual LinkedIn duplicate would need its two post URLs and Zapier task history for diagnosis.

## Verification

Regression coverage uses both immutable historical support posts, preserves their content fingerprints, tests the annotation’s exact identity binding, confirms feed-refresh idempotence and retains existing novelty, RSS-GUID and once-only selection checks. The audit changes only presentation metadata, annotation, tests and this record.
