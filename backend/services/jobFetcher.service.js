const adzuna = require('../platforms/adzuna');
const greenhouse = require('../platforms/greenhouse');
const lever = require('../platforms/lever');

// Add new platforms here — each must export a fetchJobs() that returns a count
const PLATFORMS = [
  { name: 'Adzuna', fetcher: adzuna },
  { name: 'Greenhouse', fetcher: greenhouse },
  { name: 'Lever', fetcher: lever },
];

const fetchAdzunaJobs = async () => {
  for (const { name, fetcher } of PLATFORMS) {
    try {
      const count = await fetcher.fetchJobs();
      if (count > 0) console.log(`[JobFetcher] ${name}: ${count} new jobs saved`);
    } catch (err) {
      console.error(`[JobFetcher] ${name} error:`, err.message);
    }
  }
};

module.exports = { fetchAdzunaJobs };
