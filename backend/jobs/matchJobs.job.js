const cron = require('node-cron');
const { randomUUID } = require('crypto');
const { matchJobsForAllUsers, sweepStaleMatcherVersions } = require('../services/jobMatcher.service');
const { expireStaleJobs } = require('../services/jobLifecycle.service');
const MatchRun = require('../models/MatchRun');

let registered = false;
let task = null;
let running = false;

// Persists what actually happened this tick (Improvement 6: production
// observability) — a run that merely STARTED was previously indistinguishable
// from one that fully succeeded, since matchJobsForAllUsers() returned
// nothing. Never throws itself: a failure to WRITE the MatchRun record must
// never crash or re-run the matching pipeline that already happened.
const recordMatchRun = async (fields) => {
  try {
    await MatchRun.create(fields);
  } catch (err) {
    console.error('[Cron] Failed to record MatchRun:', err.message);
  }
};

const runMatchTick = async () => {
  if (running) {
    console.warn('[Cron] Match tick skipped — previous match run is still in progress');
    return;
  }
  running = true;
  const runId = randomUUID();
  const startedAt = new Date();
  let expiredCount = 0;
  let versionRescored = 0;
  let stats = null;
  let outcome = 'success';
  const errorSummary = [];
  try {
    console.log(`[Cron] [match:${runId}] Matching jobs...`);
    // Age-based expiry sweep runs first so matching never scores a stale posting
    // this cycle. Cheap (one indexed bulk update); never deletes anything.
    expiredCount = await expireStaleJobs();
    if (expiredCount > 0) console.log(`[Cron] [match:${runId}] Expired ${expiredCount} stale job(s)`);
    stats = await matchJobsForAllUsers();
    if ((stats?.errors || 0) > 0) outcome = 'partial'; // completed, but some writes failed — see jobMatcher.service.js
    // Bounded, resumable — only advances a fixed batch of matcherVersion-stale
    // UserJob records per tick (see jobMatcher.service.js). A no-op once
    // everything's current; only does real work right after a version bump.
    versionRescored = await sweepStaleMatcherVersions();
    if (versionRescored > 0) console.log(`[Cron] [match:${runId}] Rescored ${versionRescored} record(s) to the current matcher version`);
    console.log(`[Cron] [match:${runId}] Done (${outcome})`);
  } catch (err) {
    outcome = 'failed';
    stats = err.matchStats || stats; // partial progress, if any, attached by matchJobsForAllUsers before it threw
    errorSummary.push(err.message);
    console.error(`[Cron] [match:${runId}] Match tick failed:`, err.message);
  } finally {
    const finishedAt = new Date();
    await recordMatchRun({
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      outcome,
      usersConsidered: stats?.usersConsidered || 0,
      recentJobsConsidered: stats?.recentJobsConsidered || 0,
      pendingJobsConsidered: stats?.pendingJobsConsidered || 0,
      created: stats?.created || 0,
      updated: stats?.updated || 0,
      errorCount: stats?.errors || 0,
      pendingMarkedProcessed: stats?.pendingMarkedProcessed || false,
      versionRescored,
      expiredCount,
      errorSummary,
    });
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

// Exported so an admin-triggered "run now" action can invoke the EXACT same
// orchestration the scheduled cron uses — same expiry sweep, same bounded
// matching pass, same bounded version sweep, same MatchRun tracking, and the
// same `running` guard above (shared module state — a manual call and a
// cron tick can never run concurrently with each other, not just with
// themselves).
module.exports = { startMatchJobsCron, isMatchRunning, runMatchTick };
