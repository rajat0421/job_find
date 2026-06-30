const User = require('../models/User');
const Job = require('../models/Job');
const UserJob = require('../models/UserJob');

const SKILL_SYNONYMS = {
  react: ['reactjs', 'react.js'],
  node: ['nodejs', 'node.js'],
  nodejsnode: ['nodejs', 'node.js'],
  mongo: ['mongodb', 'mongoose'],
  postgres: ['postgresql', 'pg'],
  js: ['javascript'],
  ts: ['typescript'],
  express: ['expressjs', 'express.js'],
  expressjs: ['express', 'express.js'],
  next: ['nextjs', 'next.js'],
  vue: ['vuejs', 'vue.js'],
  angular: ['angularjs'],
  aws: ['amazon web services'],
  gcp: ['google cloud'],
};

const normalizeSkill = (skill) => skill.toLowerCase().replace(/[.\s-]/g, '');

const countSkillMatches = (userSkills, jobText) => {
  const text = jobText.toLowerCase();
  let matched = 0;

  for (const skill of userSkills) {
    const n = normalizeSkill(skill);
    if (text.includes(n)) { matched++; continue; }
    const synonyms = SKILL_SYNONYMS[n] || [];
    if (synonyms.some((s) => text.includes(s))) matched++;
  }

  return { matched, total: userSkills.length };
};

const EXP_HINTS = {
  junior: ['junior', 'fresher', 'entry level', 'associate', '0-2', '1-2'],
  mid: ['mid level', '2-4', '3-5', '2-5'],
  senior: ['senior', 'lead', 'sr.', '5+', '5-8', '7+'],
};

const scoreJob = (user, job) => {
  let score = 0;
  const text = `${job.title} ${job.description || ''}`.toLowerCase();

  // Skill match → up to 50 pts
  if (user.skills?.length) {
    const { matched, total } = countSkillMatches(user.skills, text);
    score += Math.round((matched / total) * 50);
  }

  // Location match → 20 pts
  if (user.locations?.length && job.location) {
    const jobLoc = job.location.toLowerCase();
    const locMatch = user.locations.some((l) => jobLoc.includes(l.toLowerCase()));
    const isRemote = jobLoc.includes('remote') || text.includes('remote');
    if (locMatch || (isRemote && user.remotePreference !== 'office')) score += 20;
  }

  // Salary match → 15 pts (job max salary >= 80% of user expectation)
  if (user.salary && job.salaryMax && job.salaryMax >= user.salary * 0.8) score += 15;

  // Experience level hint → 15 pts
  const level = user.experience <= 2 ? 'junior' : user.experience <= 5 ? 'mid' : 'senior';
  const hasLevelHint = Object.values(EXP_HINTS).flat().some((h) => text.includes(h));
  if (EXP_HINTS[level].some((h) => text.includes(h))) score += 15;
  else if (!hasLevelHint) score += 10; // no level mentioned = neutral

  return Math.min(score, 100);
};

const matchJobsForAllUsers = async () => {
  const users = await User.find({ isOnboarded: true, isEmailVerified: true });
  const jobs = await Job.find({ createdAt: { $gte: new Date(Date.now() - 2 * 60 * 60 * 1000) } });

  console.log(`[Matcher] ${jobs.length} jobs × ${users.length} users`);

  for (const user of users) {
    await _matchJobsForUser(user, jobs);
  }

  console.log('[Matcher] Done');
};

// Run immediately after a user completes onboarding or logs in — scores all existing jobs so their dashboard isn't empty
const matchJobsForUser = async (userId) => {
  const user = await User.findById(userId);
  if (!user) return;

  const jobs = await Job.find().sort({ createdAt: -1 }).limit(500);
  console.log(`[Matcher] Onboard match: ${jobs.length} jobs for user ${user.email}`);

  const created = await _matchJobsForUser(user, jobs);
  console.log(`[Matcher] Onboard match done: ${created} UserJob records created for ${user.email}`);
};

// Shared core: scores a list of jobs for one user, bulk-inserts new UserJob records
const _matchJobsForUser = async (user, jobs) => {
  if (!jobs.length) return 0;

  // Fetch all already-matched jobIds for this user in one query
  const existing = await UserJob.find({ userId: user._id, jobId: { $in: jobs.map((j) => j._id) } }).select('jobId');
  const existingSet = new Set(existing.map((uj) => uj.jobId.toString()));

  const toInsert = [];
  for (const job of jobs) {
    if (existingSet.has(job._id.toString())) continue;
    const score = scoreJob(user, job);
    toInsert.push({ userId: user._id, jobId: job._id, score });
  }

  if (toInsert.length) {
    // ordered: false — continue on duplicate key errors (race conditions)
    await UserJob.insertMany(toInsert, { ordered: false }).catch(() => {});
  }

  return toInsert.length;
};

module.exports = { matchJobsForAllUsers, matchJobsForUser, scoreJob };
