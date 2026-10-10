// Guards the fetch/match cron split: each pipeline must register its own
// schedule and must NOT call the other pipeline's function directly. This is
// the regression test for "separate fetching from matching" — if someone
// re-couples them (e.g. calls matchJobsForAllUsers from inside the fetch
// cron again), this test fails.

jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../../services/jobFetcher.service', () => ({ fetchAdzunaJobs: jest.fn().mockResolvedValue() }));
jest.mock('../../services/jobMatcher.service', () => ({
  matchJobsForAllUsers: jest.fn().mockResolvedValue(),
}));
jest.mock('../../services/jobLifecycle.service', () => ({
  expireStaleJobs: jest.fn().mockResolvedValue(0),
}));

const cron = require('node-cron');
const { fetchAdzunaJobs } = require('../../services/jobFetcher.service');
const { matchJobsForAllUsers } = require('../../services/jobMatcher.service');
const { expireStaleJobs } = require('../../services/jobLifecycle.service');
const { startFetchJobsCron } = require('../fetchJobs.job');
const { startMatchJobsCron } = require('../matchJobs.job');

describe('fetch/match cron split', () => {
  beforeEach(() => jest.clearAllMocks());

  test('fetch cron runs at :00 and only fetches — never calls matching', async () => {
    startFetchJobsCron();
    expect(cron.schedule).toHaveBeenCalledWith('0 * * * *', expect.any(Function));

    const tick = cron.schedule.mock.calls[0][1];
    await tick();

    expect(fetchAdzunaJobs).toHaveBeenCalledTimes(1);
    expect(matchJobsForAllUsers).not.toHaveBeenCalled();
  });

  test('match cron runs at :15 and only matches — never calls fetching', async () => {
    startMatchJobsCron();
    expect(cron.schedule).toHaveBeenCalledWith('15 * * * *', expect.any(Function));

    const tick = cron.schedule.mock.calls[0][1];
    await tick();

    expect(expireStaleJobs).toHaveBeenCalledTimes(1);
    expect(matchJobsForAllUsers).toHaveBeenCalledTimes(1);
    expect(fetchAdzunaJobs).not.toHaveBeenCalled();
  });
});
