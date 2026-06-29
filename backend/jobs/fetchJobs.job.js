const cron = require('node-cron');
const { fetchAdzunaJobs } = require('../services/jobFetcher.service');
const { matchJobsForAllUsers } = require('../services/jobMatcher.service');

const startFetchJobsCron = () => {
  // Runs every hour at :00
  cron.schedule('0 * * * *', async () => {
    console.log('[Cron] Fetching jobs...');
    await fetchAdzunaJobs();
    await matchJobsForAllUsers();
  });

  console.log('[Cron] Job fetcher scheduled — runs every hour');
};

module.exports = { startFetchJobsCron };
