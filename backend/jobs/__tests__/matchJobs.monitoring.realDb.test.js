// Real-database validation for Improvement 6. The outcome-classification
// logic itself is already exercised against mocks in
// matchJobs.monitoring.test.js — this file checks what a fake model can't
// prove: that getPendingMatchBacklog/getMatcherVersionBacklog return correct
// results against real indexed queries, and that a real match-cron tick
// persists a real, queryable MatchRun document end-to-end.

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.setTimeout(60000);
jest.mock('node-cron', () => ({ schedule: jest.fn() }));

let mongod;
let User, Job, UserJob, MatchRun;
let getPendingMatchBacklog, getMatcherVersionBacklog, MATCHER_VERSION;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  User = require('../../models/User');
  Job = require('../../models/Job');
  UserJob = require('../../models/UserJob');
  MatchRun = require('../../models/MatchRun');
  await Promise.all([User.init(), Job.init(), UserJob.init(), MatchRun.init()]);
  ({ getPendingMatchBacklog, getMatcherVersionBacklog, MATCHER_VERSION } = require('../../services/jobMatcher.service'));
});

afterEach(async () => {
  await Promise.all([User.deleteMany({}), Job.deleteMany({}), UserJob.deleteMany({}), MatchRun.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const makeUser = (overrides = {}) => User.create({
  email: `${Math.random().toString(36).slice(2)}@x.com`,
  password: 'hashed',
  isOnboarded: true,
  isEmailVerified: true,
  desiredRoles: ['Backend Developer'],
  skills: ['Python'],
  ...overrides,
});

const makeJob = (overrides = {}) => Job.create({
  title: 'Backend Engineer',
  description: 'Python role',
  location: 'Remote',
  hash: Math.random().toString(36),
  status: 'active',
  ...overrides,
});

test('getPendingMatchBacklog reflects real pending jobs and the real oldest-age calculation', async () => {
  const older = await makeJob();
  // {timestamps:false} is required here — Mongoose's own timestamps plugin
  // otherwise overwrites any $set.updatedAt with "now" on every update.
  await Job.updateOne({ _id: older._id }, { $set: { updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } }, { timestamps: false });
  await makeJob(); // a second, newer pending job
  await makeJob({ needsMatching: false }); // already processed — must not count

  const backlog = await getPendingMatchBacklog();

  expect(backlog.count).toBe(2);
  expect(backlog.oldestPendingAgeMs).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000 - 5000);
});

test('getMatcherVersionBacklog counts only records below the current version, via the real index', async () => {
  const user = await makeUser();
  const job = await makeJob();
  await UserJob.create({ userId: user._id, jobId: job._id, score: 10, matcherVersion: 0 });
  await UserJob.create({ userId: user._id, jobId: (await makeJob())._id, score: 10, matcherVersion: MATCHER_VERSION });

  const backlog = await getMatcherVersionBacklog();

  expect(backlog).toBe(1);
});

test('a real match-cron tick persists a real, queryable MatchRun document reflecting what actually happened', async () => {
  await makeUser();
  await makeJob();

  const { startMatchJobsCron } = require('../matchJobs.job');
  const cron = require('node-cron');
  startMatchJobsCron();
  const tick = cron.schedule.mock.calls[cron.schedule.mock.calls.length - 1][1];

  await tick();

  const runs = await MatchRun.find().sort({ createdAt: -1 }).lean();
  expect(runs.length).toBe(1);
  expect(runs[0].outcome).toBe('success');
  expect(runs[0].pendingJobsConsidered).toBeGreaterThanOrEqual(1);
  expect(runs[0].pendingMarkedProcessed).toBe(true);
  expect(typeof runs[0].durationMs).toBe('number');
});
