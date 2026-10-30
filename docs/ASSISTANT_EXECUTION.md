# Assistant execution provenance

Assistant-managed work uses `assistant-…` run IDs. It is not an
`openai/codex-action` run and must not invent a GitHub run URL, API usage, model
identity, or successful experiment. The existing paid workflows stay disabled.
This change neither schedules work nor publishes a candidate on installation.

## Trusted boundary

The controlling operator records the actual writer and independent review
task/turn IDs and times from the execution runtime, outside the writer's output.
A different turn or a different surface label on the same task is not an
independent reviewer. The checker receives the frozen draft and independently
prepared evidence context; it returns the existing checked manifest format.

The following version-1 runtime receipt is used separately for each role:

```text
schema: 1
role: writer | checker
runId: the same assistant-… ID
actor:
  surface: codex | chatgpt
  taskId: actual runtime task UUID
  turnId: actual runtime turn ID
startedAt: actual UTC ISO timestamp, with milliseconds
completedAt: actual UTC ISO timestamp, with milliseconds
inputSha256: writer=research; checker=check-context
outputSha256: writer=draft; checker=accepted manifest
```

All hashes use `sha256(stableJSON(parsedJSON))`, except `rulesSha256`, which
hashes the exact RULES.md text. They are not hashes of pretty-printed JSON.
The operator pins each runtime receipt before invoking the registration command:

```text
node scripts/register-assistant-check.mjs RUN_ID WRITER_RECEIPT_FILE CHECKER_RECEIPT_FILE WRITER_RECEIPT_SHA256 CHECKER_RECEIPT_SHA256
```

The command reads the existing `data/drafts`, `data/research`,
`data/check-context`, and `data/checks` files for that run. It writes only
`data/assistant-executions/RUN_ID.json`. It makes no network/model calls and
does not publish or change the manifest. An identical retry returns the original
record; conflicting evidence or receipts fail without replacing it.

These records are **host attestations**, not cryptographic authentication by
the Codex/ChatGPT service. A JSON file or two different labels alone does not
prove who executed the work. The trusted operator must retain the runtime
evidence and must never accept identity/timestamp declarations from the writer
as that evidence. The receipt hashes prevent changes after that boundary.

## Checks and later publication

Registration requires the current complete assessment, demand, novelty and
candidate-source contracts, current exact RULES, threshold 6 and all five
weights equal to 1. It rechecks privacy (including checker comments), each
candidate's source IDs, source/runtime chronology, the complete novelty index,
deterministic post checks and the unrounded score. A rejected or below-threshold
proposal remains rejected. A valid registration is not permission to publish.

The existing source selection/cooldown process and `prepareLoop` reservation
remain prerequisites. An assistant host can use the existing local gate with
the actual scheduled event and no GitHub run ID; it must not forge an Actions
event, bypass a pending reservation, change the cadence, or shorten cooldown.
The registration command does not perform selection or acquire those rights.

When separately authorized, `publish-checked.mjs` accepts the host-pinned
execution via `ASSISTANT_EXECUTION_SHA256`. It requires a matching existing
reservation and a host execution outside GitHub Actions. The original fresh
source, exact quote/reference, daily cap, date/slot, novelty, privacy and
independent approval gates remain in force. Missing or changed provenance
fails before publication. The recorded writer/checker identity and times are
the actual receipt values; unreported usage remains null, not zero API cost.
The synthetic internal checker ID is only a stable key derived from the
recorded actor; it does not replace that actor's task and turn IDs.

Assistant posts carry the integrity-protected scope
`{website:true,rss:false,social:false}`. Their pages remain visible and count
for novelty and duplicate checking. They are excluded from `feed.xml`, from
curation, and from `best.xml`; an injected pick fails. No relay is activated.
Historical records without this new envelope keep their original contract.

## Verification

`tests/assistant-provenance.test.mjs` uses invented, explicitly synthetic task
IDs, source content, timestamps and isolated temporary files. It tests corrupt
pins, same-task reviews, time ordering, privacy, missing sources, altered
approved content/scores, low-score and negative decisions, immutable retries,
RSS isolation, and the actual publisher with an exact offline native-forum
transport. The fixture is not a production candidate or evidence of real
customer demand, executed integration, publication, or recovery.
