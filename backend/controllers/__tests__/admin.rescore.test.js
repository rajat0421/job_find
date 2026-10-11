// Guards the Admin Safety and Consistency Pass: fixGreenhouseDescriptions,
// rescoreAllUsers, and backfillMatches were all previously unbounded,
// single-request operations (one looped over every onboarded user and every
// one of their UserJob records with no batching at all; another loaded every
// Greenhouse job in the database in one query). All three now either run a
// genuinely bounded batch of their own, or delegate entirely to an existing
// bounded/orchestrated mechanism rather than re-implementing one.
//
// The underlying "never delete a UserJob, even one that now scores 0" and
// "preserve saved/applied history" guarantees for the version sweep and
// match cycle are proven where those mechanisms actually live — see
// services/__tests__/jobMatcher.coverage.test.js and
// services/__tests__/jobMatcher.version2.test.js. This file verifies the
// admin endpoints correctly delegate to (or bound) those mechanisms, not the
// mechanisms themselves.

jest.mock('../../models/Job', () => ({ find: jest.fn(), countDocuments: jest.fn() }));
jest.mock('../../models/UserJob', () => ({ find: jest.fn(), bulkWrite: jest.fn().mockResolvedValue({}) }));
jest.mock('../../models/Config', () => ({ findOne: jest.fn(), updateOne: jest.fn().mockResolvedValue({}) }));
jest.mock('../../services/jobMatcher.service', () => ({
  scoreJob: jest.fn(),
  scoreJobDetailed: jest.fn().mockReturnValue({ score: 0, matchedSkills: [], matchedRole: null, reasons: [] }),
  scoreJobWithBreakdown: jest.fn(),
  matchJobsForAllUsers: jest.fn(),
  sweepStaleMatcherVersions: jest.fn(),
  getMatcherVersionBacklog: jest.fn(),
  computeUserFingerprint: jest.fn().mockReturnValue('uf'),
  computeJobFingerprint: jest.fn().mockReturnValue('jf'),
  MATCHER_VERSION: 2,
}));
jest.mock('../../jobs/matchJobs.job', () => ({ runMatchTick: jest.fn(), isMatchRunning: jest.fn().mockReturnValue(false) }));

const Job = require('../../models/Job');
const UserJob = require('../../models/UserJob');
const Config = require('../../models/Config');
const { sweepStaleMatcherVersions, getMatcherVersionBacklog } = require('../../services/jobMatcher.service');
const { runMatchTick, isMatchRunning } = require('../../jobs/matchJobs.job');
const { fixGreenhouseDescriptions, rescoreAllUsers, backfillMatches } = require('../admin.controller');

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const buildFindQuery = (result) => {
  const q = {};
  q.sort = jest.fn(() => q);
  q.limit = jest.fn(() => q);
  q.populate = jest.fn(() => q);
  q.then = (resolve) => Promise.resolve(result).then(resolve);
  return q;
};

beforeEach(() => jest.clearAllMocks());

describe('fixGreenhouseDescriptions — bounded, resumable Greenhouse HTML sweep', () => {
  const ghJob = (id, description) => ({ _id: id, description, save: jest.fn(async function () {}) });

  test('processes at most GREENHOUSE_FIX_BATCH_SIZE jobs, never the whole collection, and limits the query accordingly', async () => {
    Config.findOne.mockResolvedValue(null); // no cursor yet — first run
    const batchQuery = buildFindQuery([]);
    Job.find.mockReturnValue(batchQuery);
    Job.countDocuments.mockResolvedValue(0);
    UserJob.find.mockReturnValue(buildFindQuery([]));

    await fixGreenhouseDescriptions({}, mockRes());

    expect(batchQuery.limit).toHaveBeenCalledWith(200);
  });

  test('resumes from the persisted cursor instead of starting over each time', async () => {
    Config.findOne.mockResolvedValue({ value: 'cursor123' });
    Job.find.mockReturnValue(buildFindQuery([]));
    Job.countDocuments.mockResolvedValue(0);
    UserJob.find.mockReturnValue(buildFindQuery([]));

    await fixGreenhouseDescriptions({}, mockRes());

    expect(Job.find).toHaveBeenCalledWith(expect.objectContaining({ source: 'greenhouse', _id: { $gt: 'cursor123' } }));
  });

  test('advances the cursor to the last processed job only after a successful batch', async () => {
    Config.findOne.mockResolvedValue(null);
    Job.find.mockReturnValueOnce(buildFindQuery([ghJob('j1', '<p>x</p>'), ghJob('j2', 'clean')]));
    Job.countDocuments.mockResolvedValue(0);
    UserJob.find.mockReturnValue(buildFindQuery([]));

    await fixGreenhouseDescriptions({}, mockRes());

    expect(Config.updateOne).toHaveBeenCalledWith(
      { key: 'greenhouseHtmlFixCursor' },
      { $set: { value: 'j2' } },
      { upsert: true }
    );
  });

  test('only re-saves a job whose description actually changes', async () => {
    Config.findOne.mockResolvedValue(null);
    const unchanged = ghJob('j1', 'already clean');
    const changed = ghJob('j2', '<p>needs cleaning</p>');
    Job.find.mockReturnValueOnce(buildFindQuery([unchanged, changed]));
    Job.countDocuments.mockResolvedValue(0);
    UserJob.find.mockReturnValue(buildFindQuery([]));

    const res = mockRes();
    await fixGreenhouseDescriptions({}, res);

    expect(unchanged.save).not.toHaveBeenCalled();
    expect(changed.save).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].jobsFixed).toBe(1);
  });

  test('only rescored UserJob records for jobs in THIS batch — bounded, not the whole greenhouse set', async () => {
    Config.findOne.mockResolvedValue(null);
    Job.find.mockReturnValueOnce(buildFindQuery([ghJob('j1', 'x')]));
    Job.countDocuments.mockResolvedValue(0);
    UserJob.find.mockReturnValue(buildFindQuery([]));

    await fixGreenhouseDescriptions({}, mockRes());

    expect(UserJob.find).toHaveBeenCalledWith({ jobId: { $in: ['j1'] } });
  });

  test('wraps around to the start once a full pass completes', async () => {
    Config.findOne.mockResolvedValue({ value: 'end-cursor' });
    Job.find
      .mockReturnValueOnce(buildFindQuery([])) // nothing after the cursor — pass complete
      .mockReturnValueOnce(buildFindQuery([ghJob('j1', 'x')])); // wrap-around query from the start
    Job.countDocuments.mockResolvedValue(0);
    UserJob.find.mockReturnValue(buildFindQuery([]));

    const res = mockRes();
    await fixGreenhouseDescriptions({}, res);

    expect(Job.find).toHaveBeenCalledTimes(2);
    expect(res.json.mock.calls[0][0].message).toMatch(/started a new pass/i);
  });

  test('a mid-batch failure leaves the cursor untouched, so a retry safely redoes the same batch', async () => {
    Config.findOne.mockResolvedValue(null);
    const failing = { _id: 'j1', description: '<p>x</p>', save: jest.fn().mockRejectedValue(new Error('DB blip')) };
    Job.find.mockReturnValueOnce(buildFindQuery([failing]));

    await fixGreenhouseDescriptions({}, mockRes());

    expect(Config.updateOne).not.toHaveBeenCalled();
  });

  test('rejects a second concurrent call while a batch is already running', async () => {
    Config.findOne.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(null), 20)));
    Job.find.mockReturnValue(buildFindQuery([]));
    Job.countDocuments.mockResolvedValue(0);
    UserJob.find.mockReturnValue(buildFindQuery([]));

    const res1 = mockRes();
    const res2 = mockRes();
    const p1 = fixGreenhouseDescriptions({}, res1);
    const p2 = fixGreenhouseDescriptions({}, res2);
    await Promise.all([p1, p2]);

    expect(res2.status).toHaveBeenCalledWith(409);
  });
});

describe('rescoreAllUsers — delegates to the existing bounded version sweep, not a second implementation', () => {
  test('calls sweepStaleMatcherVersions and getMatcherVersionBacklog, never loads User/UserJob itself', async () => {
    sweepStaleMatcherVersions.mockResolvedValue(42);
    getMatcherVersionBacklog.mockResolvedValue(10);

    const res = mockRes();
    await rescoreAllUsers({}, res);

    expect(sweepStaleMatcherVersions).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ rescored: 42, remainingBacklog: 10 }));
  });

  test('message indicates when more stale records remain, so the admin knows whether to click again', async () => {
    sweepStaleMatcherVersions.mockResolvedValue(300);
    getMatcherVersionBacklog.mockResolvedValue(150);

    const res = mockRes();
    await rescoreAllUsers({}, res);

    expect(res.json.mock.calls[0][0].message).toMatch(/150.*still stale/i);
  });

  test('message confirms completion when no backlog remains', async () => {
    sweepStaleMatcherVersions.mockResolvedValue(5);
    getMatcherVersionBacklog.mockResolvedValue(0);

    const res = mockRes();
    await rescoreAllUsers({}, res);

    expect(res.json.mock.calls[0][0].message).toMatch(/no stale records remain/i);
  });

  test('rejects a second concurrent call while a sweep batch is already running', async () => {
    sweepStaleMatcherVersions.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(1), 20)));
    getMatcherVersionBacklog.mockResolvedValue(0);

    const res1 = mockRes();
    const res2 = mockRes();
    const p1 = rescoreAllUsers({}, res1);
    const p2 = rescoreAllUsers({}, res2);
    await Promise.all([p1, p2]);

    expect(res2.status).toHaveBeenCalledWith(409);
  });
});

describe('backfillMatches — invokes the full shared cron orchestration, not a partial match-only call', () => {
  test('calls runMatchTick (the same function the scheduled cron calls) rather than matchJobsForAllUsers directly', async () => {
    runMatchTick.mockResolvedValue(undefined);

    await backfillMatches({}, mockRes());

    expect(runMatchTick).toHaveBeenCalledTimes(1);
  });

  test('checks isMatchRunning first and returns 409 without calling runMatchTick again if a cycle is already in progress', async () => {
    isMatchRunning.mockReturnValue(true);

    const res = mockRes();
    await backfillMatches({}, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(runMatchTick).not.toHaveBeenCalled();
  });

  test('a failure inside runMatchTick is reported, not swallowed', async () => {
    isMatchRunning.mockReturnValue(false);
    runMatchTick.mockRejectedValue(new Error('match tick exploded'));

    const res = mockRes();
    await backfillMatches({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
