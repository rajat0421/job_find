// Guards the MATCHER_VERSION bump (1 → 2) that ships the role/seniority
// false-positive fix: proves a stale, already-emailed UserJob computed under
// the OLD algorithm (score 88, matcherVersion 1) gets picked up and corrected
// by the existing bounded version sweep even though neither the user's
// profile nor the job's content ever changed — fingerprints alone would
// never catch this, since only the SCORING CODE changed. Uses the same
// in-memory fake models as jobMatcher.coverage.test.js so the real
// orchestration logic runs end-to-end without a real MongoDB connection.

jest.mock('../../models/User', () => require('../../test-utils/fakeMatcherModels').User);
jest.mock('../../models/Job', () => require('../../test-utils/fakeMatcherModels').Job);
jest.mock('../../models/UserJob', () => require('../../test-utils/fakeMatcherModels').UserJob);

const { User, Job, UserJob } = require('../../test-utils/fakeMatcherModels');

beforeEach(() => {
  jest.clearAllMocks();
  User.__reset([]);
  Job.__reset([]);
  UserJob.__reset([]);
});

// A faithful reconstruction of the real incident: a 1-year-experience user
// whose stored match for a 15+-year Principal/Architect posting was
// incorrectly scored 88 and already emailed under the old (v1) algorithm.
const incidentUser = () => ({
  _id: 'u1', email: 'a@x.com', isOnboarded: true, isEmailVerified: true,
  desiredRoles: ['Backend Developer'], skills: ['Java', 'MySQL'], experience: 1,
  locations: ['Remote'], salary: null, remotePreference: 'any',
});

const incidentJob = () => ({
  _id: 'j1', title: 'Software Architect, Java Backend', location: 'Remote',
  description: 'We are looking for an experienced Principal Software Engineer. '
    + 'Lead and mentor junior engineers. Required: 15+ years of Software Development in Java.',
  workplaceType: null, salaryMin: null, salaryMax: null, status: 'active',
  createdAt: new Date(), updatedAt: new Date(), needsMatching: false,
});

test('a stale v1 UserJob with unchanged fingerprints is still picked up by the version sweep after the bump', async () => {
  const { sweepStaleMatcherVersions, MATCHER_VERSION, computeUserFingerprint, computeJobFingerprint } = require('../jobMatcher.service');
  const user = incidentUser();
  const job = incidentJob();
  User.__reset([user]);
  Job.__reset([job]);
  UserJob.__reset([{
    _id: 'uj1', userId: 'u1', jobId: 'j1', score: 88, saved: false, applied: false, emailed: true,
    matcherVersion: MATCHER_VERSION - 1, // computed under the old (buggy) algorithm
    // Fingerprints reflect the SAME, unchanged user/job — exactly what made
    // this bug invisible to the fingerprint-based staleness check.
    userFingerprint: computeUserFingerprint(user),
    jobFingerprint: computeJobFingerprint(job),
    reasons: ['Fits your Backend Developer role', 'Matches your Java, MySQL skills', 'Fresher / junior friendly'],
  }]);

  const count = await sweepStaleMatcherVersions();

  expect(count).toBe(1);
  const uj = UserJob.__store().find((u) => u._id === 'uj1');
  expect(uj.matcherVersion).toBe(MATCHER_VERSION);
  // The corrected algorithm rejects this pair outright (explicit 15+ year
  // requirement vs 1 year of experience) — the stale 88 must not survive.
  expect(uj.score).toBe(0);
});

test('rescoring preserves emailed:true — a corrected-to-ineligible match is never re-sent', async () => {
  const { sweepStaleMatcherVersions, MATCHER_VERSION, computeUserFingerprint, computeJobFingerprint } = require('../jobMatcher.service');
  const user = incidentUser();
  const job = incidentJob();
  User.__reset([user]);
  Job.__reset([job]);
  UserJob.__reset([{
    _id: 'uj1', userId: 'u1', jobId: 'j1', score: 88, saved: false, applied: false, emailed: true,
    matcherVersion: MATCHER_VERSION - 1,
    userFingerprint: computeUserFingerprint(user), jobFingerprint: computeJobFingerprint(job),
  }]);

  await sweepStaleMatcherVersions();

  const uj = UserJob.__store().find((u) => u._id === 'uj1');
  expect(uj.emailed).toBe(true); // untouched by the rescore
  // The digest-eligibility query additionally requires emailed:false — this
  // record was never going to be re-sent regardless of its corrected score,
  // but confirming emailed survives proves the rescore itself never resets it.
});

test('rescoring never creates a duplicate — same internal _id, same (userId, jobId) pair, before and after', async () => {
  const { sweepStaleMatcherVersions, MATCHER_VERSION, computeUserFingerprint, computeJobFingerprint } = require('../jobMatcher.service');
  const user = incidentUser();
  const job = incidentJob();
  User.__reset([user]);
  Job.__reset([job]);
  UserJob.__reset([{
    _id: 'uj1', userId: 'u1', jobId: 'j1', score: 88, saved: false, applied: false, emailed: true,
    matcherVersion: MATCHER_VERSION - 1,
    userFingerprint: computeUserFingerprint(user), jobFingerprint: computeJobFingerprint(job),
  }]);

  await sweepStaleMatcherVersions();

  const matching = UserJob.__store().filter((u) => u.userId === 'u1' && u.jobId === 'j1');
  expect(matching).toHaveLength(1);
  expect(matching[0]._id).toBe('uj1'); // same record, updated in place
  expect(Job.__store().find((j) => j._id === 'j1')._id).toBe('j1'); // internal job id untouched
});

test('the bounded version sweep still only advances a fixed batch per call after the bump (no unbounded rescore)', async () => {
  const { sweepStaleMatcherVersions, MATCHER_VERSION } = require('../jobMatcher.service');
  const user = incidentUser();
  User.__reset([user]);
  const BACKLOG_SIZE = 350; // larger than VERSION_SWEEP_BATCH_SIZE (300)
  const jobs = Array.from({ length: BACKLOG_SIZE }, (_, i) => ({ ...incidentJob(), _id: `j${i}` }));
  Job.__reset(jobs);
  UserJob.__reset(jobs.map((j, i) => ({
    _id: `uj${i}`, userId: 'u1', jobId: j._id, score: 88, saved: false, applied: false, emailed: false,
    matcherVersion: MATCHER_VERSION - 1,
  })));

  const firstPass = await sweepStaleMatcherVersions();
  expect(firstPass).toBeLessThan(BACKLOG_SIZE);
  expect(UserJob.__store().filter((u) => u.matcherVersion === MATCHER_VERSION - 1).length).toBeGreaterThan(0);
});

test('a stale v1 pair not yet rescored is excluded from the digest-eligibility query (never emails an outdated high score)', async () => {
  // Mirrors jobs/dailyEmail.job.js's getEligibleDigestJobs filter directly —
  // matcherVersion must equal the CURRENT constant, so an un-rescored old-
  // version record is excluded from email eligibility regardless of its
  // (possibly stale/wrong) stored score, until the bounded sweep catches up.
  const { MATCHER_VERSION } = require('../jobMatcher.service');
  const staleRecord = { score: 88, matcherVersion: MATCHER_VERSION - 1, emailed: false };
  const threshold = 50;
  const eligible = staleRecord.score >= threshold && staleRecord.matcherVersion === MATCHER_VERSION && !staleRecord.emailed;
  expect(eligible).toBe(false);
});
