const axios = require('axios');
const { randomUUID } = require('crypto');
const { positiveIntFromEnv } = require('./envValidation.service');
const { recordTrace } = require('./traceStorage.service');
const { sanitizeErrorMessage } = require('./traceRedaction.service');

// Defaults chosen for the current workload: a handful of sequential per-board
// requests an hour, not a high-throughput crawler. 10s is generous enough for
// a slow board without letting one hung request stall the whole fetch cycle;
// 2 retries (3 attempts total) absorbs a blip without turning one flaky board
// into a long chain of delayed requests across ~90+ companies.
const DEFAULT_TIMEOUT_MS = positiveIntFromEnv('FETCH_TIMEOUT_MS', 10000);
const MAX_RETRIES = positiveIntFromEnv('FETCH_MAX_RETRIES', 2);
const BASE_BACKOFF_MS = positiveIntFromEnv('FETCH_RETRY_BASE_MS', 500);
// A malicious or misconfigured Retry-After must never stall a fetch cycle for
// an unbounded amount of time.
const MAX_RETRY_AFTER_MS = 30000;

// Sanitized failure classification — never includes the raw error message,
// request URL, params, or headers, so a classified reason can always be
// logged/stored safely even for providers (Adzuna) whose requests carry
// credentials as query params.
const classifyError = (err) => {
  if (err.budgetExceeded) return 'budget_exceeded';
  if (err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '')) return 'timeout';
  if (!err.response) return 'network_error'; // DNS failure, connection reset, refused, etc.
  const status = err.response.status;
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 404) return 'not_found'; // typically an invalid/removed board token
  if (status >= 500) return 'server_error';
  return `http_${status}`;
};

// Transient, worth retrying: network errors, timeouts, 429, and 5xx.
// Permanent, never retried: 4xx other than 429 (bad token, auth/config errors,
// bad request) — retrying those just wastes the bounded retry budget and API
// quota on a request that will never succeed. A budget-exceeded synthetic
// error is likewise never retried — there's nothing to gain from it.
const isRetryable = (err) => {
  const reason = classifyError(err);
  return reason === 'timeout' || reason === 'network_error' || reason === 'rate_limited' || reason === 'server_error';
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Exponential backoff with jitter; honors a 429's Retry-After header (seconds
// or an HTTP-date) when present, capped so it can never stall a fetch cycle
// for an unreasonable amount of time.
const retryDelayMs = (attempt, err) => {
  const retryAfter = err?.response?.headers?.['retry-after'];
  if (retryAfter) {
    const asSeconds = Number(retryAfter);
    const ms = Number.isFinite(asSeconds)
      ? asSeconds * 1000
      : new Date(retryAfter).getTime() - Date.now();
    if (Number.isFinite(ms) && ms > 0) return Math.min(ms, MAX_RETRY_AFTER_MS);
  }
  const backoff = BASE_BACKOFF_MS * 2 ** attempt;
  const jitter = Math.random() * backoff * 0.3;
  return Math.min(backoff + jitter, MAX_RETRY_AFTER_MS);
};

const budgetExceededError = () =>
  Object.assign(new Error('Fetch time budget exceeded before this request could be attempted'), { budgetExceeded: true });

/**
 * axios.get with a bounded timeout and bounded, selective retries. A near
 * drop-in replacement for `axios.get(url, config)` — same return shape (the
 * axios response), same thrown-error shape on ultimate failure — used by all
 * four platform adapters so timeout/retry behavior is defined once instead of
 * duplicated per provider.
 *
 * `stats`, if passed, is a plain mutable object the caller owns; this only
 * ever increments `stats.retries` (once per actual retry, not per attempt) so
 * callers can accumulate a retry count across many requests in one fetch run.
 *
 * `deadlines`, if passed (a single deadline object from fetchBudget.service,
 * or an array of them), gates retries: a deadline that's already expired
 * skips straight to failure instead of attempting a request, and a backoff
 * wait that would exceed the remaining budget is skipped (give up now rather
 * than burn the last of the budget on a doomed wait). This does NOT shrink an
 * already-in-flight request's own timeout — see this module's callers'
 * documentation of the resulting maximum deadline overrun.
 *
 * This is the UNINSTRUMENTED core — behavior is completely untouched by the
 * upstream-trace feature. `getWithRetry` below wraps it to add tracing
 * without risking any change to this proven retry/budget logic.
 */
const getWithRetryCore = async (url, config = {}, stats = null, deadlines = []) => {
  const list = (Array.isArray(deadlines) ? deadlines : [deadlines]).filter(Boolean);
  const isExpired = () => list.some((d) => d.expired());
  const minRemainingMs = () => (list.length ? Math.min(...list.map((d) => d.remainingMs())) : Infinity);

  const timeout = config.timeout || DEFAULT_TIMEOUT_MS;
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (isExpired()) throw lastErr || budgetExceededError();
    try {
      return await axios.get(url, { ...config, timeout });
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRIES || !isRetryable(err)) throw err;
      const delay = retryDelayMs(attempt, err);
      if (list.length && delay > minRemainingMs()) throw err; // not enough budget left for a meaningful retry
      if (stats) stats.retries = (stats.retries || 0) + 1;
      await sleep(delay);
    }
  }
  throw lastErr;
};

/**
 * Same contract as getWithRetryCore, plus optional upstream-trace capture.
 * `traceMeta` (`{provider, operation, boardToken}`) is opt-in — omitting it
 * (or calling getWithRetryCore directly) behaves EXACTLY as before this
 * feature existed. When provided, the full request/response (or failure) is
 * redacted and persisted via traceStorage.service.js after the retry core
 * settles — this never changes what's returned or thrown, only observes it.
 *
 * A successful response gets `res.traceId` attached; a thrown error gets
 * `err.traceId` attached — so a caller that wants to correlate this request
 * with the internal Job documents it produced (see platforms/*.js) can do so
 * without this function needing to know anything about job parsing.
 *
 * Trace recording is awaited (not fire-and-forget) specifically so a
 * caller's correlation follow-up is guaranteed to find the trace document
 * already written. recordTrace() is already designed to never throw (see
 * traceStorage.service.js) — but that call is ALSO wrapped in its own
 * try/catch right here, defensively, so even an unexpected future bug in the
 * tracing path can never change what this function returns or throws to its
 * caller. Tracing only ever OBSERVES the request; it can never be part of
 * deciding its outcome.
 */
const safeRecordTrace = async (trace) => {
  try {
    await recordTrace(trace);
  } catch (err) {
    console.error('[HttpClient] Unexpected error while recording upstream trace (ignored):', err.message);
  }
};

const getWithRetry = async (url, config = {}, stats = null, deadlines = [], traceMeta = null) => {
  if (!traceMeta) return getWithRetryCore(url, config, stats, deadlines);

  const traceId = randomUUID();
  const requestedAt = new Date();
  const startMs = Date.now();
  const localStats = { retries: 0 };

  try {
    const res = await getWithRetryCore(url, config, localStats, deadlines);
    if (stats) stats.retries = (stats.retries || 0) + localStats.retries;
    await safeRecordTrace({
      traceId, provider: traceMeta.provider, operation: traceMeta.operation, boardToken: traceMeta.boardToken ?? null,
      method: 'GET', url, params: config.params, requestHeaders: config.headers,
      requestedAt, respondedAt: new Date(), durationMs: Date.now() - startMs, retries: localStats.retries,
      success: true, statusCode: res.status, responseHeaders: res.headers, responseBody: res.data,
    });
    res.traceId = traceId;
    return res;
  } catch (err) {
    if (stats) stats.retries = (stats.retries || 0) + localStats.retries;
    const hasResponse = !!err.response;
    await safeRecordTrace({
      traceId, provider: traceMeta.provider, operation: traceMeta.operation, boardToken: traceMeta.boardToken ?? null,
      method: 'GET', url, params: config.params, requestHeaders: config.headers,
      requestedAt, respondedAt: hasResponse ? new Date() : null, durationMs: Date.now() - startMs, retries: localStats.retries,
      success: false, statusCode: hasResponse ? err.response.status : null, responseHeaders: hasResponse ? err.response.headers : {},
      responseBody: hasResponse ? err.response.data : null,
      errorKind: classifyError(err), errorMessage: sanitizeErrorMessage(err.message),
    });
    err.traceId = traceId;
    throw err;
  }
};

module.exports = {
  getWithRetry,
  getWithRetryCore,
  classifyError,
  isRetryable,
  DEFAULT_TIMEOUT_MS,
  MAX_RETRIES,
  BASE_BACKOFF_MS,
};
