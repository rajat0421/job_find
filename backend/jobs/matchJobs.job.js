const cron = require('node-cron');
const { matchJobsForAllUsers, sweepStaleMatcherVersions } = require('../services/jobMatcher.service');
const { expireStaleJobs } = require('../services/jobLifecycle.service');

let registered = false;
let task = null;
let running = false;

const runMatchTick = async () => {
  if (running) {
    console.warn('[Cron] Match tick skipped — previous match run is still in progress');
    return;
  }
  running = true;
  try {
    console.log('[Cron] Matching jobs...');
    // Age-based expiry sweep runs first so matching never scores a stale posting
    // this cycle. Cheap (one indexed bulk update); never deletes anything.
    const expiredCount = await expireStaleJobs();
    if (expiredCount > 0) console.log(`[Cron] Expired ${expiredCount} stale job(s)`);
    await matchJobsForAllUsers();
    // Bounded, resumable — only advances a fixed batch of matcherVersion-stale
    // UserJob records per tick (see jobMatcher.service.js). A no-op once
    // everything's current; only does real work right after a version bump.
    const versionRescored = await sweepStaleMatcherVersions();
    if (versionRescored > 0) console.log(`[Cron] Rescored ${versionRescored} record(s) to the current matcher version`);
  } finally {
    running = false;
  }
};

// Matching pipeline only — reads whatever is in the Job collection and writes
// UserJob. Decoupled from the fetch cron's schedule/duration on purpose: it
// just reads the latest state of Job, so it doesn't need to know whether (or
// how long) a fetch run took. Offset to :15 so it normally runs after the
// :00 fetch has had time to land new jobs, without depending on it directly.
//
// Guarded against being registered twice in the same process (idempotent —
// returns the existing task instead) and against overlapping runs (a tick
// that fires while the previous match run is still in progress is skipped).
const startMatchJobsCron = () => {
  if (registered) {
    console.warn('[Cron] Match cron already registered in this process — ignoring duplicate call');
    return task;
  }
  registered = true;
  task = cron.schedule('15 * * * *', runMatchTick);
  console.log('[Cron] Job matcher scheduled — runs every hour at :15');
  return task;
};

const isMatchRunning = () => running;

module.exports = { startMatchJobsCron, isMatchRunning };
