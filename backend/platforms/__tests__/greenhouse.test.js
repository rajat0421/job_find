jest.mock('axios');
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
