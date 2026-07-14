const adzuna = require('../platforms/adzuna');
const greenhouse = require('../platforms/greenhouse');
const lever = require('../platforms/lever');
const ashby = require('../platforms/ashby');
const FetchRun = require('../models/FetchRun');

// Add new platforms here — each fetchJobs() returns { fetched, added }
const PLATFORMS = [
  { name: 'Adzuna', fetcher: adzuna },
  { name: 'Greenhouse', fetcher: greenhouse },
  { name: 'Lever', fetcher: lever },
  { name: 'Ashby', fetcher: ashby },
];

const fetchAdzunaJobs = async () => {
  const start = Date.now();
  const sources = [];

  for (const { name, fetcher } of PLATFORMS) {
    try {
      const r = await fetcher.fetchJobs();
      const added = r?.added || 0;
      const fetched = r?.fetched || 0;
      sources.push({ name, fetched, added });
      console.log(`[JobFetcher] ${name}: ${added} new / ${fetched} fetched`);
    } catch (err) {
      console.error(`[JobFetcher] ${name} error:`, err.message);
      sources.push({ name, fetched: 0, added: 0 });
    }
  }

  const totalFetched = sources.reduce((s, x) => s + x.fetched, 0);
  const totalAdded = sources.reduce((s, x) => s + x.added, 0);

  try {
    await FetchRun.create({ sources, totalFetched, totalAdded, durationMs: Date.now() - start });
  } catch (err) {
    console.error('[JobFetcher] Failed to record FetchRun:', err.message);
  }

  return { sources, totalFetched, totalAdded };
};

module.exports = { fetchAdzunaJobs };
