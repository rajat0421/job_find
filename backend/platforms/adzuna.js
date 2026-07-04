const axios = require('axios');
const crypto = require('crypto');
const Job = require('../models/Job');
const User = require('../models/User');

const generateJobHash = (title, company, location) =>
  crypto.createHash('md5').update(`${title}-${company}-${location}`).digest('hex');

const PAGES_PER_QUERY = 2;

// Fetch one query (role or skill), store new jobs in DB, return count of new jobs saved
const fetchForQuery = async (appId, appKey, what) => {
  let newCount = 0;
  for (let page = 1; page <= PAGES_PER_QUERY; page++) {
    try {
      const response = await axios.get('https://api.adzuna.com/v1/api/jobs/in/search/' + page, {
        params: { app_id: appId, app_key: appKey, results_per_page: 50, what, where: 'India' },
        timeout: 10000,
      });

      const jobs = response.data.results || [];
      if (!jobs.length) break;

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
      console.error(`[Adzuna] Failed for query="${what}" page=${page}:`, err.message);
      break;
    }
  }
  return newCount;
};

const fetchJobs = async () => {
  const { ADZUNA_APP_ID: appId, ADZUNA_APP_KEY: appKey } = process.env;
  if (!appId || !appKey) {
    console.warn('[Adzuna] Credentials not set, skipping');
    return 0;
  }

  // Build query set from every active user's roles + skills
  const users = await User.find({ isOnboarded: true, isEmailVerified: true })
    .select('desiredRoles skills').lean();

  const querySet = new Set();
  for (const user of users) {
    for (const r of (user.desiredRoles || [])) querySet.add(r.trim());
    for (const s of (user.skills || [])) querySet.add(s.trim());
  }

  if (!querySet.size) querySet.add('software developer');

  const queries = Array.from(querySet);
  console.log(`[Adzuna] ${queries.length} queries from ${users.length} user(s): ${queries.join(', ')}`);

  let totalNew = 0;
  for (const what of queries) {
    const count = await fetchForQuery(appId, appKey, what);
    if (count > 0) console.log(`[Adzuna] "${what}" → ${count} new jobs`);
    totalNew += count;
  }

  console.log(`[Adzuna] Done — ${totalNew} new jobs saved across ${queries.length} queries`);
  return totalNew;
};

module.exports = { fetchJobs };
