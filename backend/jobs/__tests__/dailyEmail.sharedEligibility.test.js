// Guards Improvement 11's follow-up gap #2: sendDigestForUser (the admin's
// manual per-user send) previously used its OWN query, missing the
// matcherVersion/needsMatching/userFingerprint staleness checks the scheduled
// cron already had. Both paths now call this one exported function —
// getEligibleDigestJobs — directly, so this file tests it once, here, rather
// than duplicating the same assertions in both dailyEmail.job.js's and
// admin.controller.js's test suites.

jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../../models/User', () => ({ find: jest.fn(), updateOne: jest.fn() }));
jest.mock('../../models/UserJob', () => ({ find: jest.fn(), countDocuments: jest.fn(), updateMany: jest.fn() }));
jest.mock('../../models/EmailLog', () => ({ create: jest.fn(), findByIdAndUpdate: jest.fn(), findOne: jest.fn() }));
jest.mock('../../models/Config', () => ({ findOne: jest.fn() }));
jest.mock('../../services/email.service', () => ({ sendJobDigestEmail: jest.fn(), sendAdminDigestCopy: jest.fn() }));
jest.mock('../../services/config.service', () => ({ getEmailThreshold: jest.fn() }));

const UserJob = require('../../models/UserJob');
const { computeUserFingerprint, MATCHER_VERSION } = require('../../services/jobMatcher.service');
const { getEligibleDigestJobs } = require('../dailyEmail.job');

const USER = { _id: 'u1', email: 'a@x.com', name: 'A', skills: ['Python'] };
const USER_FINGERPRINT = computeUserFingerprint(USER);

const buildUserJobQuery = (resolvedJobs) => {
  const query = {};
  query.sort = jest.fn(() => query);
  query.limit = jest.fn(() => query);
  query.populate = jest.fn().mockResolvedValue(resolvedJobs);
  return query;
};

beforeEach(() => jest.clearAllMocks());

test('excludes a record whose matcherVersion is not current — stale scoring algorithm result', async () => {
  // Not even returned by the query itself (matcherVersion is a Mongo filter),
  // but asserting the filter shape proves the SAME check sendDigest relies on
  // is applied here.
  const query = buildUserJobQuery([]);
  UserJob.find.mockReturnValue(query);

  await getEligibleDigestJobs(USER, 50);

  expect(UserJob.find).toHaveBeenCalledWith(expect.objectContaining({ matcherVersion: MATCHER_VERSION }));
});

test('excludes a record whose job is pending reprocessing (needsMatching:true), even if its stored score clears the threshold', async () => {
  const pending = { _id: 'uj1', jobId: { status: 'active', needsMatching: true }, score: 90, matcherVersion: MATCHER_VERSION, userFingerprint: USER_FINGERPRINT };
  UserJob.find.mockReturnValue(buildUserJobQuery([pending]));

  const eligible = await getEligibleDigestJobs(USER, 50);

  expect(eligible).toHaveLength(0);
});

test('excludes a record whose job status is closed/expired', async () => {
  const closed = { _id: 'uj1', jobId: { status: 'closed', needsMatching: false }, score: 90, matcherVersion: MATCHER_VERSION, userFingerprint: USER_FINGERPRINT };
  UserJob.find.mockReturnValue(buildUserJobQuery([closed]));

  const eligible = await getEligibleDigestJobs(USER, 50);

  expect(eligible).toHaveLength(0);
});

test('excludes a record scored under a stale (outdated) user profile fingerprint — e.g. the profile changed since this score was computed', async () => {
  const staleProfile = { _id: 'uj1', jobId: { status: 'active', needsMatching: false }, score: 90, matcherVersion: MATCHER_VERSION, userFingerprint: 'some-old-fingerprint-value' };
  UserJob.find.mockReturnValue(buildUserJobQuery([staleProfile]));

  const eligible = await getEligibleDigestJobs(USER, 50);

  expect(eligible).toHaveLength(0);
});

test('a genuinely current, active, non-stale record is included', async () => {
  const current = { _id: 'uj1', jobId: { status: 'active', needsMatching: false }, score: 90, matcherVersion: MATCHER_VERSION, userFingerprint: USER_FINGERPRINT };
  UserJob.find.mockReturnValue(buildUserJobQuery([current]));

  const eligible = await getEligibleDigestJobs(USER, 50);

  expect(eligible).toHaveLength(1);
  expect(eligible[0]._id).toBe('uj1');
});

test('a hard-deleted job (populate resolves jobId to null) is excluded, not a crash', async () => {
  const orphaned = { _id: 'uj1', jobId: null, score: 90, matcherVersion: MATCHER_VERSION, userFingerprint: USER_FINGERPRINT };
  UserJob.find.mockReturnValue(buildUserJobQuery([orphaned]));

  await expect(getEligibleDigestJobs(USER, 50)).resolves.toHaveLength(0);
});

test('the query is bounded to the top 10 by score — unchanged cap', async () => {
  const query = buildUserJobQuery([]);
  UserJob.find.mockReturnValue(query);

  await getEligibleDigestJobs(USER, 50);

  expect(query.sort).toHaveBeenCalledWith({ score: -1 });
  expect(query.limit).toHaveBeenCalledWith(10);
});
