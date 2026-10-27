# Selected native forum reading context

The approved policy now distinguishes discovery/provider teasers from the
evidence read during assessment. Discovery and Apify/provider pools retain
their existing 200-character allowance. A selected native Discourse original
post can carry up to four exact privacy-safe spans, at most 1,200 characters
total, including its unchanged short task anchor. Public post copy retains the
25-word non-Reddit quotation limit. Ratings and the publication threshold do
not change.

The concrete failure was loss of available source context: the previous Make
118145 snapshot exposed only its mapping sentence and later one numeric array.
The original post also supplies the CRM/API context and related numeric arrays.
Their availability is distinct from successful Make execution, saved invoices,
tax correctness, commercial demand or payment.

`nativeReadingContext.version:2` is an explicitly validated body contract;
the existing discussion identity metadata remains version 1. It records the
topic and original-post identity, exact post permalink, creation/edit/fetch
times, normalization version, response and normalized-text hashes, and each
span's offsets and literal hash. Counts and omitted characters are checked.
Only original post number 1 is supported. Replies are deliberately outside
this first implementation because they require separate speaker/span citation
identity; no profiles or additional pages are fetched.

The normalizer processes visible text without running it, decodes entities
once and excludes hidden containers, nested quotations, image/lightbox
metadata and signatures. Unsafe blocks are omitted whole. Complete numeric
arrays/objects retain their original text; numbers are never parsed and
rewritten. The full source response is transient and is not passed to a model
or saved as an artifact. The packet itself contains only the retained spans
and non-personal integrity metadata.

Every independent checker read and final publication read reconstructs the
packet from the same guarded original-post route. The main `source.text`, task
excerpts, segment, assignment and cooldown fingerprint are unchanged. A fresh
missing packet removes the previous optional packet. Legacy `taskExample` and
the new packet cannot coexist. Native metadata that cannot establish the new
contract keeps only the old bounded evidence; it cannot acquire extra context
by assertion.

Only trusted pre-model enrichment opts a new selected source into version 2.
Later reads follow its sealed incoming version. A v1 source in an already
running batch therefore stays under its original body limit even if the
checker code is updated meanwhile; malformed v2 packets fail before retrieval.

Claims and scores may quote one validated span at a time. Demand and omission
feedback remain tied to the original task text. Quoted metadata, a response
hash, or joined excerpts are not factual support. Missing support in retained
spans must not be described as absent from the full original source. Packets
with omitted context disclose that limitation.

Historical files, scores, approvals and source receipts are not migrated or
rewritten. All prior fixtures remain under their original contract. New tests
exercise extraction, identity/time/hash/budget/privacy failures, one-request
native refresh, writer/checker preparation and the actual isolated publisher.
The actual automatic assessment after deployment remains a separate required
verification; a green deployment or valid no-post batch is not publishing
recovery.

Validation: all 760 tests passed, as did `npm run check`, `npm run build` and
`git diff --check`. The new coverage includes the actual checker preparation,
the inspector, and an isolated publisher that rejects missing or changed
context. A guarded read of the original Make post retained two safe spans
(1,014 characters), with 29 normalized characters omitted. The retained spans
include the CRM/Airtable context and net, VAT and gross arrays; the short task
and its cooldown fingerprint remained unchanged. This is source acquisition
evidence, not a new model verdict or a working-integration claim.
