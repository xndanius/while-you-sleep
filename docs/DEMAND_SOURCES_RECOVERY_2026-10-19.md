# Public demand recovery — 19 October 2026

Five new fixed public demand adapters passed real bounded HTTPS, DNS, robots and complete-response validation locally. All five also freshly reconstructed an exact sampled item through the original public feed/API, without a login or secret. They are ready for the normal hosted registry bootstrap; these local checks are not described as hosted admissions.

| Feed | Current retained items | Concrete task excerpts | Purpose |
| --- | ---: | ---: | --- |
| EU TED, English service competition notices | 10 | 17 | Requested business services in public procurement |
| We Work Remotely, customer support | 20 | 51 | Paid nontechnical support operations |
| We Work Remotely, management and finance | 13 | 36 | Paid finance, reporting and administration |
| We Work Remotely, sales and marketing | 20 | 49 | Paid content, marketing and reporting tasks |
| WooCommerce public support requests | 20 | 38 | Merchant order, invoice, inventory and reporting problems |

The recorded sample contains 83 source records and 191 retained literal task excerpts; a record may also appear in another category feed, so these totals are not presented as a cross-feed unique-demand count. A task excerpt is evidence of a documented chore, not proof that the proposed AI service has customers or revenue. All complete source records and fresh reconstructed samples pass the existing privacy detector. Exact bounded validation metadata, sampled-record digests and fresh item identities are in [the probe receipts](DEMAND_SOURCE_PROBES_2026-10-19.json).

## Access and attribution

- [TED Search API](https://docs.ted.europa.eu/api/latest/search.html) explicitly permits anonymous published-notice search. The only POST target is `https://api.ted.europa.eu/v3/notices/search`, with a fixed projection and bounded query. It selects English competition notices, CPV business services, newest publication first, and requires an explicit public deadline that has not elapsed. The API's ACTIVE scope alone does not establish an open bidding period. Only notice identity, publication/deadline status and literal task descriptions are retained. Buyer/contact/organisation fields are not requested or stored. `checkQuerySyntax` must be false to actually retrieve records; true validates without retrieving records. Fresh checking uses the exact publication number through this same official API. The TED HTML site's robots endpoint returned HTTP 429 during the investigation; its pages are not scraped or used to bypass that refusal.
- [We Work Remotely's official RSS page](https://weworkremotely.com/remote-job-rss-feed) explicitly offers the category feeds for reuse with attribution and canonical links. The adapter uses the provided RSS descriptions, not scraped job-page HTML. Fresh checking reads the original feed and reconstructs the exact advertised item. Personal contacts, author/company objects and recruitment instructions are omitted; only whole safe task excerpts are retained. A vacancy establishes requested human work, not payment to an AI service.
- [WordPress's public support forums](https://wordpress.org/support/) expose [the WooCommerce feed](https://wordpress.org/support/plugin/woocommerce/feed/). The [WordPress.org terms](https://wordpress.org/about/terms/) apply. Only short task excerpts, topic identity and date are retained, with the canonical source link. Author, profile, signature and contact fields are never copied. A request documents a merchant problem; willingness to pay remains an explicit hypothesis.

## Existing UK tender rechecks

The original Contracts Finder endpoint did not produce a valid bounded response during the recheck: the request timed out, and the old fetcher's attempt to mutate the abort exception masked the timeout. The shared fetcher needs to preserve a safely wrapped error rather than assigning a read-only exception message. No successful admission or reactivation is claimed.

The original Find a Tender endpoint returned HTTP 200 with an allowed robots decision, but its current bounded response contained no item passing the existing current active-service adapter. It remains retired unless a new real guarded validation yields eligible items. Neither old source is reactivated by overriding an access or parser failure.

## Safeguards and focused verification

New sources have fixed four-field definitions and distinct demand roles. The existing source guard, registry cap, admission schema, 6/10 scoring threshold, fresh independent demand/claim/score checks and 14-day semantic novelty checks remain intact. New TED notices, job advertisements and merchant requests retain distinct item identities on shared hostnames; they do not all collapse into one vendor-domain product. True repeated products, workflows and customers still face the existing duplicate checks.

Thirty-eight focused demand, novelty and discovery tests pass, covering public feed privacy, literal tasks, current notices and deadlines, refused/changed sources, exact fresh item reconstruction, fixed TED POST scope, prohibited personal fields, per-item novelty identity and the zero-discovery regression. No model was called and no registry record was fabricated in this verification.

## Discovery can explore without a prior success

The old discovery path depended on repeated high-scoring publications or an untried finite seed list. Once all initial seeds had an admission or exclusion, zero publications meant zero new domains and therefore zero probes indefinitely.

A separate ten-entry public demand exploration pool now rotates daily. It includes other nontechnical/creative job feeds and public requests for invoice exports, order exports, shipment tracking, forms, appointments, newsletters and recruitment administration. These are candidates, not admissions. They are not included in operator bootstrap. Each still needs a real guarded probe and probation admission; the unchanged durable ledger permits at most three automatic probes per Vilnius day, including failures.

After the fixed pool is exhausted, literal alternate RSS/Atom links on successful demand origins remain eligible for guarded discovery. Unvetted feeds retain building-role authority until an actual fixed demand adapter supports them. Old failed exclusions may be probed again after seven days, with a new quota-counted immutable receipt. Existing active, probation and retired registry entries stay unavailable to new-source discovery; retired reactivation is not silently authorized and historical records are unchanged.
