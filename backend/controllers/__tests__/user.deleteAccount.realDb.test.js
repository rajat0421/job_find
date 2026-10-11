// Real-database proof for the account-deletion atomicity fix. The unit tests
// in user.account.test.js mock mongoose entirely, which is right for most
// logic but can't actually prove the one claim this file exists to check:
// that wrapping the cascade in a real MongoDB transaction genuinely rolls
// back every write if any step fails, on an actual replica set (the one
// MongoDB topology that supports transactions at all).
//
// MongoMemoryReplSet (not plain MongoMemoryServer) is required here — a
// standalone instance would make every deleteAccount call take the
// sequential fallback, which is already covered against mocks and wouldn't
// exercise the transactional path at all.

const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

jest.setTimeout(60000);

let replset;
let User, UserJob, ResumeProfile, Feedback, EmailLog, OtpVerification;
let deleteAccount;

beforeAll(async () => {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replset.getUri());

  User = require('../../models/User');
  UserJob = require('../../models/UserJob');
  ResumeProfile = require('../../models/ResumeProfile');
  Feedback = require('../../models/Feedback');
  EmailLog = require('../../models/EmailLog');
  OtpVerification = require('../../models/OtpVerification');
  await Promise.all([User.init(), UserJob.init(), ResumeProfile.init(), Feedback.init(), EmailLog.init(), OtpVerification.init()]);

  ({ deleteAccount } = require('../user.controller'));
});

afterEach(async () => {
  await Promise.all([
    User.deleteMany({}), UserJob.deleteMany({}), ResumeProfile.deleteMany({}),
    Feedback.deleteMany({}), EmailLog.deleteMany({}), OtpVerification.deleteMany({}),
  ]);
  jest.restoreAllMocks();
});

afterAll(async () => {
  await mongoose.disconnect();
  await replset.stop();
});

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

// Seeds one full "account" — a User plus one document in every cascaded
// collection — so a test can check that deletion is all-or-nothing across
// every one of them, not just the ones that happen to run first.
const seedFullAccount = async (emailSuffix) => {
  // googleId is a sparse-unique index but defaults to an explicit `null`
  // (not `undefined`), which a sparse index still indexes — so seeding more
  // than one user per test needs a distinct value here to avoid an
  // unrelated duplicate-key error that has nothing to do with what this
  // test suite is actually checking.
  const user = await User.create({ email: `del-${emailSuffix}@x.com`, password: 'hashed', name: 'Target', googleId: `no-google-${emailSuffix}` });
  const job = new mongoose.Types.ObjectId();
  await UserJob.create({ userId: user._id, jobId: job, score: 50 });
  await ResumeProfile.create({ userId: user._id, resumeHash: 'abc123' });
  await Feedback.create({ userId: user._id, message: 'hi' });
  await EmailLog.create({ userId: user._id, email: user.email, idempotencyKey: `del-test-${emailSuffix}` });
  await OtpVerification.create({ email: user.email, otp: '123456', expiresAt: new Date(Date.now() + 60000) });
  return user;
};

const countsFor = async (user) => ({
  user: await User.countDocuments({ _id: user._id }),
  userJob: await UserJob.countDocuments({ userId: user._id }),
  resumeProfile: await ResumeProfile.countDocuments({ userId: user._id }),
  feedback: await Feedback.countDocuments({ userId: user._id }),
  emailLog: await EmailLog.countDocuments({ userId: user._id }),
  otp: await OtpVerification.countDocuments({ email: user.email }),
});

test('a full account deletion removes the User and every owned record, atomically, via a real transaction', async () => {
  const user = await seedFullAccount('success');
  const res = mockRes();

  await deleteAccount({ user: { id: user._id.toString() }, body: { confirmation: 'DELETE' } }, res);

  expect(res.status).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
  expect(await countsFor(user)).toEqual({ user: 0, userJob: 0, resumeProfile: 0, feedback: 0, emailLog: 0, otp: 0 });
});

test('a failure partway through the real transaction rolls back EVERY write — nothing is left deleted', async () => {
  const user = await seedFullAccount('rollback');

  // UserJob and ResumeProfile's deletes (earlier in the cascade) would
  // succeed; Feedback's is forced to fail mid-transaction, simulating a
  // genuine mid-cascade error the way the real driver would surface one.
  jest.spyOn(Feedback, 'deleteMany').mockReturnValueOnce({
    session: () => Promise.reject(new Error('Simulated mid-transaction failure')),
  });

  const res = mockRes();
  await deleteAccount({ user: { id: user._id.toString() }, body: { confirmation: 'DELETE' } }, res);

  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    message: expect.stringMatching(/nothing was deleted/i),
  }));

  // The actual proof: UserJob and ResumeProfile's deletes were issued INSIDE
  // the aborted transaction, before Feedback's failed — a real MongoDB
  // transaction guarantees they were rolled back along with everything else.
  expect(await countsFor(user)).toEqual({ user: 1, userJob: 1, resumeProfile: 1, feedback: 1, emailLog: 1, otp: 1 });
});

test('after a rolled-back failure, retrying the exact same request succeeds and only affects that one account', async () => {
  const target = await seedFullAccount('retry-target');
  const other = await seedFullAccount('retry-other');

  jest.spyOn(Feedback, 'deleteMany').mockReturnValueOnce({
    session: () => Promise.reject(new Error('Simulated mid-transaction failure')),
  });
  const failedAttempt = mockRes();
  await deleteAccount({ user: { id: target._id.toString() }, body: { confirmation: 'DELETE' } }, failedAttempt);
  expect(failedAttempt.status).toHaveBeenCalledWith(500);
  expect(await countsFor(target)).toEqual({ user: 1, userJob: 1, resumeProfile: 1, feedback: 1, emailLog: 1, otp: 1 });

  const retry = mockRes();
  await deleteAccount({ user: { id: target._id.toString() }, body: { confirmation: 'DELETE' } }, retry);

  expect(retry.status).not.toHaveBeenCalled();
  expect(await countsFor(target)).toEqual({ user: 0, userJob: 0, resumeProfile: 0, feedback: 0, emailLog: 0, otp: 0 });
  // The other account, seeded alongside the target, must be completely untouched.
  expect(await countsFor(other)).toEqual({ user: 1, userJob: 1, resumeProfile: 1, feedback: 1, emailLog: 1, otp: 1 });
});
