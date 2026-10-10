// Audit (post-Improvement-5): dailyEmail.staleness.test.js proves the digest
// withholds a record while its JOB is pending reprocessing (needsMatching) or
// its matcherVersion is stale. It does NOT prove anything about a record whose
// USER profile changed — rescoreUserMatches/matchJobsForUser run fire-and-
// forget (see user.controller.js's updateProfile), so there is a real window
// where a UserJob still carries an old userFingerprint, current matcherVersion,
// and a job that itself didn't change (needsMatching:false) — the exact
// combination this file targets. Uses the REAL jobMatcher.service (not
// mocked) so computeUserFingerprint/MATCHER_VERSION are the genuine values.

jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../../models/User', () => ({ find: jest.fn(), updateOne: jest.fn() }));
jest.mock('../../models/UserJob', () => ({ find: jest.fn(), countDocuments: jest.fn(), updateMany: jest.fn() }));
// create() resolves with an _id (simulates the claimDelivery() insert) so the
// success/failure path's subsequent findByIdAndUpdate(claim.doc._id, ...) has
// something to operate on — see Improvement 11's dailyEmail.job.js changes.
jest.mock('../../models/EmailLog', () => ({
  create: jest.fn().mockResolvedValue({ _id: 'log-id' }),
  findByIdAndUpdate: jest.fn().mockResolvedValue({}),
  findOne: jest.fn(),
}));
jest.mock('../../models/Config', () => ({ findOne: jest.fn() }));
jest.mock('../../services/email.service', () => ({ sendJobDigestEmail: jest.fn(), sendAdminDigestCopy: jest.fn() }));
jest.mock('../../services/config.service', () => ({ getEmailThreshold: jest.fn() }));

const User = require('../../models/User');
const UserJob = require('../../models/UserJob');
const EmailLog = require('../../models/EmailLog');
const Config = require('../../models/Config');
const { sendJobDigestEmail } = require('../../services/email.service');
const { getEmailThreshold } = require('../../services/config.service');
const { computeUserFingerprint, MATCHER_VERSION } = require('../../services/jobMatcher.service');
const { sendDigest } = require('../dailyEmail.job');

const buildUserJobQuery = (resolvedJobs) => {
  const query = {};
  query.sort = jest.fn(() => query);
  query.limit = jest.fn(() => query);
  query.populate = jest.fn().mockResolvedValue(resolvedJobs);
  return query;
};

const OLD_SKILLS_USER = { _id: 'u1', email: 'a@x.com', name: 'A', skills: ['Python'], desiredRoles: ['Backend Developer'], experience: 3, locations: [], remotePreference: 'any' };

beforeEach(() => {
  jest.clearAllMocks();
  Config.findOne.mockResolvedValue(null);
  getEmailThreshold.mockResolvedValue(50);
});

test('a UserJob scored under the OLD profile is withheld once the user profile has changed, even though matcherVersion is current and the job itself is not pending', async () => {
  // The record was correctly scored+stamped at some earlier point under the user's OLD skills.
  const staleFingerprint = computeUserFingerprint({ ...OLD_SKILLS_USER, skills: ['Python'] });
  const staleRecord = {
    _id: 'uj1',
    jobId: { title: 'Backend Role', status: 'active', needsMatching: false },
    score: 90,
    matcherVersion: MATCHER_VERSION,
    userFingerprint: staleFingerprint,
  };

  // The user's CURRENT profile (as loaded by the digest run) has since changed —
  // this simulates the race: updateProfile's fire-and-forget matchJobsForUser
  // hasn't completed its rescoreUserMatches pass yet.
  const currentUser = { ...OLD_SKILLS_USER, skills: ['Rust'] };
  User.find.mockResolvedValue([currentUser]);
  UserJob.find.mockReturnValue(buildUserJobQuery([staleRecord]));
  UserJob.countDocuments.mockResolvedValue(1);

  await sendDigest({ force: true });

  expect(sendJobDigestEmail).not.toHaveBeenCalled();
  expect(UserJob.updateMany).not.toHaveBeenCalled();
  expect(EmailLog.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped' }));
});

test('once the record is rescored under the current profile (userFingerprint matches), the same user becomes eligible again', async () => {
  const user = { ...OLD_SKILLS_USER, skills: ['Rust'] };
  const currentFingerprint = computeUserFingerprint(user);
  const freshRecord = {
    _id: 'uj1',
    jobId: { title: 'Backend Role', status: 'active', needsMatching: false },
    score: 90,
    matcherVersion: MATCHER_VERSION,
    userFingerprint: currentFingerprint,
  };

  User.find.mockResolvedValue([user]);
  UserJob.find.mockReturnValue(buildUserJobQuery([freshRecord]));
  sendJobDigestEmail.mockResolvedValue();

  await sendDigest({ force: true });

  expect(sendJobDigestEmail).toHaveBeenCalledTimes(1);
});

test('does not require scanning the users entire job history — only touches the already-bounded (<=10, threshold-filtered) digest candidates', async () => {
  const user = { ...OLD_SKILLS_USER, skills: ['Rust'] };
  const query = buildUserJobQuery([]);
  User.find.mockResolvedValue([user]);
  UserJob.find.mockReturnValue(query);
  UserJob.countDocuments.mockResolvedValue(0);

  await sendDigest({ force: true });

  // Same query shape as before this audit — no extra UserJob.find call added per user.
  expect(UserJob.find).toHaveBeenCalledTimes(1);
  expect(query.limit).toHaveBeenCalledWith(10);
});
