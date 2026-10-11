// Real-database validation for the upstream-trace feature: index definitions
// (TTL, unique traceId) and the full capture → correlation pipeline, run
// against a real (disposable) MongoDB instance rather than mocks — this is
// exactly the kind of thing a fake model can't prove (index behavior,
// genuine uniqueness enforcement, real compression round-trips persisted and
// re-read from an actual document).

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.setTimeout(60000);
process.env.FETCH_RETRY_BASE_MS = '1';

// axios is mocked file-wide (not via resetModules/doMock) specifically so it
// never disturbs the real, already-established mongoose connection this file
// relies on for everything else here — only the one end-to-end test below
// actually uses it.
jest.mock('axios');
jest.mock('../../services/companies.service', () => ({ getCompanies: jest.fn() }));

let mongod;
let UpstreamTrace, TraceStorageStats, Job;
let recordTrace, decompressBody, reconcileStorageStats;
let correlateTrace;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  UpstreamTrace = require('../../models/UpstreamTrace');
  TraceStorageStats = require('../../models/TraceStorageStats');
  Job = require('../../models/Job');
  await Promise.all([UpstreamTrace.init(), TraceStorageStats.init(), Job.init()]);
  ({ recordTrace, decompressBody, reconcileStorageStats } = require('../traceStorage.service'));
  ({ correlateTrace } = require('../traceCorrelation.service'));
});

afterEach(async () => {
  await Promise.all([UpstreamTrace.deleteMany({}), TraceStorageStats.deleteMany({}), Job.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('UpstreamTrace indexes', () => {
  test('the TTL index on requestedAt is declared with the configured retention window', async () => {
    const indexes = await UpstreamTrace.collection.indexes();
    const ttlIndex = indexes.find((i) => i.key && i.key.requestedAt === 1 && i.expireAfterSeconds !== undefined);
    expect(ttlIndex).toBeDefined();
    expect(ttlIndex.expireAfterSeconds).toBe(7 * 24 * 60 * 60); // TRACE_RETENTION_DAYS default
  });

  test('traceId has a real, enforced unique index — a duplicate insert is rejected', async () => {
    await UpstreamTrace.create({
      traceId: 'dup-1', provider: 'greenhouse', operation: 'list_jobs', url: 'https://x', requestedAt: new Date(),
      success: true, durationMs: 1,
    });
    await expect(UpstreamTrace.create({
      traceId: 'dup-1', provider: 'lever', operation: 'list_jobs', url: 'https://y', requestedAt: new Date(),
      success: true, durationMs: 1,
    })).rejects.toThrow(/E11000/);
  });

  test('observedSourceJobIds and resultingJobIds are indexed for efficient point lookups', async () => {
    const indexes = await UpstreamTrace.collection.indexes();
    expect(indexes.some((i) => i.key && i.key.observedSourceJobIds === 1)).toBe(true);
    expect(indexes.some((i) => i.key && i.key.resultingJobIds === 1)).toBe(true);
  });
});

describe('recordTrace + correlateTrace — full pipeline against a real database', () => {
  test('a captured trace can be found by provider/time range without decompressing any body', async () => {
    await recordTrace({
      traceId: 'real-1', provider: 'greenhouse', operation: 'list_jobs', boardToken: 'okta',
      url: 'https://boards-api.greenhouse.io/v1/boards/okta/jobs', requestedAt: new Date(),
      success: true, statusCode: 200, durationMs: 150,
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: { jobs: [{ id: 7882676, title: 'Software Architect, Java Backend' }] },
    });

    const found = await UpstreamTrace.findOne({ provider: 'greenhouse' }).select('-bodyGzip').lean();
    expect(found.traceId).toBe('real-1');
    expect(found.bodyCaptureStatus).toBe('complete');
  });

  test('the stored body genuinely round-trips through real compression/decompression', async () => {
    const originalBody = { jobs: [{ id: 1, title: 'Engineer', description: 'A real description with unicode: café, naïve' }] };
    await recordTrace({
      traceId: 'real-2', provider: 'lever', operation: 'list_jobs', boardToken: 'acme',
      url: 'https://api.lever.co/v0/postings/acme', requestedAt: new Date(),
      success: true, statusCode: 200, durationMs: 50, responseBody: originalBody,
    });

    const stored = await UpstreamTrace.findOne({ traceId: 'real-2' }).lean();
    expect(decompressBody(stored)).toEqual(originalBody);
  });

  test('correlation resolves an upstream job ID to the real internal Job _id created in the same cycle', async () => {
    const job = await Job.create({
      title: 'Software Architect, Java Backend', company: 'Okta', location: 'Bengaluru, India',
      hash: 'real-correlation-hash', source: 'greenhouse', sourceBoard: 'okta', sourceJobId: '7882676', status: 'active',
    });

    await recordTrace({
      traceId: 'real-3', provider: 'greenhouse', operation: 'list_jobs', boardToken: 'okta',
      url: 'https://boards-api.greenhouse.io/v1/boards/okta/jobs', requestedAt: new Date(),
      success: true, statusCode: 200, durationMs: 150,
      responseBody: { jobs: [{ id: 7882676, title: 'Software Architect, Java Backend' }] },
    });

    await correlateTrace({ traceId: 'real-3', source: 'greenhouse', sourceBoard: 'okta', observedSourceJobIds: ['7882676'] });

    // Findable from the upstream side (Phase 4: search by upstream provider job ID)
    const byUpstreamId = await UpstreamTrace.findOne({ observedSourceJobIds: '7882676' }).lean();
    expect(byUpstreamId.traceId).toBe('real-3');

    // Findable from the internal side (Phase 4: search by internal MongoDB Job ID)
    const byInternalId = await UpstreamTrace.findOne({ resultingJobIds: job._id }).lean();
    expect(byInternalId.traceId).toBe('real-3');
  });

  test('correlation is a safe no-op (never throws) when no Job happens to match yet', async () => {
    await recordTrace({
      traceId: 'real-4', provider: 'ashby', operation: 'list_jobs', boardToken: 'acme',
      url: 'https://api.ashbyhq.com/posting-api/job-board/acme', requestedAt: new Date(),
      success: true, statusCode: 200, durationMs: 50, responseBody: { jobs: [{ id: 'unmatched' }] },
    });

    await expect(correlateTrace({ traceId: 'real-4', source: 'ashby', sourceBoard: 'acme', observedSourceJobIds: ['unmatched'] }))
      .resolves.toBeUndefined();

    const trace = await UpstreamTrace.findOne({ traceId: 'real-4' }).lean();
    expect(trace.resultingJobIds).toEqual([]);
    expect(trace.observedSourceJobIds).toEqual(['unmatched']);
  });
});

describe('end-to-end through a real provider adapter (Greenhouse), with axios mocked but everything else (Mongo, models, tracing, correlation) real', () => {
  test('a full fetchJobs() run creates a real Job and a real, correlated trace together', async () => {
    const axios = require('axios');
    const { getCompanies } = require('../../services/companies.service');
    getCompanies.mockResolvedValue([{ _id: null, name: 'Okta', token: 'okta' }]);
    axios.get.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: { jobs: [{ id: 7882676, title: 'Software Architect, Java Backend', location: { name: 'Bengaluru, India' }, absolute_url: 'https://okta.example/7882676', content: '<p>desc</p>', first_published: '2026-06-09T00:00:00Z', updated_at: '2026-09-21T00:00:00Z' }] },
    });

    const { fetchJobs } = require('../../platforms/greenhouse');
    await fetchJobs();

    const job = await Job.findOne({ source: 'greenhouse', sourceBoard: 'okta', sourceJobId: '7882676' }).lean();
    expect(job).toBeTruthy();
    expect(job.title).toBe('Software Architect, Java Backend');

    const trace = await UpstreamTrace.findOne({ provider: 'greenhouse', boardToken: 'okta' }).lean();
    expect(trace).toBeTruthy();
    expect(trace.success).toBe(true);
    expect(trace.observedSourceJobIds).toContain('7882676');
    expect(trace.resultingJobIds.map(String)).toContain(String(job._id));

    const body = decompressBody(trace);
    expect(body.jobs[0].title).toBe('Software Architect, Java Backend');
  });
});

describe('Storage counter reconciliation (real MongoDB) — proves the gap this hardens, and the fix', () => {
  test('a document removed WITHOUT going through recordTrace/pruneIfNeeded (simulating MongoDB\'s own background TTL deletion) is invisible to the counter until reconciliation runs', async () => {
    await recordTrace({
      traceId: 'ttl-sim-1', provider: 'greenhouse', operation: 'list_jobs', boardToken: 'okta',
      url: 'https://x', requestedAt: new Date(), success: true, statusCode: 200, durationMs: 10,
      responseBody: { jobs: [{ id: 1, title: 'x'.repeat(100) }] },
    });

    const afterInsert = await TraceStorageStats.findById('singleton').lean();
    expect(afterInsert.totalRecords).toBe(1);
    expect(afterInsert.totalStoredBytes).toBeGreaterThan(0);

    // Simulate the TTL monitor deleting this document directly — exactly
    // what mongod's background process does, entirely outside this
    // service's code and therefore invisible to the $inc-based counter.
    await UpstreamTrace.deleteOne({ traceId: 'ttl-sim-1' });

    const afterTtlDelete = await TraceStorageStats.findById('singleton').lean();
    expect(afterTtlDelete.totalRecords).toBe(1); // still stale — this IS the gap being hardened against
    expect(await UpstreamTrace.countDocuments({})).toBe(0); // but the real collection is already empty

    // Reconciliation self-heals it, recomputing from the real collection.
    const reconciled = await reconcileStorageStats();

    expect(reconciled.totalRecords).toBe(0);
    expect(reconciled.totalStoredBytes).toBe(0);
    const afterReconcile = await TraceStorageStats.findById('singleton').lean();
    expect(afterReconcile.totalRecords).toBe(0);
    expect(afterReconcile.lastReconciledAt).toBeInstanceOf(Date);
  });

  test('reconciliation produces exact totals matching a real multi-document collection', async () => {
    for (let i = 0; i < 5; i++) {
      await recordTrace({
        traceId: `recon-${i}`, provider: 'lever', operation: 'list_jobs', boardToken: 'acme',
        url: 'https://x', requestedAt: new Date(), success: true, statusCode: 200, durationMs: 10,
        responseBody: { jobs: [{ id: i }] },
      });
    }

    const realDocs = await UpstreamTrace.find({}).select('bodyStoredSize').lean();
    const realTotalBytes = realDocs.reduce((sum, d) => sum + (d.bodyStoredSize || 0), 0);

    const reconciled = await reconcileStorageStats();

    expect(reconciled.totalRecords).toBe(5);
    expect(reconciled.totalStoredBytes).toBe(realTotalBytes);
  });
});
