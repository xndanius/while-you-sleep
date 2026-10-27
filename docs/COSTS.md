# Hosted model cost records

The trusted collector reads actual Codex CLI usage from completed GitHub model jobs. It does not call a model, use the OpenAI API key, or estimate tokens from post length. Each workflow attempt writes an immutable `data/usage/<runId>.json` record. The OpenAI invoice remains the authority for money charged.

The official pinned [Codex action execution code](https://github.com/openai/codex-action/blob/bdf19a4a223ec2549a3e2274a0cf61556bc07675/src/runCodexExec.ts) appends `codex-args` to `codex exec` and pipes stdout into the job log. [Non-interactive mode documentation](https://learn.chatgpt.com/docs/non-interactive-mode#make-output-machine-readable) describes `--json` and the top-level `turn.completed.usage` event. The [Codex event schema inspected for this build](https://github.com/openai/codex/blob/c3d3b142d10f4316b46e35aad7e5317e7e506cb7/codex-rs/exec/src/exec_events.rs) also contains optional cache-write and reasoning counts. The action currently installs the latest CLI; an incompatible future schema is recorded as unavailable instead of guessed.

The parser requires the action's `Running: ... codex exec ... --json` marker, a started thread, a started turn, and a valid top-level completion. It ignores `item.completed` contents, including tool or agent text that contains a fake usage event. Multiple CLI invocations, invalid numeric counts, missing completion, and failed turns are unavailable. Logs are held only in bounded memory; neither transcripts, error bodies, signed download URLs, nor credentials enter the committed record.

Recent GitHub CLI versions refuse log responses containing terminal escape sequences unless [`gh api --allow-escape-sequences`](https://cli.github.com/manual/gh_api) is set. The helper sets that flag only for validated job-log endpoints, captures the response in bounded RAM and removes terminal formatting before parsing. It never prints the raw response.

Only these exact GitHub job names are read:

| Workflow kind | Model jobs |
| --- | --- |
| `loop` | `writer`, `checker`, `repair`, `final_check` |
| `improve` | `propose`, `trials (baseline)`, `trials (proposal)`, `grade` |

The jobs endpoint is scoped to the current workflow run **and attempt**. Renaming a job requires updating the trusted allowlist. Explicitly skipped jobs are excluded from token sums. If GitHub omits a skipped job from its API response, the trusted workflow can supply `MODEL_JOB_RESULTS: ${{ toJSON(needs) }}`; only the exact known job's `result: skipped` proves it did not run. The improvement `trials` aggregate can prove both matrix jobs were skipped. Raw needs outputs are ignored and never persisted. A missing job or inaccessible log without independent non-execution proof, unfinished job, failed turn, or malformed usage leaves the workflow total unknown. When some counts were observed, `observedCounts` preserves that subtotal separately; it must not be presented as the complete day's bill. Unknown model names retain token counts but have `costUsd: null`.

A loop wrapper job can succeed even when its model step was skipped after failed source preparation. For the four fixed loop model-step names, a unique completed/skipped GitHub step in the exact run/attempt job list proves non-execution. The record stores only its bounded name, number and status, never raw logs. Any observed CLI usage takes precedence, and a started or failed invocation stays unknown when counters are unavailable. Missing step metadata is not skip proof.

When every expected model job has a verified skip proof, accounting is complete with six zero token/cost counters and `pricingStatus: no_model_invocation`. The README labels this as verified non-execution, not reported CLI usage. This does not make the writer or content assessment successful: source failures, unverified outcomes and learning rewards keep their existing meaning. Reconciliation may append an exact original-bound zero-usage correction but never rewrites the original usage or content history.

## Rate calculation

Rates verified on 10 October 2026 for `gpt-6-luna` Standard processing with prompts up to 272K tokens: $0.10 per million uncached input tokens, $0.01 cached input, $0.125 cache writes, and $0.50 output. [Official model pricing](https://developers.openai.com/api/docs/models/gpt-6-luna#pricing).

Cached input and cache writes are subsets of total input; reasoning is a subset of output. [Cache-write pricing replaces the corresponding input rate](https://developers.openai.com/api/docs/guides/prompt-caching#why-prompt-caching-matters).

```text
estimate USD = (
  (input - cached - cache_write) × 0.10
  + cached × 0.01
  + cache_write × 0.125
  + output × 0.50
) / 1,000,000
```

Older CLI events that omit the optional cache-write field retain `cacheWriteInputTokens: null` and label the estimate `reported_categories_standard_estimate`: that number prices the reported input/cache/output categories only. It does not establish cache-write adjustments. No missing token count is fabricated. Long-context requests, different processing tiers, regional premiums, and paid tool calls also require invoice reconciliation because cumulative CLI token totals do not establish those billing details.

## Workflow wiring

Every model action needs this input alongside the existing action settings:

```yaml
codex-args: '["--ephemeral", "--json"]'
```

Run the collector on a fresh trusted runner after all model jobs have finished. The existing loop `record` job and improvement `commit` job meet that separation; they need `actions: read` in addition to their existing commit permission. Keep the model API key scoped to the Codex action, absent from the collector job.

```yaml
permissions:
  contents: write
  actions: read
steps:
  # Existing trusted checkout and Node setup precede this step.
  - name: Collect actual hosted Codex token usage
    if: always()
    env:
      GH_TOKEN: ${{ github.token }}
      CODEX_MODEL: ${{ vars.CODEX_MODEL || 'gpt-6-luna' }}
      MODEL_JOB_RESULTS: ${{ toJSON(needs) }}
    run: node scripts/collect-usage.mjs loop "$RUN_ID"
```

For the improvement job, pass `improve` instead of `loop`. `GITHUB_REPOSITORY`, `GITHUB_RUN_ID` and `GITHUB_RUN_ATTEMPT` are provided by GitHub. The helper uses `gh api` GET requests only, with a fixed GitHub hostname and validated jobs/log endpoints. No token appears in command arguments or printed output.

Include the exact current `data/usage/<runId>.json` in the trusted commit allowlist. Generate the public machine and feed data by joining usage records to matching `runId`/`id`; keep the original run/version records immutable. Daily estimates should sum complete model usage records by `localDate` in Europe/Vilnius. If any model run has incomplete coverage or unknown pricing, show the daily total as unavailable and any reported subtotal as partial. Research and measurement jobs do not execute models and should not be counted as missing model usage.

## Completed-run reconciliation

`reconcile-usage.yml` runs after either model workflow completes. It can also be dispatched with a completed source run ID:

```sh
gh workflow run reconcile-usage.yml --repo xndanius/while-you-sleep --ref main -f source_run_id=38032271902
```

The fresh runner checks out trusted `main`, downloads no model artifacts, and receives no OpenAI key. Authoritative GitHub metadata must identify this exact repository, a completed `main` run, a valid commit SHA, the loop or improvement workflow path, and a schedule or manual event. It reads the source attempt's model logs only when its initial usage record is incomplete. Known skipped-job proofs may be preserved from the trusted initial collector; a present API job still overrides them.

If all required counters become available, it adds immutable `data/usage/<runId>-reconciled.json`, with `supersedes` and the SHA-256 of the unchanged original. The correction retains the original Vilnius record date. The builder and README select exactly one effective record per run: the valid complete correction replaces the incomplete original for totals, without deleting history or counting the run twice. Already complete initial records are left alone. If retrieval or parsing is still incomplete, no correction is written and the initial unknown remains; a later manual retry is possible. Unknown model pricing still remains unknown.

The commit job shares the record concurrency lock, retries a rebased push up to three times and invokes Pages explicitly after writing a correction. Public data therefore reflects the corrected counters even though a GitHub-token commit does not trigger a normal push workflow.

The hourly planning target is approximately $0.03 per loop run and $0.70 per day at 24 runs, before variable repairs and daily improvement. These are expectations from the v4 brief, not observed full-day costs. Empty clock ticks, deterministic LinkedIn selection and settled cheap gates make no model calls. The collector observes and reports usage; it does not itself enforce an OpenAI account spending limit or promise that target. Budget controls can consume these records without treating an unavailable total as zero.
