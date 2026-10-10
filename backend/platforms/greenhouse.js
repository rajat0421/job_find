const crypto = require('crypto');
const { observeJob, sweepMissingJobs } = require('../services/jobLifecycle.service');
const { getWithRetry, classifyError } = require('../services/httpClient.service');
const { createProviderDeadline } = require('../services/fetchBudget.service');

const generateJobHash = (title, company, location) =>
  crypto.createHash('md5').update(`${title}-${company}-${location}`).digest('hex');

// Board tokens are managed in the Company collection (admin portal), with the
// greenhouseBoards.json list as a seed/fallback. Find a token at:
// https://boards.greenhouse.io/<board_token>
const { getCompanies } = require('../services/companies.service');
const BOARDS = require('../data/greenhouseBoards.json'); // legacy export for admin live-test compatibility

const stripHtml = (html) => {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const Company = require('../models/Company');

// `cycleDeadline` (from fetchBudget.service.js, shared across all four
// providers for one fetch run) is passed in by jobFetcher.service.js. This
// adapter also tracks its own per-provider budget independently.
const fetchJobs = async ({ cycleDeadline } = {}) => {
  let newCount = 0;
  let totalFetched = 0;
  const companies = await getCompanies('greenhouse');

  const providerDeadline = createProviderDeadline();
  const deadlines = [providerDeadline, cycleDeadline].filter(Boolean);

  const stats = { requestsAttempted: 0, requestsFailed: 0, retries: 0 };
  const companiesFailed = [];
  const companiesSkipped = [];
  let budgetExceeded = null;
  let attemptedCount = 0;

  for (let i = 0; i < companies.length; i++) {
    const { _id, name, token } = companies[i];

    // Checked BEFORE starting a new company's request — a company never
    // reached here is never attempted, never counted as scanned, and never
    // fed into sweepMissingJobs. Preserves Improvement 3's lifecycle safety:
    // only a complete, verified scan may trigger missing-job detection.
    if (providerDeadline.expired()) budgetExceeded = 'provider';
    else if (cycleDeadline?.expired()) budgetExceeded = 'cycle';
    if (budgetExceeded) {
      companiesSkipped.push(
        ...companies.slice(i).map((c) => ({ name: c.name || c.token, reason: `${budgetExceeded}_budget_exceeded` }))
      );
      console.warn(`[Greenhouse] ${budgetExceeded} time budget exceeded — skipping ${companies.length - i} remaining board(s) this cycle`);
      break;
    }

    attemptedCount++;
    let fetched = 0;
    stats.requestsAttempted++;
    try {
      const res = await getWithRetry(
        `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
        { timeout: 8000 },
        stats,
        deadlines
      );

      const jobs = res.data?.jobs || [];
      fetched = jobs.length;
      totalFetched += fetched;
      const company = name || (token.charAt(0).toUpperCase() + token.slice(1));

      // Greenhouse's job board API returns a complete current snapshot of this
      // board's open postings (no pagination) — so, once we're sure this scan
      // actually succeeded and wasn't suspiciously empty, absence from it is a
      // meaningful (though still grace-windowed) signal a posting may have closed.
      const observedIds = [];
      for (const j of jobs) {
        const sourceJobId = j.id != null ? String(j.id) : null;
        if (sourceJobId) observedIds.push(sourceJobId); // record as "seen" even if later fields are incomplete

        const title = j.title || '';
        const location = j.location?.name || '';
        const hash = generateJobHash(title, company, location);

        const { created } = await observeJob({
          source: 'greenhouse',
          sourceBoard: token,
          sourceJobId,
          hash,
          fields: {
            title,
            company,
            location,
            salaryMin: null,
            salaryMax: null,
            description: stripHtml(j.content),
            applyLink: j.absolute_url,
            postedAt: j.updated_at ? new Date(j.updated_at) : null,
          },
        });
        if (created) newCount++;
      }

      if (_id) await Company.updateOne({ _id }, { lastFetchedAt: new Date(), lastJobCount: fetched });

      // "fetched > 0" guards against an empty-but-unverified response (board API
      // glitch returning a valid-but-empty payload) being mistaken for "this
      // company now has zero open jobs" — see Improvement 3's lifecycle rules.
      // This only runs when the request above actually succeeded (including
      // after any internal retries) — a failed/exhausted request throws and is
      // handled in the catch block below, which never runs the sweep.
      if (fetched > 0) {
        await sweepMissingJobs({ source: 'greenhouse', sourceBoard: token, observedSourceJobIds: observedIds });
      }
    } catch (err) {
      // Board token might be wrong, company removed it, or the request failed
      // even after bounded retries — skip silently. Crucially: never run
      // missing-detection for a failed scan. Reason is classified, not the raw
      // error, so nothing sensitive ever lands in FetchRun or logs.
      const reason = classifyError(err);
      stats.requestsFailed++;
      companiesFailed.push({ name: name || token, reason });
      console.warn(`[Greenhouse] Skipped ${token}: ${reason}`);
      if (_id) await Company.updateOne({ _id }, { lastFetchedAt: new Date(), lastJobCount: 0 });
    }
  }

  return {
    added: newCount,
    fetched: totalFetched,
    companiesAttempted: attemptedCount,
    companiesFailed,
    companiesSkipped,
    budgetExceeded,
    requestsAttempted: stats.requestsAttempted,
    requestsFailed: stats.requestsFailed,
    retries: stats.retries,
  };
};

module.exports = { fetchJobs, BOARDS, stripHtml };
