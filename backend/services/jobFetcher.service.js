const adzuna = require('../platforms/adzuna');
const greenhouse = require('../platforms/greenhouse');
const lever = require('../platforms/lever');
const ashby = require('../platforms/ashby');
const FetchRun = require('../models/FetchRun');
const { createCycleDeadline } = require('../services/fetchBudget.service');
const { classifyError } = require('../services/httpClient.service');

// Add new platforms here — each fetchJobs({ cycleDeadline }) returns
// { fetched, added, ... }. The extra resilience fields (requestsAttempted/
// requestsFailed/retries/failures/skipped/aborted/budgetExceeded) are
// optional on the return value — a platform that doesn't report them just
// gets zeroed-out defaults below, so adding a new platform without this
// instrumentation never breaks FetchRun reporting.
const PLATFORMS = [
  { name: 'Adzuna', fetcher: adzuna },
  { name: 'Greenhouse', fetcher: greenhouse },
  { name: 'Lever', fetcher: lever },
  { name: 'Ashby', fetcher: ashby },
];

// A source's own outcome: 'failed' only when every single request it made
// failed (or it threw before making any, or the overall cycle budget expired
// before it ever got to run); 'partial' when some but not all requests
// failed, OR it completed everything it attempted but a time budget cut it
// off before reaching its full company/category list (an incomplete run is
// never reported as a plain 'success', even if nothing it tried actually
// failed); 'success' otherwise.
const sourceOutcome = ({ requestsAttempted, requestsFailed, threw, failures, budgetExceeded, skippedEntirely }) => {
  if (threw) return 'failed';
  if (skippedEntirely) return 'failed'; // never even started — overall cycle budget was already gone
  if (requestsAttempted === 0) return failures.length > 0 ? 'failed' : 'success';
  if (requestsFailed >= requestsAttempted) return 'failed';
  if (requestsFailed > 0 || budgetExceeded) return 'partial';
  return 'success';
};

const fetchAdzunaJobs = async () => {
  const startedAt = new Date();
  const start = Date.now();
  // One deadline shared across all four providers for this entire run — each
  // provider also has its own independent per-provider budget (created inside
  // the adapter itself), so a provider is bounded by whichever is tighter.
  const cycleDeadline = createCycleDeadline();
  const sources = [];
  const errorSummary = [];

  for (const { name, fetcher } of PLATFORMS) {
    // The overall cycle budget is checked BEFORE starting a provider at all —
    // once it's gone, no new upstream requests are started for any remaining
    // provider this cycle. A provider skipped here never ran, so it must
    // never be reported as a successful empty scan.
    if (cycleDeadline.expired()) {
      console.warn(`[JobFetcher] Overall fetch-cycle budget exceeded — skipping ${name} entirely this cycle`);
      const outcome = sourceOutcome({ requestsAttempted: 0, requestsFailed: 0, threw: false, failures: [], budgetExceeded: 'cycle', skippedEntirely: true });
      sources.push({ name, fetched: 0, added: 0, updated: 0, requestsAttempted: 0, requestsFailed: 0, retries: 0, failures: [], skipped: [], aborted: false, budgetExceeded: 'cycle', outcome });
      errorSummary.push(`${name}: skipped entirely — overall fetch-cycle budget exceeded`);
      continue;
    }

    let threw = false;
    let r;
    try {
      r = await fetcher.fetchJobs({ cycleDeadline });
    } catch (err) {
      threw = true;
      // Full message only to server-side logs (an operator-only trust
      // boundary). What goes into `errorSummary` is admin-API-visible (via
      // getFetchHealth/analytics), so it's run through the same sanitized
      // classifier every normal per-request failure already uses — a crash
      // here is rare (a bug, not a classified HTTP failure) but Adzuna's
      // request URLs carry credentials as query params, and some error types
      // (e.g. network-level ones) can otherwise embed more than just a
      // message. Never assume a raw error object is safe to expose.
      console.error(`[JobFetcher] ${name} error:`, err.message);
      errorSummary.push(`${name}: crashed (${classifyError(err)})`);
      r = {};
    }

    const added = r?.added || 0;
    const updated = r?.updated || 0;
    const fetched = r?.fetched || 0;
    const requestsAttempted = r?.requestsAttempted || 0;
    const requestsFailed = r?.requestsFailed || 0;
    const retries = r?.retries || 0;
    const failures = r?.companiesFailed || r?.categoriesFailed || [];
    const skipped = r?.companiesSkipped || r?.categoriesSkipped || [];
    const aborted = r?.aborted || false;
    const budgetExceeded = r?.budgetExceeded || null;

    const outcome = sourceOutcome({ requestsAttempted, requestsFailed, threw, failures, budgetExceeded });
    sources.push({ name, fetched, added, updated, requestsAttempted, requestsFailed, retries, failures, skipped, aborted, budgetExceeded, outcome });

    const budgetNote = budgetExceeded ? `, ${budgetExceeded} budget exceeded (${skipped.length} skipped)` : '';
    console.log(`[JobFetcher] ${name}: ${added} new / ${fetched} fetched (${outcome}${aborted ? ', rate-limit aborted' : ''}${budgetNote})`);

    if (!threw && outcome !== 'success') {
      const failureNote = failures.length
        ? `${failures.length} failure(s), e.g. ${failures[0].reason}`
        : 'no successful requests';
      errorSummary.push(`${name}: ${outcome} — ${failureNote}${aborted ? ' (rate-limit aborted)' : ''}${budgetExceeded ? ` (${budgetExceeded} budget exceeded, ${skipped.length} skipped)` : ''}`);
    }
  }

  const totalFetched = sources.reduce((s, x) => s + x.fetched, 0);
  const totalAdded = sources.reduce((s, x) => s + x.added, 0);
  const totalUpdated = sources.reduce((s, x) => s + x.updated, 0);

  // Overall: 'failed' only if every single source failed outright — a run
  // that found zero jobs because every provider was unreachable must never
  // look identical to a quiet-but-healthy hour with nothing new to report.
  const outcome = sources.every((s) => s.outcome === 'failed')
    ? 'failed'
    : sources.some((s) => s.outcome !== 'success')
    ? 'partial'
    : 'success';

  const finishedAt = new Date();
  const durationMs = Date.now() - start;

  try {
    await FetchRun.create({ sources, totalFetched, totalAdded, totalUpdated, durationMs, startedAt, finishedAt, outcome, errorSummary });
  } catch (err) {
    console.error('[JobFetcher] Failed to record FetchRun:', err.message);
  }

  if (outcome === 'failed') {
    console.error(`[JobFetcher] Fetch run FAILED — every source failed. ${errorSummary.join(' | ')}`);
  } else if (outcome === 'partial') {
    console.warn(`[JobFetcher] Fetch run partially failed. ${errorSummary.join(' | ')}`);
  }

  return { sources, totalFetched, totalAdded, totalUpdated, outcome };
};

module.exports = { fetchAdzunaJobs };
