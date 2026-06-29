const axios = require('axios');
const crypto = require('crypto');
const Job = require('../models/Job');

const generateJobHash = (title, company, location) =>
  crypto.createHash('md5').update(`${title}-${company}-${location}`).digest('hex');

const fetchJobs = async () => {
  const { ADZUNA_APP_ID, ADZUNA_APP_KEY } = process.env;
  if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) {
    console.warn('[Adzuna] Credentials not set, skipping');
    return 0;
  }

  const response = await axios.get('https://api.adzuna.com/v1/api/jobs/in/search/1', {
    params: {
      app_id: ADZUNA_APP_ID,
      app_key: ADZUNA_APP_KEY,
      results_per_page: 50,
      what: 'software engineer developer',
      where: 'India',
    },
  });

  const jobs = response.data.results || [];
  let newCount = 0;

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

  return newCount;
};

module.exports = { fetchJobs };
