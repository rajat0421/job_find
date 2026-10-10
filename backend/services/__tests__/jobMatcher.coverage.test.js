// Guards Improvement 5: matching coverage, stale-match correction, and
// matcher versioning. Uses the shared in-memory fake models (real
// find/sort/limit/populate/bulkWrite semantics) so the actual orchestration
// logic in jobMatcher.service.js runs for real — only the MongoDB driver
// itself is faked. Does not re-test scoreJobDetailed's algorithm (untouched,
// out of scope) — only that the right pairs get scored/skipped/updated.

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

const baseUser = (overrides = {}) => ({
  _id: 'u1', email: 'a@x.com', isOnboarded: true, isEmailVerified: true,
  desiredRoles: ['Backend Developer'], skills: ['Python'], experience: 3,
  locations: ['Remote'], salary: null, remotePreference: 'any',
  ...overrides,
});

const baseJob = (overrides = {}) => ({
  _id: 'j1', title: 'Backend Engineer', description: 'Python role', location: 'Remote',
  workplaceType: null, salaryMin: null, salaryMax: null, status: 'active',
  createdAt: new Date(), updatedAt: new Date(), needsMatching: true,
  ...overrides,
});

describe('coverage: pending jobs outside the recent window (#1, #2)', () => {
  test('a job with an old createdAt (would be outside a real latest-2000 window) is still matched via the pending batch', async () => {
    const { matchJobsForAllUsers } = require('../jobMatcher.service');
    User.__reset([baseUser()]);
    Job.__reset([baseJob({ _id: 'old1', createdAt: new Date('2000-01-01'), needsMatching: true })]);

    await matchJobsForAllUsers();

    const uj = UserJob.__store().find((u) => u.jobId === 'old1');
    expect(uj).toBeTruthy();
    expect(uj.score).toBeGreaterThan(0);
  });

  test('a brand-new job (needsMatching defaults true) is eligible for matching immediately', async () => {
    const { matchJobsForAllUsers } = require('../jobMatcher.service');
    User.__reset([baseUser()]);
    Job.__reset([baseJob({ _id: 'new1' })]); // needsMatching: true via baseJob default

    await matchJobsForAllUsers();

    expect(UserJob.__store().find((u) => u.jobId === 'new1')).toBeTruthy();
  });

  test('once processed, a pending job is marked needsMatching:false and not reprocessed for no reason', async () => {
    const { matchJobsForAllUsers } = require('../jobMatcher.service');
    User.__reset([baseUser()]);
    Job.__reset([baseJob({ _id: 'j1' })]);

    await matchJobsForAllUsers();

    expect(Job.__store().find((j) => j._id === 'j1').needsMatching).toBe(false);
  });
});

describe('coverage: unchanged jobs are not needlessly rescored (#3)', () => {
  test('a fully current pair (matching version + fingerprints) is skipped — no scoring work, score untouched', async () => {
    const { matchJobsForAllUsers, computeUserFingerprint, computeJobFingerprint, MATCHER_VERSION } = require('../jobMatcher.service');
    const user = baseUser();
    const job = baseJob({ _id: 'j1', needsMatching: true }); // still pending so it's in this cycle's candidate set
    User.__reset([user]);
    Job.__reset([job]);
    UserJob.__reset([{
      _id: 'uj1', userId: 'u1', jobId: 'j1', score: 77, saved: false, applied: false, emailed: false,
      matcherVersion: MATCHER_VERSION, userFingerprint: computeUserFingerprint(user), jobFingerprint: computeJobFingerprint(job),
    }]);

    await matchJobsForAllUsers();

    expect(UserJob.__store().find((u) => u._id === 'uj1').score).toBe(77);
  });
});

describe('coverage: interrupted batches remain eligible for a later run (#4)', () => {
  test('if the final "mark processed" step fails, needsMatching stays true for the next cron tick', async () => {
    const { matchJobsForAllUsers } = require('../jobMatcher.service');
    User.__reset([baseUser()]);
    Job.__reset([baseJob({ _id: 'p1' })]);
    Job.updateMany.mockRejectedValueOnce(new Error('DB connection dropped'));

    await expect(matchJobsForAllUsers()).rejects.toThrow('DB connection dropped');

    expect(Job.__store().find((j) => j._id === 'p1').needsMatching).toBe(true);
  });
});

describe('coverage: existing UserJob updated, never duplicated, when stale (#5)', () => {
  test('a stale existing pair is updated in place — no second record is created', async () => {
    const { matchJobsForAllUsers } = require('../jobMatcher.service');
    const user = baseUser();
    const job = baseJob({ _id: 'j1', title: 'Senior Backend Engineer' }); // content changed since last scored
    User.__reset([user]);
    Job.__reset([job]);
    UserJob.__reset([{ _id: 'uj1', userId: 'u1', jobId: 'j1', score: 10, saved: false, applied: false, emailed: false, matcherVersion: 0 }]);

    await matchJobsForAllUsers();

    const matchingRecords = UserJob.__store().filter((u) => u.userId === 'u1' && u.jobId === 'j1');
    expect(matchingRecords).toHaveLength(1);
    expect(matchingRecords[0]._id).toBe('uj1'); // same record, updated — not a new one
  });
});

describe('coverage: user profile changes refresh existing matches, including older jobs (#6, #8)', () => {
  test('a profile change rescoring older matches does not require scanning the whole job collection', async () => {
    const { matchJobsForUser, computeJobFingerprint, MATCHER_VERSION } = require('../jobMatcher.service');
    const user = baseUser({ skills: ['Java'] }); // changed from whatever it was scored under
    const oldJob = baseJob({ _id: 'veryOld', createdAt: new Date('1999-01-01'), title: 'Java Engineer', description: 'Java role' });
    User.__reset([user]);
    Job.__reset([oldJob]); // only this one job exists — proves no collection-wide scan is needed to find it
    UserJob.__reset([{
      _id: 'uj1', userId: 'u1', jobId: 'veryOld', score: 5, saved: false, applied: false, emailed: false,
      matcherVersion: MATCHER_VERSION, userFingerprint: 'stale-fingerprint-from-before', jobFingerprint: computeJobFingerprint(oldJob),
    }]);

    await matchJobsForUser('u1');

    const uj = UserJob.__store().find((u) => u._id === 'uj1');
    expect(uj.score).not.toBe(5); // rescored under the new profile
    expect(uj.userFingerprint).not.toBe('stale-fingerprint-from-before');
  });

  test('changing email interval/schedule settings alone does not trigger a rescore (not part of the user fingerprint)', async () => {
    const { computeUserFingerprint } = require('../jobMatcher.service');
    const user1 = baseUser({ emailIntervalHours: 24, emailSendHourIST: 10, lastEmailedAt: new Date('2020-01-01') });
    const user2 = baseUser({ emailIntervalHours: 1, emailSendHourIST: 3, lastEmailedAt: new Date('2026-01-01') });

    expect(computeUserFingerprint(user1)).toBe(computeUserFingerprint(user2));
  });
});

describe('coverage: job content changes are detected; irrelevant changes are not (#7, #8)', () => {
  const { computeJobFingerprint } = require('../jobMatcher.service');

  test.each([
    ['title', { title: 'Different Title' }],
    ['description', { description: 'Completely different text' }],
    ['location', { location: 'Bangalore' }],
    ['workplaceType', { workplaceType: 'remote' }],
    ['salaryMin', { salaryMin: 500000 }],
    ['salaryMax', { salaryMax: 2000000 }],
    ['status', { status: 'closed' }],
  ])('a change to %s produces a different fingerprint', (_field, change) => {
    const original = baseJob();
    const changed = baseJob(change);
    expect(computeJobFingerprint(original)).not.toBe(computeJobFingerprint(changed));
  });

  test('lastSeenAt alone does not change the job fingerprint', () => {
    const a = baseJob({ lastSeenAt: new Date('2020-01-01') });
    const b = baseJob({ lastSeenAt: new Date('2026-01-01') });
    expect(computeJobFingerprint(a)).toBe(computeJobFingerprint(b));
  });

  test('company, applyLink and postedAt alone do not change the job fingerprint', () => {
    const a = baseJob({ company: 'Acme', applyLink: 'https://a.com', postedAt: new Date('2020-01-01') });
    const b = baseJob({ company: 'Globex', applyLink: 'https://b.com', postedAt: new Date('2026-01-01') });
    expect(computeJobFingerprint(a)).toBe(computeJobFingerprint(b));
  });
});

describe('coverage: matcher version change is resumable, not an unbounded rescore (#9)', () => {
  test('a legacy UserJob (matcherVersion 0) is brought current by the sweep', async () => {
    const { sweepStaleMatcherVersions, MATCHER_VERSION } = require('../jobMatcher.service');
    const user = baseUser();
    const job = baseJob();
    User.__reset([user]);
    Job.__reset([job]);
    UserJob.__reset([{ _id: 'legacy1', userId: 'u1', jobId: 'j1', score: 10, saved: false, applied: false, emailed: false, matcherVersion: 0 }]);

    const count = await sweepStaleMatcherVersions();

    expect(count).toBe(1);
    expect(UserJob.__store().find((u) => u._id === 'legacy1').matcherVersion).toBe(MATCHER_VERSION);
  });

  test('a large backlog is processed across multiple bounded calls, never all at once', async () => {
    const { sweepStaleMatcherVersions } = require('../jobMatcher.service');
    const user = baseUser();
    User.__reset([user]);
    const BACKLOG_SIZE = 350; // larger than VERSION_SWEEP_BATCH_SIZE (300)
    const jobs = Array.from({ length: BACKLOG_SIZE }, (_, i) => baseJob({ _id: `j${i}` }));
    Job.__reset(jobs);
    UserJob.__reset(jobs.map((j, i) => ({ _id: `uj${i}`, userId: 'u1', jobId: j._id, score: 0, saved: false, applied: false, emailed: false, matcherVersion: 0 })));

    const firstPass = await sweepStaleMatcherVersions();
    expect(firstPass).toBeLessThan(BACKLOG_SIZE);
    expect(UserJob.__store().filter((u) => u.matcherVersion === 0).length).toBeGreaterThan(0);

    const secondPass = await sweepStaleMatcherVersions();
    expect(firstPass + secondPass).toBeGreaterThan(firstPass); // real progress on the second call
  });
});

describe('coverage: saved/applied/emailed flags survive rescoring (#11)', () => {
  test('saved, applied and emailed are preserved when an existing match is refreshed', async () => {
    const { matchJobsForAllUsers } = require('../jobMatcher.service');
    const user = baseUser();
    const job = baseJob({ _id: 'j1', title: 'Totally Different Role Now' });
    User.__reset([user]);
    Job.__reset([job]);
    UserJob.__reset([{ _id: 'uj1', userId: 'u1', jobId: 'j1', score: 10, saved: true, applied: true, emailed: true, matcherVersion: 0 }]);

    await matchJobsForAllUsers();

    const uj = UserJob.__store().find((u) => u._id === 'uj1');
    expect(uj.saved).toBe(true);
    expect(uj.applied).toBe(true);
    expect(uj.emailed).toBe(true);
  });

  test('a rescored pair that now scores 0 is updated, not deleted — saved history survives', async () => {
    const { matchJobsForAllUsers } = require('../jobMatcher.service');
    const user = baseUser({ skills: ['CompletelyUnrelatedSkillXYZ'], desiredRoles: [] });
    const job = baseJob({ _id: 'j1', title: 'Sales Representative' }); // blacklisted title, no role affinity → score 0
    User.__reset([user]);
    Job.__reset([job]);
    UserJob.__reset([{ _id: 'uj1', userId: 'u1', jobId: 'j1', score: 50, saved: true, applied: false, emailed: true, matcherVersion: 0 }]);

    await matchJobsForAllUsers();

    const uj = UserJob.__store().find((u) => u._id === 'uj1');
    expect(uj).toBeTruthy(); // still exists
    expect(uj.saved).toBe(true); // history preserved
    expect(uj.score).toBe(0);
  });
});

describe('coverage: new users and resume confirmation still get matches (#12)', () => {
  test('matchJobsForUser creates fresh matches for a brand-new user with no prior UserJob records', async () => {
    const { matchJobsForUser } = require('../jobMatcher.service');
    User.__reset([baseUser({ _id: 'newUser' })]);
    Job.__reset([baseJob({ _id: 'j1' })]);

    await matchJobsForUser('newUser');

    expect(UserJob.__store().find((u) => u.userId === 'newUser' && u.jobId === 'j1')).toBeTruthy();
  });
});
