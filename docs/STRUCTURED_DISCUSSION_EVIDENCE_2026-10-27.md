# Bounded discussion input examples

The original Make topic <https://community.make.com/t/118145> contains an input
array that the previous single-sentence extractor discarded. The automatic
11:07 UTC cycle (`40493906767`) therefore assessed a narrower snapshot than the
public original post. Its historical no-post receipt and scores remain intact.

The native Discourse adapter now optionally retains one complete named numeric
array from the original first post. It copies a contiguous span after the same
HTML/entity/whitespace normalization as the main excerpt. It neither parses and
reserializes the values nor joins separated selected fields. Main task and
example together remain at most 200 characters. The original task text,
assignment, task count, segment and cooldown fingerprint are unchanged.

The optional `taskExample` has an exact versioned shape, a literal-text SHA-256,
privacy checks and the existing independently fetched native-source stamp.
RSS discovery, replies, HN and provider captures do not gain this field. Each
fresh original-post read recreates or removes it. Writer preparation, checker
preparation and the last publication check use the same extraction path.
Claim and score quotes must occur wholly in one valid span; demand and omitted
candidate quotes still require the main task text. An absent or changed live
example cannot satisfy the earlier quote.

A guarded read at 2026-10-27 11:25:23 UTC verified that this topic retains its
108-character task plus a 72-character numeric array, 180 characters total.
Both values were copied unchanged; the existing source contract passed and the
cooldown fingerprint stayed identical. Only sanitized bounded evidence was
saved in the local audit, not the full response or personal/profile fields.

This fixes loss of an available input example. It does not prove a tested
solution, recurring commercial demand, payment or a qualifying score. The
6-point threshold, independent assessment, original posts and historical
receipts remain unchanged. No model cycle was dispatched to obtain a post.

Validation: `npm test` passed all 737 tests, including 12 new extraction,
privacy, freshness, scoring and actual-publisher regressions. The isolated
publisher accepts the synthetic valid fixture, but blocks both a missing and
a changed example on its final native reread. `npm run check`,
`npm run build` and `git diff --check` passed. No separate lint or TypeScript
command exists in this JavaScript repository.

The recorded 11:07 assessment remains `completed_no_post` at 3.8 for this
candidate. Its unchanged task fingerprint keeps the existing three-hour
cooldown: it can become eligible after 14:14:44 UTC, subject to the current
feed, ordinary selection and an actual fresh independent assessment. Retaining
an input array does not establish the previous score was wrong or authorize a
historical revision. Corroborating anecdotes and an offline mapping test also
do not prove an external endpoint, persisted invoice or tax correctness.
