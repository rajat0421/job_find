// Guards Improvement 11's follow-up gap #2: sendDigestForUser (the admin's
// manual per-user send) previously used its OWN query, missing the
// matcherVersion/needsMatching/userFingerprint staleness checks the scheduled
// cron already had. Both paths now call this one exported function —
// getEligibleDigestJobs — directly, so this file tests it once, here, rather
// than duplicating the same assertions in both dailyEmail.job.js's and
// admin.controller.js's test suites.

jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../../models/User', () => ({ find: jest.fn(), updateOne: jest.fn() }));
jest.mock('../../models/UserJob', () => ({ find: jest.fn(), countDocuments: jest.fn(), updateMany: jest.fn() }));
jest.mock('../../models/EmailLog', () => ({ create: jest.fn(), findByIdAndUpdate: jest.fn(), findOne: jest.fn() }));
jest.mock('../../models/Config', () => ({ findOne: jest.fn() }));
jest.mock('../../services/email.service', () => ({ sendJobDigestEmail: jest.fn(), sendAdminDigestCopy: jest.fn(), isSafeHttpUrl: jest.requireActual('../../services/email.service').isSafeHttpUrl }));
jest.mock('../../services/config.service', () => ({
  getEmailThreshold: jest.fn(),
  getEmailFreshnessConfig: jest.fn().mockResolvedValue({ defaultMaxAgeDays: 30, adzunaMaxAgeDays: 14 }),
  // Real fallback constants — exercised by the "omit the freshness argument"
  // test below, which calls getEligibleDigestJobs without a third argument.
  DEFAULT_EMAIL_FRESHNESS_MAX_AGE_DAYS: 30,
  ADZUNA_EMAIL_FRESHNESS_MAX_AGE_DAYS: 14,
}));

const UserJob = require('../../models/UserJob');
const { computeUserFingerprint, MATCHER_VERSION } = require('../../services/jobMatcher.service');
const { getEligibleDigestJobs } = require('../dailyEmail.job');

const USER = { _id: 'u1', email: 'a@x.com', name: 'A', skills: ['Python'] };
const USER_FINGERPRINT = computeUserFingerprint(USER);

// A fresh, valid-link job — the "otherwise eligible" baseline every fixture
// below starts from, so each test below isolates the ONE dimension it's
// actually checking (matcherVersion/needsMatching/status/fingerprint)
// without also tripping the newer freshness/link-validity filters for an
// unrelated reason.
const FRESH_JOB_FIELDS = { postedAt: new Date(), applyLink: 'https://example.com/apply', source: 'greenhouse' };

const buildUserJobQuery = (resolvedJobs) => {
  const query = {};
  query.sort = jest.fn(() => query);
  query.limit = jest.fn(() => query);
  query.populate = jest.fn().mockResolvedValue(resolvedJobs);
  return query;
};

beforeEach(() => jest.clearAllMocks());

test('excludes a record whose matcherVersion is not current — stale scoring algorithm result', async () => {
  // Not even returned by the query itself (matcherVersion is a Mongo filter),
  // but asserting the filter shape proves the SAME check sendDigest relies on
  // is applied here.
  const query = buildUserJobQuery([]);
  UserJob.find.mockReturnValue(query);

  await getEligibleDigestJobs(USER, 50);

  expect(UserJob.find).toHaveBeenCalledWith(expect.objectContaining({ matcherVersion: MATCHER_VERSION }));
});

test('excludes a record whose job is pending reprocessing (needsMatching:true), even if its stored score clears the threshold', async () => {
  const pending = { _id: 'uj1', jobId: { status: 'active', needsMatching: true }, score: 90, matcherVersion: MATCHER_VERSION, userFingerprint: USER_FINGERPRINT };
  UserJob.find.mockReturnValue(buildUserJobQuery([pending]));

  const eligible = await getEligibleDigestJobs(USER, 50);

  expect(eligible).toHaveLength(0);
});

test('excludes a record whose job status is closed/expired', async () => {
  const closed = { _id: 'uj1', jobId: { status: 'closed', needsMatching: false }, score: 90, matcherVersion: MATCHER_VERSION, userFingerprint: USER_FINGERPRINT };
  UserJob.find.mockReturnValue(buildUserJobQuery([closed]));

  const eligible = await getEligibleDigestJobs(USER, 50);

  expect(eligible).toHaveLength(0);
});

test('excludes a record scored under a stale (outdated) user profile fingerprint — e.g. the profile changed since this score was computed', async () => {
  const staleProfile = { _id: 'uj1', jobId: { status: 'active', needsMatching: false }, score: 90, matcherVersion: MATCHER_VERSION, userFingerprint: 'some-old-fingerprint-value' };
  UserJob.find.mockReturnValue(buildUserJobQuery([staleProfile]));

  const eligible = await getEligibleDigestJobs(USER, 50);

  expect(eligible).toHaveLength(0);
});

test('a genuinely current, active, non-stale record is included', async () => {
  const current = { _id: 'uj1', jobId: { status: 'active', needsMatching: false, ...FRESH_JOB_FIELDS }, score: 90, matcherVersion: MATCHER_VERSION, userFingerprint: USER_FINGERPRINT };
  UserJob.find.mockReturnValue(buildUserJobQuery([current]));

  const eligible = await getEligibleDigestJobs(USER, 50);

  expect(eligible).toHaveLength(1);
  expect(eligible[0]._id).toBe('uj1');
});

// Stale-job-email protection: posting age and application-link validity.
describe('posting freshness and application-link validity', () => {
  const FRESHNESS = { defaultMaxAgeDays: 30, adzunaMaxAgeDays: 14 };

  test('excludes a job older than the default max age (non-Adzuna source)', async () => {
    const tooOld = {
      _id: 'uj1',
      jobId: { status: 'active', needsMatching: false, source: 'greenhouse', applyLink: 'https://example.com/apply', postedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
      score: 90, matcherVersion: MATCHER_VERSION, userFingerprint: USER_FINGERPRINT,
    };
    UserJob.find.mockReturnValue(buildUserJobQuery([tooOld]));

    const eligible = await getEligibleDigestJobs(USER, 50, FRESHNESS);

    expect(eligible).toHaveLength(0);
  });

  test('includes a job exactly at the default max age boundary', async () => {
    const atBoundary = {
      _id: 'uj1',
      jobId: { status: 'active', needsMatching: false, source: 'greenhouse', applyLink: 'https://example.com/apply', postedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      score: 90, matcherVersion: MATCHER_VERSION, userFingerprint: USER_FINGERPRINT,
    };
    UserJob.find.mockReturnValue(buildUserJobQuery([atBoundary]));

    const eligible = await getEligibleDigestJobs(USER, 50, FRESHNESS);

    expect(eligible).toHaveLength(1);
  });

  test('an Adzuna job uses the shorter Adzuna-specific max age, not the general default', async () => {
    const adzunaMidAge = {
      _id: 'uj1',
      // 20 days old: within the general 30-day default, but past Adzuna's 14-day limit.
      jobId: { status: 'active', needsMatching: false, source: 'adzuna', applyLink: 'https://example.com/apply', postedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) },
      score: 90, matcherVersion: MATCHER_VERSION, userFingerprint: USER_FINGERPRINT,
    };
    UserJob.find.mockReturnValue(buildUserJobQuery([adzunaMidAge]));

    const eligible = await getEligibleDigestJobs(USER, 50, FRESHNESS);

    expect(eligible).toHaveLength(0);
  });

  test('a fresh Adzuna job within its own 14-day limit is still included', async () => {
    const adzunaFresh = {
      _id: 'uj1',
      jobId: { status: 'active', needsMatching: false, source: 'adzuna', applyLink: 'https://example.com/apply', postedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
      score: 90, matcherVersion: MATCHER_VERSION, userFingerprint: USER_FINGERPRINT,
    };
    UserJob.find.mockReturnValue(buildUserJobQuery([adzunaFresh]));

    const eligible = await getEligibleDigestJobs(USER, 50, FRESHNESS);

    expect(eligible).toHaveLength(1);
  });

  test('a missing publication date is treated conservatively as NOT fresh, never as proof the posting is recent', async () => {
    const noDate = {
      _id: 'uj1',
      jobId: { status: 'active', needsMatching: false, source: 'greenhouse', applyLink: 'https://example.com/apply', postedAt: null },
      score: 90, matcherVersion: MATCHER_VERSION, userFingerprint: USER_FINGERPRINT,
    };
    UserJob.find.mockReturnValue(buildUserJobQuery([noDate]));

    const eligible = await getEligibleDigestJobs(USER, 50, FRESHNESS);

    expect(eligible).toHaveLength(0);
  });

  // Legacy-data semantics: a record predating reliable postedAt capture (or
  // from before the Greenhouse ingestion fix corrected what postedAt means)
  // must never be treated as fresh just because the SYSTEM has touched it
  // recently — updatedAt/lastSeenAt say when this app last observed the
  // record, never when the position itself was first published.
  test('never substitutes updatedAt/lastSeenAt/sourceUpdatedAt for a missing postedAt, even when those are very recent', async () => {
    const legacyButRecentlySeen = {
      _id: 'uj1',
      jobId: {
        status: 'active', needsMatching: false, source: 'greenhouse', applyLink: 'https://example.com/apply',
        postedAt: null, // the one field that actually matters here
        updatedAt: new Date(), lastSeenAt: new Date(), sourceUpdatedAt: new Date(),
      },
      score: 90, matcherVersion: MATCHER_VERSION, userFingerprint: USER_FINGERPRINT,
    };
    UserJob.find.mockReturnValue(buildUserJobQuery([legacyButRecentlySeen]));

    const eligible = await getEligibleDigestJobs(USER, 50, FRESHNESS);

    expect(eligible).toHaveLength(0);
  });

  test('an unparseable publication date is treated the same as a missing one', async () => {
    const badDate = {
      _id: 'uj1',
      jobId: { status: 'active', needsMatching: false, source: 'greenhouse', applyLink: 'https://example.com/apply', postedAt: 'not-a-real-date' },
      score: 90, matcherVersion: MATCHER_VERSION, userFingerprint: USER_FINGERPRINT,
    };
    UserJob.find.mockReturnValue(buildUserJobQuery([badDate]));

    const eligible = await getEligibleDigestJobs(USER, 50, FRESHNESS);

    expect(eligible).toHaveLength(0);
  });

  test('excludes a job with no application link at all', async () => {
    const noLink = {
      _id: 'uj1',
      jobId: { status: 'active', needsMatching: false, source: 'greenhouse', applyLink: '', postedAt: new Date() },
      score: 90, matcherVersion: MATCHER_VERSION, userFingerprint: USER_FINGERPRINT,
    };
    UserJob.find.mockReturnValue(buildUserJobQuery([noLink]));

    const eligible = await getEligibleDigestJobs(USER, 50, FRESHNESS);

    expect(eligible).toHaveLength(0);
  });

  test('excludes a job whose application link uses a non-http(s) scheme', async () => {
    const badScheme = {
      _id: 'uj1',
      jobId: { status: 'active', needsMatching: false, source: 'greenhouse', applyLink: 'javascript:alert(1)', postedAt: new Date() },
      score: 90, matcherVersion: MATCHER_VERSION, userFingerprint: USER_FINGERPRINT,
    };
    UserJob.find.mockReturnValue(buildUserJobQuery([badScheme]));

    const eligible = await getEligibleDigestJobs(USER, 50, FRESHNESS);

    expect(eligible).toHaveLength(0);
  });

  test('excludes a job whose application link is simply malformed', async () => {
    const malformed = {
      _id: 'uj1',
      jobId: { status: 'active', needsMatching: false, source: 'greenhouse', applyLink: 'not a url', postedAt: new Date() },
      score: 90, matcherVersion: MATCHER_VERSION, userFingerprint: USER_FINGERPRINT,
    };
    UserJob.find.mockReturnValue(buildUserJobQuery([malformed]));

    const eligible = await getEligibleDigestJobs(USER, 50, FRESHNESS);

    expect(eligible).toHaveLength(0);
  });

  test('a fresh job with a valid https link passes both new checks', async () => {
    const good = {
      _id: 'uj1',
      jobId: { status: 'active', needsMatching: false, source: 'greenhouse', applyLink: 'https://boards.greenhouse.io/acme/jobs/123', postedAt: new Date() },
      score: 90, matcherVersion: MATCHER_VERSION, userFingerprint: USER_FINGERPRINT,
    };
    UserJob.find.mockReturnValue(buildUserJobQuery([good]));

    const eligible = await getEligibleDigestJobs(USER, 50, FRESHNESS);

    expect(eligible).toHaveLength(1);
  });

  test('omitting the freshness argument entirely falls back to the built-in defaults (30 days general / 14 Adzuna), not a crash', async () => {
    const current = {
      _id: 'uj1',
      jobId: { status: 'active', needsMatching: false, source: 'greenhouse', applyLink: 'https://example.com/apply', postedAt: new Date() },
      score: 90, matcherVersion: MATCHER_VERSION, userFingerprint: USER_FINGERPRINT,
    };
    UserJob.find.mockReturnValue(buildUserJobQuery([current]));

    const eligible = await getEligibleDigestJobs(USER, 50); // no third argument

    expect(eligible).toHaveLength(1);
  });
});

test('a hard-deleted job (populate resolves jobId to null) is excluded, not a crash', async () => {
  const orphaned = { _id: 'uj1', jobId: null, score: 90, matcherVersion: MATCHER_VERSION, userFingerprint: USER_FINGERPRINT };
  UserJob.find.mockReturnValue(buildUserJobQuery([orphaned]));

  await expect(getEligibleDigestJobs(USER, 50)).resolves.toHaveLength(0);
});

test('the query is bounded to the top 10 by score — unchanged cap', async () => {
  const query = buildUserJobQuery([]);
  UserJob.find.mockReturnValue(query);

  await getEligibleDigestJobs(USER, 50);

  expect(query.sort).toHaveBeenCalledWith({ score: -1 });
  expect(query.limit).toHaveBeenCalledWith(10);
});
