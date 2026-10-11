// Guards Improvement 3's step 5: inactive jobs are excluded from normal
// recommendations, but remain visible in a user's own saved/applied history
// (requirement #8 and #9 of the lifecycle test plan).

jest.mock('../../models/UserJob', () => ({ countDocuments: jest.fn(), find: jest.fn() }));
jest.mock('../../services/jobMatcher.service', () => ({ MATCHER_VERSION: 2 }));

const UserJob = require('../../models/UserJob');
const { MATCHER_VERSION } = require('../../services/jobMatcher.service');
const { getMatchedJobs } = require('../job.controller');

// Every fixture here is deliberately CURRENT-version unless a test is
// specifically about staleness (see job.controller.staleMatches.test.js) —
// these tests exist to guard the inactive-status exclusion, not version
// handling, so their baseline must not be confounded by the separate,
// unrelated matcherVersion filter.

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

beforeEach(() => jest.clearAllMocks());

test('excludes a closed/expired job that is neither saved nor applied', async () => {
  UserJob.countDocuments.mockResolvedValue(2);
  UserJob.find.mockReturnValue(buildQuery([
    { _id: 'uj1', jobId: { _id: 'j1', title: 'Active role', toObject() { return this; } }, score: 80, saved: false, applied: false, matcherVersion: MATCHER_VERSION },
    { _id: 'uj2', jobId: { _id: 'j2', title: 'Closed role', status: 'closed', toObject() { return this; } }, score: 70, saved: false, applied: false, matcherVersion: MATCHER_VERSION },
  ]));

  const res = mockRes();
  await getMatchedJobs({ query: {}, user: { id: 'u1' } }, res);

  const body = res.json.mock.calls[0][0];
  expect(body.jobs).toHaveLength(1);
  expect(body.jobs[0].title).toBe('Active role');
});

test('keeps a saved job visible even after it closes, with its status passed through', async () => {
  UserJob.countDocuments.mockResolvedValue(1);
  UserJob.find.mockReturnValue(buildQuery([
    { _id: 'uj1', jobId: { _id: 'j1', title: 'Closed but saved', status: 'closed', toObject() { return this; } }, score: 70, saved: true, applied: false, matcherVersion: MATCHER_VERSION },
  ]));

  const res = mockRes();
  await getMatchedJobs({ query: {}, user: { id: 'u1' } }, res);

  const body = res.json.mock.calls[0][0];
  expect(body.jobs).toHaveLength(1);
  expect(body.jobs[0].status).toBe('closed');
});

test('keeps an applied job visible even after it expires', async () => {
  UserJob.countDocuments.mockResolvedValue(1);
  UserJob.find.mockReturnValue(buildQuery([
    { _id: 'uj1', jobId: { _id: 'j1', title: 'Expired but applied', status: 'expired', toObject() { return this; } }, score: 70, saved: false, applied: true, matcherVersion: MATCHER_VERSION },
  ]));

  const res = mockRes();
  await getMatchedJobs({ query: {}, user: { id: 'u1' } }, res);

  const body = res.json.mock.calls[0][0];
  expect(body.jobs).toHaveLength(1);
});

test('an active job with neither saved nor applied is still shown normally', async () => {
  UserJob.countDocuments.mockResolvedValue(1);
  UserJob.find.mockReturnValue(buildQuery([
    { _id: 'uj1', jobId: { _id: 'j1', title: 'Open role', status: 'active', toObject() { return this; } }, score: 90, saved: false, applied: false, matcherVersion: MATCHER_VERSION },
  ]));

  const res = mockRes();
  await getMatchedJobs({ query: {}, user: { id: 'u1' } }, res);

  const body = res.json.mock.calls[0][0];
  expect(body.jobs).toHaveLength(1);
});
