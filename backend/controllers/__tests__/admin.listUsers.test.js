// Guards a display-accuracy fix found while auditing the admin Users page:
// listUsers' jobsMatched/topScore used to be a raw count/max over EVERY
// UserJob ever created for a user, with no matcherVersion filter — meaning a
// stale score computed under a PREVIOUS scoring algorithm (e.g. the Okta
// false-positive incident: 88/100, since corrected to 0) could still be
// displayed as the user's "Top Score" and counted in "Jobs Matched" until
// the bounded version sweep happened to reach that specific record. Both
// queries are now scoped to matcherVersion: MATCHER_VERSION.

jest.mock('../../models/User', () => ({ find: jest.fn() }));
jest.mock('../../models/UserJob', () => ({ countDocuments: jest.fn(), findOne: jest.fn() }));

const User = require('../../models/User');
const UserJob = require('../../models/UserJob');
const { MATCHER_VERSION } = require('../../services/jobMatcher.service');
const { listUsers } = require('../admin.controller');

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const buildUserQuery = (result) => {
  const q = {};
  q.select = jest.fn(() => q);
  q.sort = jest.fn(() => q);
  q.then = (resolve) => Promise.resolve(result).then(resolve);
  return q;
};

const buildFindOneQuery = (result) => ({ sort: jest.fn().mockResolvedValue(result) });

beforeEach(() => jest.clearAllMocks());

test('jobsMatched and topScore queries are scoped to the current MATCHER_VERSION, not every UserJob ever created', async () => {
  User.find.mockReturnValue(buildUserQuery([{ _id: 'u1', toObject: () => ({}) }]));
  UserJob.countDocuments.mockResolvedValue(0);
  UserJob.findOne.mockReturnValue(buildFindOneQuery(null));

  await listUsers({}, mockRes());

  expect(UserJob.countDocuments).toHaveBeenCalledWith({ userId: 'u1', matcherVersion: MATCHER_VERSION });
  expect(UserJob.findOne).toHaveBeenCalledWith({ userId: 'u1', matcherVersion: MATCHER_VERSION });
});

test('a stale pre-bump score is excluded from both jobsMatched and topScore until it is actually rescored', async () => {
  // Simulates the real incident shape: only a stale (old matcherVersion)
  // UserJob exists for this user, so the current-version-scoped queries
  // correctly report 0/no-match rather than surfacing the stale 88.
  User.find.mockReturnValue(buildUserQuery([{ _id: 'u1', toObject: () => ({}) }]));
  UserJob.countDocuments.mockResolvedValue(0); // the stale record doesn't match the {matcherVersion: MATCHER_VERSION} filter
  UserJob.findOne.mockReturnValue(buildFindOneQuery(null));

  const res = mockRes();
  await listUsers({}, res);

  const [user] = res.json.mock.calls[0][0];
  expect(user.jobsMatched).toBe(0);
  expect(user.topScore).toBe(0);
});

test('a genuinely current match is still correctly reported', async () => {
  User.find.mockReturnValue(buildUserQuery([{ _id: 'u1', toObject: () => ({}) }]));
  UserJob.countDocuments.mockResolvedValue(3);
  UserJob.findOne.mockReturnValue(buildFindOneQuery({ score: 72 }));

  const res = mockRes();
  await listUsers({}, res);

  const [user] = res.json.mock.calls[0][0];
  expect(user.jobsMatched).toBe(3);
  expect(user.topScore).toBe(72);
});
