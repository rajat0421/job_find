jest.mock('axios');
// Keep retry backoff near-instant in these tests — read once at module load.
process.env.FETCH_RETRY_BASE_MS = '1';
jest.mock('../../models/Job', () => {
  const { createFakeJobModel } = require('../../test-utils/fakeJobModel');
  return createFakeJobModel();
});
jest.mock('../../services/jobLifecycle.service', () => {
  const actual = jest.requireActual('../../services/jobLifecycle.service');
  return { ...actual, sweepMissingJobs: jest.fn() };
});
jest.mock('../../services/traceStorage.service', () => ({ recordTrace: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../services/traceCorrelation.service', () => ({ correlateTrace: jest.fn().mockResolvedValue(undefined) }));

const axios = require('axios');
const Job = require('../../models/Job');
const { sweepMissingJobs } = require('../../services/jobLifecycle.service');
const { fetchJobs } = require('../adzuna');

beforeEach(() => {
  Job.__store.length = 0;
  jest.clearAllMocks();
  process.env.ADZUNA_APP_ID = 'test-id';
  process.env.ADZUNA_APP_KEY = 'test-key';
});

test('Adzuna never calls sweepMissingJobs — a limited category/page search can never prove a job is gone', async () => {
  axios.get.mockResolvedValue({ data: { results: [] } });

  await fetchJobs();

  expect(sweepMissingJobs).not.toHaveBeenCalled();
});

test('limited search coverage (0 results this cycle) does not expire or touch any existing job', async () => {
  const existing = {
    _id: 'id1', source: 'adzuna', sourceBoard: null, sourceJobId: '42', hash: 'h',
    title: 'Previously seen role', status: 'active', missingScans: 0,
    lastSeenAt: new Date('2020-01-01'), // old, but untouched by a mere empty search
  };
  Job.__store.push(existing);

  axios.get.mockResolvedValue({ data: { results: [] } }); // this hour's limited category search found nothing

  await fetchJobs();

  expect(Job.__store).toHaveLength(1);
  expect(Job.__store[0].status).toBe('active'); // absence from search was never treated as closure
  expect(sweepMissingJobs).not.toHaveBeenCalled();
});

test('a job that IS observed is still tracked normally via the shared identity logic', async () => {
  const result = {
    id: 777,
    title: 'Backend Engineer',
    company: { display_name: 'Acme' },
    location: { display_name: 'Remote' },
    salary_min: 1000000,
    salary_max: 2000000,
    description: 'desc',
    redirect_url: 'https://example.com/job/777',
    created: '2026-01-01',
  };
  axios.get.mockResolvedValueOnce({ data: { results: [result] } }).mockResolvedValue({ data: { results: [] } });

  await fetchJobs();

  expect(Job.__store).toHaveLength(1);
  expect(Job.__store[0].source).toBe('adzuna');
  expect(Job.__store[0].sourceJobId).toBe('777');
  expect(Job.__store[0].sourceBoard).toBeNull();
});

describe('Improvement 4 — resilience, retries, and quota protection', () => {
  test('repeated rate-limiting trips the circuit breaker and aborts the rest of the cycle', async () => {
    axios.get.mockRejectedValue(Object.assign(new Error('Too Many Requests'), { response: { status: 429, headers: {} } }));

    const result = await fetchJobs();

    expect(result.aborted).toBe(true);
    // 3 consecutive rate-limited categories * (1 attempt + 2 retries) = 9 calls before aborting —
    // far short of the full 20 categories * 2 pages * 3 attempts = 120-call budget.
    expect(axios.get.mock.calls.length).toBeLessThan(15);
  });

  test('a transient failure recovers via retry and does not count toward the rate-limit circuit breaker', async () => {
    axios.get
      .mockRejectedValueOnce(Object.assign(new Error('Service Unavailable'), { response: { status: 503 } }))
      .mockResolvedValue({ data: { results: [] } });

    const result = await fetchJobs();

    expect(result.aborted).toBe(false);
    expect(result.categoriesFailed).toEqual([]);
    expect(result.retries).toBeGreaterThanOrEqual(1);
  });

  test('a permanent error (401) is reported per category but never retried, and never aborts the whole run', async () => {
    axios.get.mockRejectedValue(Object.assign(new Error('Unauthorized'), { response: { status: 401 } }));

    const result = await fetchJobs();

    expect(result.aborted).toBe(false);
    expect(result.categoriesFailed.length).toBeGreaterThan(0);
    expect(result.categoriesFailed[0].reason).toBe('auth_error');
  });

  test('a failure never logs the configured Adzuna credentials', async () => {
    process.env.ADZUNA_APP_ID = 'super-secret-id';
    process.env.ADZUNA_APP_KEY = 'super-secret-key';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    axios.get.mockRejectedValue(Object.assign(new Error('Unauthorized'), { response: { status: 401 } }));

    await fetchJobs();

    const allLogs = [...warnSpy.mock.calls, ...errorSpy.mock.calls].flat().join(' ');
    expect(allLogs).not.toContain('super-secret-id');
    expect(allLogs).not.toContain('super-secret-key');

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
