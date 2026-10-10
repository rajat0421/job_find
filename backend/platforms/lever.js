const axios = require('axios');
const crypto = require('crypto');
const { observeJob, sweepMissingJobs } = require('../services/jobLifecycle.service');

// Public Lever Postings API — no auth needed. Companies are managed in the Company
// collection (admin portal), with leverCompanies.json as a seed/fallback.
// Find a token from its careers page: https://jobs.lever.co/<token>
const { getCompanies } = require('../services/companies.service');
const Company = require('../models/Company');
const COMPANIES = require('../data/leverCompanies.json'); // legacy export for admin live-test compatibility

const generateJobHash = (title, company, location) =>
  crypto.createHash('md5').update(`${title}-${company}-${location}`).digest('hex');

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

// Combine the plain description + list sections (responsibilities, requirements) into one blob
const buildDescription = (j) => {
  const parts = [];
  if (j.descriptionPlain) parts.push(j.descriptionPlain);
  else if (j.description) parts.push(stripHtml(j.description));
  for (const section of j.lists || []) {
    if (section.text) parts.push(section.text);
    if (section.content) parts.push(stripHtml(section.content));
  }
  if (j.additionalPlain) parts.push(j.additionalPlain);
  else if (j.additional) parts.push(stripHtml(j.additional));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
};

const baseUrl = (region) => (region === 'eu' ? 'https://api.eu.lever.co' : 'https://api.lever.co');

const fetchJobs = async () => {
  let newCount = 0;
  let totalFetched = 0;
  const companies = await getCompanies('lever');

  for (const { _id, name: company, token, region } of companies) {
    let fetched = 0;
    try {
      const res = await axios.get(`${baseUrl(region)}/v0/postings/${token}`, {
        params: { mode: 'json' },
        timeout: 10000,
      });

      const jobs = Array.isArray(res.data) ? res.data : [];
      fetched = jobs.length;
      totalFetched += fetched;

      // Lever's postings API returns a complete current snapshot of this board
      // (no pagination) — once we're sure the scan succeeded and wasn't
      // suspiciously empty, absence from it is a meaningful missing-posting signal.
      const observedIds = [];
      for (const j of jobs) {
        const sourceJobId = j.id ? String(j.id) : null;
        if (sourceJobId) observedIds.push(sourceJobId); // seen even if we skip it below for missing fields

        const title = j.text || '';
        const location = j.categories?.location || (j.categories?.allLocations || []).join(', ') || '';
        const applyLink = j.applyUrl || j.hostedUrl || '';
        if (!title || !applyLink) continue;

        const hash = generateJobHash(title, company, location);

        const { created } = await observeJob({
          source: 'lever',
          sourceBoard: token,
          sourceJobId,
          hash,
          fields: {
            title,
            company,
            location,
            salaryMin: null,
            salaryMax: null,
            description: buildDescription(j),
            applyLink,
            workplaceType: j.workplaceType || null,
            country: j.country || null,
            postedAt: j.createdAt ? new Date(j.createdAt) : null,
          },
        });
        if (created) newCount++;
      }
      if (_id) await Company.updateOne({ _id }, { lastFetchedAt: new Date(), lastJobCount: fetched });

      if (fetched > 0) {
        await sweepMissingJobs({ source: 'lever', sourceBoard: token, observedSourceJobIds: observedIds });
      }
    } catch (err) {
      // Token may be wrong, company left Lever, or on the EU instance — skip and continue
      console.warn(`[Lever] Skipped ${company} (${token}): ${err.response?.status || err.message}`);
      if (_id) await Company.updateOne({ _id }, { lastFetchedAt: new Date(), lastJobCount: 0 });
    }
  }

  return { added: newCount, fetched: totalFetched };
};

module.exports = { fetchJobs, COMPANIES, stripHtml };
