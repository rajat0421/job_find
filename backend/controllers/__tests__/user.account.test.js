// Guards the new account-management endpoints (navbar account menu follow-up):
// getProfile's hasPassword flag, changePassword, and deleteAccount. The most
// important behavior here is deleteAccount's failure reporting — a response
// must never claim "nothing was deleted" unless that is actually guaranteed
// (true for an aborted MongoDB transaction, false for a plain sequential
// delete that got partway through), and the account/data must only ever be
// fully removed once every step has genuinely succeeded.

jest.mock('bcryptjs', () => ({ compare: jest.fn(), hash: jest.fn() }));
jest.mock('mongoose', () => ({ startSession: jest.fn() }));
jest.mock('../../models/User', () => ({ findById: jest.fn(), updateOne: jest.fn(), deleteOne: jest.fn() }));
jest.mock('../../models/UserJob', () => ({ deleteMany: jest.fn() }));
jest.mock('../../models/ResumeProfile', () => ({ deleteMany: jest.fn() }));
jest.mock('../../models/Feedback', () => ({ deleteMany: jest.fn() }));
jest.mock('../../models/EmailLog', () => ({ deleteMany: jest.fn() }));
jest.mock('../../models/OtpVerification', () => ({ deleteMany: jest.fn() }));
jest.mock('../../services/jobMatcher.service', () => ({ matchJobsForUser: jest.fn().mockResolvedValue() }));

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../../models/User');
const UserJob = require('../../models/UserJob');
const ResumeProfile = require('../../models/ResumeProfile');
const Feedback = require('../../models/Feedback');
const EmailLog = require('../../models/EmailLog');
const OtpVerification = require('../../models/OtpVerification');
const { getProfile, changePassword, deleteAccount } = require('../user.controller');

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

// The exact, stable MongoDB error for "this deployment isn't a replica set
// or mongos" (see controller comment) — the signal deleteAccount uses to
// fall back from a transaction to the sequential path.
const UNSUPPORTED_TXN_ERR = new Error('Transaction numbers are only allowed on a replica set member or mongos');

// Configures mongoose.startSession() for the next deleteAccount call.
// Default (no args): simulates a standalone MongoDB with no transaction
// support, which is this project's actual local/dev/test environment — the
// controller falls back to the sequential path, so every pre-existing test
// below (written against that path) needs no changes to keep passing.
// Pass `withTransactionImpl` to simulate a replica set instead, where the
// transaction actually runs the real cascade (success or failure).
const mockSession = ({ withTransactionImpl } = {}) => {
  const endSession = jest.fn().mockResolvedValue();
  const withTransaction = jest.fn(withTransactionImpl || (() => Promise.reject(UNSUPPORTED_TXN_ERR)));
  mongoose.startSession.mockResolvedValue({ withTransaction, endSession });
  return { withTransaction, endSession };
};

// A chainable mongoose Query stand-in: `Model.deleteX({...}).session(session)`.
// Only used by the transaction-path tests — the sequential fallback never
// calls `.session()`, so its tests keep using plain `mockResolvedValue`.
const chainable = (value = {}) => ({ session: jest.fn().mockResolvedValue(value) });

const passwordUser = (overrides = {}) => ({
  _id: 'u1', email: 'a@x.com', name: 'A', password: 'hashed-secret', googleId: null,
  toObject() { return { _id: this._id, email: this.email, name: this.name, password: this.password, googleId: this.googleId }; },
  ...overrides,
});

const googleUser = (overrides = {}) => ({
  _id: 'u2', email: 'g@x.com', name: 'G', password: undefined, googleId: 'google-123',
  toObject() { return { _id: this._id, email: this.email, name: this.name, password: this.password, googleId: this.googleId }; },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSession(); // every test defaults to "transactions unsupported" unless it overrides this
});

describe('getProfile hasPassword', () => {
  test('reports hasPassword:true and never leaks the raw hash for a password account', async () => {
    User.findById.mockResolvedValue(passwordUser());
    const res = mockRes();

    await getProfile({ user: { id: 'u1' } }, res);

    const body = res.json.mock.calls[0][0];
    expect(body.hasPassword).toBe(true);
    expect(body.password).toBeUndefined();
  });

  test('reports hasPassword:false for a Google-only account', async () => {
    User.findById.mockResolvedValue(googleUser());
    const res = mockRes();

    await getProfile({ user: { id: 'u2' } }, res);

    expect(res.json.mock.calls[0][0].hasPassword).toBe(false);
  });
});

describe('changePassword', () => {
  test('updates the password after verifying the current one', async () => {
    User.findById.mockResolvedValue(passwordUser());
    bcrypt.compare.mockResolvedValue(true);
    bcrypt.hash.mockResolvedValue('new-hashed');
    const res = mockRes();

    await changePassword({ user: { id: 'u1' }, body: { currentPassword: 'old', newPassword: 'newpassword1' } }, res);

    expect(bcrypt.compare).toHaveBeenCalledWith('old', 'hashed-secret');
    expect(User.updateOne).toHaveBeenCalledWith({ _id: 'u1' }, { $set: { password: 'new-hashed' } });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
  });

  test('rejects an incorrect current password without changing anything, using 400 (not 401 — see controller comment on why 401 is avoided here)', async () => {
    User.findById.mockResolvedValue(passwordUser());
    bcrypt.compare.mockResolvedValue(false);
    const res = mockRes();

    await changePassword({ user: { id: 'u1' }, body: { currentPassword: 'wrong', newPassword: 'newpassword1' } }, res);

    expect(User.updateOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects a new password under 8 characters', async () => {
    const res = mockRes();
    await changePassword({ user: { id: 'u1' }, body: { currentPassword: 'old', newPassword: 'short' } }, res);
    expect(User.findById).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('a Google-only account (no password on file) cannot "change" a password that does not exist', async () => {
    User.findById.mockResolvedValue(googleUser());
    const res = mockRes();

    await changePassword({ user: { id: 'u2' }, body: { currentPassword: 'x', newPassword: 'newpassword1' } }, res);

    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(User.updateOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('deleteAccount', () => {
  const okDeletes = () => {
    UserJob.deleteMany.mockResolvedValue({});
    ResumeProfile.deleteMany.mockResolvedValue({});
    Feedback.deleteMany.mockResolvedValue({});
    EmailLog.deleteMany.mockResolvedValue({});
    OtpVerification.deleteMany.mockResolvedValue({});
    User.deleteOne.mockResolvedValue({});
  };

  test('requires the literal "DELETE" confirmation before touching anything', async () => {
    User.findById.mockResolvedValue(passwordUser());
    const res = mockRes();

    await deleteAccount({ user: { id: 'u1' }, body: { confirmation: 'delete' } }, res);

    expect(UserJob.deleteMany).not.toHaveBeenCalled();
    expect(User.deleteOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('a missing confirmation is rejected before any deletion', async () => {
    User.findById.mockResolvedValue(passwordUser());
    const res = mockRes();

    await deleteAccount({ user: { id: 'u1' }, body: {} }, res);

    expect(UserJob.deleteMany).not.toHaveBeenCalled();
    expect(User.deleteOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('a password account can delete by typing DELETE alone — no password required or checked', async () => {
    User.findById.mockResolvedValue(passwordUser());
    okDeletes();
    const res = mockRes();

    await deleteAccount({ user: { id: 'u1' }, body: { confirmation: 'DELETE' } }, res);

    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(UserJob.deleteMany).toHaveBeenCalledWith({ userId: 'u1' });
    expect(ResumeProfile.deleteMany).toHaveBeenCalledWith({ userId: 'u1' });
    expect(Feedback.deleteMany).toHaveBeenCalledWith({ userId: 'u1' });
    expect(EmailLog.deleteMany).toHaveBeenCalledWith({ userId: 'u1' });
    expect(OtpVerification.deleteMany).toHaveBeenCalledWith({ email: 'a@x.com' });
    expect(User.deleteOne).toHaveBeenCalledWith({ _id: 'u1' });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
  });

  test('a Google-only account can delete with just the typed confirmation — no password required', async () => {
    User.findById.mockResolvedValue(googleUser());
    okDeletes();
    const res = mockRes();

    await deleteAccount({ user: { id: 'u2' }, body: { confirmation: 'DELETE' } }, res);

    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(User.deleteOne).toHaveBeenCalledWith({ _id: 'u2' });
  });

  // Even if a malicious client sends a different id anywhere in the request,
  // the controller must only ever resolve the account from req.user.id (the
  // verified-JWT identity set by the `protect` middleware) — never from the
  // request body or params. This is what makes "delete my own account" safe
  // to expose without per-request re-authentication.
  test('ignores any client-supplied user id and only ever acts on the authenticated session identity', async () => {
    User.findById.mockResolvedValue(passwordUser());
    okDeletes();
    const res = mockRes();

    await deleteAccount({
      user: { id: 'u1' },
      params: { id: 'u2', userId: 'u2' },
      body: { confirmation: 'DELETE', userId: 'u2', id: 'u2' },
    }, res);

    expect(User.findById).toHaveBeenCalledWith('u1');
    expect(UserJob.deleteMany).toHaveBeenCalledWith({ userId: 'u1' });
    expect(User.deleteOne).toHaveBeenCalledWith({ _id: 'u1' });
    expect(User.deleteOne).not.toHaveBeenCalledWith({ _id: 'u2' });
  });

  // The core safety guarantee: if ANY auxiliary collection's cleanup fails,
  // the User document must never be deleted — the account stays fully intact
  // (modulo already-removed auxiliary records — see the next test) and the
  // same request can be retried safely later.
  test('a failure deleting an auxiliary collection aborts BEFORE the User document is deleted', async () => {
    User.findById.mockResolvedValue(passwordUser());
    UserJob.deleteMany.mockResolvedValue({});
    ResumeProfile.deleteMany.mockRejectedValue(new Error('Mongo blip'));
    Feedback.deleteMany.mockResolvedValue({});
    EmailLog.deleteMany.mockResolvedValue({});
    OtpVerification.deleteMany.mockResolvedValue({});
    const res = mockRes();

    await expect(deleteAccount({ user: { id: 'u1' }, body: { confirmation: 'DELETE' } }, res)).resolves.not.toThrow();

    expect(User.deleteOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  // This is the exact bug this test suite previously missed: on the
  // sequential (non-transactional) path, UserJob.deleteMany above actually
  // succeeded before ResumeProfile.deleteMany failed — so SOME of this
  // user's data really was removed. The response must say so, not claim
  // "nothing was deleted" (that claim is only ever true when the whole
  // cascade is wrapped in a real, aborted MongoDB transaction — see the
  // transactional-path tests below).
  test('a failure AFTER at least one step has already succeeded is reported as a partial failure, never as "nothing was deleted"', async () => {
    User.findById.mockResolvedValue(passwordUser());
    UserJob.deleteMany.mockResolvedValue({});
    ResumeProfile.deleteMany.mockRejectedValue(new Error('Mongo blip'));
    Feedback.deleteMany.mockResolvedValue({});
    EmailLog.deleteMany.mockResolvedValue({});
    OtpVerification.deleteMany.mockResolvedValue({});
    const res = mockRes();

    await deleteAccount({ user: { id: 'u1' }, body: { confirmation: 'DELETE' } }, res);

    expect(User.deleteOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    const message = res.json.mock.calls[0][0].message;
    expect(message).not.toMatch(/nothing was deleted/i);
    expect(message).toMatch(/already removed|partially|did not finish/i);
    expect(message).toMatch(/retry/i);
  });

  // The mirror case: the very FIRST step fails, so "nothing was deleted" is
  // still an accurate claim on the sequential path too.
  test('a failure on the very first step is still accurately reported as nothing deleted', async () => {
    User.findById.mockResolvedValue(passwordUser());
    UserJob.deleteMany.mockRejectedValue(new Error('Mongo blip'));
    const res = mockRes();

    await deleteAccount({ user: { id: 'u1' }, body: { confirmation: 'DELETE' } }, res);

    expect(ResumeProfile.deleteMany).not.toHaveBeenCalled();
    expect(User.deleteOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringMatching(/nothing was deleted/i),
    }));
  });

  // Retry safety: after a partial sequential failure, the exact same request
  // (same authenticated user, same body) must be able to finish the job —
  // re-deleting already-empty collections is a no-op — and must still never
  // touch any other user's account.
  test('retrying after a partial sequential failure safely finishes the job', async () => {
    User.findById.mockResolvedValue(passwordUser());
    UserJob.deleteMany.mockResolvedValue({});
    ResumeProfile.deleteMany
      .mockRejectedValueOnce(new Error('Mongo blip'))  // attempt 1: fails here
      .mockResolvedValueOnce({});                       // attempt 2 (retry): succeeds
    Feedback.deleteMany.mockResolvedValue({});
    EmailLog.deleteMany.mockResolvedValue({});
    OtpVerification.deleteMany.mockResolvedValue({});
    User.deleteOne.mockResolvedValue({});

    const firstAttempt = mockRes();
    await deleteAccount({ user: { id: 'u1' }, body: { confirmation: 'DELETE' } }, firstAttempt);
    expect(firstAttempt.status).toHaveBeenCalledWith(500);
    expect(User.deleteOne).not.toHaveBeenCalled();

    const retry = mockRes();
    await deleteAccount({ user: { id: 'u1' }, body: { confirmation: 'DELETE' } }, retry);

    expect(User.deleteOne).toHaveBeenCalledTimes(1);
    expect(User.deleteOne).toHaveBeenCalledWith({ _id: 'u1' });
    expect(User.deleteOne).not.toHaveBeenCalledWith({ _id: 'u2' });
    expect(retry.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
    expect(retry.status).not.toHaveBeenCalled();
  });
});

describe('deleteAccount — transactional path (MongoDB deployments that support transactions, e.g. Atlas)', () => {
  const allChainable = () => {
    UserJob.deleteMany.mockReturnValue(chainable());
    ResumeProfile.deleteMany.mockReturnValue(chainable());
    Feedback.deleteMany.mockReturnValue(chainable());
    EmailLog.deleteMany.mockReturnValue(chainable());
    OtpVerification.deleteMany.mockReturnValue(chainable());
    User.deleteOne.mockReturnValue(chainable());
  };

  test('runs the whole cascade inside one real transaction when the deployment supports it', async () => {
    User.findById.mockResolvedValue(passwordUser());
    const { withTransaction, endSession } = mockSession({ withTransactionImpl: async (fn) => fn() });
    allChainable();
    const res = mockRes();

    await deleteAccount({ user: { id: 'u1' }, body: { confirmation: 'DELETE' } }, res);

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(UserJob.deleteMany).toHaveBeenCalledWith({ userId: 'u1' });
    expect(UserJob.deleteMany).toHaveBeenCalledTimes(1); // never ALSO retried via the sequential fallback
    expect(User.deleteOne).toHaveBeenCalledWith({ _id: 'u1' });
    expect(endSession).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
  });

  // The whole point of using a transaction: a failure partway through is
  // guaranteed by MongoDB to roll back everything already attempted inside
  // it, so — unlike the sequential path — "nothing was deleted" really is
  // true here even though UserJob's delete ran before ResumeProfile's failed.
  test('a genuine mid-transaction failure is atomic — correctly reported as nothing deleted, and never falls through to a second, unsessioned attempt', async () => {
    User.findById.mockResolvedValue(passwordUser());
    const { endSession } = mockSession({ withTransactionImpl: async (fn) => fn() });
    UserJob.deleteMany.mockReturnValue(chainable());
    ResumeProfile.deleteMany.mockReturnValue({ session: jest.fn().mockRejectedValue(new Error('Mongo blip mid-transaction')) });
    const res = mockRes();

    await deleteAccount({ user: { id: 'u1' }, body: { confirmation: 'DELETE' } }, res);

    expect(UserJob.deleteMany).toHaveBeenCalledTimes(1); // one attempt only — no sequential retry
    expect(User.deleteOne).not.toHaveBeenCalled();
    expect(endSession).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringMatching(/nothing was deleted/i),
    }));
  });

  test('falls back to the sequential path only for the specific "transactions unsupported" error, and completes the deletion there', async () => {
    User.findById.mockResolvedValue(passwordUser());
    mockSession(); // default: rejects with the unsupported-transactions error
    UserJob.deleteMany.mockResolvedValue({});
    ResumeProfile.deleteMany.mockResolvedValue({});
    Feedback.deleteMany.mockResolvedValue({});
    EmailLog.deleteMany.mockResolvedValue({});
    OtpVerification.deleteMany.mockResolvedValue({});
    User.deleteOne.mockResolvedValue({});
    const res = mockRes();

    await deleteAccount({ user: { id: 'u1' }, body: { confirmation: 'DELETE' } }, res);

    expect(User.deleteOne).toHaveBeenCalledWith({ _id: 'u1' });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
  });

  test('always ends the Mongo session, even when the transaction attempt fails', async () => {
    User.findById.mockResolvedValue(passwordUser());
    const { endSession } = mockSession({ withTransactionImpl: async () => { throw new Error('boom'); } });
    const res = mockRes();

    await deleteAccount({ user: { id: 'u1' }, body: { confirmation: 'DELETE' } }, res);

    expect(endSession).toHaveBeenCalledTimes(1);
  });
});
