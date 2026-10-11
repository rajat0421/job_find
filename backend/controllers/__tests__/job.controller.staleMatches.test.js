// Guards the fix for a gap found while investigating the Okta false-positive
// incident: jobs/dailyEmail.job.js's digest query already excludes any
// UserJob not yet reprocessed under the current MATCHER_VERSION, but
// job.controller.js's getMatchedJobs (the in-app "your matches" endpoint)
// had no equivalent check — a stale score computed under an old scoring
// algorithm could be presented as a current, verified recommendation while
// it sat waiting for the bounded version sweep to correct it.
//
// The fix mirrors the EXISTING, already-tested precedent in this same file
// (job.controller.test.js) for inactive (closed/expired) postings: excluded
// from normal recommendations, but a user's own saved/applied history always
// stays visible — never hidden by adding matcherVersion to the DB-level
// `filter` (that would ALSO hide a user's own history while it's awaiting
// re-scoring, not just unconfirmed new recommendations).

jest.mock('../../models/UserJob', () => ({ countDocuments: jest.fn(), find: jest.fn() }));
jest.mock('../../services/jobMatcher.service', () => ({ MATCHER_VERSION: 2 }));

const UserJob = require('../../models/UserJob');
const { MATCHER_VERSION } = require('../../services/jobMatcher.service');
const { getMatchedJobs } = require('../job.controller');

const buildQuery = (result) => {
  const q = {};
  q.sort = jest.fn(() => q);
  q.skip = jest.fn(() => q);
  q.limit = jest.fn(() => q);
  q.populate = jest.fn().mockResolvedValue(result);
  return q;
};

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const activeJob = (overrides = {}) => ({ _id: 'j1', title: 'Backend Developer', status: 'active', toObject() { return this; }, ...overrides });

beforeEach(() => jest.clearAllMocks());

test('1. a stale (version 1) record is not displayed as a current recommendation', async () => {
  UserJob.countDocuments.mockResolvedValue(1);
  UserJob.find.mockReturnValue(buildQuery([
    { _id: 'uj1', jobId: activeJob(), score: 88, saved: false, applied: false, matcherVersion: MATCHER_VERSION - 1 },
  ]));

  const res = mockRes();
  await getMatchedJobs({ query: {}, user: { id: 'u1' } }, res);

  expect(res.json.mock.calls[0][0].jobs).toHaveLength(0);
});

test('2. a current (version 2) recommendation remains visible', async () => {
  UserJob.countDocuments.mockResolvedValue(1);
  UserJob.find.mockReturnValue(buildQuery([
    { _id: 'uj1', jobId: activeJob(), score: 80, saved: false, applied: false, matcherVersion: MATCHER_VERSION },
  ]));

  const res = mockRes();
  await getMatchedJobs({ query: {}, user: { id: 'u1' } }, res);

  const { jobs } = res.json.mock.calls[0][0];
  expect(jobs).toHaveLength(1);
  expect(jobs[0].matchStale).toBe(false);
});

test('3. a stale (version 1) SAVED job remains accessible while awaiting re-scoring', async () => {
  UserJob.countDocuments.mockResolvedValue(1);
  UserJob.find.mockReturnValue(buildQuery([
    { _id: 'uj1', jobId: activeJob({ title: 'Saved while stale' }), score: 88, saved: true, applied: false, matcherVersion: MATCHER_VERSION - 1 },
  ]));

  const res = mockRes();
  await getMatchedJobs({ query: {}, user: { id: 'u1' } }, res);

  const { jobs } = res.json.mock.calls[0][0];
  expect(jobs).toHaveLength(1);
  expect(jobs[0].title).toBe('Saved while stale');
  expect(jobs[0].saved).toBe(true);
});

test('4. a stale (version 1) APPLIED job remains accessible while awaiting re-scoring', async () => {
  UserJob.countDocuments.mockResolvedValue(1);
  UserJob.find.mockReturnValue(buildQuery([
    { _id: 'uj1', jobId: activeJob({ title: 'Applied while stale' }), score: 88, saved: false, applied: true, matcherVersion: MATCHER_VERSION - 1 },
  ]));

  const res = mockRes();
  await getMatchedJobs({ query: {}, user: { id: 'u1' } }, res);

  const { jobs } = res.json.mock.calls[0][0];
  expect(jobs).toHaveLength(1);
  expect(jobs[0].title).toBe('Applied while stale');
  expect(jobs[0].applied).toBe(true);
});

test('5. a stale score is never presented as current — saved/applied stale records carry an explicit matchStale flag', async () => {
  UserJob.countDocuments.mockResolvedValue(2);
  UserJob.find.mockReturnValue(buildQuery([
    { _id: 'uj1', jobId: activeJob({ _id: 'j1' }), score: 88, saved: true, applied: false, matcherVersion: MATCHER_VERSION - 1 },
    { _id: 'uj2', jobId: activeJob({ _id: 'j2' }), score: 70, saved: false, applied: true, matcherVersion: MATCHER_VERSION - 1 },
  ]));

  const res = mockRes();
  await getMatchedJobs({ query: {}, user: { id: 'u1' } }, res);

  const { jobs } = res.json.mock.calls[0][0];
  expect(jobs).toHaveLength(2);
  expect(jobs.every((j) => j.matchStale === true)).toBe(true);
  // The old, uncorrected score is still what's returned for a saved/applied
  // record awaiting re-scoring (this endpoint never recomputes synchronously)
  // — `matchStale` is what lets a caller avoid presenting it as verified-current.
  expect(jobs.find((j) => j._id === 'j1').score).toBe(88);
});

test('6. closed/expired stale-version jobs that are NOT saved/applied are still excluded (both rules compose correctly)', async () => {
  UserJob.countDocuments.mockResolvedValue(1);
  UserJob.find.mockReturnValue(buildQuery([
    { _id: 'uj1', jobId: activeJob({ status: 'closed' }), score: 88, saved: false, applied: false, matcherVersion: MATCHER_VERSION - 1 },
  ]));

  const res = mockRes();
  await getMatchedJobs({ query: {}, user: { id: 'u1' } }, res);

  expect(res.json.mock.calls[0][0].jobs).toHaveLength(0);
});

test('7a. getMatchedJobs is strictly read-only — it never creates or writes a UserJob record', async () => {
  UserJob.countDocuments.mockResolvedValue(1);
  UserJob.find.mockReturnValue(buildQuery([
    { _id: 'uj1', jobId: activeJob(), score: 88, saved: true, applied: false, matcherVersion: MATCHER_VERSION - 1 },
  ]));

  await getMatchedJobs({ query: {}, user: { id: 'u1' } }, mockRes());

  expect(UserJob.create).toBeUndefined(); // not even imported/used by this controller
  expect(UserJob.find).toHaveBeenCalledTimes(1);
  expect(UserJob.countDocuments).toHaveBeenCalledTimes(1);
});

test('7b. the stale-version check is query-shape-neutral — the DB filter itself is untouched by matcherVersion', async () => {
  UserJob.countDocuments.mockResolvedValue(0);
  UserJob.find.mockReturnValue(buildQuery([]));

  await getMatchedJobs({ query: {}, user: { id: 'u1' } }, mockRes());

  // The DB-level filter must never include matcherVersion — doing so would
  // ALSO exclude a stale saved/applied record from being fetched at all,
  // which is exactly what this fix must avoid (see module-level comment).
  const filterArg = UserJob.find.mock.calls[0][0];
  expect(filterArg).not.toHaveProperty('matcherVersion');
  expect(UserJob.countDocuments.mock.calls[0][0]).not.toHaveProperty('matcherVersion');
});
