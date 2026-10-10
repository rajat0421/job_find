// Guards requirement: "each scheduler is registered only once per process"
// and "safeguards against ... overlapping executions". Each test resets the
// module registry first so every job file's internal registration/running
// state starts fresh — these guards are per-process state, so tests must not
// leak state into each other.

jest.mock('node-cron', () => ({ schedule: jest.fn() }));

beforeEach(() => jest.resetModules());

describe('fetch cron', () => {
  test('registering twice in the same process only calls cron.schedule once', () => {
    jest.doMock('../../services/jobFetcher.service', () => ({ fetchAdzunaJobs: jest.fn().mockResolvedValue() }));
    const cron = require('node-cron');
    const { startFetchJobsCron } = require('../fetchJobs.job');

    startFetchJobsCron();
    startFetchJobsCron();

    expect(cron.schedule).toHaveBeenCalledTimes(1);
  });

  test('a tick firing while the previous fetch run is still in progress is skipped, not run concurrently', async () => {
    let resolveFetch;
    const fetchAdzunaJobs = jest.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
    jest.doMock('../../services/jobFetcher.service', () => ({ fetchAdzunaJobs }));
    const cron = require('node-cron');
    const { startFetchJobsCron } = require('../fetchJobs.job');

    startFetchJobsCron();
    const tick = cron.schedule.mock.calls[0][1];

    const firstRun = tick();   // starts, suspends on the in-flight fetchAdzunaJobs() promise
    const secondRun = tick();  // should see the first run still in progress and skip immediately

    resolveFetch();
    await firstRun;
    await secondRun;

    expect(fetchAdzunaJobs).toHaveBeenCalledTimes(1);
  });
});

describe('match cron', () => {
  test('registering twice in the same process only calls cron.schedule once', () => {
    jest.doMock('../../services/jobMatcher.service', () => ({ matchJobsForAllUsers: jest.fn().mockResolvedValue() }));
    jest.doMock('../../services/jobLifecycle.service', () => ({ expireStaleJobs: jest.fn().mockResolvedValue(0) }));
    const cron = require('node-cron');
    const { startMatchJobsCron } = require('../matchJobs.job');

    startMatchJobsCron();
    startMatchJobsCron();

    expect(cron.schedule).toHaveBeenCalledTimes(1);
  });

  test('a tick firing while the previous match run is still in progress is skipped, not run concurrently', async () => {
    let resolveMatch;
    const matchJobsForAllUsers = jest.fn(() => new Promise((resolve) => { resolveMatch = resolve; }));
    jest.doMock('../../services/jobMatcher.service', () => ({ matchJobsForAllUsers }));
    jest.doMock('../../services/jobLifecycle.service', () => ({ expireStaleJobs: jest.fn().mockResolvedValue(0) }));
    const cron = require('node-cron');
    const { startMatchJobsCron } = require('../matchJobs.job');

    startMatchJobsCron();
    const tick = cron.schedule.mock.calls[0][1];

    const firstRun = tick();
    const secondRun = tick();

    await Promise.resolve(); // let the mocked expireStaleJobs() resolve so runMatchTick reaches matchJobsForAllUsers()
    resolveMatch();
    await firstRun;
    await secondRun;

    expect(matchJobsForAllUsers).toHaveBeenCalledTimes(1);
  });
});

describe('email cron', () => {
  const mockModels = () => {
    jest.doMock('../../models/User', () => ({}));
    jest.doMock('../../models/UserJob', () => ({}));
    jest.doMock('../../models/EmailLog', () => ({}));
    jest.doMock('../../models/Config', () => ({}));
    jest.doMock('../../services/email.service', () => ({ sendJobDigestEmail: jest.fn(), sendAdminDigestCopy: jest.fn() }));
  };

  test('registering twice in the same process only calls cron.schedule once', () => {
    mockModels();
    jest.doMock('../../services/config.service', () => ({ getEmailThreshold: jest.fn() }));
    const cron = require('node-cron');
    const { startDailyEmailCron } = require('../dailyEmail.job');

    startDailyEmailCron();
    startDailyEmailCron();

    expect(cron.schedule).toHaveBeenCalledTimes(1);
  });

  test('registration still uses :20 past the hour, Asia/Kolkata — unaffected by the guard', () => {
    mockModels();
    jest.doMock('../../services/config.service', () => ({ getEmailThreshold: jest.fn() }));
    const cron = require('node-cron');
    const { startDailyEmailCron } = require('../dailyEmail.job');

    startDailyEmailCron();

    expect(cron.schedule).toHaveBeenCalledWith('20 * * * *', expect.any(Function), { timezone: 'Asia/Kolkata' });
  });

  test('a tick firing while the previous digest run is still in progress is skipped, not run concurrently', async () => {
    mockModels();
    jest.doMock('../../services/config.service', () => ({ getEmailThreshold: jest.fn().mockResolvedValue(50) }));
    jest.doMock('../../models/User', () => ({ find: jest.fn(() => new Promise(() => {})) })); // never resolves — simulates a long-running digest
    const cron = require('node-cron');
    const { startDailyEmailCron } = require('../dailyEmail.job');
    const User = require('../../models/User');

    startDailyEmailCron();
    const tick = cron.schedule.mock.calls[0][1];

    tick();  // first tick — starts sendDigest(), which hangs on User.find()
    tick();  // second tick — should see the first still in progress and skip immediately

    expect(User.find).toHaveBeenCalledTimes(1);
  });
});
