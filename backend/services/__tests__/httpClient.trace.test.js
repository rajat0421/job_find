// Guards the upstream-trace capture added to getWithRetry. The retry/budget
// logic itself is untouched and already covered by httpClient.service.test.js
// — these tests are specifically about: trace capture on success/failure,
// backward compatibility when tracing isn't requested, and the guarantee
// that nothing about trace recording can ever change what this function
// returns or throws to its caller.

process.env.FETCH_RETRY_BASE_MS = '1';
jest.mock('axios');
jest.mock('../traceStorage.service', () => ({ recordTrace: jest.fn().mockResolvedValue(undefined) }));

const axios = require('axios');
const { recordTrace } = require('../traceStorage.service');
const { getWithRetry, getWithRetryCore } = require('../httpClient.service');

beforeEach(() => jest.clearAllMocks());

describe('backward compatibility — traceMeta omitted', () => {
  test('omitting traceMeta never calls recordTrace at all', async () => {
    axios.get.mockResolvedValue({ status: 200, data: { jobs: [] }, headers: {} });
    await getWithRetry('https://example.com/jobs', {}, null, []);
    expect(recordTrace).not.toHaveBeenCalled();
  });

  test('omitting traceMeta returns a response with no traceId attached', async () => {
    axios.get.mockResolvedValue({ status: 200, data: { jobs: [] }, headers: {} });
    const res = await getWithRetry('https://example.com/jobs', {}, null, []);
    expect(res.traceId).toBeUndefined();
  });

  test('getWithRetryCore is exported and usable directly, completely independent of tracing', async () => {
    axios.get.mockResolvedValue({ status: 200, data: {}, headers: {} });
    const res = await getWithRetryCore('https://example.com/jobs', {}, null, []);
    expect(res.status).toBe(200);
    expect(recordTrace).not.toHaveBeenCalled();
  });
});

describe('trace capture on success', () => {
  test('records a successful request with the right provider/operation/board metadata', async () => {
    axios.get.mockResolvedValue({ status: 200, data: { jobs: [{ id: 1 }] }, headers: { 'content-type': 'application/json' } });

    await getWithRetry(
      'https://boards-api.greenhouse.io/v1/boards/okta/jobs', { timeout: 8000 }, null, [],
      { provider: 'greenhouse', operation: 'list_jobs', boardToken: 'okta' }
    );

    expect(recordTrace).toHaveBeenCalledTimes(1);
    const trace = recordTrace.mock.calls[0][0];
    expect(trace.provider).toBe('greenhouse');
    expect(trace.operation).toBe('list_jobs');
    expect(trace.boardToken).toBe('okta');
    expect(trace.success).toBe(true);
    expect(trace.statusCode).toBe(200);
    expect(trace.responseBody).toEqual({ jobs: [{ id: 1 }] });
    expect(typeof trace.durationMs).toBe('number');
    expect(trace.traceId).toEqual(expect.any(String));
  });

  test('attaches a stable traceId to the returned response for caller correlation', async () => {
    axios.get.mockResolvedValue({ status: 200, data: {}, headers: {} });
    const res = await getWithRetry('https://example.com', {}, null, [], { provider: 'lever', operation: 'list_jobs', boardToken: 'acme' });
    expect(res.traceId).toEqual(expect.any(String));
    expect(recordTrace.mock.calls[0][0].traceId).toBe(res.traceId);
  });
});

describe('trace capture on failure', () => {
  test('records a non-2xx HTTP failure with status code and response body', async () => {
    const err = Object.assign(new Error('Request failed with status code 404'), {
      response: { status: 404, data: { message: 'not found' }, headers: {} },
    });
    axios.get.mockRejectedValue(err);

    await expect(getWithRetry(
      'https://example.com', {}, null, [], { provider: 'ashby', operation: 'list_jobs', boardToken: 'acme' }
    )).rejects.toThrow();

    const trace = recordTrace.mock.calls[0][0];
    expect(trace.success).toBe(false);
    expect(trace.statusCode).toBe(404);
    expect(trace.errorKind).toBe('not_found');
  });

  test('records a network failure (no HTTP response at all) with statusCode null', async () => {
    const err = new Error('connect ECONNREFUSED');
    axios.get.mockRejectedValue(err);

    await expect(getWithRetry(
      'https://example.com', {}, null, [], { provider: 'adzuna', operation: 'search', boardToken: 'dev' }
    )).rejects.toThrow();

    const trace = recordTrace.mock.calls[0][0];
    expect(trace.success).toBe(false);
    expect(trace.statusCode).toBeNull();
    expect(trace.errorKind).toBe('network_error');
    expect(trace.respondedAt).toBeNull();
  });

  test('attaches traceId to the thrown error', async () => {
    axios.get.mockRejectedValue(Object.assign(new Error('Unauthorized'), { response: { status: 401, data: {}, headers: {} } }));

    try {
      await getWithRetry('https://example.com', {}, null, [], { provider: 'greenhouse', operation: 'list_jobs', boardToken: 'x' });
      throw new Error('expected getWithRetry to throw');
    } catch (err) {
      expect(err.traceId).toEqual(expect.any(String));
    }
  });
});

describe('tracing never changes the outcome of the actual upstream request', () => {
  test('a trace-recording failure on a SUCCESSFUL request still returns the real response, not an error', async () => {
    recordTrace.mockRejectedValueOnce(new Error('Mongo is down'));
    axios.get.mockResolvedValue({ status: 200, data: { jobs: ['real data'] }, headers: {} });

    const res = await getWithRetry('https://example.com', {}, null, [], { provider: 'lever', operation: 'list_jobs', boardToken: 'x' });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ jobs: ['real data'] });
  });

  test('a trace-recording failure on a FAILED request still throws the ORIGINAL upstream error, not a tracing error', async () => {
    recordTrace.mockRejectedValueOnce(new Error('Mongo is down'));
    const upstreamErr = Object.assign(new Error('Request failed with status code 500'), { response: { status: 500, data: {}, headers: {} } });
    axios.get.mockRejectedValue(upstreamErr);

    await expect(
      getWithRetry('https://example.com', {}, null, [], { provider: 'ashby', operation: 'list_jobs', boardToken: 'x' })
    ).rejects.toThrow('Request failed with status code 500');
  });

  test('retries still work identically with tracing enabled — final success after one retry', async () => {
    axios.get
      .mockRejectedValueOnce(Object.assign(new Error('Service Unavailable'), { response: { status: 503, data: {}, headers: {} } }))
      .mockResolvedValueOnce({ status: 200, data: {}, headers: {} });

    const stats = { retries: 0 };
    const res = await getWithRetry('https://example.com', {}, stats, [], { provider: 'greenhouse', operation: 'list_jobs', boardToken: 'x' });

    expect(res.status).toBe(200);
    expect(stats.retries).toBe(1);
    expect(recordTrace.mock.calls[0][0].retries).toBe(1); // the trace reflects the real retry count too
  });
});
