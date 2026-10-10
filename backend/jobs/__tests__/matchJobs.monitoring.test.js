// Guards Improvement 6: a match-cron tick now persists a MatchRun document
// describing what actually happened, instead of leaving "did this tick
// succeed?" unanswerable. Does not re-test the cron-registration/overlap
// guards (see cronGuards.test.js) — only the outcome classification and the
// resumability guarantee (a failed tick must not lose the ability to retry).

jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../../services/jobLifecycle.service', () => ({ expireStaleJobs: jest.fn().mockResolvedValue(0) }));
jest.mock('../../models/MatchRun', () => ({ create: jest.fn().mockResolvedValue({}) }));

const { expireStaleJobs } = require('../../services/jobLifecycle.service');
const MatchRun = require('../../models/MatchRun');

const loadWithMatcher = (matcherMock) => {
  jest.resetModules();
  jest.doMock('node-cron', () => ({ schedule: jest.fn() }));
  jest.doMock('../../services/jobLifecycle.service', () => ({ expireStaleJobs: jest.fn().mockResolvedValue(0) }));
  jest.doMock('../../models/MatchRun', () => ({ create: jest.fn().mockResolvedValue({}) }));
  jest.doMock('../../services/jobMatcher.service', () => matcherMock);
  const cron = require('node-cron');
  const { startMatchJobsCron } = require('../matchJobs.job');
  startMatchJobsCron();
  const tick = cron.schedule.mock.calls[0][1];
  const RunMatchRun = require('../../models/MatchRun');
  return { tick, RunMatchRun };
};

beforeEach(() => jest.clearAllMocks());

test('a clean run with zero write errors records outcome "success" with its stats', async () => {
  const stats = { usersConsidered: 3, recentJobsConsidered: 10, pendingJobsConsidered: 2, created: 4, updated: 1, errors: 0, pendingMarkedProcessed: true };
  const { tick, RunMatchRun } = loadWithMatcher({
    matchJobsForAllUsers: jest.fn().mockResolvedValue(stats),
    sweepStaleMatcherVersions: jest.fn().mockResolvedValue(0),
  });

  await tick();

  expect(RunMatchRun.create).toHaveBeenCalledWith(expect.objectContaining({
    outcome: 'success', created: 4, updated: 1, errorCount: 0, pendingMarkedProcessed: true,
  }));
});

test('a run that completes but had tolerated write errors records outcome "partial"', async () => {
  const stats = { usersConsidered: 3, recentJobsConsidered: 10, pendingJobsConsidered: 2, created: 4, updated: 1, errors: 2, pendingMarkedProcessed: true };
  const { tick, RunMatchRun } = loadWithMatcher({
    matchJobsForAllUsers: jest.fn().mockResolvedValue(stats),
    sweepStaleMatcherVersions: jest.fn().mockResolvedValue(0),
  });

  await tick();

  expect(RunMatchRun.create).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'partial', errorCount: 2 }));
});

test('a run that throws records outcome "failed", preserves partial stats, and does not crash the tick', async () => {
  const err = new Error('DB connection dropped');
  err.matchStats = { usersConsidered: 3, recentJobsConsidered: 10, pendingJobsConsidered: 2, created: 1, updated: 0, errors: 0, pendingMarkedProcessed: false };
  const { tick, RunMatchRun } = loadWithMatcher({
    matchJobsForAllUsers: jest.fn().mockRejectedValue(err),
    sweepStaleMatcherVersions: jest.fn().mockResolvedValue(0),
  });

  await expect(tick()).resolves.not.toThrow();

  expect(RunMatchRun.create).toHaveBeenCalledWith(expect.objectContaining({
    outcome: 'failed',
    created: 1, // partial progress before the throw is still recorded
    pendingMarkedProcessed: false, // so the pending batch stays eligible for retry next tick
    errorSummary: ['DB connection dropped'],
  }));
});

test('a thrown error with no attached matchStats still records a failed run without crashing', async () => {
  const { tick, RunMatchRun } = loadWithMatcher({
    matchJobsForAllUsers: jest.fn().mockRejectedValue(new Error('totally unexpected')),
    sweepStaleMatcherVersions: jest.fn().mockResolvedValue(0),
  });

  await expect(tick()).resolves.not.toThrow();

  expect(RunMatchRun.create).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed', created: 0 }));
});

test('a failure to WRITE the MatchRun record itself is logged but never crashes the tick', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.resetModules();
  jest.doMock('node-cron', () => ({ schedule: jest.fn() }));
  jest.doMock('../../services/jobLifecycle.service', () => ({ expireStaleJobs: jest.fn().mockResolvedValue(0) }));
  jest.doMock('../../models/MatchRun', () => ({ create: jest.fn().mockRejectedValue(new Error('Mongo down')) }));
  jest.doMock('../../services/jobMatcher.service', () => ({
    matchJobsForAllUsers: jest.fn().mockResolvedValue({ usersConsidered: 0, recentJobsConsidered: 0, pendingJobsConsidered: 0, created: 0, updated: 0, errors: 0, pendingMarkedProcessed: true }),
    sweepStaleMatcherVersions: jest.fn().mockResolvedValue(0),
  }));
  const cron = require('node-cron');
  const { startMatchJobsCron } = require('../matchJobs.job');
  startMatchJobsCron();
  const tick = cron.schedule.mock.calls[0][1];

  await expect(tick()).resolves.not.toThrow();

  errorSpy.mockRestore();
});
