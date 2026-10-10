const axios = require('axios');
const crypto = require('crypto');
const { observeJob, sweepMissingJobs } = require('../services/jobLifecycle.service');

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
  let totalFetched = 0;
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
      if (fetched > 0) {
        await sweepMissingJobs({ source: 'greenhouse', sourceBoard: token, observedSourceJobIds: observedIds });
      }
    } catch (err) {
      // Board token might be wrong, company removed it, or the request failed —
      // skip silently. Crucially: never run missing-detection for a failed scan.
      console.warn(`[Greenhouse] Skipped ${token}: ${err.message}`);
      if (_id) await Company.updateOne({ _id }, { lastFetchedAt: new Date(), lastJobCount: 0 });
    }
  }

  return { added: newCount, fetched: totalFetched };
};

module.exports = { fetchJobs, BOARDS, stripHtml };
