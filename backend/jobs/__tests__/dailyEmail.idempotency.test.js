// Guards Improvement 11: email delivery idempotency. Real MongoDB unique-index
// enforcement is proven separately in dailyEmail.idempotency.realDb.test.js —
// this file uses mocked models to test claimDelivery()'s decision logic
// (which status leads to a retry, which doesn't) and its integration into
// sendDigest(), since a fake model can faithfully simulate a MongoDB
// duplicate-key error (err.code === 11000) without needing a real database.

jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../../models/User', () => ({ find: jest.fn(), updateOne: jest.fn() }));
jest.mock('../../models/UserJob', () => ({ find: jest.fn(), countDocuments: jest.fn(), updateMany: jest.fn() }));
jest.mock('../../models/EmailLog', () => ({
  create: jest.fn(),
  findByIdAndUpdate: jest.fn().mockResolvedValue({}),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
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
const { computeUserFingerprint, MATCHER_VERSION } = require('../../services/jobMatcher.service');
const { sendDigest, claimDelivery, scheduledIdempotencyKey, manualIdempotencyKey } = require('../dailyEmail.job');

const DUE_USER = { _id: 'u1', email: 'a@x.com', name: 'A' };
const DUE_USER_FINGERPRINT = computeUserFingerprint(DUE_USER);

const buildUserJobQuery = (resolvedJobs) => {
  const query = {};
  query.sort = jest.fn(() => query);
  query.limit = jest.fn(() => query);
  query.populate = jest.fn().mockResolvedValue(resolvedJobs);
  return query;
};

const dupKeyError = () => Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });

const matchedUserJob = (overrides = {}) => ({
  _id: 'uj1',
  jobId: { title: 'Role', status: 'active', needsMatching: false, postedAt: new Date(), applyLink: 'https://example.com/apply' },
  score: 90,
  matcherVersion: MATCHER_VERSION,
  userFingerprint: DUE_USER_FINGERPRINT,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  User.find.mockResolvedValue([DUE_USER]);
  Config.findOne.mockResolvedValue(null);
  getEmailThreshold.mockResolvedValue(50);
});

// ── Key format (§2, test case #7) ────────────────────────────────────────────

describe('idempotency key format', () => {
  test('the same scheduled occurrence always produces the same key', () => {
    const now = new Date('2026-03-01T04:45:00.000Z'); // IST 10:15
    expect(scheduledIdempotencyKey('u1', now)).toBe(scheduledIdempotencyKey('u1', new Date('2026-03-01T04:59:59.000Z')));
  });

  test('a different hour produces a different scheduled key', () => {
    const a = scheduledIdempotencyKey('u1', new Date('2026-03-01T04:45:00.000Z'));
    const b = scheduledIdempotencyKey('u1', new Date('2026-03-01T05:45:00.000Z'));
    expect(a).not.toBe(b);
  });

  test('scheduled and manual keys for the same user at the same instant never collide (manual cannot block scheduled, or vice versa)', () => {
    const now = new Date('2026-03-01T04:45:00.000Z');
    expect(scheduledIdempotencyKey('u1', now)).not.toBe(manualIdempotencyKey('u1', now));
  });

  test('the key is not based on the current millisecond timestamp or a random id — it is stable, not unique per call', () => {
    const now = new Date('2026-03-01T04:45:00.000Z');
    const key1 = scheduledIdempotencyKey('u1', now);
    const key2 = scheduledIdempotencyKey('u1', new Date(now.getTime() + 1)); // 1ms later
    expect(key1).toBe(key2);
  });
});

// ── claimDelivery() decision logic (§3, §4) ──────────────────────────────────

describe('claimDelivery', () => {
  test('a fresh key is claimed immediately via a plain insert', async () => {
    EmailLog.create.mockResolvedValue({ _id: 'log1', status: 'claimed' });

    const result = await claimDelivery('scheduled:u1:2026-03-01T04', { userId: 'u1', email: 'a@x.com', name: 'A' });

    expect(result.claimed).toBe(true);
    expect(EmailLog.create).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'scheduled:u1:2026-03-01T04', status: 'claimed' }));
  });

  test('a MongoDB duplicate-key error (code 11000) is handled as "already claimed", not thrown as an application error (§6 test #11)', async () => {
    EmailLog.create.mockRejectedValue(dupKeyError());
    EmailLog.findOne.mockResolvedValue({ _id: 'log1', status: 'sent' });

    await expect(claimDelivery('k', {})).resolves.not.toThrow();
  });

  test('a genuinely unexpected error (not a duplicate-key error) is never swallowed', async () => {
    EmailLog.create.mockRejectedValue(new Error('Mongo connection reset'));

    await expect(claimDelivery('k', {})).rejects.toThrow('Mongo connection reset');
  });

  test('an already-SENT delivery is never re-claimed — this is the core duplicate-prevention guarantee (§6 test #5)', async () => {
    EmailLog.create.mockRejectedValue(dupKeyError());
    EmailLog.findOne.mockResolvedValue({ _id: 'log1', status: 'sent' });

    const result = await claimDelivery('k', {});

    expect(result.claimed).toBe(false);
    expect(EmailLog.findOneAndUpdate).not.toHaveBeenCalled(); // never attempts to flip a 'sent' row back to 'claimed'
  });

  test('an ambiguous/abandoned CLAIMED row is never auto-retried (§6 test #6 — documented recovery policy)', async () => {
    EmailLog.create.mockRejectedValue(dupKeyError());
    EmailLog.findOne.mockResolvedValue({ _id: 'log1', status: 'claimed', claimedAt: new Date(Date.now() - 60 * 60 * 1000) });

    const result = await claimDelivery('k', {});

    expect(result.claimed).toBe(false);
    expect(EmailLog.findOneAndUpdate).not.toHaveBeenCalled(); // a stuck 'claimed' row is left alone, not reclaimed
  });

  test('a known-FAILED delivery is safely retried via an atomic conditional transition', async () => {
    EmailLog.create.mockRejectedValue(dupKeyError());
    EmailLog.findOne.mockResolvedValue({ _id: 'log1', status: 'failed' });
    EmailLog.findOneAndUpdate.mockResolvedValue({ _id: 'log1', status: 'claimed' });

    const result = await claimDelivery('k', {});

    expect(result.claimed).toBe(true);
    expect(EmailLog.findOneAndUpdate).toHaveBeenCalledWith(
      { idempotencyKey: 'k', status: 'failed' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'claimed' }) }),
      expect.anything()
    );
  });

  test('two concurrent retries of a failed delivery cannot both win — only one atomic transition succeeds (§6 test #3)', async () => {
    EmailLog.create.mockRejectedValue(dupKeyError());
    EmailLog.findOne.mockResolvedValue({ _id: 'log1', status: 'failed' });
    // Simulates the SECOND concurrent findOneAndUpdate losing the race: the
    // filter {status:'failed'} no longer matches because the first one already
    // flipped it to 'claimed' — Mongo returns null for a non-matching filter.
    EmailLog.findOneAndUpdate.mockResolvedValueOnce({ _id: 'log1', status: 'claimed' }).mockResolvedValueOnce(null);

    const [first, second] = await Promise.all([claimDelivery('k', {}), claimDelivery('k', {})]);

    const claimedCount = [first, second].filter((r) => r.claimed).length;
    expect(claimedCount).toBe(1);
  });
});

// ── Integration into sendDigest() ────────────────────────────────────────────

describe('sendDigest + claiming', () => {
  test('a successful scheduled digest is not sent twice for the same occurrence (§6 test #1)', async () => {
    UserJob.find.mockReturnValue(buildUserJobQuery([matchedUserJob()]));
    sendJobDigestEmail.mockResolvedValue();
    // First call: fresh claim succeeds. Second call (same occurrence): the
    // claim already exists and has been marked 'sent' by the first run.
    EmailLog.create
      .mockResolvedValueOnce({ _id: 'log1', status: 'claimed' })
      .mockRejectedValueOnce(dupKeyError());
    EmailLog.findOne.mockResolvedValue({ _id: 'log1', status: 'sent' });

    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.setSystemTime(new Date('2026-03-01T04:45:00.000Z'));
    await sendDigest(); // scheduled (not forced)
    await sendDigest(); // retried within the SAME IST hour — e.g. a crash-and-restart
    jest.useRealTimers();

    expect(sendJobDigestEmail).toHaveBeenCalledTimes(1);
  });

  test('a later legitimate scheduled occurrence can send another digest (§6 test #2)', async () => {
    UserJob.find.mockReturnValue(buildUserJobQuery([matchedUserJob()]));
    sendJobDigestEmail.mockResolvedValue();
    EmailLog.create.mockResolvedValue({ _id: 'log-new', status: 'claimed' }); // always succeeds — different hour, different key

    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.setSystemTime(new Date('2026-03-01T04:45:00.000Z'));
    await sendDigest();
    jest.setSystemTime(new Date('2026-03-01T05:45:00.000Z')); // next IST hour
    await sendDigest();
    jest.useRealTimers();

    expect(sendJobDigestEmail).toHaveBeenCalledTimes(2);
  });

  test('a provider failure does not mark included jobs as emailed (§6 test #4)', async () => {
    UserJob.find.mockReturnValue(buildUserJobQuery([matchedUserJob()]));
    sendJobDigestEmail.mockRejectedValue(new Error('smtp down'));
    EmailLog.create.mockResolvedValue({ _id: 'log1', status: 'claimed' });

    await sendDigest({ force: true });

    expect(UserJob.updateMany).not.toHaveBeenCalled();
    expect(User.updateOne).not.toHaveBeenCalled();
    expect(EmailLog.findByIdAndUpdate).toHaveBeenCalledWith('log1', { $set: expect.objectContaining({ status: 'failed' }) });
  });

  test('a manual send does not block the next scheduled digest for the same user (§6 test #7)', async () => {
    UserJob.find.mockReturnValue(buildUserJobQuery([matchedUserJob()]));
    sendJobDigestEmail.mockResolvedValue();
    EmailLog.create.mockResolvedValue({ _id: 'log-x', status: 'claimed' }); // manual and scheduled keys differ — both succeed independently

    await sendDigest({ force: true }); // manual
    await sendDigest(); // scheduled, same tick

    expect(sendJobDigestEmail).toHaveBeenCalledTimes(2);
    const keysClaimed = EmailLog.create.mock.calls.map((c) => c[0].idempotencyKey);
    expect(keysClaimed[0]).toMatch(/^manual:/);
    expect(keysClaimed[1]).toMatch(/^scheduled:/);
  });

  test('retrying the same manual operation does not duplicate its delivery (§6 test #8)', async () => {
    UserJob.find.mockReturnValue(buildUserJobQuery([matchedUserJob()]));
    sendJobDigestEmail.mockResolvedValue();
    EmailLog.create
      .mockResolvedValueOnce({ _id: 'log1', status: 'claimed' })
      .mockRejectedValueOnce(dupKeyError());
    EmailLog.findOne.mockResolvedValue({ _id: 'log1', status: 'sent' });

    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.setSystemTime(new Date('2026-03-01T04:45:00.000Z'));
    await sendDigest({ force: true });
    await sendDigest({ force: true }); // retried a few seconds later, same IST minute
    jest.useRealTimers();

    expect(sendJobDigestEmail).toHaveBeenCalledTimes(1);
  });

  test('empty digests never create a claimed/sent delivery record (§6 test #9)', async () => {
    UserJob.find.mockReturnValue(buildUserJobQuery([]));
    UserJob.countDocuments.mockResolvedValue(0);

    await sendDigest({ force: true });

    expect(sendJobDigestEmail).not.toHaveBeenCalled();
    expect(EmailLog.create).toHaveBeenCalledTimes(1);
    expect(EmailLog.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped' }));
  });

  test('an already-claimed/sent occurrence is skipped cleanly, without throwing and without a redundant log row', async () => {
    UserJob.find.mockReturnValue(buildUserJobQuery([matchedUserJob()]));
    EmailLog.create.mockRejectedValue(dupKeyError());
    EmailLog.findOne.mockResolvedValue({ _id: 'log1', status: 'sent' });

    await expect(sendDigest({ force: true })).resolves.not.toThrow();
    expect(sendJobDigestEmail).not.toHaveBeenCalled();
  });
});
