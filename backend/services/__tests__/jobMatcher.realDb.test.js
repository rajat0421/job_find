// Real-database validation for Improvement 5. The coverage/versioning logic
// itself is already exercised against an in-memory fake in
// jobMatcher.coverage.test.js — this file specifically checks that the new
// indexes and query shapes behave correctly against a real (disposable)
// MongoDB instance, which a fake model can't prove.

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.setTimeout(60000);

let mongod;
let User, Job, UserJob;
let matchJobsForAllUsers, matchJobsForUser, sweepStaleMatcherVersions, MATCHER_VERSION;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  User = require('../../models/User');
  Job = require('../../models/Job');
  UserJob = require('../../models/UserJob');
  await Promise.all([User.init(), Job.init(), UserJob.init()]);
  ({ matchJobsForAllUsers, matchJobsForUser, sweepStaleMatcherVersions, MATCHER_VERSION } = require('../jobMatcher.service'));
});

afterEach(async () => {
  await Promise.all([User.deleteMany({}), Job.deleteMany({}), UserJob.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const makeUser = (overrides = {}) =>
  User.create({
    email: `${Math.random().toString(36).slice(2)}@x.com`,
    password: 'hashed',
    isOnboarded: true,
    isEmailVerified: true,
    desiredRoles: ['Backend Developer'],
    skills: ['Python'],
    experience: 3,
    locations: ['Remote'],
    remotePreference: 'any',
    ...overrides,
  });

const makeJob = (overrides = {}) =>
  Job.create({
    title: 'Backend Engineer',
    description: 'Python role, great team',
    location: 'Remote',
    hash: Math.random().toString(36),
    status: 'active',
    ...overrides,
  });

test('a job with an old createdAt (outside a real latest-N window) is still matched via the pending batch', async () => {
  const user = await makeUser();
  // Explicitly backdate createdAt by writing it directly — simulates a job
  // that would fall outside MATCH_WINDOW in a large real collection, while
  // still needsMatching:true (the default).
  const job = await makeJob();
  await Job.updateOne({ _id: job._id }, { $set: { createdAt: new Date('2000-01-01') } });

  await matchJobsForAllUsers();

  const uj = await UserJob.findOne({ userId: user._id, jobId: job._id });
  expect(uj).toBeTruthy();
  expect(uj.score).toBeGreaterThan(0);
  const reloadedJob = await Job.findById(job._id);
  expect(reloadedJob.needsMatching).toBe(false); // marked processed after a successful pass
});

test('a job whose content changes after being matched gets its existing UserJob updated, not duplicated', async () => {
  const user = await makeUser();
  const job = await makeJob({ title: 'Backend Engineer' });

  await matchJobsForAllUsers();
  const firstPass = await UserJob.findOne({ userId: user._id, jobId: job._id });
  expect(firstPass).toBeTruthy();

  // Content change via a real update — this is what jobLifecycle.service.js's
  // observeJob does when a board re-fetch sees different content; here we
  // apply the same effect directly to isolate the matcher's own behavior.
  await Job.updateOne({ _id: job._id }, { $set: { title: 'Senior Backend Engineer', needsMatching: true } });

  await matchJobsForAllUsers();

  const allMatches = await UserJob.find({ userId: user._id, jobId: job._id });
  expect(allMatches).toHaveLength(1); // same record, not duplicated
  expect(allMatches[0]._id.toString()).toBe(firstPass._id.toString());
});

test('a profile change rescales an existing match linked to a job outside the recent window', async () => {
  const user = await makeUser({ skills: ['Python'] });
  const job = await makeJob({ title: 'Java Developer', description: 'Enterprise Java role' });
  await Job.updateOne({ _id: job._id }, { $set: { createdAt: new Date('2000-01-01') } });

  await matchJobsForAllUsers(); // Python user vs Java job — likely low/no score, may not even create a record
  const before = await UserJob.findOne({ userId: user._id, jobId: job._id });

  await User.updateOne({ _id: user._id }, { $set: { skills: ['Java'] } });
  const updatedUser = await User.findById(user._id);
  await matchJobsForUser(updatedUser._id.toString());

  const after = await UserJob.findOne({ userId: user._id, jobId: job._id });
  expect(after).toBeTruthy();
  expect(after.score).toBeGreaterThan(before?.score || 0);
});

test('matcher version sweep brings a legacy record current, bounded per call', async () => {
  const user = await makeUser();
  const job = await makeJob();
  const uj = await UserJob.create({ userId: user._id, jobId: job._id, score: 1, matcherVersion: 0 });

  const count = await sweepStaleMatcherVersions();

  expect(count).toBe(1);
  const reloaded = await UserJob.findById(uj._id);
  expect(reloaded.matcherVersion).toBe(MATCHER_VERSION);
});

test('saved/applied/emailed survive a full matchJobsForAllUsers pass that rescales the record', async () => {
  const user = await makeUser();
  const job = await makeJob({ title: 'Senior Backend Engineer' });
  await UserJob.create({ userId: user._id, jobId: job._id, score: 5, saved: true, applied: true, emailed: true, matcherVersion: 0 });
  await Job.updateOne({ _id: job._id }, { $set: { needsMatching: true } });

  await matchJobsForAllUsers();

  const reloaded = await UserJob.findOne({ userId: user._id, jobId: job._id });
  expect(reloaded.saved).toBe(true);
  expect(reloaded.applied).toBe(true);
  expect(reloaded.emailed).toBe(true);
});
