jest.mock('axios');
jest.mock('../../models/Job', () => {
  const { createFakeJobModel } = require('../../test-utils/fakeJobModel');
  return createFakeJobModel();
});
jest.mock('../../services/jobLifecycle.service', () => {
  const actual = jest.requireActual('../../services/jobLifecycle.service');
  return { ...actual, sweepMissingJobs: jest.fn() };
});

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
