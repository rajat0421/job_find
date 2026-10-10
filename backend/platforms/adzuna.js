const axios = require('axios');
const crypto = require('crypto');
const { observeJob } = require('../services/jobLifecycle.service');

const generateJobHash = (title, company, location) =>
  crypto.createHash('md5').update(`${title}-${company}-${location}`).digest('hex');

// Fetch is DECOUPLED from users — always fetches the same curated categories so
// ingestion is predictable regardless of who's registered. Edit categories in
// data/adzunaCategories.json only. Matching (per-user) happens later, separately.
const CATEGORIES = require('../data/adzunaCategories.json');

// NOTE on API budget: CATEGORIES.length × MAX_PAGES calls per fetch cycle.
// 20 categories × 2 pages = 40 calls/hour ≈ 960/day. Keep an eye on your Adzuna
// plan's daily quota — raise MAX_PAGES or trim categories to fit.
const MAX_PAGES = 2;

const fetchForCategory = async (appId, appKey, what) => {
  let newCount = 0;
  let fetched = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const response = await axios.get('https://api.adzuna.com/v1/api/jobs/in/search/' + page, {
        params: { app_id: appId, app_key: appKey, results_per_page: 50, what, where: 'India' },
        timeout: 10000,
      });

      const jobs = response.data.results || [];
      if (!jobs.length) break; // stop paginating this category once results dry up
      fetched += jobs.length;

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
        const hash = generateJobHash(title, company, location);

        const { created } = await observeJob({
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
      }
    } catch (err) {
      console.error(`[Adzuna] Failed for "${what}" page=${page}:`, err.message);
      break;
    }
  }
  return { added: newCount, fetched };
};

const fetchJobs = async () => {
  const { ADZUNA_APP_ID: appId, ADZUNA_APP_KEY: appKey } = process.env;
  if (!appId || !appKey) {
    console.warn('[Adzuna] Credentials not set, skipping');
    return { added: 0, fetched: 0 };
  }

  console.log(`[Adzuna] Fetching ${CATEGORIES.length} categories × ${MAX_PAGES} pages = up to ${CATEGORIES.length * MAX_PAGES} calls`);

  let totalNew = 0;
  let totalFetched = 0;
  for (const what of CATEGORIES) {
    const { added, fetched } = await fetchForCategory(appId, appKey, what);
    if (added > 0) console.log(`[Adzuna] "${what}" → ${added} new jobs`);
    totalNew += added;
    totalFetched += fetched;
  }

  console.log(`[Adzuna] Done — ${totalNew} new / ${totalFetched} fetched across ${CATEGORIES.length} categories`);
  return { added: totalNew, fetched: totalFetched };
};

module.exports = { fetchJobs };
