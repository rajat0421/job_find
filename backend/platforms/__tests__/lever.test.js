jest.mock('axios');
// Keep retry backoff near-instant in these tests — read once at module load.
process.env.FETCH_RETRY_BASE_MS = '1';
jest.mock('../../models/Job', () => {
  const { createFakeJobModel } = require('../../test-utils/fakeJobModel');
  return createFakeJobModel();
});
jest.mock('../../models/Company', () => ({ updateOne: jest.fn().mockResolvedValue({}) }));
jest.mock('../../services/companies.service', () => ({ getCompanies: jest.fn() }));
jest.mock('../../services/traceStorage.service', () => ({ recordTrace: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../services/traceCorrelation.service', () => ({ correlateTrace: jest.fn().mockResolvedValue(undefined) }));

const axios = require('axios');
const Job = require('../../models/Job');
const { getCompanies } = require('../../services/companies.service');
const { fetchJobs } = require('../lever');
const { MISSING_SCAN_THRESHOLD } = require('../../services/jobLifecycle.service');

// Lever's postings API returns a raw array (not wrapped in an object).
const leverJob = (id, overrides = {}) => ({
  id,
  text: 'Backend Engineer',
  categories: { location: 'Remote', allLocations: ['Remote'] },
  applyUrl: `https://jobs.lever.co/acme/${id}/apply`,
  hostedUrl: `https://jobs.lever.co/acme/${id}`,
  workplaceType: 'remote',
  country: 'IN',
  createdAt: 1700000000000,
  descriptionPlain: 'Build things.',
  lists: [{ text: 'Requirements', content: '<ul><li>5 years</li></ul>' }],
  additionalPlain: 'Great benefits.',
  ...overrides,
});

beforeEach(() => {
  Job.__store.length = 0;
  jest.clearAllMocks();
  getCompanies.mockResolvedValue([{ _id: 'c1', name: 'Acme', token: 'acme', region: 'global' }]);
});

describe('response mapping and provider-specific fields', () => {
  test('maps title, location, applyLink, workplaceType and country from Lever\'s raw-array response', async () => {
    axios.get.mockResolvedValueOnce({ data: [leverJob('1')] });

    await fetchJobs();

    expect(Job.__store).toHaveLength(1);
    const job = Job.__store[0];
    expect(job.title).toBe('Backend Engineer');
    expect(job.location).toBe('Remote');
    expect(job.applyLink).toBe('https://jobs.lever.co/acme/1/apply');
    expect(job.workplaceType).toBe('remote');
    expect(job.country).toBe('IN');
    expect(job.source).toBe('lever');
    expect(job.sourceJobId).toBe('1');
  });

  test('builds the description from descriptionPlain + list sections + additionalPlain', async () => {
    axios.get.mockResolvedValueOnce({ data: [leverJob('1')] });

    await fetchJobs();

    const desc = Job.__store[0].description;
    expect(desc).toContain('Build things.');
    expect(desc).toContain('Requirements');
    expect(desc).toContain('5 years'); // from stripped HTML content
    expect(desc).toContain('Great benefits.');
  });

  test('falls back to allLocations and hostedUrl when location/applyUrl are missing', async () => {
    axios.get.mockResolvedValueOnce({
      data: [leverJob('1', { categories: { allLocations: ['Bangalore', 'Remote'] }, applyUrl: undefined })],
    });

    await fetchJobs();

    expect(Job.__store[0].location).toBe('Bangalore, Remote');
    expect(Job.__store[0].applyLink).toBe('https://jobs.lever.co/acme/1');
  });

  test('a posting missing both title and applyLink is skipped entirely, not stored', async () => {
    axios.get.mockResolvedValueOnce({ data: [leverJob('1', { text: '', applyUrl: '', hostedUrl: '' })] });

    await fetchJobs();

    expect(Job.__store).toHaveLength(0);
  });

  test('EU-region companies are fetched from the EU API host', async () => {
    getCompanies.mockResolvedValue([{ _id: 'c1', name: 'Acme EU', token: 'acme-eu', region: 'eu' }]);
    axios.get.mockResolvedValueOnce({ data: [] });

    await fetchJobs();

    expect(axios.get).toHaveBeenCalledWith(
      'https://api.eu.lever.co/v0/postings/acme-eu',
      expect.objectContaining({ params: { mode: 'json' } })
    );
  });
});

describe('shared retry wrapper', () => {
  test('a transient failure (503) recovers via retry', async () => {
    axios.get
      .mockRejectedValueOnce(Object.assign(new Error('Service Unavailable'), { response: { status: 503 } }))
      .mockResolvedValueOnce({ data: [leverJob('1')] });

    const result = await fetchJobs();

    expect(Job.__store).toHaveLength(1);
    expect(result.retries).toBe(1);
    expect(result.companiesFailed).toEqual([]);
  });

  test('a permanent error (404 — invalid token) is not retried', async () => {
    axios.get.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { response: { status: 404 } }));

    const result = await fetchJobs();

    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(result.companiesFailed).toEqual([{ name: 'Acme', reason: 'not_found' }]);
  });
});

describe('failure isolation', () => {
  test('one failed company does not stop the remaining boards', async () => {
    getCompanies.mockResolvedValue([
      { _id: 'c1', name: 'Acme', token: 'acme', region: 'global' },
      { _id: 'c2', name: 'Globex', token: 'globex', region: 'global' },
    ]);
    axios.get
      .mockRejectedValueOnce(Object.assign(new Error('Not Found'), { response: { status: 404 } }))
      .mockResolvedValueOnce({ data: [leverJob('1')] });

    const result = await fetchJobs();

    expect(Job.__store).toHaveLength(1);
    expect(result.companiesAttempted).toBe(2);
    expect(result.companiesFailed).toEqual([{ name: 'Acme', reason: 'not_found' }]);
  });
});

describe('scan completeness protection (missing-job sweeps)', () => {
  test('a failed/exhausted scan never marks existing jobs closed or missing', async () => {
    axios.get.mockResolvedValueOnce({ data: [leverJob('1')] });
    await fetchJobs();
    expect(Job.__store).toHaveLength(1);

    axios.get.mockRejectedValue(Object.assign(new Error('Gateway Timeout'), { response: { status: 504 } }));
    await fetchJobs();

    expect(Job.__store[0].status).toBe('active');
    expect(Job.__store[0].missingScans).toBe(0);
  });

  test('a suspiciously empty scan does not trigger missing-detection', async () => {
    axios.get.mockResolvedValueOnce({ data: [leverJob('1')] });
    await fetchJobs();

    axios.get.mockResolvedValueOnce({ data: [] });
    await fetchJobs();

    expect(Job.__store[0].status).toBe('active');
    expect(Job.__store[0].missingScans).toBe(0);
  });

  test('a job absent from one complete, successful scan is not immediately closed', async () => {
    axios.get.mockResolvedValueOnce({ data: [leverJob('1'), leverJob('2')] });
    await fetchJobs();

    axios.get.mockResolvedValueOnce({ data: [leverJob('1')] }); // '2' now gone
    await fetchJobs();

    const missing = Job.__store.find((j) => j.sourceJobId === '2');
    expect(missing.status).toBe('active');
    expect(missing.missingScans).toBe(1);
  });

  test('a persistently missing posting is closed only after crossing the grace threshold', async () => {
    axios.get.mockResolvedValueOnce({ data: [leverJob('1'), leverJob('2')] });
    await fetchJobs();

    for (let i = 0; i < MISSING_SCAN_THRESHOLD; i++) {
      axios.get.mockResolvedValueOnce({ data: [leverJob('1')] });
      await fetchJobs();
    }

    expect(Job.__store.find((j) => j.sourceJobId === '2').status).toBe('closed');
  });
});
