const User = require('../models/User');
const Job = require('../models/Job');
const UserJob = require('../models/UserJob');

const SKILL_SYNONYMS = {
  react: ['reactjs', 'react.js'],
  node: ['nodejs', 'node.js'],
  mongo: ['mongodb', 'mongoose'],
  postgres: ['postgresql', 'pg'],
  js: ['javascript'],
  ts: ['typescript'],
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
  // Only score jobs fetched in the last 2 hours to avoid re-scoring everything
  const jobs = await Job.find({ createdAt: { $gte: new Date(Date.now() - 2 * 60 * 60 * 1000) } });

  console.log(`[Matcher] ${jobs.length} jobs × ${users.length} users`);

  for (const user of users) {
    for (const job of jobs) {
      const exists = await UserJob.findOne({ userId: user._id, jobId: job._id });
      if (exists) continue;

      const score = scoreJob(user, job);
      await UserJob.create({ userId: user._id, jobId: job._id, score });
    }
  }

  console.log('[Matcher] Done');
};

module.exports = { matchJobsForAllUsers, scoreJob };
