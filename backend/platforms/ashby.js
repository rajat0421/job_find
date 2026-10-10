const crypto = require('crypto');
const { observeJob, sweepMissingJobs } = require('../services/jobLifecycle.service');
const { getWithRetry, classifyError } = require('../services/httpClient.service');
const { createProviderDeadline } = require('../services/fetchBudget.service');

// Public Ashby Job Posting API — no auth. Companies are managed in the Company
// collection (admin portal), with ashbyBoards.json as a seed/fallback.
// Find a board name from its careers page: https://jobs.ashbyhq.com/<board>
const { getCompanies } = require('../services/companies.service');
const Company = require('../models/Company');
const BOARDS = require('../data/ashbyBoards.json'); // legacy export for admin live-test compatibility

const generateJobHash = (title, company, location) =>
  crypto.createHash('md5').update(`${title}-${company}-${location}`).digest('hex');

// Ashby returns 'Remote' | 'Hybrid' | 'OnSite'; normalize to the matcher's lowercase form
const normalizeWorkplace = (wt) => {
  if (!wt) return null;
  const w = wt.toLowerCase();
  if (w.includes('remote')) return 'remote';
  if (w.includes('hybrid')) return 'hybrid';
  return 'onsite';
};

// `cycleDeadline` (from fetchBudget.service.js, shared across all four
// providers for one fetch run) is passed in by jobFetcher.service.js. This
// adapter also tracks its own per-provider budget independently.
const fetchJobs = async ({ cycleDeadline } = {}) => {
  let newCount = 0;
  let totalFetched = 0;
  const companies = await getCompanies('ashby');

  const providerDeadline = createProviderDeadline();
  const deadlines = [providerDeadline, cycleDeadline].filter(Boolean);

  const stats = { requestsAttempted: 0, requestsFailed: 0, retries: 0 };
  const companiesFailed = [];
  const companiesSkipped = [];
  let budgetExceeded = null;
  let attemptedCount = 0;

  for (let i = 0; i < companies.length; i++) {
    const { _id, name: company, token: board } = companies[i];

    // Checked BEFORE starting a new company's request — a company never
    // reached here is never attempted, never counted as scanned, and never
    // fed into sweepMissingJobs.
    if (providerDeadline.expired()) budgetExceeded = 'provider';
    else if (cycleDeadline?.expired()) budgetExceeded = 'cycle';
    if (budgetExceeded) {
      companiesSkipped.push(
        ...companies.slice(i).map((c) => ({ name: c.name || c.token, reason: `${budgetExceeded}_budget_exceeded` }))
      );
      console.warn(`[Ashby] ${budgetExceeded} time budget exceeded — skipping ${companies.length - i} remaining board(s) this cycle`);
      break;
    }

    attemptedCount++;
    let fetched = 0;
    stats.requestsAttempted++;
    try {
      const res = await getWithRetry(
        `https://api.ashbyhq.com/posting-api/job-board/${board}`,
        { timeout: 10000 },
        stats,
        deadlines
      );

      const jobs = res.data?.jobs || [];
      fetched = jobs.length;
      totalFetched += fetched;

      // Ashby's job board API returns a complete current snapshot of this board
      // (no pagination) — once we're sure the scan succeeded and wasn't
      // suspiciously empty, absence from it is a meaningful missing-posting signal.
      const observedIds = [];
      for (const j of jobs) {
        const sourceJobId = j.id ? String(j.id) : null;
        if (sourceJobId) observedIds.push(sourceJobId); // seen even if we skip it below for missing fields

        const title = j.title || '';
        const location = j.location || '';
        const applyLink = j.applyUrl || j.jobUrl || '';
        if (!title || !applyLink) continue;

        const hash = generateJobHash(title, company, location);

        const { created } = await observeJob({
          source: 'ashby',
          sourceBoard: board,
          sourceJobId,
          hash,
          fields: {
            title,
            company,
            location,
            salaryMin: null, // Ashby compensation is USD text — skip to avoid INR mismatch
            salaryMax: null,
            description: j.descriptionPlain || '',
            applyLink,
            workplaceType: normalizeWorkplace(j.workplaceType) || (j.isRemote ? 'remote' : null),
            country: null,
            postedAt: j.publishedAt ? new Date(j.publishedAt) : null,
          },
        });
        if (created) newCount++;
      }
      if (_id) await Company.updateOne({ _id }, { lastFetchedAt: new Date(), lastJobCount: fetched });

      if (fetched > 0) {
        await sweepMissingJobs({ source: 'ashby', sourceBoard: board, observedSourceJobIds: observedIds });
      }
    } catch (err) {
      const reason = classifyError(err);
      stats.requestsFailed++;
      companiesFailed.push({ name: company || board, reason });
      console.warn(`[Ashby] Skipped ${company} (${board}): ${reason}`);
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

module.exports = { fetchJobs, BOARDS };
