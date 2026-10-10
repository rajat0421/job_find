jest.mock('axios');
const axios = require('axios');

// Keep retry backoff near-instant in tests — these are read once at module
// load time, so they must be set before the first require of httpClient.service.
process.env.FETCH_RETRY_BASE_MS = '1';

const makeAxiosError = ({ code, message = 'error', status, headers } = {}) => {
  const err = new Error(message);
  err.code = code;
  if (status) err.response = { status, headers: headers || {} };
  return err;
};

describe('getWithRetry', () => {
  beforeEach(() => jest.clearAllMocks());

  test('passes a finite, bounded timeout through to axios — a hung request cannot stall indefinitely', async () => {
    const { getWithRetry, DEFAULT_TIMEOUT_MS } = require('../httpClient.service');
    axios.get.mockResolvedValue({ data: {} });

    await getWithRetry('https://example.com');

    expect(Number.isFinite(DEFAULT_TIMEOUT_MS)).toBe(true);
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(axios.get).toHaveBeenCalledWith('https://example.com', expect.objectContaining({ timeout: DEFAULT_TIMEOUT_MS }));
  });

  test('an explicit per-call timeout overrides the default', async () => {
    const { getWithRetry } = require('../httpClient.service');
    axios.get.mockResolvedValue({ data: {} });

    await getWithRetry('https://example.com', { timeout: 1234 });

    expect(axios.get).toHaveBeenCalledWith('https://example.com', expect.objectContaining({ timeout: 1234 }));
  });

  test('a transient failure (500) succeeds after a retry', async () => {
    const { getWithRetry } = require('../httpClient.service');
    axios.get
      .mockRejectedValueOnce(makeAxiosError({ status: 500, message: 'Internal Server Error' }))
      .mockResolvedValueOnce({ data: { ok: true } });

    const stats = { retries: 0 };
    const res = await getWithRetry('https://example.com', {}, stats);

    expect(res.data.ok).toBe(true);
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(stats.retries).toBe(1);
  });

  test('a permanent error (404) is not retried', async () => {
    const { getWithRetry } = require('../httpClient.service');
    axios.get.mockRejectedValueOnce(makeAxiosError({ status: 404, message: 'Not Found' }));

    await expect(getWithRetry('https://example.com')).rejects.toThrow('Not Found');
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test('an auth/config error (401) is not retried', async () => {
    const { getWithRetry } = require('../httpClient.service');
    axios.get.mockRejectedValueOnce(makeAxiosError({ status: 401, message: 'Unauthorized' }));

    await expect(getWithRetry('https://example.com')).rejects.toThrow();
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test('a 429 is retried, bounded by MAX_RETRIES, and eventually gives up if it never recovers', async () => {
    const { getWithRetry, MAX_RETRIES } = require('../httpClient.service');
    axios.get.mockRejectedValue(makeAxiosError({ status: 429, message: 'Too Many Requests' }));

    await expect(getWithRetry('https://example.com', { timeout: 10 })).rejects.toThrow();
    expect(axios.get).toHaveBeenCalledTimes(MAX_RETRIES + 1); // first attempt + MAX_RETRIES retries, then give up
  });

  test('a 429 with Retry-After is retried and eventually succeeds', async () => {
    const { getWithRetry } = require('../httpClient.service');
    axios.get
      .mockRejectedValueOnce(makeAxiosError({ status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce({ data: { ok: true } });

    const res = await getWithRetry('https://example.com');
    expect(res.data.ok).toBe(true);
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  test('a timeout error (ECONNABORTED) is retried like any other transient failure', async () => {
    const { getWithRetry } = require('../httpClient.service');
    axios.get
      .mockRejectedValueOnce(makeAxiosError({ code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' }))
      .mockResolvedValueOnce({ data: { ok: true } });

    const res = await getWithRetry('https://example.com');
    expect(res.data.ok).toBe(true);
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  test('a network error with no response at all is retried', async () => {
    const { getWithRetry } = require('../httpClient.service');
    axios.get
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValueOnce({ data: { ok: true } });

    const res = await getWithRetry('https://example.com');
    expect(res.data.ok).toBe(true);
  });

  test('a successful first attempt is never retried', async () => {
    const { getWithRetry } = require('../httpClient.service');
    axios.get.mockResolvedValue({ data: { ok: true } });

    const stats = { retries: 0 };
    await getWithRetry('https://example.com', {}, stats);

    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(stats.retries).toBe(0);
  });
});

describe('getWithRetry — deadline integration', () => {
  beforeEach(() => jest.clearAllMocks());

  const fakeDeadline = (expired, remainingMs = 0) => ({ expired: () => expired, remainingMs: () => remainingMs });

  test('an already-expired deadline prevents even a first attempt', async () => {
    const { getWithRetry } = require('../httpClient.service');
    axios.get.mockResolvedValue({ data: {} });

    await expect(getWithRetry('https://example.com', {}, null, fakeDeadline(true))).rejects.toThrow(/budget exceeded/i);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('a deadline that expires between attempts stops further retries immediately, with no extra backoff wait', async () => {
    const { getWithRetry } = require('../httpClient.service');
    let callCount = 0;
    const deadline = { expired: () => callCount >= 1, remainingMs: () => 0 };
    axios.get.mockImplementation(() => {
      callCount++;
      return Promise.reject(Object.assign(new Error('Service Unavailable'), { response: { status: 503 } }));
    });

    const start = Date.now();
    await expect(getWithRetry('https://example.com', {}, null, deadline)).rejects.toThrow('Service Unavailable');
    const elapsed = Date.now() - start;

    expect(axios.get).toHaveBeenCalledTimes(1); // no retry attempted once the deadline is expired
    expect(elapsed).toBeLessThan(200); // no backoff wait was incurred
  });

  test('a backoff wait that would exceed the remaining budget is skipped — gives up rather than burning the last of it', async () => {
    const { getWithRetry } = require('../httpClient.service');
    // Base backoff is 1ms in this test file, but Retry-After asks for 10s —
    // far more than the 50ms this deadline claims is left.
    axios.get.mockRejectedValueOnce(
      Object.assign(new Error('Too Many Requests'), { response: { status: 429, headers: { 'retry-after': '10' } } })
    );
    const deadline = fakeDeadline(false, 50);

    await expect(getWithRetry('https://example.com', {}, null, deadline)).rejects.toThrow('Too Many Requests');
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test('a still-healthy deadline does not interfere with a normal retry-then-succeed', async () => {
    const { getWithRetry } = require('../httpClient.service');
    axios.get
      .mockRejectedValueOnce(Object.assign(new Error('Internal Server Error'), { response: { status: 500 } }))
      .mockResolvedValueOnce({ data: { ok: true } });
    const deadline = fakeDeadline(false, 60000);

    const res = await getWithRetry('https://example.com', {}, null, deadline);

    expect(res.data.ok).toBe(true);
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  test('accepts an array of deadlines — expired if ANY of them is expired (e.g. provider budget tighter than cycle budget)', async () => {
    const { getWithRetry } = require('../httpClient.service');
    axios.get.mockResolvedValue({ data: {} });
    const providerDeadline = fakeDeadline(true); // provider budget already gone
    const cycleDeadline = fakeDeadline(false, 60000); // cycle budget still fine

    await expect(getWithRetry('https://example.com', {}, null, [providerDeadline, cycleDeadline])).rejects.toThrow(/budget exceeded/i);
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe('classifyError', () => {
  const { classifyError } = require('../httpClient.service');

  test('classifies without ever including the raw message, URL, params or headers', () => {
    const err = makeAxiosError({ status: 429, message: 'secret-app-id-123' });
    err.config = { url: 'https://api.adzuna.com/...', params: { app_id: 'secret-app-id-123', app_key: 'secret-key-456' } };

    const reason = classifyError(err);

    expect(reason).toBe('rate_limited');
    expect(reason).not.toMatch(/secret/);
  });

  test.each([
    [{ code: 'ECONNABORTED' }, 'timeout'],
    [{}, 'network_error'],
    [{ status: 429 }, 'rate_limited'],
    [{ status: 401 }, 'auth_error'],
    [{ status: 403 }, 'auth_error'],
    [{ status: 404 }, 'not_found'],
    [{ status: 500 }, 'server_error'],
    [{ status: 503 }, 'server_error'],
    [{ status: 400 }, 'http_400'],
  ])('classifies %j as %s', (shape, expected) => {
    expect(classifyError(makeAxiosError(shape))).toBe(expected);
  });
});
