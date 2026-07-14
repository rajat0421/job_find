const axios = require('axios');
const crypto = require('crypto');
const Job = require('../models/Job');

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

      for (const j of jobs) {
        const title = j.title?.label || j.title || '';
        const company = j.company?.display_name || '';
        const location = j.location?.display_name || '';
        const hash = generateJobHash(title, company, location);

        if (await Job.findOne({ hash })) continue;

        await Job.create({
          title, company, location,
          salaryMin: j.salary_min,
          salaryMax: j.salary_max,
          description: j.description,
          applyLink: j.redirect_url,
          source: 'adzuna',
          hash,
          postedAt: j.created ? new Date(j.created) : null,
        });
        newCount++;
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
