# One-candidate research continuation — local prototype

These are local, offline replay entry points for the shared continuation planner.
They do not dispatch work or fetch URLs. The production integration is documented
in docs/RESEARCH_CONTINUATION_2026-10-28.md.

`candidate-research.mjs` re-exports the shared lib/candidate-research.mjs, which derives immutable, serializable dossiers from an exact
completed no-post bundle. It reuses the current completion, source, learning,
plan, privacy, literal-demand-quote and fixed-reference validators. A dossier
retains the full original candidate, proposed experiment, source packet, all
unresolved limitations and hashes of the original records. Its reference requests
come only from the existing fixed catalog and have a maximum of two. Requests
are not new evidence or score approvals.

The planner returns one already eligible candidate, using the existing selector
and the original cooldown. It will not nominate a currently excluded or already
published URL. Producing a plan is idempotent and does not consume an attempt.
An intact later completed bundle can show an actual documentation attempt or
available capability; duplicate plans or forged/unverified later records cannot.

## Reproduce without network access

From the repository root:

```sh
node --test tests/candidate-research-prototype.test.mjs
node prototypes/plan-candidate-research.mjs loop-40734809732-1 2026-10-28T20:29:00.000Z /tmp/wys-csv-research-plan.json
```

The second command replays a frozen historical snapshot at an explicit time.
It is not a prediction of current source eligibility or an automatic run. Existing
different output files are never overwritten.

## Fixed evaluation split and result

- Development case407348/325109: retain the exact CSV plan and request existing
  CSV extraction plus persistent deduplication documentation.
- Separate regression case405498/118145: request array mapping, not its previously
  supplied error-handler reference. Actual later406005 evidence demonstrates
  that a requested capability can become available while publication remains0.
- Separate regression cases407435/118271 and325081: preserve unresolved image
  and booking limitations, request nothing under the current catalog. No matcher
  expansion was added to make these pass.
- Three vague HN exclusions do not become invented candidates.
- Before cooldown expiry or after publication: no research priority.
- Tampered original records/dossiers and arbitrary reference URLs: rejected.
- A fixture-only fetch through the existing enrichment pipeline makes one native
  source request and two documentation requests. It yields actual extracted
  fixture text, rather than changing the plan's wording. These are synthetic
  HTTP responses, not live docs or an executed customer workflow.

These are previously discussed frozen regression cases, not unseen or blinded
evidence of general improvement. Scores and publication outcomes are unchanged.

## Production boundary

The existing loop now archives an intent before acquisition and a separate result
before model access. Only the trusted scheduled research code applies priority;
this replay CLI remains advisory and uses frozen inputs. Current scan/selection
bindings, source cooldown and a fresh primary fingerprint must all pass before
fixed-reference priority is active. Missing terminal results are unknown and park
the gap; they never become completed work. The writer receives a prior proposed
plan only after completed acquisition, and still needs fresh independent checks.

No change to the 6/10 threshold, privacy limits, source authority, cooldown,
historical receipts or number of model invocations is made.
