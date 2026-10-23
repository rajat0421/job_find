// Guards Improvement 3's step 5/6: inactive jobs can't be selected for new
// email digests through pre-existing UserJob records, and a UserJob is never
// marked emailed just because its job became inactive. Separate file from
// dailyEmail.safety.test.js to avoid touching an already-passing test file.

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
jest.mock('../../services/email.service', () => ({ sendJobDigestEmail: jest.fn(), sendAdminDigestCopy: jest.fn(), isSafeHttpUrl: jest.requireActual('../../services/email.service').isSafeHttpUrl }));
jest.mock('../../services/config.service', () => ({ getEmailThreshold: jest.fn(), getEmailFreshnessConfig: jest.fn().mockResolvedValue({ defaultMaxAgeDays: 30, adzunaMaxAgeDays: 14 }) }));

const User = require('../../models/User');
const UserJob = require('../../models/UserJob');
const EmailLog = require('../../models/EmailLog');
const Config = require('../../models/Config');
const { sendJobDigestEmail } = require('../../services/email.service');
const { getEmailThreshold } = require('../../services/config.service');
const { computeUserFingerprint } = require('../../services/jobMatcher.service');
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

test('closed/expired jobs are dropped from the digest selection; the active one still sends', async () => {
  const active = { _id: 'uj1', jobId: { title: 'Open role', postedAt: new Date(), applyLink: 'https://example.com/apply' }, score: 90, userFingerprint: DUE_USER_FINGERPRINT };
  const closed = { _id: 'uj2', jobId: { title: 'Closed role', status: 'closed' }, score: 85 };
  const expired = { _id: 'uj3', jobId: { title: 'Expired role', status: 'expired' }, score: 80 };
  UserJob.find.mockReturnValue(buildUserJobQuery([active, closed, expired]));
  sendJobDigestEmail.mockResolvedValue();

  await sendDigest({ force: true });

  expect(sendJobDigestEmail).toHaveBeenCalledTimes(1);
  const jobsPayload = sendJobDigestEmail.mock.calls[0][2];
  expect(jobsPayload).toHaveLength(1);
  expect(jobsPayload[0].job.title).toBe('Open role');
});

test('a closed/expired UserJob is never marked emailed, even though it was excluded this cycle', async () => {
  const active = { _id: 'uj1', jobId: { title: 'Open role', postedAt: new Date(), applyLink: 'https://example.com/apply' }, score: 90, userFingerprint: DUE_USER_FINGERPRINT };
  const closed = { _id: 'uj2', jobId: { title: 'Closed role', status: 'closed' }, score: 85 };
  UserJob.find.mockReturnValue(buildUserJobQuery([active, closed]));
  sendJobDigestEmail.mockResolvedValue();

  await sendDigest({ force: true });

  // Only the active job's UserJob is marked emailed — 'uj2' is never included.
  expect(UserJob.updateMany).toHaveBeenCalledWith({ _id: { $in: ['uj1'] } }, { emailed: true });
});

test('if every matched job is inactive, the user is logged as skipped — not emailed, not marked emailed', async () => {
  const closed = { _id: 'uj2', jobId: { title: 'Closed role', status: 'closed' }, score: 85 };
  UserJob.find.mockReturnValue(buildUserJobQuery([closed]));
  UserJob.countDocuments.mockResolvedValue(1);

  await sendDigest({ force: true });

  expect(sendJobDigestEmail).not.toHaveBeenCalled();
  expect(UserJob.updateMany).not.toHaveBeenCalled();
  expect(User.updateOne).not.toHaveBeenCalled();
  expect(EmailLog.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped', jobCount: 0 }));
});

test('a UserJob whose job was hard-deleted (populate returns null) is treated the same as inactive, not a crash', async () => {
  const orphaned = { _id: 'uj1', jobId: null, score: 90 };
  UserJob.find.mockReturnValue(buildUserJobQuery([orphaned]));
  UserJob.countDocuments.mockResolvedValue(1);

  await expect(sendDigest({ force: true })).resolves.not.toThrow();
  expect(sendJobDigestEmail).not.toHaveBeenCalled();
});
