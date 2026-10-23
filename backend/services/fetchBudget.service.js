const { positiveIntFromEnv } = require('./envValidation.service');

// Bounds how long a single provider's fetch loop (per-company/category) may
// keep starting new requests, and how long the whole hourly fetch cycle (all
// four providers, run sequentially) may keep going — so one provider's
// outage can't push the cycle past the :15 match cron. See the Improvement 4
// final report for the calculated worst-case duration this replaces.
const PROVIDER_BUDGET_MS = positiveIntFromEnv('FETCH_PROVIDER_BUDGET_MS', 4 * 60 * 1000);
const CYCLE_BUDGET_MS = positiveIntFromEnv('FETCH_CYCLE_BUDGET_MS', 10 * 60 * 1000);

// process.hrtime.bigint() is a monotonic clock — immune to system clock
// adjustments (NTP sync, manual changes, DST) that Date.now() is exposed to.
// Only ever used to measure elapsed intervals, never as a wall-clock timestamp.
const elapsedMs = (startNs) => Number(process.hrtime.bigint() - startNs) / 1e6;

// `kind` ('provider' | 'cycle') is optional and purely informational — it
// lets a caller holding several deadlines (see httpClient.service.js) report
// WHICH one actually tripped on a budget_exceeded rejection, instead of only
// knowing that at least one of them did. Never used in the expiry check
// itself, so a caller that omits it keeps behaving exactly as before.
const createDeadline = (budgetMs, kind = null) => {
  const startNs = process.hrtime.bigint();
  return {
    expired: () => elapsedMs(startNs) >= budgetMs,
    remainingMs: () => Math.max(0, budgetMs - elapsedMs(startNs)),
    elapsedMs: () => elapsedMs(startNs),
    budgetMs,
    kind,
  };
};

const createCycleDeadline = () => createDeadline(CYCLE_BUDGET_MS, 'cycle');
const createProviderDeadline = () => createDeadline(PROVIDER_BUDGET_MS, 'provider');

module.exports = { createCycleDeadline, createProviderDeadline, createDeadline, PROVIDER_BUDGET_MS, CYCLE_BUDGET_MS };
