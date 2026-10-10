// Guards Improvement 11's manual "send digest now" admin endpoint
// (POST /api/admin/users/:id/send-digest). Confirms it (a) goes through the
// same claimDelivery() mechanism as the scheduled cron, under the 'manual:'
// key namespace, (b) now delegates eligibility to the SAME
// getEligibleDigestJobs() helper the scheduled cron uses — closing the
// pre-existing staleness-filter gap — rather than re-testing that helper's
// filtering logic here (already covered by dailyEmail.staleness.test.js /
// dailyEmail.profileStaleness.test.js), and (c) supports a client-supplied
// requestId for cross-minute-boundary retry safety (Improvement 11 follow-up).

jest.mock('../../models/User', () => ({ findById: jest.fn(), updateOne: jest.fn().mockResolvedValue({}) }));
jest.mock('../../models/UserJob', () => ({ updateMany: jest.fn() }));
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
jest.mock('../../jobs/dailyEmail.job', () => ({
  claimDelivery: jest.fn(),
  manualIdempotencyKey: jest.fn((id) => `manual:${id}:fixed-bucket`),
  getEligibleDigestJobs: jest.fn(),
}));

const User = require('../../models/User');
const UserJob = require('../../models/UserJob');
const { sendJobDigestEmail } = require('../../services/email.service');
const { getEmailThreshold } = require('../../services/config.service');
const EmailLog = require('../../models/EmailLog');
const { claimDelivery, getEligibleDigestJobs } = require('../../jobs/dailyEmail.job');
const { sendDigestForUser } = require('../admin.controller');

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const USER = { _id: 'u1', email: 'a@x.com', name: 'A' };

beforeEach(() => {
  jest.clearAllMocks();
  User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(USER) });
  getEmailThreshold.mockResolvedValue(50);
});

test('a successful manual send claims the delivery, sends, and marks the claim sent', async () => {
  const uj = { _id: 'uj1', jobId: { title: 'Role' }, score: 80 };
  getEligibleDigestJobs.mockResolvedValue([uj]);
  claimDelivery.mockResolvedValue({ claimed: true, doc: { _id: 'log1' } });
  sendJobDigestEmail.mockResolvedValue();

  const res = mockRes();
  await sendDigestForUser({ params: { id: 'u1' }, body: {}, headers: {} }, res);

  expect(getEligibleDigestJobs).toHaveBeenCalledWith(USER, 50); // delegates eligibility — no separate/drifted query
  expect(claimDelivery).toHaveBeenCalledWith('manual:u1:fixed-bucket', expect.objectContaining({ userId: 'u1' }));
  expect(UserJob.updateMany).toHaveBeenCalledWith({ _id: { $in: ['uj1'] } }, { emailed: true });
  expect(EmailLog.findByIdAndUpdate).toHaveBeenCalledWith('log1', { $set: expect.objectContaining({ status: 'sent' }) });
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Email sent') }));
});

test('retrying the same manual operation (claim already held) is refused with 409, not sent again', async () => {
  getEligibleDigestJobs.mockResolvedValue([{ _id: 'uj1', jobId: { title: 'Role' }, score: 80 }]);
  claimDelivery.mockResolvedValue({ claimed: false, doc: { _id: 'log1', status: 'sent' } });

  const res = mockRes();
  await sendDigestForUser({ params: { id: 'u1' }, body: {}, headers: {} }, res);

  expect(sendJobDigestEmail).not.toHaveBeenCalled();
  expect(UserJob.updateMany).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(409);
});

test('a provider failure marks the claim failed and never marks UserJob emailed', async () => {
  getEligibleDigestJobs.mockResolvedValue([{ _id: 'uj1', jobId: { title: 'Role' }, score: 80 }]);
  claimDelivery.mockResolvedValue({ claimed: true, doc: { _id: 'log1' } });
  sendJobDigestEmail.mockRejectedValue(new Error('smtp down'));

  const res = mockRes();
  await sendDigestForUser({ params: { id: 'u1' }, body: {}, headers: {} }, res);

  expect(UserJob.updateMany).not.toHaveBeenCalled();
  expect(EmailLog.findByIdAndUpdate).toHaveBeenCalledWith('log1', { $set: expect.objectContaining({ status: 'failed', reason: 'smtp down' }) });
  expect(res.status).toHaveBeenCalledWith(500);
});

test('no eligible jobs (including stale matches already filtered out by getEligibleDigestJobs): 400, and no claim is ever attempted', async () => {
  getEligibleDigestJobs.mockResolvedValue([]);

  const res = mockRes();
  await sendDigestForUser({ params: { id: 'u1' }, body: {}, headers: {} }, res);

  expect(claimDelivery).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(400);
});

describe('client-supplied requestId (Improvement 11 follow-up)', () => {
  beforeEach(() => {
    getEligibleDigestJobs.mockResolvedValue([{ _id: 'uj1', jobId: { title: 'Role' }, score: 80 }]);
    claimDelivery.mockResolvedValue({ claimed: true, doc: { _id: 'log1' } });
    sendJobDigestEmail.mockResolvedValue();
  });

  test('a valid client requestId is used to compose the idempotency key, scoped to this user and the manual namespace', async () => {
    const res = mockRes();
    await sendDigestForUser({ params: { id: 'u1' }, body: { requestId: 'abcdef1234567890' }, headers: {} }, res);

    expect(claimDelivery).toHaveBeenCalledWith('manual:u1:client:abcdef1234567890', expect.anything());
  });

  test('the same requestId reused across two calls (a retry) produces the identical key both times', async () => {
    const res = mockRes();
    await sendDigestForUser({ params: { id: 'u1' }, body: { requestId: 'retry-token-001' }, headers: {} }, res);
    await sendDigestForUser({ params: { id: 'u1' }, body: { requestId: 'retry-token-001' }, headers: {} }, res);

    const keysUsed = claimDelivery.mock.calls.map((c) => c[0]);
    expect(keysUsed[0]).toBe(keysUsed[1]);
  });

  test('a different requestId (a deliberate new send) produces a different key', async () => {
    const res = mockRes();
    await sendDigestForUser({ params: { id: 'u1' }, body: { requestId: 'token-one-aaaa' }, headers: {} }, res);
    await sendDigestForUser({ params: { id: 'u1' }, body: { requestId: 'token-two-bbbb' }, headers: {} }, res);

    const keysUsed = claimDelivery.mock.calls.map((c) => c[0]);
    expect(keysUsed[0]).not.toBe(keysUsed[1]);
  });

  test('a malformed/unsafe requestId is ignored, falling back to the pre-existing minute-bucket key', async () => {
    const res = mockRes();
    await sendDigestForUser({ params: { id: 'u1' }, body: { requestId: '<script>bad</script>' }, headers: {} }, res);

    expect(claimDelivery).toHaveBeenCalledWith('manual:u1:fixed-bucket', expect.anything());
  });

  test('no requestId at all (older client / direct API call) falls back to the pre-existing minute-bucket key, unchanged', async () => {
    const res = mockRes();
    await sendDigestForUser({ params: { id: 'u1' }, body: {}, headers: {} }, res);

    expect(claimDelivery).toHaveBeenCalledWith('manual:u1:fixed-bucket', expect.anything());
  });

  test('a requestId supplied via the x-idempotency-key header also works', async () => {
    const res = mockRes();
    await sendDigestForUser({ params: { id: 'u1' }, body: {}, headers: { 'x-idempotency-key': 'header-token-123' } }, res);

    expect(claimDelivery).toHaveBeenCalledWith('manual:u1:client:header-token-123', expect.anything());
  });

  test('the client-derived key still carries the "manual:" namespace, so it can never collide with a scheduled-delivery key', async () => {
    const res = mockRes();
    await sendDigestForUser({ params: { id: 'u1' }, body: { requestId: 'abcdef1234567890' }, headers: {} }, res);

    const keyUsed = claimDelivery.mock.calls[0][0];
    expect(keyUsed.startsWith('manual:')).toBe(true);
  });
});
