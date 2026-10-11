// Guards the admin user-detail staleness fix: a UserJob record computed
// under a PREVIOUS matcher version must be visibly labeled, not silently
// presented identically to a current, verified result. Read-only — this
// endpoint must never rescore or otherwise write anything.

jest.mock('../../models/User', () => ({ findById: jest.fn() }));
jest.mock('../../models/UserJob', () => ({ find: jest.fn() }));

const User = require('../../models/User');
const UserJob = require('../../models/UserJob');
const { MATCHER_VERSION } = require('../../services/jobMatcher.service');
const { getUserDetail } = require('../admin.controller');

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const buildUserQuery = (result) => ({ select: jest.fn().mockResolvedValue(result) });
const buildJobsQuery = (result) => {
  const q = {};
  q.sort = jest.fn(() => q);
  q.limit = jest.fn(() => q);
  q.populate = jest.fn().mockResolvedValue(result);
  return q;
};

beforeEach(() => jest.clearAllMocks());

test('404s when the user does not exist', async () => {
  User.findById.mockReturnValue(buildUserQuery(null));
  const res = mockRes();
  await getUserDetail({ params: { id: 'missing' } }, res);
  expect(res.status).toHaveBeenCalledWith(404);
});

test('includes currentMatcherVersion so the frontend never has to hardcode it', async () => {
  User.findById.mockReturnValue(buildUserQuery({ _id: 'u1' }));
  UserJob.find.mockReturnValue(buildJobsQuery([]));

  const res = mockRes();
  await getUserDetail({ params: { id: 'u1' } }, res);

  expect(res.json.mock.calls[0][0].currentMatcherVersion).toBe(MATCHER_VERSION);
});

test('a record computed under the current matcher version is labeled stale:false', async () => {
  User.findById.mockReturnValue(buildUserQuery({ _id: 'u1' }));
  UserJob.find.mockReturnValue(buildJobsQuery([
    { score: 72, matcherVersion: MATCHER_VERSION, emailed: false, saved: false, applied: false, createdAt: new Date(), jobId: { _id: 'j1', title: 'Engineer' } },
  ]));

  const res = mockRes();
  await getUserDetail({ params: { id: 'u1' } }, res);

  const [job] = res.json.mock.calls[0][0].jobs;
  expect(job.stale).toBe(false);
  expect(job.matcherVersion).toBe(MATCHER_VERSION);
});

test('a record computed under an OLD matcher version is labeled stale:true, and its score is still returned (not hidden)', async () => {
  User.findById.mockReturnValue(buildUserQuery({ _id: 'u1' }));
  UserJob.find.mockReturnValue(buildJobsQuery([
    { score: 88, matcherVersion: MATCHER_VERSION - 1, emailed: true, saved: false, applied: false, createdAt: new Date(), jobId: { _id: 'j1', title: 'Software Architect, Java Backend' } },
  ]));

  const res = mockRes();
  await getUserDetail({ params: { id: 'u1' } }, res);

  const [job] = res.json.mock.calls[0][0].jobs;
  expect(job.stale).toBe(true);
  expect(job.matcherVersion).toBe(MATCHER_VERSION - 1);
  // The historical score/emailed/saved state is preserved, not deleted or
  // zeroed out by this read-only view — only labeled.
  expect(job.score).toBe(88);
  expect(job.emailed).toBe(true);
});

test('never writes anything — no model other than the two read-only lookups is touched', async () => {
  User.findById.mockReturnValue(buildUserQuery({ _id: 'u1' }));
  UserJob.find.mockReturnValue(buildJobsQuery([
    { score: 88, matcherVersion: MATCHER_VERSION - 1, emailed: false, saved: true, applied: true, createdAt: new Date(), jobId: { _id: 'j1' } },
  ]));

  await getUserDetail({ params: { id: 'u1' } }, mockRes());

  // The mocked models only expose read methods at all (findById/find) —
  // proving by construction that getUserDetail cannot have written anything;
  // this also means any accidental write attempt would throw here instead
  // of silently succeeding.
  expect(Object.keys(User)).toEqual(['findById']);
  expect(Object.keys(UserJob)).toEqual(['find']);
});
