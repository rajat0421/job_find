// Guards Improvement 3's step 5: inactive postings must be excluded from new
// matching computations. Does not re-test the scoring algorithm itself
// (untouched, out of scope) — only that the candidate-job query filters out
// closed/expired jobs before scoring ever runs.

jest.mock('../../models/User', () => ({ find: jest.fn(), findById: jest.fn() }));
jest.mock('../../models/Job', () => ({ find: jest.fn(() => ({ sort: () => ({ limit: () => Promise.resolve([]) }) })) }));
jest.mock('../../models/UserJob', () => ({ find: jest.fn().mockResolvedValue([]), insertMany: jest.fn() }));

const Job = require('../../models/Job');
const User = require('../../models/User');
const { matchJobsForAllUsers, matchJobsForUser } = require('../jobMatcher.service');

beforeEach(() => jest.clearAllMocks());

test('matchJobsForAllUsers excludes closed/expired jobs from the candidate pool', async () => {
  User.find.mockResolvedValue([]);

  await matchJobsForAllUsers();

  expect(Job.find).toHaveBeenCalledWith({ status: { $nin: ['closed', 'expired'] } });
});

test('matchJobsForUser excludes closed/expired jobs from the candidate pool', async () => {
  User.findById.mockResolvedValue({ _id: 'u1', email: 'a@x.com' });

  await matchJobsForUser('u1');

  expect(Job.find).toHaveBeenCalledWith({ status: { $nin: ['closed', 'expired'] } });
});
