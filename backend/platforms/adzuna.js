const crypto = require('crypto');
const { observeJob } = require('../services/jobLifecycle.service');
const { getWithRetry, classifyError } = require('../services/httpClient.service');
const { createProviderDeadline } = require('../services/fetchBudget.service');
const { correlateTrace } = require('../services/traceCorrelation.service');

const generateJobHash = (title, company, location) =>
  crypto.createHash('md5').update(`${title}-${company}-${location}`).digest('hex');

// Fetch is DECOUPLED from users — always fetches the same curated categories so
// ingestion is predictable regardless of who's registered. Edit categories in
// data/adzunaCategories.json only. Matching (per-user) happens later, separately.
const CATEGORIES = require('../data/adzunaCategories.json');

// NOTE on API budget: CATEGORIES.length × MAX_PAGES calls per fetch cycle.
// 20 categories × 2 pages = 40 calls/hour ≈ 960/day. Keep an eye on your Adzuna
// plan's daily quota — raise MAX_PAGES or trim categories to fit. getWithRetry
// adds up to MAX_RETRIES extra attempts per call on transient failures, which
// is a modest, bounded multiplier, not a new unbounded request source.
const MAX_PAGES = 2;

// Quota protection: if the API is actively rate-limiting us, hammering through
// the remaining ~18 categories (each still paying the retry cost) only makes
// it worse and burns the daily quota on calls likely to also fail. Abort the
// rest of this cycle's Adzuna run after this many consecutive rate-limited
// categories; the next hourly cycle tries again from the top. This is a
// SEPARATE mechanism from the time-budget check below — it protects quota,
// the time budget protects the fetch cycle's own schedule.
const CONSECUTIVE_RATE_LIMIT_ABORT_THRESHOLD = Number(process.env.ADZUNA_RATE_LIMIT_ABORT_THRESHOLD) || 3;

const fetchForCategory = async (appId, appKey, what, stats, deadlines) => {
  let newCount = 0;
  let updatedCount = 0;
  let fetched = 0;
  let failureReason = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    stats.requestsAttempted++;
    try {
      const response = await getWithRetry(
        'https://api.adzuna.com/v1/api/jobs/in/search/' + page,
        { params: { app_id: appId, app_key: appKey, results_per_page: 50, what, where: 'India' }, timeout: 10000 },
        stats,
        deadlines,
        { provider: 'adzuna', operation: 'search', boardToken: what }
      );

      const jobs = response.data.results || [];
      if (!jobs.length) break; // stop paginating this category once results dry up
      fetched += jobs.length;
      const observedIds = [];

      // NOTE on lifecycle: Adzuna's fetch is a limited keyword/category search
      // across a fixed category list (see CATEGORIES above), never a complete
      // snapshot of anything. A specific job's absence from this search proves
      // nothing about whether it's still open — so, unlike the Greenhouse/Lever/
      // Ashby adapters, this NEVER calls sweepMissingJobs. Adzuna-sourced jobs
      // rely solely on the global age-based expiry fallback in
      // jobLifecycle.service.js's expireStaleJobs(). This is a documented
      // limitation, not an oversight: Adzuna cannot reliably prove closure.
      for (const j of jobs) {
        const title = j.title?.label || j.title || '';
        const company = j.company?.display_name || '';
        const location = j.location?.display_name || '';
        const sourceJobId = j.id != null ? String(j.id) : null;
        if (sourceJobId) observedIds.push(sourceJobId);
        const hash = generateJobHash(title, company, location);

        const { created, updated } = await observeJob({
          source: 'adzuna',
          sourceBoard: null,
          sourceJobId,
          hash,
          fields: {
            title, company, location,
            salaryMin: j.salary_min,
            salaryMax: j.salary_max,
            description: j.description,
            applyLink: j.redirect_url,
            postedAt: j.created ? new Date(j.created) : null,
          },
        });
        if (created) newCount++;
        else if (updated) updatedCount++;
      }

      if (response.traceId) {
        await correlateTrace({ traceId: response.traceId, source: 'adzuna', sourceBoard: null, observedSourceJobIds: observedIds });
      }
    } catch (err) {
      failureReason = classifyError(err);
      stats.requestsFailed++;
      console.warn(`[Adzuna] Failed for "${what}" page=${page}: ${failureReason}`);
      break;
    }
  }
  return { added: newCount, updated: updatedCount, fetched, failureReason };
};

// `cycleDeadline` (from fetchBudget.service.js, shared across all four
// providers for one fetch run) is passed in by jobFetcher.service.js. This
// adapter also tracks its own per-provider budget independently.
const fetchJobs = async ({ cycleDeadline } = {}) => {
  const { ADZUNA_APP_ID: appId, ADZUNA_APP_KEY: appKey } = process.env;
  if (!appId || !appKey) {
    console.warn('[Adzuna] Credentials not set, skipping');
    return { added: 0, fetched: 0, aborted: false, budgetExceeded: null, categoriesFailed: [{ name: 'config', reason: 'missing_credentials' }], categoriesSkipped: [] };
  }

  console.log(`[Adzuna] Fetching ${CATEGORIES.length} categories × ${MAX_PAGES} pages = up to ${CATEGORIES.length * MAX_PAGES} calls`);

  const providerDeadline = createProviderDeadline();
  const deadlines = [providerDeadline, cycleDeadline].filter(Boolean);

  const stats = { requestsAttempted: 0, requestsFailed: 0, retries: 0 };
  const categoriesFailed = [];
  const categoriesSkipped = [];
  let consecutiveRateLimited = 0;
  let aborted = false; // rate-limit circuit breaker
  let budgetExceeded = null; // time-budget cutoff

  let totalNew = 0;
  let totalUpdated = 0;
  let totalFetched = 0;
  for (let i = 0; i < CATEGORIES.length; i++) {
    const what = CATEGORIES[i];

    // Checked BEFORE starting a new category — a category never reached here
    // is never attempted and never counted as scanned.
    if (providerDeadline.expired()) budgetExceeded = 'provider';
    else if (cycleDeadline?.expired()) budgetExceeded = 'cycle';
    if (budgetExceeded) {
      categoriesSkipped.push(
        ...CATEGORIES.slice(i).map((c) => ({ name: c, reason: `${budgetExceeded}_budget_exceeded` }))
      );
      console.warn(`[Adzuna] ${budgetExceeded} time budget exceeded — skipping ${CATEGORIES.length - i} remaining categor${CATEGORIES.length - i === 1 ? 'y' : 'ies'} this cycle`);
      break;
    }

    const { added, updated, fetched, failureReason } = await fetchForCategory(appId, appKey, what, stats, deadlines);
    if (added > 0) console.log(`[Adzuna] "${what}" → ${added} new jobs`);
    totalNew += added;
    totalUpdated += updated;
    totalFetched += fetched;

    if (failureReason) {
      categoriesFailed.push({ name: what, reason: failureReason });
      consecutiveRateLimited = failureReason === 'rate_limited' ? consecutiveRateLimited + 1 : 0;
      if (consecutiveRateLimited >= CONSECUTIVE_RATE_LIMIT_ABORT_THRESHOLD) {
        console.warn(`[Adzuna] Aborting remaining categories this cycle — ${consecutiveRateLimited} consecutive rate-limited requests`);
        aborted = true;
        break;
      }
    } else {
      consecutiveRateLimited = 0;
    }
  }

  console.log(`[Adzuna] Done — ${totalNew} new / ${totalFetched} fetched across ${CATEGORIES.length} categories${aborted ? ' (rate-limit aborted)' : ''}${budgetExceeded ? ' (time-budget aborted)' : ''}`);
  return {
    added: totalNew,
    updated: totalUpdated,
    fetched: totalFetched,
    aborted,
    budgetExceeded,
    categoriesFailed,
    categoriesSkipped,
    requestsAttempted: stats.requestsAttempted,
    requestsFailed: stats.requestsFailed,
    retries: stats.retries,
  };
};

module.exports = { fetchJobs };
