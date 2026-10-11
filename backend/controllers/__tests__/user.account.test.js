// Guards the new account-management endpoints (navbar account menu follow-up):
// getProfile's hasPassword flag, changePassword, and deleteAccount. The most
// important behavior here is deleteAccount's failure ordering — the User
// document must never be deleted unless every auxiliary collection's cleanup
// already succeeded, so a partial failure always leaves the account (and
// data) fully intact and safely retryable.

jest.mock('bcryptjs', () => ({ compare: jest.fn(), hash: jest.fn() }));
jest.mock('../../models/User', () => ({ findById: jest.fn(), updateOne: jest.fn(), deleteOne: jest.fn() }));
jest.mock('../../models/UserJob', () => ({ deleteMany: jest.fn() }));
jest.mock('../../models/ResumeProfile', () => ({ deleteMany: jest.fn() }));
jest.mock('../../models/Feedback', () => ({ deleteMany: jest.fn() }));
jest.mock('../../models/EmailLog', () => ({ deleteMany: jest.fn() }));
jest.mock('../../models/OtpVerification', () => ({ deleteMany: jest.fn() }));
jest.mock('../../services/jobMatcher.service', () => ({ matchJobsForUser: jest.fn().mockResolvedValue() }));

const bcrypt = require('bcryptjs');
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

beforeEach(() => jest.clearAllMocks());

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
  // and the same request can be retried safely later.
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
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringMatching(/nothing was deleted/i),
    }));
  });
});
