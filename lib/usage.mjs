import { spawn } from 'node:child_process';
import { localParts } from './config.mjs';

// Verified 2026-10-10. Only this exact model has a configured estimate.
export const TOKEN_RATES = Object.freeze({
  'gpt-6-luna': Object.freeze({
    inputUsdPerMillion: 0.10, cachedInputUsdPerMillion: 0.01,
    cacheWriteInputUsdPerMillion: 0.125, outputUsdPerMillion: 0.50,
    source: 'https://developers.openai.com/api/docs/models/gpt-6-luna',
    verifiedAt: '2026-10-10', tier: 'standard_short_context', currency: 'USD',
  }),
});
const JOB_NAMES = Object.freeze({
  loop: ['writer', 'checker', 'repair', 'final_check'],
  improve: ['propose', 'trials (baseline)', 'trials (proposal)', 'grade'],
});
const MAX_LOG_BYTES = 24 * 1024 * 1024;
const MAX_EVENT_BYTES = 1024 * 1024;
const MAX_TOKENS = 1_000_000_000;
const nullCounts = () => ({inputTokens:null,cachedInputTokens:null,cacheWriteInputTokens:null,outputTokens:null,reasoningOutputTokens:null,costUsd:null});
const validTokens = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_TOKENS;
const modelName = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(value) ? value : null;
const cleanLine = line => line.replace(/\x1b\[[0-9;]*m/g, '').replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s+/, '').trim();

export function modelJobNames(kind) {
  if (!Object.hasOwn(JOB_NAMES, kind)) throw new Error('Unsupported usage workflow kind.');
  return [...JOB_NAMES[kind]];
}

/** Only trusted workflow-needs results can prove an omitted job was skipped. */
export function parseModelJobResults(raw, kind) {
  modelJobNames(kind);
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 64 * 1024) return {};
  let needs;
  try {needs=JSON.parse(raw);} catch {return {};}
  if (!needs || typeof needs !== 'object' || Array.isArray(needs)) return {};
  const results={};
  const names=kind==='loop' ? {writer:'writer',checker:'checker',repair:'repair',final_check:'final_check'}
    : {propose:'propose','trials (baseline)':'trials','trials (proposal)':'trials',grade:'grade'};
  for (const [name,key] of Object.entries(names)) {
    // Outputs, conclusions, strings containing "skipped", and unknown jobs are
    // deliberately ignored. The caller obtains this object from toJSON(needs).
    if (needs[key] && typeof needs[key] === 'object' && !Array.isArray(needs[key]) && needs[key].result === 'skipped') results[name]='skipped';
  }
  return results;
}

function commandModel(line) {
  if (!line.startsWith('Running: ')) return null;
  // codex-action prints each argument with JSON.stringify. Never search inside
  // a JSON event or tool output for this marker.
  const quoted = line.match(/"(?:\\.|[^"\\])*"/g) || [];
  let args;
  try { args = quoted.map(value => JSON.parse(value)); } catch { return null; }
  const execIndex = args.indexOf('exec');
  if (execIndex < 0 || !args.includes('--json') || !args.includes('--skip-git-repo-check')) return null;
  const codexBeforeExec = execIndex > 0 && /(?:^|\/)codex$/.test(args[execIndex - 1]);
  const directCodex = execIndex === 0 && /^Running: (?:CODEX_HOME=\S+ )?\S*\bcodex\s/.test(line);
  if (!codexBeforeExec && !directCodex) return null;
  const index = args.indexOf('--model', execIndex);
  return {model: index >= 0 ? modelName(args[index + 1]) : null};
}

export function estimateTokenCost(usage, model) {
  const rates = TOKEN_RATES[model];
  if (!rates || !validTokens(usage.inputTokens) || !validTokens(usage.cachedInputTokens) || !validTokens(usage.outputTokens)) return null;
  const writes = usage.cacheWriteInputTokens ?? 0;
  if (!validTokens(writes) || usage.cachedInputTokens + writes > usage.inputTokens) return null;
  return ((usage.inputTokens - usage.cachedInputTokens - writes) * rates.inputUsdPerMillion
    + usage.cachedInputTokens * rates.cachedInputUsdPerMillion
    + writes * rates.cacheWriteInputUsdPerMillion
    + usage.outputTokens * rates.outputUsdPerMillion) / 1_000_000;
}

function eventUsage(event) {
  if (!event || event.type !== 'turn.completed' || !event.usage || Array.isArray(event.usage)) return null;
  if (Object.keys(event).some(key => !['type', 'usage'].includes(key))) return null;
  const raw = event.usage;
  if (![raw.input_tokens, raw.cached_input_tokens, raw.output_tokens].every(validTokens)) return null;
  const writes = raw.cache_write_input_tokens;
  const reasoning = raw.reasoning_output_tokens;
  if ((writes !== undefined && !validTokens(writes)) || (reasoning !== undefined && !validTokens(reasoning))) return null;
  if (raw.cached_input_tokens + (writes ?? 0) > raw.input_tokens || (reasoning ?? 0) > raw.output_tokens) return null;
  return {inputTokens:raw.input_tokens,cachedInputTokens:raw.cached_input_tokens,cacheWriteInputTokens:writes ?? null,outputTokens:raw.output_tokens,reasoningOutputTokens:reasoning ?? null};
}

/** Read only actual JSONL CLI events, never recursively search item/tool text. */
export function parseCodexUsage(log, {model:configuredModel} = {}) {
  const unknown = reason => ({status:'unknown',reason,model:modelName(configuredModel),...nullCounts()});
  if (typeof log !== 'string' || Buffer.byteLength(log) > MAX_LOG_BYTES) return unknown('log_unavailable_or_oversized');
  let invocation = null, threadStarted = false, turnStarted = false, ended = false, observed = null;
  let invocationCount = 0, invalid = false, failed = false;
  for (const rawLine of log.split(/\r?\n/)) {
    const line = cleanLine(rawLine);
    const command = commandModel(line);
    if (command) {
      invocationCount++;
      if (invocationCount !== 1) invalid = true;
      invocation = command;
      continue;
    }
    if (!invocation || ended || !line.startsWith('{') || Buffer.byteLength(line) > MAX_EVENT_BYTES) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (!event || Array.isArray(event) || typeof event !== 'object') continue;
    if (event.type === 'thread.started') {
      if (threadStarted || turnStarted || typeof event.thread_id !== 'string' || !event.thread_id) invalid = true;
      threadStarted = true;
    } else if (event.type === 'turn.started') {
      if (!threadStarted || turnStarted) invalid = true;
      turnStarted = true;
    } else if (event.type === 'turn.completed') {
      if (!threadStarted || !turnStarted) invalid = true;
      observed = eventUsage(event);
      if (!observed) invalid = true;
      ended = true;
    } else if (event.type === 'turn.failed') {
      failed = true;
      ended = true;
    }
  }
  if (invocationCount !== 1 || invalid || failed || !ended || !observed) return unknown(failed ? 'codex_turn_failed' : invalid ? 'invalid_cli_usage_event' : 'completed_cli_usage_not_found');
  const model = invocation.model || modelName(configuredModel);
  return {
    status:'observed',reason:null,model,...observed,costUsd:estimateTokenCost(observed,model),
    cacheWriteAccounting:observed.cacheWriteInputTokens === null ? 'not_reported_by_cli' : 'reported_by_cli',
    pricingStatus:!TOKEN_RATES[model] ? 'model_rates_unknown' : observed.cacheWriteInputTokens === null ? 'reported_categories_standard_estimate' : 'standard_token_estimate',
  };
}

/** GitHub CLI follows the authenticated job-log redirect. Keep output in RAM. */
export function githubApiGet(endpoint, {maxBytes = MAX_LOG_BYTES, timeoutMs = 30_000, env = process.env} = {}) {
  if (!/^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/(?:runs\/\d+\/attempts\/\d+\/jobs\?per_page=100&page=\d+|jobs\/\d+\/logs)$/.test(endpoint)) throw new Error('Unsupported usage API endpoint.');
  return new Promise((resolve,reject) => {
    const childEnv = {...env,GH_PROMPT_DISABLED:'1'};
    delete childEnv.GH_DEBUG;
    const child = spawn('gh',['api','--hostname','github.com','--method','GET',endpoint],{env:childEnv,stdio:['ignore','pipe','pipe']});
    let size = 0, chunks = [], finished = false;
    const finish = (error,value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      chunks = [];
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => {child.kill('SIGKILL');finish(new Error('Usage API request timed out.'));},timeoutMs);
    child.stdout.on('data',chunk => {
      if (finished) return;
      size += chunk.length;
      if (size > maxBytes) {child.kill('SIGKILL');finish(new Error('Usage API response exceeded size limit.'));}
      else chunks.push(chunk);
    });
    // Never echo GitHub error bodies, signed log URLs, or inherited credentials.
    child.stderr.on('data',() => {});
    child.on('error',() => finish(new Error('Usage API request unavailable.')));
    child.on('close',code => code === 0 ? finish(null,Buffer.concat(chunks).toString('utf8')) : finish(new Error('Usage API request unavailable.')));
  });
}

function validateContext({kind,runId,repository,githubRunId,attempt,model}) {
  modelJobNames(kind);
  if (typeof runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,160}$/.test(runId)) throw new Error('Invalid usage record ID.');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') || !/^\d+$/.test(String(githubRunId)) || !/^[1-9]\d*$/.test(String(attempt))) throw new Error('Invalid GitHub usage context.');
  if (!modelName(model)) throw new Error('Invalid usage model name.');
}

export async function collectUsage(context, {apiGet = githubApiGet, now = new Date()} = {}) {
  validateContext(context);
  const {kind,runId,repository,githubRunId,attempt,model,jobResults={}} = context;
  const expected = modelJobNames(kind), listed = [];
  let listingAvailable = true;
  try {
    for (let page = 1; page <= 10; page++) {
      const body = JSON.parse(await apiGet(`repos/${repository}/actions/runs/${githubRunId}/attempts/${attempt}/jobs?per_page=100&page=${page}`,{maxBytes:2*1024*1024}));
      if (!Array.isArray(body.jobs) || !Number.isSafeInteger(body.total_count) || body.total_count < 0 || body.total_count > 1000) throw new Error('Invalid job list.');
      listed.push(...body.jobs);
      if (listed.length >= body.total_count) break;
      if (page === 10 || !body.jobs.length) throw new Error('Incomplete job list.');
    }
  } catch {listingAvailable = false;}
  const jobs = [];
  for (const name of expected) {
    const matches = listed.filter(job => job.name === name);
    const base = {name,jobId:null,githubJobUrl:null,status:'unknown',reason:'job_not_found',...nullCounts()};
    if (!matches.length && jobResults[name] === 'skipped') {jobs.push({...base,status:'not_run',reason:'trusted_workflow_needs_skipped'});continue;}
    if (!listingAvailable) {jobs.push({...base,reason:'job_list_unavailable'});continue;}
    if (matches.length !== 1) {jobs.push({...base,reason:matches.length ? 'ambiguous_job_name' : 'job_not_found'});continue;}
    const job = matches[0];
    if (!Number.isSafeInteger(job.id) || job.id <= 0 || String(job.run_id) !== String(githubRunId) || (job.run_attempt !== undefined && Number(job.run_attempt) !== Number(attempt))) {jobs.push({...base,reason:'invalid_job_identity'});continue;}
    base.jobId = job.id;
    base.githubJobUrl = `https://github.com/${repository}/actions/runs/${githubRunId}/job/${job.id}`;
    base.conclusion = ['success','failure','cancelled','skipped','timed_out','action_required','neutral','stale'].includes(job.conclusion) ? job.conclusion : null;
    if (job.conclusion === 'skipped') {jobs.push({...base,status:'not_run',reason:'github_job_skipped'});continue;}
    if (job.status !== 'completed') {jobs.push({...base,reason:'job_not_completed'});continue;}
    try {
      const log = await apiGet(`repos/${repository}/actions/jobs/${job.id}/logs`);
      jobs.push({...base,...parseCodexUsage(log,{model})});
    } catch {jobs.push({...base,reason:'job_log_unavailable'});}
  }
  const observed = jobs.filter(job => job.status === 'observed');
  const unknown = jobs.filter(job => job.status === 'unknown');
  const complete = unknown.length === 0 && observed.length > 0;
  const sum = field => observed.length && observed.every(job => typeof job[field] === 'number') ? observed.reduce((total,job) => total + job[field],0) : null;
  const totals = Object.fromEntries(['inputTokens','cachedInputTokens','cacheWriteInputTokens','outputTokens','reasoningOutputTokens','costUsd'].map(field => [field,complete ? sum(field) : null]));
  return {
    id:runId,type:'usage',runId,workflowKind:kind,collectedAt:now.toISOString(),localDate:localParts(now).day,
    githubRunId:String(githubRunId),runAttempt:Number(attempt),githubRunUrl:`https://github.com/${repository}/actions/runs/${githubRunId}/attempts/${attempt}`,
    model,source:'github_actions_logs_codex_exec_jsonl',status:complete ? 'recorded' : observed.length ? 'partial' : 'unknown',
    ...totals,observedCounts:{inputTokens:sum('inputTokens'),cachedInputTokens:sum('cachedInputTokens'),cacheWriteInputTokens:sum('cacheWriteInputTokens'),outputTokens:sum('outputTokens'),reasoningOutputTokens:sum('reasoningOutputTokens'),costUsd:sum('costUsd')},
    coverage:{expectedModelJobs:expected.length,observedModelJobs:observed.length,notRunModelJobs:jobs.filter(job => job.status === 'not_run').length,unknownModelJobs:unknown.length},
    rates:TOKEN_RATES[model] || null,observedModels:[...new Set(observed.map(job => job.model))],pricingStatus:totals.costUsd === null ? 'estimate_unavailable_or_incomplete' : 'recorded_token_estimate',
    caveat:'Token-based standard-rate estimate, not an invoice. Long-context, service-tier, region, paid-tool, and unreported cache-write adjustments are not established by CLI totals. Missing job usage leaves totals unknown; observedCounts covers only reported jobs.',
    jobs,
  };
}
