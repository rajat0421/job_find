jest.mock('axios');
// Keep retry backoff near-instant in these tests — read once at module load.
process.env.FETCH_RETRY_BASE_MS = '1';
jest.mock('../../models/Job', () => {
  const { createFakeJobModel } = require('../../test-utils/fakeJobModel');
  return createFakeJobModel();
});
jest.mock('../../models/Company', () => ({ updateOne: jest.fn().mockResolvedValue({}) }));
jest.mock('../../services/companies.service', () => ({ getCompanies: jest.fn() }));

const axios = require('axios');
const Job = require('../../models/Job');
const { getCompanies } = require('../../services/companies.service');
const { fetchJobs } = require('../greenhouse');
const { MISSING_SCAN_THRESHOLD } = require('../../services/jobLifecycle.service');

const ghJob = (id, title, location) => ({
  id,
  title,
  location: { name: location },
  absolute_url: `https://boards.greenhouse.io/acme/jobs/${id}`,
  updated_at: '2026-01-01T00:00:00Z',
  content: '<p>desc</p>',
});

beforeEach(() => {
  Job.__store.length = 0;
  jest.clearAllMocks();
  getCompanies.mockResolvedValue([{ _id: 'c1', name: 'Acme', token: 'acme' }]);
});

test('a failed scan never marks existing jobs closed or even missing', async () => {
  axios.get.mockResolvedValueOnce({ data: { jobs: [ghJob('1', 'Engineer', 'Remote')] } });
  await fetchJobs();
  expect(Job.__store).toHaveLength(1);

  axios.get.mockRejectedValueOnce(new Error('request timed out'));
  await fetchJobs();

  expect(Job.__store[0].status).toBe('active');
  expect(Job.__store[0].missingScans).toBe(0);
});

test('a job absent from a single complete, successful scan is not immediately closed', async () => {
  axios.get.mockResolvedValueOnce({ data: { jobs: [ghJob('1', 'Engineer', 'Remote'), ghJob('2', 'Designer', 'Remote')] } });
  await fetchJobs();
  expect(Job.__store).toHaveLength(2);

  axios.get.mockResolvedValueOnce({ data: { jobs: [ghJob('1', 'Engineer', 'Remote')] } }); // job '2' now gone
  await fetchJobs();

  const missingJob = Job.__store.find((j) => j.sourceJobId === '2');
  expect(missingJob.status).toBe('active');
  expect(missingJob.missingScans).toBe(1);
});

test('a persistently missing posting is closed only after crossing the grace threshold', async () => {
  axios.get.mockResolvedValueOnce({ data: { jobs: [ghJob('1', 'Engineer', 'Remote'), ghJob('2', 'Designer', 'Remote')] } });
  await fetchJobs();

  for (let i = 0; i < MISSING_SCAN_THRESHOLD; i++) {
    axios.get.mockResolvedValueOnce({ data: { jobs: [ghJob('1', 'Engineer', 'Remote')] } }); // '2' absent every cycle
    await fetchJobs();
    const missingJob = Job.__store.find((j) => j.sourceJobId === '2');
    if (i < MISSING_SCAN_THRESHOLD - 1) expect(missingJob.status).toBe('active');
    else expect(missingJob.status).toBe('closed');
  }
});

test('a suspiciously empty scan (0 jobs, board previously had some) does not trigger missing-detection', async () => {
  axios.get.mockResolvedValueOnce({ data: { jobs: [ghJob('1', 'Engineer', 'Remote')] } });
  await fetchJobs();

  axios.get.mockResolvedValueOnce({ data: { jobs: [] } }); // could be a transient API glitch, not proof of mass closure
  await fetchJobs();

  expect(Job.__store[0].status).toBe('active');
  expect(Job.__store[0].missingScans).toBe(0);
});

test('a reappearing posting resets its missing-scan count back to active', async () => {
  axios.get.mockResolvedValueOnce({ data: { jobs: [ghJob('1', 'Engineer', 'Remote'), ghJob('2', 'Designer', 'Remote')] } });
  await fetchJobs();

  axios.get.mockResolvedValueOnce({ data: { jobs: [ghJob('1', 'Engineer', 'Remote')] } }); // '2' missing once
  await fetchJobs();
  expect(Job.__store.find((j) => j.sourceJobId === '2').missingScans).toBe(1);

  axios.get.mockResolvedValueOnce({ data: { jobs: [ghJob('1', 'Engineer', 'Remote'), ghJob('2', 'Designer', 'Remote')] } }); // '2' back
  await fetchJobs();
  const job2 = Job.__store.find((j) => j.sourceJobId === '2');
  expect(job2.missingScans).toBe(0);
  expect(job2.status).toBe('active');
});

test('a changed title/location for a tracked posting updates in place, not a duplicate', async () => {
  axios.get.mockResolvedValueOnce({ data: { jobs: [ghJob('1', 'Engineer', 'Remote')] } });
  await fetchJobs();

  axios.get.mockResolvedValueOnce({ data: { jobs: [ghJob('1', 'Senior Engineer', 'Bangalore')] } });
  await fetchJobs();

  expect(Job.__store).toHaveLength(1);
  expect(Job.__store[0].title).toBe('Senior Engineer');
  expect(Job.__store[0].location).toBe('Bangalore');
});

describe('Improvement 4 (final) — per-provider and cycle time budgets', () => {
  // These tests need a tiny FETCH_PROVIDER_BUDGET_MS/FETCH_CYCLE_BUDGET_MS,
  // which fetchBudget.service.js reads once at module load — so each test
  // resets the module registry and re-requires everything fresh with the env
  // var already set, rather than sharing the file's top-level requires (which
  // loaded with the normal, never-expires-in-a-fast-test default budget).
  const loadFreshGreenhouse = () => {
    jest.resetModules();
    jest.doMock('axios');
    jest.doMock('../../models/Job', () => {
      const { createFakeJobModel } = require('../../test-utils/fakeJobModel');
      return createFakeJobModel();
    });
    jest.doMock('../../models/Company', () => ({ updateOne: jest.fn().mockResolvedValue({}) }));
    jest.doMock('../../services/companies.service', () => ({ getCompanies: jest.fn() }));
    return {
      axios: require('axios'),
      Job: require('../../models/Job'),
      getCompanies: require('../../services/companies.service').getCompanies,
      fetchJobs: require('../greenhouse').fetchJobs,
    };
  };

  afterEach(() => {
    delete process.env.FETCH_PROVIDER_BUDGET_MS;
    delete process.env.FETCH_CYCLE_BUDGET_MS;
  });

  test('once the per-provider budget expires, remaining boards are skipped and recorded, not attempted', async () => {
    process.env.FETCH_PROVIDER_BUDGET_MS = '10'; // 10ms
    const { axios, Job, getCompanies, fetchJobs } = loadFreshGreenhouse();
    getCompanies.mockResolvedValue([
      { _id: 'c1', name: 'Acme', token: 'acme' },
      { _id: 'c2', name: 'Globex', token: 'globex' },
      { _id: 'c3', name: 'Initech', token: 'initech' },
    ]);
    // Acme's request itself takes 25ms — long enough that the 10ms provider
    // budget has genuinely elapsed (real monotonic clock) by the time the
    // loop checks before starting Globex.
    axios.get.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ data: { jobs: [ghJob('1', 'Engineer', 'Remote')] } }), 25))
    );

    const result = await fetchJobs();

    expect(Job.__store).toHaveLength(1); // only Acme was actually processed
    expect(result.companiesAttempted).toBe(1);
    expect(result.budgetExceeded).toBe('provider');
    expect(result.companiesSkipped).toEqual([
      { name: 'Globex', reason: 'provider_budget_exceeded' },
      { name: 'Initech', reason: 'provider_budget_exceeded' },
    ]);
    expect(axios.get).toHaveBeenCalledTimes(1); // Globex/Initech never even attempted
  });

  test('once the overall cycle budget expires (passed in from the orchestrator), this provider stops too', async () => {
    const { axios, Job, getCompanies, fetchJobs } = loadFreshGreenhouse();
    getCompanies.mockResolvedValue([
      { _id: 'c1', name: 'Acme', token: 'acme' },
      { _id: 'c2', name: 'Globex', token: 'globex' },
    ]);
    // Stays healthy throughout Acme's request (including getWithRetry's own
    // internal deadline checks) and only flips once Acme's response actually
    // arrives — naturally true by the time the loop checks before Globex.
    let cycleExpired = false;
    const cycleDeadline = { expired: () => cycleExpired, remainingMs: () => (cycleExpired ? 0 : 999999) };
    axios.get.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => {
        cycleExpired = true;
        resolve({ data: { jobs: [ghJob('1', 'Engineer', 'Remote')] } });
      }, 10))
    );

    const result = await fetchJobs({ cycleDeadline });

    expect(Job.__store).toHaveLength(1);
    expect(result.budgetExceeded).toBe('cycle');
    expect(result.companiesSkipped).toEqual([{ name: 'Globex', reason: 'cycle_budget_exceeded' }]);
  });

  test('a budget-skipped board never triggers a missing-job sweep for its previously-tracked postings', async () => {
    process.env.FETCH_PROVIDER_BUDGET_MS = '10';
    const { axios, Job, getCompanies, fetchJobs } = loadFreshGreenhouse();
    getCompanies.mockResolvedValue([
      { _id: 'c1', name: 'Acme', token: 'acme' },
      { _id: 'c2', name: 'Globex', token: 'globex' },
    ]);
    // Seed an existing, previously-tracked job for Globex's board directly.
    Job.__store.push({
      _id: 'existing1', source: 'greenhouse', sourceBoard: 'globex', sourceJobId: '99', hash: 'h',
      status: 'active', missingScans: 0, title: 'Old role', company: 'Globex', location: 'Remote',
    });
    axios.get.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ data: { jobs: [ghJob('1', 'Engineer', 'Remote')] } }), 25))
    );

    await fetchJobs();

    const globexJob = Job.__store.find((j) => j._id === 'existing1');
    expect(globexJob.status).toBe('active'); // untouched — Globex's board was never scanned, let alone swept
    expect(globexJob.missingScans).toBe(0);
  });

  test('companiesAttempted only counts boards actually attempted, not the full configured list', async () => {
    process.env.FETCH_PROVIDER_BUDGET_MS = '10';
    const { axios, getCompanies, fetchJobs } = loadFreshGreenhouse();
    getCompanies.mockResolvedValue([
      { _id: 'c1', name: 'Acme', token: 'acme' },
      { _id: 'c2', name: 'Globex', token: 'globex' },
    ]);
    axios.get.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ data: { jobs: [] } }), 25))
    );

    const result = await fetchJobs();

    expect(result.companiesAttempted).toBe(1);
  });
});

describe('Improvement 4 — resilience, retries, and failure isolation', () => {
  test('one failed company does not stop the remaining boards from being fetched', async () => {
    getCompanies.mockResolvedValue([
      { _id: 'c1', name: 'Acme', token: 'acme' },
      { _id: 'c2', name: 'Globex', token: 'globex' },
    ]);
    // Acme's board request fails every attempt (permanent — not retried); Globex succeeds.
    axios.get
      .mockRejectedValueOnce(Object.assign(new Error('Not Found'), { response: { status: 404 } }))
      .mockResolvedValueOnce({ data: { jobs: [ghJob('1', 'Engineer', 'Remote')] } });

    const result = await fetchJobs();

    expect(Job.__store).toHaveLength(1);
    expect(Job.__store[0].company).toBe('Globex');
    expect(result.companiesAttempted).toBe(2);
    expect(result.companiesFailed).toEqual([{ name: 'Acme', reason: 'not_found' }]);
    expect(result.requestsFailed).toBe(1);
  });

  test('a transient failure for one company recovers via retry — no company is skipped unnecessarily', async () => {
    getCompanies.mockResolvedValue([{ _id: 'c1', name: 'Acme', token: 'acme' }]);
    axios.get
      .mockRejectedValueOnce(Object.assign(new Error('Service Unavailable'), { response: { status: 503 } }))
      .mockResolvedValueOnce({ data: { jobs: [ghJob('1', 'Engineer', 'Remote')] } });

    const result = await fetchJobs();

    expect(Job.__store).toHaveLength(1);
    expect(result.companiesFailed).toEqual([]);
    expect(result.retries).toBe(1);
  });

  test('a permanently failing board is reported with a sanitized reason, not retried into the ground', async () => {
    getCompanies.mockResolvedValue([{ _id: 'c1', name: 'Acme', token: 'acme' }]);
    axios.get.mockRejectedValue(Object.assign(new Error('Unauthorized'), { response: { status: 401 } }));

    const result = await fetchJobs();

    expect(axios.get).toHaveBeenCalledTimes(1); // no retry for a permanent error
    expect(result.companiesFailed).toEqual([{ name: 'Acme', reason: 'auth_error' }]);
  });

  test('a fully failed scan (exhausted retries) never runs missing-detection for that board', async () => {
    axios.get.mockResolvedValueOnce({ data: { jobs: [ghJob('1', 'Engineer', 'Remote'), ghJob('2', 'Designer', 'Remote')] } });
    await fetchJobs();

    // Next cycle: transient failures on every retry attempt — ultimately fails.
    axios.get.mockRejectedValue(Object.assign(new Error('Gateway Timeout'), { response: { status: 504 } }));
    await fetchJobs();

    expect(Job.__store.find((j) => j.sourceJobId === '1').missingScans).toBe(0);
    expect(Job.__store.find((j) => j.sourceJobId === '2').missingScans).toBe(0);
  });
});
