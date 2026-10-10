// Guards a real bug found and fixed as part of Improvement 5: rescoreAllUsers
// and fixGreenhouseDescriptions used to DELETE a UserJob whenever its
// recalculated score was 0 — including ones with saved:true/applied:true,
// silently destroying a user's saved/applied history. Both now only ever
// update score to 0 (letting the existing threshold filters exclude it from
// active surfaces) and never delete.

jest.mock('../../models/User', () => ({ find: jest.fn() }));
jest.mock('../../models/Job', () => ({ find: jest.fn() }));
jest.mock('../../models/UserJob', () => ({ find: jest.fn(), bulkWrite: jest.fn().mockResolvedValue({}), deleteMany: jest.fn() }));

const User = require('../../models/User');
const Job = require('../../models/Job');
const UserJob = require('../../models/UserJob');
const { rescoreAllUsers, fixGreenhouseDescriptions } = require('../admin.controller');

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const buildQuery = (result) => {
  const q = {};
  q.populate = jest.fn(() => q);
  q.then = (resolve) => Promise.resolve(result).then(resolve);
  return q;
};

beforeEach(() => jest.clearAllMocks());

test('rescoreAllUsers never deletes a record whose score recalculates to 0', async () => {
  User.find.mockResolvedValue([{ _id: 'u1', email: 'a@x.com', skills: [], desiredRoles: [] }]);
  const savedButNowZero = { _id: 'uj1', userId: 'u1', jobId: { _id: 'j1', title: 'Sales Representative' }, score: 80, saved: true, applied: true };
  UserJob.find.mockReturnValue(buildQuery([savedButNowZero]));

  await rescoreAllUsers({}, mockRes());

  expect(UserJob.deleteMany).not.toHaveBeenCalled();
  expect(UserJob.bulkWrite).toHaveBeenCalled();
  const ops = UserJob.bulkWrite.mock.calls[0][0];
  expect(ops[0].updateOne.filter._id).toBe('uj1');
  expect(ops[0].updateOne.update.$set.score).toBe(0); // updated to 0, not removed
});

test('rescoreAllUsers refreshes matchedSkills/matchedRole/reasons/matcherVersion, not just the raw score', async () => {
  User.find.mockResolvedValue([{ _id: 'u1', email: 'a@x.com', skills: ['Python'], desiredRoles: ['Backend Developer'] }]);
  const uj = { _id: 'uj1', userId: 'u1', jobId: { _id: 'j1', title: 'Backend Engineer', description: 'Python role' }, score: 1 };
  UserJob.find.mockReturnValue(buildQuery([uj]));

  await rescoreAllUsers({}, mockRes());

  const setClause = UserJob.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
  expect(setClause).toHaveProperty('matchedSkills');
  expect(setClause).toHaveProperty('matcherVersion');
  expect(setClause).toHaveProperty('userFingerprint');
  expect(setClause).toHaveProperty('jobFingerprint');
});

test('an orphaned record (job hard-deleted) is skipped, not deleted and not crashed on', async () => {
  User.find.mockResolvedValue([{ _id: 'u1', email: 'a@x.com' }]);
  UserJob.find.mockReturnValue(buildQuery([{ _id: 'uj1', userId: 'u1', jobId: null, score: 10 }]));

  const res = mockRes();
  await rescoreAllUsers({}, res);

  expect(UserJob.deleteMany).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ skippedOrphaned: 1 }));
});

test('fixGreenhouseDescriptions never deletes a saved/applied record that now scores 0', async () => {
  Job.find.mockResolvedValue([]); // no greenhouse jobs need HTML stripping this run
  const savedButNowZero = { _id: 'uj1', userId: { _id: 'u1', skills: [] }, jobId: { _id: 'j1', title: 'Marketing Manager' }, score: 50, saved: true };
  UserJob.find.mockReturnValue(buildQuery([savedButNowZero]));

  await fixGreenhouseDescriptions({}, mockRes());

  expect(UserJob.deleteMany).not.toHaveBeenCalled();
  expect(UserJob.bulkWrite).toHaveBeenCalled();
});
