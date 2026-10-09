const cron = require('node-cron');
const { fetchAdzunaJobs } = require('../services/jobFetcher.service');

let registered = false;
let task = null;
let running = false;

const runFetchTick = async () => {
  if (running) {
    console.warn('[Cron] Fetch tick skipped — previous fetch run is still in progress');
    return;
  }
  running = true;
  try {
    console.log('[Cron] Fetching jobs...');
    await fetchAdzunaJobs();
  } finally {
    running = false;
  }
};

// Fetch pipeline only — writes to the Job collection. Matching is a separate,
// independently-scheduled pipeline (see matchJobs.job.js) so a slow fetch run
// (more companies, a flaky platform) never drags matching's schedule with it.
//
// Guarded against being registered twice in the same process (idempotent —
// returns the existing task instead) and against overlapping runs (a tick
// that fires while the previous fetch is still in progress is skipped, not
// queued or run concurrently).
const startFetchJobsCron = () => {
  if (registered) {
    console.warn('[Cron] Fetch cron already registered in this process — ignoring duplicate call');
    return task;
  }
  registered = true;
  task = cron.schedule('0 * * * *', runFetchTick);
  console.log('[Cron] Job fetcher scheduled — runs every hour at :00');
  return task;
};

const isFetchRunning = () => running;

module.exports = { startFetchJobsCron, isFetchRunning };
