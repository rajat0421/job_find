// Guards Improvement 11's manual "send digest now" admin endpoint
// (POST /api/admin/users/:id/send-digest) — previously untested. Confirms it
// now goes through the same claimDelivery() mechanism as the scheduled cron,
// under the 'manual:' key namespace, so a double-click/retried request can't
// send twice.

jest.mock('../../models/User', () => ({ findById: jest.fn(), updateOne: jest.fn().mockResolvedValue({}) }));
jest.mock('../../models/UserJob', () => ({ find: jest.fn(), updateMany: jest.fn() }));
jest.mock('../../services/jobMatcher.service', () => ({
  scoreJob: jest.fn(), scoreJobDetailed: jest.fn(), scoreJobWithBreakdown: jest.fn(), matchJobsForAllUsers: jest.fn(),
  computeUserFingerprint: jest.fn(), computeJobFingerprint: jest.fn(), MATCHER_VERSION: 1,
}));
jest.mock('../../services/companies.service', () => ({ getCompanies: jest.fn() }));
jest.mock('../../services/config.service', () => ({ getEmailThreshold: jest.fn() }));
jest.mock('../../services/monitoring.service', () => ({ getOperationalOverview: jest.fn(), getFetchHealth: jest.fn(), getMatchHealth: jest.fn(), getEmailHealth: jest.fn() }));
jest.mock('../../services/email.service', () => ({ sendJobDigestEmail: jest.fn(), sendAdminDigestCopy: jest.fn() }));
jest.mock('../../models/EmailLog', () => ({ findByIdAndUpdate: jest.fn().mockResolvedValue({}) }));
jest.mock('../../models/Config', () => ({ findOne: jest.fn().mockResolvedValue(null) }));
jest.mock('../../jobs/dailyEmail.job', () => ({ claimDelivery: jest.fn(), manualIdempotencyKey: jest.fn((id) => `manual:${id}:fixed-bucket`) }));

const User = require('../../models/User');
const UserJob = require('../../models/UserJob');
const { sendJobDigestEmail } = require('../../services/email.service');
const { getEmailThreshold } = require('../../services/config.service');
const EmailLog = require('../../models/EmailLog');
const { claimDelivery } = require('../../jobs/dailyEmail.job');
const { sendDigestForUser } = require('../admin.controller');

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const buildQuery = (result) => {
  const q = {};
  q.sort = jest.fn(() => q);
  q.limit = jest.fn(() => q);
  q.populate = jest.fn().mockResolvedValue(result);
  return q;
};

const USER = { _id: 'u1', email: 'a@x.com', name: 'A' };

beforeEach(() => {
  jest.clearAllMocks();
  User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(USER) });
  getEmailThreshold.mockResolvedValue(50);
});

test('a successful manual send claims the delivery, sends, and marks the claim sent', async () => {
  const uj = { _id: 'uj1', jobId: { title: 'Role' }, score: 80 };
  UserJob.find.mockReturnValue(buildQuery([uj]));
  claimDelivery.mockResolvedValue({ claimed: true, doc: { _id: 'log1' } });
  sendJobDigestEmail.mockResolvedValue();

  const res = mockRes();
  await sendDigestForUser({ params: { id: 'u1' } }, res);

  expect(claimDelivery).toHaveBeenCalledWith('manual:u1:fixed-bucket', expect.objectContaining({ userId: 'u1' }));
  expect(UserJob.updateMany).toHaveBeenCalledWith({ _id: { $in: ['uj1'] } }, { emailed: true });
  expect(EmailLog.findByIdAndUpdate).toHaveBeenCalledWith('log1', { $set: expect.objectContaining({ status: 'sent' }) });
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Email sent') }));
});

test('retrying the same manual operation (claim already held) is refused with 409, not sent again', async () => {
  const uj = { _id: 'uj1', jobId: { title: 'Role' }, score: 80 };
  UserJob.find.mockReturnValue(buildQuery([uj]));
  claimDelivery.mockResolvedValue({ claimed: false, doc: { _id: 'log1', status: 'sent' } });

  const res = mockRes();
  await sendDigestForUser({ params: { id: 'u1' } }, res);

  expect(sendJobDigestEmail).not.toHaveBeenCalled();
  expect(UserJob.updateMany).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(409);
});

test('a provider failure marks the claim failed and never marks UserJob emailed', async () => {
  const uj = { _id: 'uj1', jobId: { title: 'Role' }, score: 80 };
  UserJob.find.mockReturnValue(buildQuery([uj]));
  claimDelivery.mockResolvedValue({ claimed: true, doc: { _id: 'log1' } });
  sendJobDigestEmail.mockRejectedValue(new Error('smtp down'));

  const res = mockRes();
  await sendDigestForUser({ params: { id: 'u1' } }, res);

  expect(UserJob.updateMany).not.toHaveBeenCalled();
  expect(EmailLog.findByIdAndUpdate).toHaveBeenCalledWith('log1', { $set: expect.objectContaining({ status: 'failed', reason: 'smtp down' }) });
  expect(res.status).toHaveBeenCalledWith(500);
});

test('no eligible jobs: 400, and no claim is ever attempted', async () => {
  UserJob.find.mockReturnValue(buildQuery([]));

  const res = mockRes();
  await sendDigestForUser({ params: { id: 'u1' } }, res);

  expect(claimDelivery).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(400);
});
