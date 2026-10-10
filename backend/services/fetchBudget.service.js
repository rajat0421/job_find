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

const createDeadline = (budgetMs) => {
  const startNs = process.hrtime.bigint();
  return {
    expired: () => elapsedMs(startNs) >= budgetMs,
    remainingMs: () => Math.max(0, budgetMs - elapsedMs(startNs)),
    elapsedMs: () => elapsedMs(startNs),
    budgetMs,
  };
};

const createCycleDeadline = () => createDeadline(CYCLE_BUDGET_MS);
const createProviderDeadline = () => createDeadline(PROVIDER_BUDGET_MS);

module.exports = { createCycleDeadline, createProviderDeadline, createDeadline, PROVIDER_BUDGET_MS, CYCLE_BUDGET_MS };
