const zlib = require('zlib');

jest.mock('../../models/UpstreamTrace', () => ({
  countDocuments: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
}));
jest.mock('../../models/TraceStorageStats', () => ({ findById: jest.fn() }));
jest.mock('../../services/monitoring.service', () => ({ getOperationalOverview: jest.fn() }));

const UpstreamTrace = require('../../models/UpstreamTrace');
const TraceStorageStats = require('../../models/TraceStorageStats');
const { getOperationalOverview } = require('../../services/monitoring.service');
const { listTraces, getTraceDetail, getRawJobFromTrace, getOverview } = require('../adminTrace.controller');

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const buildListQuery = (result, total = result.length) => {
  UpstreamTrace.countDocuments.mockResolvedValue(total);
  const q = {};
  q.sort = jest.fn(() => q);
  q.skip = jest.fn(() => q);
  q.limit = jest.fn(() => q);
  q.select = jest.fn(() => q);
  q.lean = jest.fn().mockResolvedValue(result);
  UpstreamTrace.find.mockReturnValue(q);
  return q;
};

beforeEach(() => jest.clearAllMocks());

describe('listTraces — pagination, filtering, and validation', () => {
  test('returns a bounded page of traces with total/page/pages', async () => {
    buildListQuery([{ traceId: 't1', provider: 'greenhouse' }], 1);
    const res = mockRes();

    await listTraces({ query: {} }, res);

    const body = res.json.mock.calls[0][0];
    expect(body.traces).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
  });

  test('never selects the compressed body field in the list view', async () => {
    const q = buildListQuery([]);
    await listTraces({ query: {} }, mockRes());
    expect(q.select).toHaveBeenCalledWith('-bodyGzip -requestBody');
  });

  test('applies a valid provider filter', async () => {
    buildListQuery([]);
    await listTraces({ query: { provider: 'lever' } }, mockRes());
    expect(UpstreamTrace.find).toHaveBeenCalledWith(expect.objectContaining({ provider: 'lever' }));
  });

  test('rejects an invalid provider with 400, never silently ignoring it', async () => {
    const res = mockRes();
    await listTraces({ query: { provider: 'not-a-real-provider' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(UpstreamTrace.find).not.toHaveBeenCalled();
  });

  test('rejects a non-integer page/limit', async () => {
    const res = mockRes();
    await listTraces({ query: { page: 'abc' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('caps limit at the maximum even if a huge value is requested', async () => {
    const q = buildListQuery([]);
    await listTraces({ query: { limit: '100000' } }, mockRes());
    expect(q.limit).toHaveBeenCalledWith(100);
  });

  test('rejects an invalid date range', async () => {
    const res = mockRes();
    await listTraces({ query: { from: 'not-a-date' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('applies a valid date range filter', async () => {
    buildListQuery([]);
    await listTraces({ query: { from: '2026-01-01', to: '2026-01-02' } }, mockRes());
    const filterArg = UpstreamTrace.find.mock.calls[0][0];
    expect(filterArg.requestedAt.$gte).toBeInstanceOf(Date);
    expect(filterArg.requestedAt.$lte).toBeInstanceOf(Date);
  });

  test('a 24-char hex jobId is treated as an internal Job _id lookup', async () => {
    buildListQuery([]);
    await listTraces({ query: { jobId: '6a437117e4ad99fc51fe1631' } }, mockRes());
    expect(UpstreamTrace.find).toHaveBeenCalledWith(expect.objectContaining({ resultingJobIds: '6a437117e4ad99fc51fe1631' }));
  });

  test('a non-hex jobId is treated as an upstream provider job ID lookup', async () => {
    buildListQuery([]);
    await listTraces({ query: { jobId: '7882676' } }, mockRes());
    expect(UpstreamTrace.find).toHaveBeenCalledWith(expect.objectContaining({ observedSourceJobIds: '7882676' }));
  });

  test('a traceId filter is applied exactly', async () => {
    buildListQuery([]);
    await listTraces({ query: { traceId: 'abc-123' } }, mockRes());
    expect(UpstreamTrace.find).toHaveBeenCalledWith(expect.objectContaining({ traceId: 'abc-123' }));
  });
});

describe('getTraceDetail', () => {
  test('404s when the trace does not exist', async () => {
    UpstreamTrace.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });
    const res = mockRes();
    await getTraceDetail({ params: { traceId: 'missing' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('decompresses a "complete" body and never leaks the raw gzip Buffer in the response', async () => {
    const gzip = zlib.gzipSync(JSON.stringify({ jobs: [{ id: 1, title: 'Engineer' }] }));
    UpstreamTrace.findOne.mockReturnValue({
      lean: () => Promise.resolve({ traceId: 't1', bodyCaptureStatus: 'complete', bodyGzip: gzip }),
    });
    const res = mockRes();

    await getTraceDetail({ params: { traceId: 't1' } }, res);

    const body = res.json.mock.calls[0][0];
    expect(body.body).toEqual({ jobs: [{ id: 1, title: 'Engineer' }] });
    expect(body.bodyGzip).toBeUndefined();
  });

  test('attaches a clear notice for an omitted body, with no body field populated', async () => {
    UpstreamTrace.findOne.mockReturnValue({
      lean: () => Promise.resolve({ traceId: 't2', bodyCaptureStatus: 'omitted', bodyOmittedReason: 'exceeds_max_body_size', bodyGzip: null }),
    });
    const res = mockRes();

    await getTraceDetail({ params: { traceId: 't2' } }, res);

    const body = res.json.mock.calls[0][0];
    expect(body.body).toBeNull();
    expect(body.bodyNotice).toMatch(/not retained/i);
    expect(body.bodyNotice).toMatch(/exceeds_max_body_size/);
  });

  test('attaches a clear notice for a truncated body', async () => {
    const gzip = zlib.gzipSync(JSON.stringify({ _truncated: true, _originalCount: 500, _keptCount: 10, jobs: [] }));
    UpstreamTrace.findOne.mockReturnValue({
      lean: () => Promise.resolve({ traceId: 't3', bodyCaptureStatus: 'truncated', bodyGzip: gzip }),
    });
    const res = mockRes();

    await getTraceDetail({ params: { traceId: 't3' } }, res);

    expect(res.json.mock.calls[0][0].bodyNotice).toMatch(/partial capture/i);
  });
});

describe('getRawJobFromTrace — Phase 4 job-level debugging', () => {
  test('404s when the trace does not exist', async () => {
    UpstreamTrace.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });
    const res = mockRes();
    await getRawJobFromTrace({ params: { traceId: 'missing', upstreamJobId: '1' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('extracts the exact raw job object from a captured list response, clearly labeled', async () => {
    const gzip = zlib.gzipSync(JSON.stringify({ jobs: [{ id: 7882676, title: 'Software Architect, Java Backend' }] }));
    UpstreamTrace.findOne.mockReturnValue({
      lean: () => Promise.resolve({ traceId: 't1', bodyCaptureStatus: 'complete', bodyGzip: gzip, requestedAt: new Date('2026-10-11') }),
    });
    const res = mockRes();

    await getRawJobFromTrace({ params: { traceId: 't1', upstreamJobId: '7882676' } }, res);

    const body = res.json.mock.calls[0][0];
    expect(body.found).toBe(true);
    expect(body.extractedFrom).toBe('captured_response');
    expect(body.job).toEqual({ id: 7882676, title: 'Software Architect, Java Backend' });
    expect(body.provenance).toMatch(/t1/);
    expect(body.provenance).toMatch(/NOT a live re-fetch/i);
  });

  test('reports found:false (not an error) when the body was never captured', async () => {
    UpstreamTrace.findOne.mockReturnValue({
      lean: () => Promise.resolve({ traceId: 't2', bodyCaptureStatus: 'omitted' }),
    });
    const res = mockRes();

    await getRawJobFromTrace({ params: { traceId: 't2', upstreamJobId: '1' } }, res);

    expect(res.json.mock.calls[0][0]).toEqual(expect.objectContaining({ found: false, reason: 'body_omitted' }));
  });

  test('reports found:false when the job ID is not present in the (complete) captured response', async () => {
    const gzip = zlib.gzipSync(JSON.stringify({ jobs: [{ id: 1 }] }));
    UpstreamTrace.findOne.mockReturnValue({
      lean: () => Promise.resolve({ traceId: 't3', bodyCaptureStatus: 'complete', bodyGzip: gzip }),
    });
    const res = mockRes();

    await getRawJobFromTrace({ params: { traceId: 't3', upstreamJobId: '999' } }, res);

    expect(res.json.mock.calls[0][0]).toEqual(expect.objectContaining({ found: false, reason: 'item_not_in_response' }));
  });

  test('distinguishes "not in the truncated subset" from "genuinely absent"', async () => {
    const gzip = zlib.gzipSync(JSON.stringify({ _truncated: true, _originalCount: 500, _keptCount: 1, jobs: [{ id: 1 }] }));
    UpstreamTrace.findOne.mockReturnValue({
      lean: () => Promise.resolve({ traceId: 't4', bodyCaptureStatus: 'truncated', bodyGzip: gzip }),
    });
    const res = mockRes();

    await getRawJobFromTrace({ params: { traceId: 't4', upstreamJobId: '999' } }, res);

    expect(res.json.mock.calls[0][0]).toEqual(expect.objectContaining({ found: false, reason: 'item_not_in_truncated_subset' }));
  });
});

describe('getOverview — reuses existing monitoring data, adds recent trace failures', () => {
  test('composes operational overview + recent failed traces + storage stats', async () => {
    getOperationalOverview.mockResolvedValue({ fetch: { status: 'success' }, match: { status: 'success' }, email: { status: 'success' }, warnings: [] });
    UpstreamTrace.find.mockReturnValue({
      sort: () => ({ limit: () => ({ select: () => ({ lean: () => Promise.resolve([{ traceId: 'f1', provider: 'greenhouse', statusCode: 404 }]) }) }) }),
    });
    TraceStorageStats.findById.mockReturnValue({ lean: () => Promise.resolve({ totalRecords: 42, totalStoredBytes: 1024 }) });

    const res = mockRes();
    await getOverview({}, res);

    const body = res.json.mock.calls[0][0];
    expect(body.fetch.status).toBe('success');
    expect(body.recentErrors).toHaveLength(1);
    expect(body.recentErrors[0].traceId).toBe('f1');
    expect(body.traceStorage.totalRecords).toBe(42);
  });

  test('falls back to zeroed storage stats when no singleton document exists yet', async () => {
    getOperationalOverview.mockResolvedValue({ warnings: [] });
    UpstreamTrace.find.mockReturnValue({ sort: () => ({ limit: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }) }) });
    TraceStorageStats.findById.mockReturnValue({ lean: () => Promise.resolve(null) });

    const res = mockRes();
    await getOverview({}, res);

    expect(res.json.mock.calls[0][0].traceStorage).toEqual({ totalRecords: 0, totalStoredBytes: 0 });
  });
});
