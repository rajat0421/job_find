const cron = require('node-cron');
const { fetchAdzunaJobs } = require('../services/jobFetcher.service');

// Fetch pipeline only — writes to the Job collection. Matching is a separate,
// independently-scheduled pipeline (see matchJobs.job.js) so a slow fetch run
// (more companies, a flaky platform) never drags matching's schedule with it.
const startFetchJobsCron = () => {
  // Runs every hour at :00
  cron.schedule('0 * * * *', async () => {
    console.log('[Cron] Fetching jobs...');
    await fetchAdzunaJobs();
  });

  console.log('[Cron] Job fetcher scheduled — runs every hour at :00');
};

module.exports = { startFetchJobsCron };
