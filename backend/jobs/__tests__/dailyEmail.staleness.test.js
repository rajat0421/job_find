// Guards Improvement 5 requirement #13: the email pipeline must not deliver an
// obsolete score while a recalculation is pending — without changing any
// user's email schedule. Separate file from dailyEmail.safety.test.js /
// dailyEmail.lifecycle.test.js to avoid touching already-passing test files.

jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../../models/User', () => ({ find: jest.fn(), updateOne: jest.fn() }));
jest.mock('../../models/UserJob', () => ({ find: jest.fn(), countDocuments: jest.fn(), updateMany: jest.fn() }));
jest.mock('../../models/EmailLog', () => ({ create: jest.fn() }));
jest.mock('../../models/Config', () => ({ findOne: jest.fn() }));
jest.mock('../../services/email.service', () => ({ sendJobDigestEmail: jest.fn(), sendAdminDigestCopy: jest.fn() }));
jest.mock('../../services/config.service', () => ({ getEmailThreshold: jest.fn() }));

const User = require('../../models/User');
const UserJob = require('../../models/UserJob');
const EmailLog = require('../../models/EmailLog');
const Config = require('../../models/Config');
const { sendJobDigestEmail } = require('../../services/email.service');
const { getEmailThreshold } = require('../../services/config.service');
const { MATCHER_VERSION, computeUserFingerprint } = require('../../services/jobMatcher.service');
const { sendDigest } = require('../dailyEmail.job');

const DUE_USER = { _id: 'u1', email: 'a@x.com', name: 'A' };
const DUE_USER_FINGERPRINT = computeUserFingerprint(DUE_USER);

const buildUserJobQuery = (resolvedJobs) => {
  const query = {};
  query.sort = jest.fn(() => query);
  query.limit = jest.fn(() => query);
  query.populate = jest.fn().mockResolvedValue(resolvedJobs);
  return query;
};

beforeEach(() => {
  jest.clearAllMocks();
  User.find.mockResolvedValue([DUE_USER]);
  Config.findOne.mockResolvedValue(null);
  getEmailThreshold.mockResolvedValue(50);
});

test('the digest query itself only selects records at the current matcher version', async () => {
  const query = buildUserJobQuery([]);
  UserJob.find.mockReturnValue(query);
  UserJob.countDocuments.mockResolvedValue(0);

  await sendDigest({ force: true });

  expect(UserJob.find).toHaveBeenCalledWith(
    expect.objectContaining({ matcherVersion: MATCHER_VERSION })
  );
});

test('a job awaiting reprocessing (needsMatching:true) is withheld from the digest even if its stored score clears the threshold', async () => {
  const pendingRecalc = { _id: 'uj1', jobId: { title: 'Role', status: 'active', needsMatching: true }, score: 90 };
  UserJob.find.mockReturnValue(buildUserJobQuery([pendingRecalc]));
  UserJob.countDocuments.mockResolvedValue(1);

  await sendDigest({ force: true });

  expect(sendJobDigestEmail).not.toHaveBeenCalled();
});

test('once the job is no longer pending (needsMatching:false), the same user becomes eligible again', async () => {
  const current = { _id: 'uj1', jobId: { title: 'Role', status: 'active', needsMatching: false }, score: 90, userFingerprint: DUE_USER_FINGERPRINT };
  UserJob.find.mockReturnValue(buildUserJobQuery([current]));
  sendJobDigestEmail.mockResolvedValue();

  await sendDigest({ force: true });

  expect(sendJobDigestEmail).toHaveBeenCalledTimes(1);
});

test("withholding a stale record never marks it emailed, and never advances the user's lastEmailedAt (schedule untouched)", async () => {
  const pendingRecalc = { _id: 'uj1', jobId: { title: 'Role', status: 'active', needsMatching: true }, score: 90 };
  UserJob.find.mockReturnValue(buildUserJobQuery([pendingRecalc]));
  UserJob.countDocuments.mockResolvedValue(1);

  await sendDigest({ force: true });

  expect(UserJob.updateMany).not.toHaveBeenCalled();
  expect(User.updateOne).not.toHaveBeenCalled();
  expect(EmailLog.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped' }));
});

test('a legitimately current, active, non-pending match still sends normally (no over-withholding)', async () => {
  const current = { _id: 'uj1', jobId: { title: 'Role', status: 'active', needsMatching: false }, score: 90, userFingerprint: DUE_USER_FINGERPRINT };
  UserJob.find.mockReturnValue(buildUserJobQuery([current]));
  sendJobDigestEmail.mockResolvedValue();

  await sendDigest({ force: true });

  expect(sendJobDigestEmail).toHaveBeenCalledTimes(1);
  expect(UserJob.updateMany).toHaveBeenCalledWith({ _id: { $in: ['uj1'] } }, { emailed: true });
});
