# Hosted model cost records

The trusted collector reads actual Codex CLI usage from completed GitHub model jobs. It does not call a model, use the OpenAI API key, or estimate tokens from post length. Each workflow attempt writes an immutable `data/usage/<runId>.json` record. The OpenAI invoice remains the authority for money charged.

The official pinned [Codex action execution code](https://github.com/openai/codex-action/blob/bdf19a4a223ec2549a3e2274a0cf61556bc07675/src/runCodexExec.ts) appends `codex-args` to `codex exec` and pipes stdout into the job log. [Non-interactive mode documentation](https://learn.chatgpt.com/docs/non-interactive-mode#make-output-machine-readable) describes `--json` and the top-level `turn.completed.usage` event. The [Codex event schema inspected for this build](https://github.com/openai/codex/blob/c3d3b142d10f4316b46e35aad7e5317e7e506cb7/codex-rs/exec/src/exec_events.rs) also contains optional cache-write and reasoning counts. The action currently installs the latest CLI; an incompatible future schema is recorded as unavailable instead of guessed.

The parser requires the action's `Running: ... codex exec ... --json` marker, a started thread, a started turn, and a valid top-level completion. It ignores `item.completed` contents, including tool or agent text that contains a fake usage event. Multiple CLI invocations, invalid numeric counts, missing completion, and failed turns are unavailable. Logs are held only in bounded memory; neither transcripts, error bodies, signed download URLs, nor credentials enter the committed record.

Only these exact GitHub job names are read:

| Workflow kind | Model jobs |
| --- | --- |
| `loop` | `writer`, `checker`, `repair`, `final_check` |
| `improve` | `propose`, `trials (baseline)`, `trials (proposal)`, `grade` |

The jobs endpoint is scoped to the current workflow run **and attempt**. Renaming a job requires updating the trusted allowlist. Explicitly skipped jobs are excluded from token sums. If GitHub omits a skipped job from its API response, the trusted workflow can supply `MODEL_JOB_RESULTS: ${{ toJSON(needs) }}`; only the exact known job's `result: skipped` proves it did not run. The improvement `trials` aggregate can prove both matrix jobs were skipped. Raw needs outputs are ignored and never persisted. A missing job without that proof, unfinished job, inaccessible log, failed turn, or malformed usage leaves the workflow total unknown. When some counts were observed, `observedCounts` preserves that subtotal separately; it must not be presented as the complete day's bill. Unknown model names retain token counts but have `costUsd: null`.

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

The configured target is under $0.50/day. The collector observes and reports usage; it does not itself enforce an OpenAI account spending limit or promise that target. Budget controls can consume these records without treating an unavailable total as zero.
