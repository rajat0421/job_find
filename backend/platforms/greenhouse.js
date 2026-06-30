const axios = require('axios');
const crypto = require('crypto');
const Job = require('../models/Job');

const generateJobHash = (title, company, location) =>
  crypto.createHash('md5').update(`${title}-${company}-${location}`).digest('hex');

// Board tokens loaded from data file — add new companies by editing greenhouseBoards.json only
// Find a company's token at: https://boards.greenhouse.io/<board_token>
const BOARDS = require('../data/greenhouseBoards.json');

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

const fetchJobs = async () => {
  let newCount = 0;

  for (const board of BOARDS) {
    try {
      const res = await axios.get(
        `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`,
        { timeout: 8000 }
      );

      const jobs = res.data?.jobs || [];

      for (const j of jobs) {
        const title = j.title || '';
        const company = board.charAt(0).toUpperCase() + board.slice(1);
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
    } catch (err) {
      // Board token might be wrong or company removed it — skip silently
      console.warn(`[Greenhouse] Skipped ${board}: ${err.message}`);
    }
  }

  return newCount;
};

module.exports = { fetchJobs, BOARDS, stripHtml };
