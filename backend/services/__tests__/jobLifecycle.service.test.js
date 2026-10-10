jest.mock('../../models/Job', () => {
  const { createFakeJobModel } = require('../../test-utils/fakeJobModel');
  return createFakeJobModel();
});

const Job = require('../../models/Job');

beforeEach(() => {
  Job.__store.length = 0;
  jest.clearAllMocks();
});

describe('observeJob — identity and deduplication', () => {
  test('a stable source ID updates an existing posting rather than inserting a duplicate', async () => {
    const { observeJob } = require('../jobLifecycle.service');

    await observeJob({ source: 'greenhouse', sourceBoard: 'acme', sourceJobId: '123', hash: 'h1', fields: { title: 'Backend Engineer', company: 'Acme', location: 'Remote' } });
    await observeJob({ source: 'greenhouse', sourceBoard: 'acme', sourceJobId: '123', hash: 'h1', fields: { title: 'Senior Backend Engineer', company: 'Acme', location: 'Remote' } });

    expect(Job.__store).toHaveLength(1);
    expect(Job.__store[0].title).toBe('Senior Backend Engineer');
  });

  test('two genuinely distinct postings with identical title/company/location are kept separate when stable IDs differ', async () => {
    const { observeJob } = require('../jobLifecycle.service');
    const fields = { title: 'Software Engineer', company: 'Acme', location: 'Remote' };

    await observeJob({ source: 'greenhouse', sourceBoard: 'acme', sourceJobId: 'A', hash: 'same-hash', fields });
    await observeJob({ source: 'greenhouse', sourceBoard: 'acme', sourceJobId: 'B', hash: 'same-hash', fields });

    expect(Job.__store).toHaveLength(2);
    expect(Job.__store.map((j) => j.sourceJobId).sort()).toEqual(['A', 'B']);
  });

  test('a changed title/location does not create a duplicate when the stable source ID is unchanged, even though the hash changes', async () => {
    const { observeJob } = require('../jobLifecycle.service');

    await observeJob({ source: 'lever', sourceBoard: 'acme', sourceJobId: '99', hash: 'hash-v1', fields: { title: 'Backend Engineer', company: 'Acme', location: 'Bangalore' } });
    await observeJob({ source: 'lever', sourceBoard: 'acme', sourceJobId: '99', hash: 'hash-v2', fields: { title: 'Backend Engineer II', company: 'Acme', location: 'Remote' } });

    expect(Job.__store).toHaveLength(1);
    expect(Job.__store[0].location).toBe('Remote');
    expect(Job.__store[0].hash).toBe('hash-v2');
  });

  test('cross-source dedup is preserved: a provider without the stable ID still collapses onto an existing hash match', async () => {
    const { observeJob } = require('../jobLifecycle.service');

    // Greenhouse observes it first, with a stable ID.
    await observeJob({ source: 'greenhouse', sourceBoard: 'acme', sourceJobId: '1', hash: 'shared-hash', fields: { title: 'Data Engineer', company: 'Acme', location: 'Remote', description: 'rich GH description' } });
    // Adzuna's aggregator later surfaces what looks like the same vacancy (same fingerprint).
    await observeJob({ source: 'adzuna', sourceBoard: null, sourceJobId: 'adzuna-999', hash: 'shared-hash', fields: { title: 'Data Engineer', company: 'Acme', location: 'Remote', description: 'thin adzuna snippet' } });

    expect(Job.__store).toHaveLength(1);
    // Hash-matched merge must not let the second source's data clobber the first's.
    expect(Job.__store[0].description).toBe('rich GH description');
    expect(Job.__store[0].source).toBe('greenhouse');
  });

  test('a brand new posting with a never-seen ID and hash is created', async () => {
    const { observeJob } = require('../jobLifecycle.service');

    const { created } = await observeJob({ source: 'ashby', sourceBoard: 'notion', sourceJobId: 'x1', hash: 'new-hash', fields: { title: 'PM', company: 'Notion', location: 'SF' } });

    expect(created).toBe(true);
    expect(Job.__store).toHaveLength(1);
  });

  test('providers without a stable ID fall back to hash-only identity exactly as before', async () => {
    const { observeJob } = require('../jobLifecycle.service');

    await observeJob({ source: 'legacy', sourceBoard: null, sourceJobId: null, hash: 'legacy-hash', fields: { title: 'Old Role', company: 'X', location: 'Y' } });
    const { created } = await observeJob({ source: 'legacy', sourceBoard: null, sourceJobId: null, hash: 'legacy-hash', fields: { title: 'Old Role Renamed', company: 'X', location: 'Y' } });

    expect(created).toBe(false);
    expect(Job.__store).toHaveLength(1);
    // Hash-only match path does not overwrite fields (preserves today's silent-skip behavior).
    expect(Job.__store[0].title).toBe('Old Role');
  });
});

describe('sweepMissingJobs — conservative missing-posting detection', () => {
  const seedActiveJob = async (overrides = {}) => {
    const { observeJob } = require('../jobLifecycle.service');
    await observeJob({
      source: 'greenhouse', sourceBoard: 'acme', sourceJobId: overrides.sourceJobId || '1', hash: overrides.hash || 'h',
      fields: { title: 'Role', company: 'Acme', location: 'Remote' },
    });
  };

  test('a job absent from a single scan is not immediately closed', async () => {
    const { sweepMissingJobs } = require('../jobLifecycle.service');
    await seedActiveJob();

    const result = await sweepMissingJobs({ source: 'greenhouse', sourceBoard: 'acme', observedSourceJobIds: [] });

    expect(result.closed).toBe(0);
    expect(Job.__store[0].status).toBe('active');
    expect(Job.__store[0].missingScans).toBe(1);
  });

  test('persistently missing postings are closed only after crossing the configured threshold', async () => {
    const { sweepMissingJobs, MISSING_SCAN_THRESHOLD } = require('../jobLifecycle.service');
    await seedActiveJob();

    for (let i = 0; i < MISSING_SCAN_THRESHOLD - 1; i++) {
      await sweepMissingJobs({ source: 'greenhouse', sourceBoard: 'acme', observedSourceJobIds: [] });
      expect(Job.__store[0].status).toBe('active');
    }

    await sweepMissingJobs({ source: 'greenhouse', sourceBoard: 'acme', observedSourceJobIds: [] });
    expect(Job.__store[0].status).toBe('closed');
  });

  test('being observed again (via observeJob, as the adapter loop does) resets the missing-scan counter', async () => {
    const { observeJob, sweepMissingJobs } = require('../jobLifecycle.service');
    await seedActiveJob({ sourceJobId: '1' });

    await sweepMissingJobs({ source: 'greenhouse', sourceBoard: 'acme', observedSourceJobIds: [] });
    expect(Job.__store[0].missingScans).toBe(1);

    // Next cycle: the adapter's loop calls observeJob() for every job it actually
    // sees (that's what resets the counter), then sweeps whatever's left missing.
    await observeJob({ source: 'greenhouse', sourceBoard: 'acme', sourceJobId: '1', hash: 'h', fields: { title: 'Role', company: 'Acme', location: 'Remote' } });
    await sweepMissingJobs({ source: 'greenhouse', sourceBoard: 'acme', observedSourceJobIds: ['1'] });

    expect(Job.__store[0].missingScans).toBe(0);
    expect(Job.__store[0].status).toBe('active');
  });

  test('only acts on the given (source, board) — does not touch other boards or sources', async () => {
    const { observeJob, sweepMissingJobs } = require('../jobLifecycle.service');
    await observeJob({ source: 'greenhouse', sourceBoard: 'acme', sourceJobId: '1', hash: 'h1', fields: { title: 'A', company: 'Acme', location: 'X' } });
    await observeJob({ source: 'greenhouse', sourceBoard: 'other-co', sourceJobId: '1', hash: 'h2', fields: { title: 'B', company: 'Other', location: 'Y' } });
    await observeJob({ source: 'lever', sourceBoard: 'acme', sourceJobId: '1', hash: 'h3', fields: { title: 'C', company: 'Acme (Lever)', location: 'Z' } });

    await sweepMissingJobs({ source: 'greenhouse', sourceBoard: 'acme', observedSourceJobIds: [] });

    const [gh, otherBoard, lever] = Job.__store;
    expect(gh.missingScans).toBe(1);
    expect(otherBoard.missingScans).toBe(0);
    expect(lever.missingScans).toBe(0);
  });
});

describe('expireStaleJobs — age-based fallback', () => {
  test('a long-unseen active job is marked expired', async () => {
    const { observeJob, expireStaleJobs, EXPIRY_AGE_DAYS } = require('../jobLifecycle.service');
    await observeJob({ source: 'adzuna', sourceBoard: null, sourceJobId: 'a1', hash: 'h', fields: { title: 'Old Listing', company: 'X', location: 'Y' } });

    const staleDate = new Date(Date.now() - (EXPIRY_AGE_DAYS + 1) * 24 * 60 * 60 * 1000);
    Job.__store[0].lastSeenAt = staleDate;

    const count = await expireStaleJobs();

    expect(count).toBe(1);
    expect(Job.__store[0].status).toBe('expired');
  });

  test('a recently-seen active job is left alone', async () => {
    const { observeJob, expireStaleJobs } = require('../jobLifecycle.service');
    await observeJob({ source: 'adzuna', sourceBoard: null, sourceJobId: 'a2', hash: 'h2', fields: { title: 'Fresh Listing', company: 'X', location: 'Y' } });

    const count = await expireStaleJobs();

    expect(count).toBe(0);
    expect(Job.__store[0].status).toBe('active');
  });

  test('expiry never deletes the record — only flips status', async () => {
    const { observeJob, expireStaleJobs, EXPIRY_AGE_DAYS } = require('../jobLifecycle.service');
    await observeJob({ source: 'adzuna', sourceBoard: null, sourceJobId: 'a3', hash: 'h3', fields: { title: 'Old Listing', company: 'X', location: 'Y' } });
    Job.__store[0].lastSeenAt = new Date(Date.now() - (EXPIRY_AGE_DAYS + 1) * 24 * 60 * 60 * 1000);

    await expireStaleJobs();

    expect(Job.__store).toHaveLength(1); // still present, just inactive
  });
});
