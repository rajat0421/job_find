const { startFetchJobsCron, isFetchRunning } = require('./fetchJobs.job');
const { startMatchJobsCron, isMatchRunning } = require('./matchJobs.job');
const { startDailyEmailCron, isEmailRunning } = require('./dailyEmail.job');

let started = false;
let tasks = [];

const stopAll = () => {
  tasks.forEach((t) => t?.stop?.());
};

const isBusy = () => isFetchRunning() || isMatchRunning() || isEmailRunning();

// Registers all three background pipelines (fetch :00, match :15, email :20)
// for this process. Each individual job file already guards against being
// registered twice, but this flag makes the "schedulers start exactly once
// per process" guarantee explicit at the single call site used by both the
// "all" and "worker" process roles.
const startSchedulers = () => {
  if (started) {
    console.warn('[Scheduler] Schedulers already started in this process — ignoring duplicate call');
    return { stopAll, isBusy };
  }
  started = true;

  tasks = [startFetchJobsCron(), startMatchJobsCron(), startDailyEmailCron()];
  console.log('[Scheduler] All background jobs registered (fetch :00, match :15, email :20)');

  return { stopAll, isBusy };
};

module.exports = { startSchedulers };
