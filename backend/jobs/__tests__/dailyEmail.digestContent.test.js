// Guards Improvement 7's integration point: dailyEmail.job.js must pass the
// matcher's own matchedSkills/matchedRole/reasons through to the email
// template (previously dropped entirely — see email.digest.test.js for the
// template-level rendering of this data). Does not touch selection/ordering/
// threshold/cap — those are already covered by dailyEmail.safety.test.js and
// dailyEmail.staleness.test.js and must remain green alongside this file.

jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../../models/User', () => ({ find: jest.fn(), updateOne: jest.fn() }));
jest.mock('../../models/UserJob', () => ({ find: jest.fn(), countDocuments: jest.fn(), updateMany: jest.fn() }));
// create() resolves with an _id (simulates the claimDelivery() insert) so the
// success/failure path's subsequent findByIdAndUpdate(claim.doc._id, ...) has
// something to operate on — see Improvement 11's dailyEmail.job.js changes.
jest.mock('../../models/EmailLog', () => ({
  create: jest.fn().mockResolvedValue({ _id: 'log-id' }),
  findByIdAndUpdate: jest.fn().mockResolvedValue({}),
  findOne: jest.fn(),
}));
jest.mock('../../models/Config', () => ({ findOne: jest.fn() }));
jest.mock('../../services/email.service', () => ({ sendJobDigestEmail: jest.fn(), sendAdminDigestCopy: jest.fn() }));
jest.mock('../../services/config.service', () => ({ getEmailThreshold: jest.fn() }));

const User = require('../../models/User');
const UserJob = require('../../models/UserJob');
const Config = require('../../models/Config');
const { sendJobDigestEmail } = require('../../services/email.service');
const { getEmailThreshold } = require('../../services/config.service');
const { computeUserFingerprint, MATCHER_VERSION } = require('../../services/jobMatcher.service');
const { sendDigest } = require('../dailyEmail.job');

const DUE_USER = { _id: 'u1', email: 'a@x.com', name: 'Priya' };
const DUE_USER_FINGERPRINT = computeUserFingerprint(DUE_USER);

const buildUserJobQuery = (resolvedJobs) => {
  const query = {};
  query.sort = jest.fn(() => query);
  query.limit = jest.fn(() => query);
  query.populate = jest.fn().mockResolvedValue(resolvedJobs);
  return query;
};

beforeEach(() => {
  jest.clearAllMocks();
  User.find.mockResolvedValue([DUE_USER]);
  Config.findOne.mockResolvedValue(null);
  getEmailThreshold.mockResolvedValue(50);
  sendJobDigestEmail.mockResolvedValue();
});

test('matchedSkills, matchedRole and reasons from the UserJob record reach the email payload unchanged', async () => {
  const uj = {
    _id: 'uj1',
    jobId: { title: 'Backend Engineer', status: 'active', needsMatching: false },
    score: 88,
    matcherVersion: MATCHER_VERSION,
    userFingerprint: DUE_USER_FINGERPRINT,
    matchedSkills: ['Python', 'Docker'],
    matchedRole: 'Backend Developer',
    reasons: ['Fits your Backend Developer role', 'Matches your Python, Docker skills'],
  };
  UserJob.find.mockReturnValue(buildUserJobQuery([uj]));

  await sendDigest({ force: true });

  expect(sendJobDigestEmail).toHaveBeenCalledTimes(1);
  const [, , jobsPayload] = sendJobDigestEmail.mock.calls[0];
  expect(jobsPayload[0]).toEqual(expect.objectContaining({
    score: 88,
    matchedSkills: ['Python', 'Docker'],
    matchedRole: 'Backend Developer',
    reasons: ['Fits your Backend Developer role', 'Matches your Python, Docker skills'],
  }));
});

test('a UserJob record with no matchedSkills/reasons (legacy/malformed) still reaches sendJobDigestEmail without throwing', async () => {
  const uj = {
    _id: 'uj1',
    jobId: { title: 'Backend Engineer', status: 'active', needsMatching: false },
    score: 60,
    matcherVersion: MATCHER_VERSION,
    userFingerprint: DUE_USER_FINGERPRINT,
    // matchedSkills/matchedRole/reasons intentionally absent
  };
  UserJob.find.mockReturnValue(buildUserJobQuery([uj]));

  await expect(sendDigest({ force: true })).resolves.not.toThrow();
  expect(sendJobDigestEmail).toHaveBeenCalledTimes(1);
});
