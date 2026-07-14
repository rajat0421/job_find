const axios = require('axios');
const crypto = require('crypto');
const Job = require('../models/Job');

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

const fetchJobs = async () => {
  let newCount = 0;
  const companies = await getCompanies('greenhouse');

  for (const { _id, name, token } of companies) {
    let fetched = 0;
    try {
      const res = await axios.get(
        `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
        { timeout: 8000 }
      );

      const jobs = res.data?.jobs || [];
      fetched = jobs.length;
      const company = name || (token.charAt(0).toUpperCase() + token.slice(1));

      for (const j of jobs) {
        const title = j.title || '';
        const location = j.location?.name || '';
        const hash = generateJobHash(title, company, location);

        const exists = await Job.findOne({ hash });
        if (exists) continue;

        await Job.create({
          title,
          company,
          location,
          salaryMin: null,
          salaryMax: null,
          description: stripHtml(j.content),
          applyLink: j.absolute_url,
          source: 'greenhouse',
          hash,
          postedAt: j.updated_at ? new Date(j.updated_at) : null,
        });
        newCount++;
      }
      if (_id) await Company.updateOne({ _id }, { lastFetchedAt: new Date(), lastJobCount: fetched });
    } catch (err) {
      // Board token might be wrong or company removed it — skip silently
      console.warn(`[Greenhouse] Skipped ${token}: ${err.message}`);
      if (_id) await Company.updateOne({ _id }, { lastFetchedAt: new Date(), lastJobCount: 0 });
    }
  }

  return newCount;
};

module.exports = { fetchJobs, BOARDS, stripHtml };
