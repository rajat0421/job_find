const axios = require('axios');
const crypto = require('crypto');
const Job = require('../models/Job');

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

const fetchJobs = async () => {
  let newCount = 0;
  const companies = await getCompanies('ashby');

  for (const { _id, name: company, token: board } of companies) {
    let fetched = 0;
    try {
      const res = await axios.get(`https://api.ashbyhq.com/posting-api/job-board/${board}`, {
        timeout: 10000,
      });

      const jobs = res.data?.jobs || [];
      fetched = jobs.length;

      for (const j of jobs) {
        const title = j.title || '';
        const location = j.location || '';
        const applyLink = j.applyUrl || j.jobUrl || '';
        if (!title || !applyLink) continue;

        const hash = generateJobHash(title, company, location);
        const exists = await Job.findOne({ hash });
        if (exists) continue;

        await Job.create({
          title,
          company,
          location,
          salaryMin: null, // Ashby compensation is USD text — skip to avoid INR mismatch
          salaryMax: null,
          description: j.descriptionPlain || '',
          applyLink,
          source: 'ashby',
          workplaceType: normalizeWorkplace(j.workplaceType) || (j.isRemote ? 'remote' : null),
          country: null,
          hash,
          postedAt: j.publishedAt ? new Date(j.publishedAt) : null,
        });
        newCount++;
      }
      if (_id) await Company.updateOne({ _id }, { lastFetchedAt: new Date(), lastJobCount: fetched });
    } catch (err) {
      console.warn(`[Ashby] Skipped ${company} (${board}): ${err.response?.status || err.message}`);
      if (_id) await Company.updateOne({ _id }, { lastFetchedAt: new Date(), lastJobCount: 0 });
    }
  }

  return newCount;
};

module.exports = { fetchJobs, BOARDS };
