// Guards Improvement 5 requirement #7: updateProfile previously triggered NO
// rematch at all — a real pre-existing gap, not a regression. This confirms
// the fix: a profile edit now fires the same matchJobsForUser pipeline that
// onboarding/login/resume-confirm already used.

jest.mock('../../models/User', () => ({ updateOne: jest.fn().mockResolvedValue({}), findById: jest.fn() }));
jest.mock('../../services/jobMatcher.service', () => ({ matchJobsForUser: jest.fn().mockResolvedValue() }));

const User = require('../../models/User');
const { matchJobsForUser } = require('../../services/jobMatcher.service');
const { updateProfile } = require('../user.controller');

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

beforeEach(() => jest.clearAllMocks());

test('updateProfile triggers matchJobsForUser for the authenticated user', async () => {
  const req = { user: { id: 'u1' }, body: { skills: ['Python', 'Go'] } };
  const res = mockRes();

  await updateProfile(req, res);

  expect(User.updateOne).toHaveBeenCalledWith({ _id: 'u1' }, { $set: expect.objectContaining({ skills: ['Python', 'Go'] }) });
  expect(matchJobsForUser).toHaveBeenCalledWith('u1');
});

test('the response is not delayed by matching — it is fire-and-forget', async () => {
  let resolveMatch;
  matchJobsForUser.mockReturnValue(new Promise((resolve) => { resolveMatch = resolve; }));
  const req = { user: { id: 'u1' }, body: { locations: ['Bangalore'] } };
  const res = mockRes();

  await updateProfile(req, res);

  expect(res.json).toHaveBeenCalledWith({ message: 'Profile updated' }); // responded without waiting for the match promise
  resolveMatch();
});

test('a failed background match does not affect the HTTP response or throw unhandled', async () => {
  matchJobsForUser.mockRejectedValue(new Error('matcher exploded'));
  const req = { user: { id: 'u1' }, body: { experience: 5 } };
  const res = mockRes();

  await expect(updateProfile(req, res)).resolves.not.toThrow();
  expect(res.json).toHaveBeenCalledWith({ message: 'Profile updated' });
});
