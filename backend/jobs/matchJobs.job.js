const cron = require('node-cron');
const { matchJobsForAllUsers } = require('../services/jobMatcher.service');

// Matching pipeline only — reads whatever is in the Job collection and writes
// UserJob. Decoupled from the fetch cron's schedule/duration on purpose: it
// just reads the latest state of Job, so it doesn't need to know whether (or
// how long) a fetch run took. Offset to :15 so it normally runs after the
// :00 fetch has had time to land new jobs, without depending on it directly.
const startMatchJobsCron = () => {
  cron.schedule('15 * * * *', async () => {
    console.log('[Cron] Matching jobs...');
    await matchJobsForAllUsers();
  });

  console.log('[Cron] Job matcher scheduled — runs every hour at :15');
};

module.exports = { startMatchJobsCron };
