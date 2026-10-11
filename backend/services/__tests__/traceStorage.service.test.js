const zlib = require('zlib');

jest.mock('../../models/UpstreamTrace', () => ({
  create: jest.fn().mockResolvedValue({}),
  findById: jest.fn(),
  findOne: jest.fn(),
  deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  aggregate: jest.fn(),
}));
jest.mock('../../models/TraceStorageStats', () => ({
  updateOne: jest.fn().mockResolvedValue({}),
  findById: jest.fn(),
}));

const UpstreamTrace = require('../../models/UpstreamTrace');
const TraceStorageStats = require('../../models/TraceStorageStats');
const {
  recordTrace, decompressBody, pruneIfNeeded, reconcileStorageStats, reconcileIfDue,
  buildBodyCapture, extractJobList, MAX_BODY_BYTES, RECONCILE_INTERVAL_MS,
} = require('../traceStorage.service');

beforeEach(() => {
  jest.clearAllMocks();
  // Default: well under every limit, and reconciled "just now" — so
  // recordTrace()'s unconditional post-write pruneIfNeeded()/reconcileIfDue()
  // calls are both harmless no-ops in tests that aren't specifically
  // exercising either — avoids noisy, misleading error logs from an
  // incidentally-unmocked step in unrelated tests.
  TraceStorageStats.findById.mockReturnValue({ lean: () => Promise.resolve({ totalRecords: 1, totalStoredBytes: 1000, lastReconciledAt: new Date() }) });
});

describe('buildBodyCapture — body-capture status decisions', () => {
  test('null body → status "none", nothing to compress', () => {
    const out = buildBodyCapture(null);
    expect(out.status).toBe('none');
    expect(out.gzip).toBeNull();
  });

  test('a normal-sized job-list body is captured whole, gzip-compressed', () => {
    const body = { jobs: [{ id: 1, title: 'Engineer' }, { id: 2, title: 'Designer' }] };
    const out = buildBodyCapture(body);
    expect(out.status).toBe('complete');
    expect(out.gzip).toBeInstanceOf(Buffer);
    expect(out.isArray).toBe(false);
    expect(out.itemCount).toBe(2);
    const roundTripped = JSON.parse(zlib.gunzipSync(out.gzip).toString('utf8'));
    expect(roundTripped).toEqual(body);
  });

  test('a bare-array body (Lever\'s shape) is recognized correctly', () => {
    const body = [{ id: 'a', text: 'Role A' }];
    const out = buildBodyCapture(body);
    expect(out.status).toBe('complete');
    expect(out.isArray).toBe(true);
    expect(out.itemCount).toBe(1);
  });

  test('an oversized job-list body is truncated to a bounded, EXPLICITLY marked-partial subset, never silently', () => {
    // Build a body whose JSON size clearly exceeds MAX_BODY_BYTES.
    const bigDescription = 'x'.repeat(10000);
    const jobs = Array.from({ length: 2000 }, (_, i) => ({ id: i, title: `Job ${i}`, description: bigDescription }));
    const body = { jobs };
    const originalJson = JSON.stringify(body);
    expect(Buffer.byteLength(originalJson, 'utf8')).toBeGreaterThan(MAX_BODY_BYTES);

    const out = buildBodyCapture(body);
    expect(out.status).toBe('truncated');
    expect(out.omittedReason).toBe('exceeds_max_body_size');

    const decompressed = JSON.parse(zlib.gunzipSync(out.gzip).toString('utf8'));
    expect(decompressed._truncated).toBe(true);
    expect(decompressed._originalCount).toBe(2000);
    expect(decompressed._keptCount).toBeGreaterThan(0);
    expect(decompressed._keptCount).toBeLessThan(2000); // genuinely partial
    expect(decompressed.jobs).toHaveLength(decompressed._keptCount);
    expect(decompressed.jobs[0]).toEqual(jobs[0]); // real job objects, not a string cut
    // The stored, compressed truncated capture must itself still be comfortably small.
    expect(out.storedSize).toBeLessThan(MAX_BODY_BYTES);
  });

  test('a truncated bare-array body preserves the array shape with explicit markers alongside it', () => {
    const jobs = Array.from({ length: 1000 }, (_, i) => ({ id: i, text: 'x'.repeat(10000) }));
    const out = buildBodyCapture(jobs);
    expect(out.status).toBe('truncated');
    const decompressed = JSON.parse(zlib.gunzipSync(out.gzip).toString('utf8'));
    expect(decompressed._truncated).toBe(true);
    expect(decompressed._originalCount).toBe(1000);
    expect(Array.isArray(decompressed.items)).toBe(true);
  });

  test('an oversized body with no recognizable job-list shape is omitted entirely (metadata only, no body)', () => {
    const body = { message: 'x'.repeat(MAX_BODY_BYTES + 1000) };
    const out = buildBodyCapture(body);
    expect(out.status).toBe('omitted');
    expect(out.gzip).toBeNull();
    expect(out.omittedReason).toBe('exceeds_max_body_size');
    expect(out.originalSize).toBeGreaterThan(MAX_BODY_BYTES);
  });

  test('a non-JSON-serializable body (circular reference) is omitted, never throws', () => {
    const circular = {};
    circular.self = circular;
    expect(() => buildBodyCapture(circular)).not.toThrow();
    const out = buildBodyCapture(circular);
    expect(out.status).toBe('omitted');
    expect(out.omittedReason).toBe('not_serializable');
  });
});

describe('extractJobList — generic provider-shape recognition', () => {
  test('recognizes Greenhouse/Ashby shape ({jobs:[...]})', () => {
    expect(extractJobList({ jobs: [{ id: 1 }] }).list).toHaveLength(1);
  });
  test('recognizes Adzuna shape ({results:[...]})', () => {
    expect(extractJobList({ results: [{ id: 1 }] }).list).toHaveLength(1);
  });
  test('recognizes Lever shape (bare array)', () => {
    const { list, bareArray } = extractJobList([{ id: 1 }]);
    expect(list).toHaveLength(1);
    expect(bareArray).toBe(true);
  });
  test('returns null for an unrecognized shape', () => {
    expect(extractJobList({ message: 'error' }).list).toBeNull();
  });
});

describe('recordTrace — compression round trip and never-throws guarantee', () => {
  test('a successful trace round-trips through gzip correctly end to end', async () => {
    let created;
    UpstreamTrace.create.mockImplementation(async (doc) => { created = doc; return doc; });

    await recordTrace({
      traceId: 't1', provider: 'greenhouse', operation: 'list_jobs', boardToken: 'okta',
      url: 'https://boards-api.greenhouse.io/v1/boards/okta/jobs', requestedAt: new Date(),
      success: true, statusCode: 200, durationMs: 120, retries: 0,
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: { jobs: [{ id: 1, title: 'Engineer' }] },
    });

    expect(created.bodyCaptureStatus).toBe('complete');
    const roundTripped = JSON.parse(zlib.gunzipSync(created.bodyGzip).toString('utf8'));
    expect(roundTripped).toEqual({ jobs: [{ id: 1, title: 'Engineer' }] });
  });

  test('a failed request (no response received) is recorded with statusCode null and no body', async () => {
    let created;
    UpstreamTrace.create.mockImplementation(async (doc) => { created = doc; return doc; });

    await recordTrace({
      traceId: 't2', provider: 'adzuna', operation: 'search', boardToken: 'developer jobs',
      url: 'https://api.adzuna.com/v1/api/jobs/in/search/1', requestedAt: new Date(),
      success: false, statusCode: null, durationMs: 10000, retries: 2,
      errorKind: 'timeout', errorMessage: 'timeout of 10000ms exceeded',
    });

    expect(created.success).toBe(false);
    expect(created.statusCode).toBeNull();
    expect(created.errorKind).toBe('timeout');
    expect(created.bodyCaptureStatus).toBe('none');
  });

  test('redacts request/response data before persisting — raw DB document never contains the secret', async () => {
    let created;
    UpstreamTrace.create.mockImplementation(async (doc) => { created = doc; return doc; });

    await recordTrace({
      traceId: 't3', provider: 'adzuna', operation: 'search', boardToken: 'dev',
      url: 'https://api.adzuna.com/v1/api/jobs/in/search/1?app_id=real-id&app_key=real-secret',
      params: { app_id: 'real-id', app_key: 'real-secret' },
      requestedAt: new Date(), success: true, statusCode: 200, durationMs: 50,
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: { results: [{ id: 1, title: 'Engineer' }] },
    });

    expect(created.url).not.toContain('real-id');
    expect(created.url).not.toContain('real-secret');
  });

  test('a database failure while recording a trace never throws — ingestion must never see this as a failure', async () => {
    UpstreamTrace.create.mockRejectedValueOnce(new Error('Mongo is down'));
    await expect(recordTrace({
      traceId: 't4', provider: 'lever', operation: 'list_jobs', boardToken: 'acme',
      url: 'https://api.lever.co/v0/postings/acme', requestedAt: new Date(),
      success: true, statusCode: 200, durationMs: 80, responseBody: [],
    })).resolves.toBeUndefined();
  });

  test('a TraceStorageStats update failure also never throws', async () => {
    TraceStorageStats.updateOne.mockRejectedValueOnce(new Error('counter update failed'));
    await expect(recordTrace({
      traceId: 't5', provider: 'ashby', operation: 'list_jobs', boardToken: 'acme',
      url: 'https://api.ashbyhq.com/posting-api/job-board/acme', requestedAt: new Date(),
      success: true, statusCode: 200, durationMs: 80, responseBody: { jobs: [] },
    })).resolves.toBeUndefined();
  });
});

describe('decompressBody', () => {
  test('decompresses and parses a real captured trace document', () => {
    const gzip = zlib.gzipSync(JSON.stringify({ jobs: [{ id: 1 }] }));
    expect(decompressBody({ bodyGzip: gzip })).toEqual({ jobs: [{ id: 1 }] });
  });

  test('returns null when there is no gzip body (status none/omitted)', () => {
    expect(decompressBody({ bodyGzip: null })).toBeNull();
    expect(decompressBody({})).toBeNull();
  });

  test('never throws on corrupted gzip data', () => {
    expect(() => decompressBody({ bodyGzip: Buffer.from('not actually gzip') })).not.toThrow();
    expect(decompressBody({ bodyGzip: Buffer.from('not actually gzip') })).toBeNull();
  });
});

describe('pruneIfNeeded — bounded pruning of the oldest records', () => {
  test('does nothing when under both the record-count and storage-budget limits', async () => {
    TraceStorageStats.findById.mockReturnValue({ lean: () => Promise.resolve({ totalRecords: 10, totalStoredBytes: 1000 }) });
    await pruneIfNeeded();
    expect(UpstreamTrace.deleteOne).not.toHaveBeenCalled();
  });

  test('deletes the oldest record(s) when over the record-count limit, and updates the counter by what was actually freed', async () => {
    TraceStorageStats.findById
      .mockReturnValueOnce({ lean: () => Promise.resolve({ totalRecords: 5001, totalStoredBytes: 1000 }) });
    UpstreamTrace.findOne.mockReturnValue({
      sort: () => ({ select: () => ({ lean: () => Promise.resolve({ _id: 'oldest1', bodyStoredSize: 200 }) }) }),
    });

    await pruneIfNeeded();

    expect(UpstreamTrace.deleteOne).toHaveBeenCalledWith({ _id: 'oldest1' });
    expect(TraceStorageStats.updateOne).toHaveBeenCalledWith(
      { _id: 'singleton' },
      { $inc: { totalRecords: -1, totalStoredBytes: -200 } }
    );
  });

  test('stops pruning once there are no more records to delete, even if still "over budget" by the counter', async () => {
    TraceStorageStats.findById.mockReturnValue({ lean: () => Promise.resolve({ totalRecords: 5001, totalStoredBytes: 1000 }) });
    UpstreamTrace.findOne.mockReturnValue({ sort: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }) });

    await expect(pruneIfNeeded()).resolves.toBeUndefined();
  });

  test('bounds the number of deletions in a single pass (never an unbounded cleanup sweep)', async () => {
    let remaining = 1000; // a large hypothetical backlog
    TraceStorageStats.findById.mockReturnValue({ lean: () => Promise.resolve({ totalRecords: 5000 + remaining, totalStoredBytes: 0 }) });
    UpstreamTrace.findOne.mockReturnValue({
      sort: () => ({ select: () => ({ lean: () => Promise.resolve({ _id: `old-${remaining}`, bodyStoredSize: 0 }) }) }),
    });

    await pruneIfNeeded();

    expect(UpstreamTrace.deleteOne.mock.calls.length).toBeLessThanOrEqual(100); // MAX_PRUNE_PER_PASS
  });

  test('never throws if TraceStorageStats has no singleton document yet', async () => {
    TraceStorageStats.findById.mockReturnValue({ lean: () => Promise.resolve(null) });
    await expect(pruneIfNeeded()).resolves.toBeUndefined();
    expect(UpstreamTrace.deleteOne).not.toHaveBeenCalled();
  });

  // Real concurrency bug found and fixed: a race where two processes both
  // read the same "oldest" doc before either deletes it. Only one deleteOne
  // call actually removes anything; the loser must NOT also decrement the
  // counter, or the counter silently under-counts (making the budget look
  // like it has more room than it really does).
  test('does NOT decrement the counter when deleteOne removes nothing (lost a concurrent prune race)', async () => {
    TraceStorageStats.findById
      .mockReturnValueOnce({ lean: () => Promise.resolve({ totalRecords: 5001, totalStoredBytes: 1000 }) })
      // Re-read after losing the race — ground truth, already decremented by the winner.
      .mockReturnValueOnce({ lean: () => Promise.resolve({ totalRecords: 5000, totalStoredBytes: 800 }) });
    UpstreamTrace.findOne.mockReturnValue({
      sort: () => ({ select: () => ({ lean: () => Promise.resolve({ _id: 'already-gone', bodyStoredSize: 200 }) }) }),
    });
    UpstreamTrace.deleteOne.mockResolvedValueOnce({ deletedCount: 0 }); // another process already deleted it

    await pruneIfNeeded();

    expect(TraceStorageStats.updateOne).not.toHaveBeenCalled();
  });

  test('a successful delete still decrements normally (deletedCount: 1 is the expected common case)', async () => {
    TraceStorageStats.findById.mockReturnValueOnce({ lean: () => Promise.resolve({ totalRecords: 5001, totalStoredBytes: 1000 }) });
    UpstreamTrace.findOne.mockReturnValue({
      sort: () => ({ select: () => ({ lean: () => Promise.resolve({ _id: 'oldest1', bodyStoredSize: 200 }) }) }),
    });
    UpstreamTrace.deleteOne.mockResolvedValueOnce({ deletedCount: 1 });

    await pruneIfNeeded();

    expect(TraceStorageStats.updateOne).toHaveBeenCalledWith({ _id: 'singleton' }, { $inc: { totalRecords: -1, totalStoredBytes: -200 } });
  });
});

describe('reconcileStorageStats / reconcileIfDue — bounding drift from TTL expiry, crashes, and races', () => {
  test('reconcileStorageStats recomputes exact totals from the real collection via aggregation, overwriting the counter', async () => {
    UpstreamTrace.aggregate.mockResolvedValue([{ _id: null, totalRecords: 37, totalStoredBytes: 123456 }]);

    const result = await reconcileStorageStats();

    expect(result).toEqual({ totalRecords: 37, totalStoredBytes: 123456 });
    expect(TraceStorageStats.updateOne).toHaveBeenCalledWith(
      { _id: 'singleton' },
      { $set: { totalRecords: 37, totalStoredBytes: 123456, lastReconciledAt: expect.any(Date) } },
      { upsert: true }
    );
  });

  test('reconcileStorageStats reports zero (not a crash) when the collection is empty', async () => {
    UpstreamTrace.aggregate.mockResolvedValue([]); // $group over an empty collection returns no rows

    const result = await reconcileStorageStats();

    expect(result).toEqual({ totalRecords: 0, totalStoredBytes: 0 });
  });

  test('reconcileIfDue skips reconciliation when the last one was recent', async () => {
    TraceStorageStats.findById.mockReturnValue({ lean: () => Promise.resolve({ lastReconciledAt: new Date() }) });

    await reconcileIfDue();

    expect(UpstreamTrace.aggregate).not.toHaveBeenCalled();
  });

  test('reconcileIfDue runs reconciliation once the interval has elapsed', async () => {
    TraceStorageStats.findById.mockReturnValue({ lean: () => Promise.resolve({ lastReconciledAt: new Date(Date.now() - RECONCILE_INTERVAL_MS - 1000) }) });
    UpstreamTrace.aggregate.mockResolvedValue([{ _id: null, totalRecords: 5, totalStoredBytes: 500 }]);

    await reconcileIfDue();

    expect(UpstreamTrace.aggregate).toHaveBeenCalledTimes(1);
  });

  test('reconcileIfDue runs reconciliation when it has never happened before (this self-heals a fresh/never-reconciled counter, e.g. after a crash)', async () => {
    TraceStorageStats.findById.mockReturnValue({ lean: () => Promise.resolve({ totalRecords: 1, totalStoredBytes: 1 }) }); // no lastReconciledAt at all
    UpstreamTrace.aggregate.mockResolvedValue([{ _id: null, totalRecords: 1, totalStoredBytes: 1 }]);

    await reconcileIfDue();

    expect(UpstreamTrace.aggregate).toHaveBeenCalledTimes(1);
  });

  test('recordTrace triggers reconcileIfDue as part of its normal flow (but it safely no-ops when not due)', async () => {
    UpstreamTrace.create.mockResolvedValue({});
    await recordTrace({
      traceId: 't-reconcile', provider: 'greenhouse', operation: 'list_jobs', boardToken: 'x',
      url: 'https://x', requestedAt: new Date(), success: true, statusCode: 200, durationMs: 10, responseBody: { jobs: [] },
    });
    // Default beforeEach fixture has a recent lastReconciledAt — correctly skipped.
    expect(UpstreamTrace.aggregate).not.toHaveBeenCalled();
  });

  test('a reconciliation failure never breaks a successful trace write', async () => {
    TraceStorageStats.findById.mockReturnValue({ lean: () => Promise.resolve({ lastReconciledAt: null }) });
    UpstreamTrace.aggregate.mockRejectedValue(new Error('aggregation blew up'));
    let created;
    UpstreamTrace.create.mockImplementation(async (doc) => { created = doc; return doc; });

    await recordTrace({
      traceId: 't-reconcile-fail', provider: 'lever', operation: 'list_jobs', boardToken: 'x',
      url: 'https://x', requestedAt: new Date(), success: true, statusCode: 200, durationMs: 10, responseBody: { jobs: [] },
    });

    // The trace itself was still created successfully — a reconciliation
    // failure must never be mistaken for an ingestion failure.
    expect(created).toBeDefined();
    expect(created.traceId).toBe('t-reconcile-fail');
  });
});
