const axios = require('axios');
const crypto = require('crypto');
const Job = require('../models/Job');

const generateJobHash = (title, company, location) =>
  crypto.createHash('md5').update(`${title}-${company}-${location}`).digest('hex');

// One query per role — fetch cycle collects broadly, matching is done locally
const ROLE_QUERIES = [
  'software engineer',
  'software developer',
  'backend developer',
  'frontend developer',
  'full stack developer',
  'devops engineer',
  'data engineer',
  'data scientist',
  'qa engineer',
  'cybersecurity engineer',
  'cloud engineer',
  'java developer',
  'python developer',
  'react developer',
  'nodejs developer',
  'android developer',
  // SAP & ERP
  'sap consultant',
  'sap mm',
  'sap sd',
  'sap fico',
  'sap abap',
  'sap basis',
  'erp consultant',
];

const PAGES_PER_ROLE = 2; // 2 pages × 50 results × 16 roles = up to 1600 jobs/cycle

const fetchForRole = async (appId, appKey, role) => {
  let newCount = 0;
  for (let page = 1; page <= PAGES_PER_ROLE; page++) {
    try {
      const response = await axios.get('https://api.adzuna.com/v1/api/jobs/in/search/' + page, {
        params: {
          app_id: appId,
          app_key: appKey,
          results_per_page: 50,
          what: role,
          where: 'India',
        },
        timeout: 10000,
      });

      const jobs = response.data.results || [];
      if (!jobs.length) break; // no more pages

      for (const j of jobs) {
        const title = j.title?.label || j.title || '';
        const company = j.company?.display_name || '';
        const location = j.location?.display_name || '';
        const hash = generateJobHash(title, company, location);

        const exists = await Job.findOne({ hash });
        if (exists) continue;

        await Job.create({
          title,
          company,
          location,
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
      console.error(`[Adzuna] Failed for role="${role}" page=${page}:`, err.message);
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

  let totalNew = 0;
  for (const role of ROLE_QUERIES) {
    const count = await fetchForRole(appId, appKey, role);
    if (count > 0) console.log(`[Adzuna] "${role}" → ${count} new jobs`);
    totalNew += count;
  }

  console.log(`[Adzuna] Fetch complete — ${totalNew} new jobs saved across ${ROLE_QUERIES.length} roles`);
  return totalNew;
};

module.exports = { fetchJobs };
