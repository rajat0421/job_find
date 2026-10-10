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
const { fetchJobs } = require('../ashby');
const { MISSING_SCAN_THRESHOLD } = require('../../services/jobLifecycle.service');

const ashbyJob = (id, overrides = {}) => ({
  id,
  title: 'Product Manager',
  location: 'Remote - US',
  applyUrl: `https://jobs.ashbyhq.com/acme/${id}/apply`,
  jobUrl: `https://jobs.ashbyhq.com/acme/${id}`,
  descriptionPlain: 'Own the roadmap.',
  workplaceType: 'Remote',
  isRemote: true,
  publishedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

beforeEach(() => {
  Job.__store.length = 0;
  jest.clearAllMocks();
  getCompanies.mockResolvedValue([{ _id: 'c1', name: 'Acme', token: 'acme' }]);
});

describe('response mapping and provider-specific fields', () => {
  test('maps title, location, applyLink, description and workplaceType from Ashby\'s response', async () => {
    axios.get.mockResolvedValueOnce({ data: { jobs: [ashbyJob('1')] } });

    await fetchJobs();

    expect(Job.__store).toHaveLength(1);
    const job = Job.__store[0];
    expect(job.title).toBe('Product Manager');
    expect(job.location).toBe('Remote - US');
    expect(job.applyLink).toBe('https://jobs.ashbyhq.com/acme/1/apply');
    expect(job.description).toBe('Own the roadmap.');
    expect(job.workplaceType).toBe('remote');
    expect(job.source).toBe('ashby');
    expect(job.sourceJobId).toBe('1');
    expect(job.salaryMin).toBeNull(); // Ashby comp is USD free-text — deliberately not stored
    expect(job.salaryMax).toBeNull();
  });

  test('normalizes "Hybrid" and "OnSite" workplaceType values to the matcher\'s lowercase vocabulary', async () => {
    axios.get.mockResolvedValueOnce({
      data: { jobs: [ashbyJob('1', { workplaceType: 'Hybrid' }), ashbyJob('2', { workplaceType: 'OnSite', isRemote: false })] },
    });

    await fetchJobs();

    expect(Job.__store.find((j) => j.sourceJobId === '1').workplaceType).toBe('hybrid');
    expect(Job.__store.find((j) => j.sourceJobId === '2').workplaceType).toBe('onsite');
  });

  test('falls back to isRemote when workplaceType is missing', async () => {
    axios.get.mockResolvedValueOnce({ data: { jobs: [ashbyJob('1', { workplaceType: null, isRemote: true })] } });

    await fetchJobs();

    expect(Job.__store[0].workplaceType).toBe('remote');
  });

  test('falls back to jobUrl when applyUrl is missing', async () => {
    axios.get.mockResolvedValueOnce({ data: { jobs: [ashbyJob('1', { applyUrl: undefined })] } });

    await fetchJobs();

    expect(Job.__store[0].applyLink).toBe('https://jobs.ashbyhq.com/acme/1');
  });

  test('a posting missing both title and applyLink is skipped entirely, not stored', async () => {
    axios.get.mockResolvedValueOnce({ data: { jobs: [ashbyJob('1', { title: '', applyUrl: '', jobUrl: '' })] } });

    await fetchJobs();

    expect(Job.__store).toHaveLength(0);
  });
});

describe('shared retry wrapper', () => {
  test('a transient failure (timeout) recovers via retry', async () => {
    axios.get
      .mockRejectedValueOnce(Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' }))
      .mockResolvedValueOnce({ data: { jobs: [ashbyJob('1')] } });

    const result = await fetchJobs();

    expect(Job.__store).toHaveLength(1);
    expect(result.retries).toBe(1);
    expect(result.companiesFailed).toEqual([]);
  });

  test('a permanent error (401) is not retried', async () => {
    axios.get.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { response: { status: 401 } }));

    const result = await fetchJobs();

    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(result.companiesFailed).toEqual([{ name: 'Acme', reason: 'auth_error' }]);
  });
});

describe('failure isolation', () => {
  test('one failed company does not stop the remaining boards', async () => {
    getCompanies.mockResolvedValue([
      { _id: 'c1', name: 'Acme', token: 'acme' },
      { _id: 'c2', name: 'Globex', token: 'globex' },
    ]);
    axios.get
      .mockRejectedValueOnce(Object.assign(new Error('Not Found'), { response: { status: 404 } }))
      .mockResolvedValueOnce({ data: { jobs: [ashbyJob('1')] } });

    const result = await fetchJobs();

    expect(Job.__store).toHaveLength(1);
    expect(result.companiesAttempted).toBe(2);
    expect(result.companiesFailed).toEqual([{ name: 'Acme', reason: 'not_found' }]);
  });
});

describe('scan completeness protection (missing-job sweeps)', () => {
  test('a failed/exhausted scan never marks existing jobs closed or missing', async () => {
    axios.get.mockResolvedValueOnce({ data: { jobs: [ashbyJob('1')] } });
    await fetchJobs();
    expect(Job.__store).toHaveLength(1);

    axios.get.mockRejectedValue(Object.assign(new Error('Service Unavailable'), { response: { status: 503 } }));
    await fetchJobs();

    expect(Job.__store[0].status).toBe('active');
    expect(Job.__store[0].missingScans).toBe(0);
  });

  test('a suspiciously empty scan does not trigger missing-detection', async () => {
    axios.get.mockResolvedValueOnce({ data: { jobs: [ashbyJob('1')] } });
    await fetchJobs();

    axios.get.mockResolvedValueOnce({ data: { jobs: [] } });
    await fetchJobs();

    expect(Job.__store[0].status).toBe('active');
    expect(Job.__store[0].missingScans).toBe(0);
  });

  test('a job absent from one complete, successful scan is not immediately closed', async () => {
    axios.get.mockResolvedValueOnce({ data: { jobs: [ashbyJob('1'), ashbyJob('2')] } });
    await fetchJobs();

    axios.get.mockResolvedValueOnce({ data: { jobs: [ashbyJob('1')] } }); // '2' now gone
    await fetchJobs();

    const missing = Job.__store.find((j) => j.sourceJobId === '2');
    expect(missing.status).toBe('active');
    expect(missing.missingScans).toBe(1);
  });

  test('a persistently missing posting is closed only after crossing the grace threshold', async () => {
    axios.get.mockResolvedValueOnce({ data: { jobs: [ashbyJob('1'), ashbyJob('2')] } });
    await fetchJobs();

    for (let i = 0; i < MISSING_SCAN_THRESHOLD; i++) {
      axios.get.mockResolvedValueOnce({ data: { jobs: [ashbyJob('1')] } });
      await fetchJobs();
    }

    expect(Job.__store.find((j) => j.sourceJobId === '2').status).toBe('closed');
  });
});
