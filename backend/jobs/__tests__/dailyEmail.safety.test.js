// Guards the delivery-safety guarantees called out as critical:
//   - a UserJob is only ever marked emailed:true after a successful send
//   - a user who gets 0 eligible jobs this cycle is logged as 'skipped', not
//     advanced past their due date — so they're never permanently skipped
//   - the existing score threshold, 10-job cap and emailed:false dedup filter
//     are still what gates what gets sent
// These were already true before the fetch/match cron split; this test file
// locks them in as a regression guard per the explicit request to verify
// nothing about email delivery changed.

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
jest.mock('../../services/email.service', () => ({
  sendJobDigestEmail: jest.fn(),
  sendAdminDigestCopy: jest.fn(),
  isSafeHttpUrl: jest.requireActual('../../services/email.service').isSafeHttpUrl,
}));
jest.mock('../../services/config.service', () => ({ getEmailThreshold: jest.fn(), getEmailFreshnessConfig: jest.fn().mockResolvedValue({ defaultMaxAgeDays: 30, adzunaMaxAgeDays: 14 }) }));

const User = require('../../models/User');
const UserJob = require('../../models/UserJob');
const EmailLog = require('../../models/EmailLog');
const Config = require('../../models/Config');
const { sendJobDigestEmail } = require('../../services/email.service');
const { getEmailThreshold } = require('../../services/config.service');
const { computeUserFingerprint } = require('../../services/jobMatcher.service');
const { sendDigest } = require('../dailyEmail.job');

const DUE_USER = { _id: 'u1', email: 'a@x.com', name: 'A', isOnboarded: true };
const DUE_USER_FINGERPRINT = computeUserFingerprint(DUE_USER);

// Builds a mock Mongoose query chain: UserJob.find(...).sort().limit().populate()
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
  Config.findOne.mockResolvedValue(null); // no admin notification configured
  getEmailThreshold.mockResolvedValue(65);
});

test('send failure: does NOT mark emailed, does NOT advance lastEmailedAt, logs failed', async () => {
  const matchedJob = { _id: 'uj1', jobId: { title: 'Backend Engineer', postedAt: new Date(), applyLink: 'https://example.com/apply' }, score: 80, userFingerprint: DUE_USER_FINGERPRINT };
  UserJob.find.mockReturnValue(buildUserJobQuery([matchedJob]));
  sendJobDigestEmail.mockRejectedValue(new Error('smtp down'));

  await sendDigest({ force: true });

  expect(UserJob.updateMany).not.toHaveBeenCalled();
  expect(User.updateOne).not.toHaveBeenCalled();
  // The delivery was claimed (Improvement 11), then transitioned to 'failed'
  // via findByIdAndUpdate once sendJobDigestEmail rejected — the final
  // persisted outcome (status 'failed', jobCount 0, a reason) is unchanged
  // from before; only the mechanism (update vs a fresh create) differs.
  expect(EmailLog.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', status: 'claimed' }));
  expect(EmailLog.findByIdAndUpdate).toHaveBeenCalledWith('log-id', {
    $set: expect.objectContaining({ status: 'failed', jobCount: 0, reason: 'smtp down' }),
  });
});

test('0 eligible jobs: logs skipped, does NOT advance lastEmailedAt (user stays due next cycle)', async () => {
  UserJob.find.mockReturnValue(buildUserJobQuery([]));
  UserJob.countDocuments.mockResolvedValueOnce(0).mockResolvedValueOnce(0); // totalMatched, totalUnread

  await sendDigest({ force: true });

  expect(sendJobDigestEmail).not.toHaveBeenCalled();
  expect(UserJob.updateMany).not.toHaveBeenCalled();
  expect(User.updateOne).not.toHaveBeenCalled();
  expect(EmailLog.create).toHaveBeenCalledWith(
    expect.objectContaining({ userId: 'u1', status: 'skipped', jobCount: 0 })
  );
});

test('success path: marks emailed, advances lastEmailedAt, logs sent', async () => {
  const matchedJob = { _id: 'uj1', jobId: { title: 'Backend Engineer', postedAt: new Date(), applyLink: 'https://example.com/apply' }, score: 80, userFingerprint: DUE_USER_FINGERPRINT };
  UserJob.find.mockReturnValue(buildUserJobQuery([matchedJob]));
  sendJobDigestEmail.mockResolvedValue();

  await sendDigest({ force: true });

  expect(UserJob.updateMany).toHaveBeenCalledWith({ _id: { $in: ['uj1'] } }, { emailed: true });
  expect(User.updateOne).toHaveBeenCalledWith({ _id: 'u1' }, { lastEmailedAt: expect.any(Date) });
  // Claimed first (Improvement 11), then transitioned to 'sent' via
  // findByIdAndUpdate once sendJobDigestEmail resolved — same final outcome
  // (status 'sent', jobCount 1) as before, via the new claim mechanism.
  expect(EmailLog.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', status: 'claimed' }));
  expect(EmailLog.findByIdAndUpdate).toHaveBeenCalledWith('log-id', {
    $set: expect.objectContaining({ status: 'sent', jobCount: 1 }),
  });
});

test('query still gates on the admin-configured threshold, emailed:false dedup, and a 10-job cap', async () => {
  const query = buildUserJobQuery([]);
  UserJob.find.mockReturnValue(query);
  UserJob.countDocuments.mockResolvedValue(0);

  await sendDigest({ force: true });

  expect(UserJob.find).toHaveBeenCalledWith(
    expect.objectContaining({ userId: 'u1', emailed: false, score: { $gte: 65 } })
  );
  expect(query.limit).toHaveBeenCalledWith(10);
});
