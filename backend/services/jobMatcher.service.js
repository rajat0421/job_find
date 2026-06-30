const User = require('../models/User');
const Job = require('../models/Job');
const UserJob = require('../models/UserJob');

const SKILL_SYNONYMS = {
  react: ['reactjs', 'react.js'],
  node: ['nodejs', 'node.js'],
  nodejs: ['node', 'node.js'],       // normalizeSkill('Node.js') → 'nodejs'
  mongo: ['mongodb', 'mongoose'],
  mongodb: ['mongo', 'mongoose'],
  postgres: ['postgresql', 'pg'],
  postgresql: ['postgres', 'pg'],
  js: ['javascript'],
  javascript: ['js'],
  ts: ['typescript'],
  typescript: ['ts'],
  express: ['expressjs', 'express.js'],
  expressjs: ['express', 'express.js'],
  next: ['nextjs', 'next.js'],
  nextjs: ['next', 'next.js'],
  vue: ['vuejs', 'vue.js'],
  vuejs: ['vue', 'vue.js'],
  angular: ['angularjs'],
  aws: ['amazon web services', 'amazon'],
  gcp: ['google cloud', 'google cloud platform'],
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

// Experience hints — each level includes overlapping year ranges
const EXP_HINTS = {
  junior: ['junior', 'fresher', 'entry level', 'entry-level', 'associate', '0-1', '0-2', '1-2', '0 to 2', '1 to 2'],
  mid:    ['mid level', 'mid-level', '2-4', '3-5', '2-5', '3-6', '2 to 4', '3 to 5', '2 to 5'],
  senior: ['senior', 'lead', 'sr.', 'principal', 'staff', '5+', '6+', '7+', '5-8', '7-10', '8+'],
};

// Which experience level a user belongs to, plus the adjacent level for partial credit
const getUserLevel = (exp) => {
  if (exp <= 2) return { primary: 'junior', adjacent: 'mid' };
  if (exp <= 5) return { primary: 'mid',    adjacent: null }; // mid overlaps both; no partial
  return           { primary: 'senior',  adjacent: 'mid' };
};

// Cap score at 30 (below 40 threshold) when a junior user's title signals a senior/management role
const SENIOR_TITLE_PATTERNS = ['senior', 'lead', 'sr.', 'principal', 'staff', 'director', 'manager', 'vp ', 'vice president', 'head of'];

const scoreJob = (user, job) => {
  let score = 0;
  const text = `${job.title} ${job.description || ''}`.toLowerCase();

  // Skills — must match at least 1 if user has skills defined
  let matched = 0;
  if (user.skills?.length) {
    matched = countSkillMatches(user.skills, text).matched;
    if (matched === 0) return 0; // no relevant skills → skip entirely
    score += Math.min(25 + (matched - 1) * 5, 50);
  }

  // Location — remote only counts if the job LOCATION FIELD says "remote", not just description text
  const jobLoc = (job.location || '').toLowerCase();
  const isRemote = jobLoc.includes('remote');
  const locMatch = (user.locations || []).some((l) => jobLoc.includes(l.toLowerCase()));
  if (locMatch) score += 20;
  else if (isRemote && user.remotePreference !== 'office') score += 20;

  // Salary: fuzzy range — match within 70%–150% of user's expectation
  if (user.salary) {
    const low  = user.salary * 0.70;
    const high = user.salary * 1.50;
    const jMax = job.salaryMax;
    const jMin = job.salaryMin;

    if (jMax && jMin) {
      if (jMax >= low && jMin <= high) score += 15;
    } else if (jMax) {
      if (jMax >= low) score += 15;
    } else if (jMin) {
      if (jMin <= high) score += 15;
    } else {
      score += 8; // no salary listed = neutral, give partial credit
    }
  } else {
    score += 8; // user hasn't set expectation = neutral
  }

  // Experience: exact level = 15 pts, adjacent level = 8 pts, no hint = 10 pts
  const { primary, adjacent } = getUserLevel(user.experience ?? 0);
  const allHints = Object.values(EXP_HINTS).flat();
  const hasAnyHint = allHints.some((h) => text.includes(h));

  if (EXP_HINTS[primary].some((h) => text.includes(h))) {
    score += 15;
  } else if (adjacent && EXP_HINTS[adjacent].some((h) => text.includes(h))) {
    score += 8; // adjacent level — nearby experience range
  } else if (!hasAnyHint) {
    score += 10; // no experience level mentioned = neutral
  }

  // Cap score below threshold when a junior user encounters a senior/management title
  if (primary === 'junior') {
    const titleLower = job.title.toLowerCase();
    if (SENIOR_TITLE_PATTERNS.some((p) => titleLower.includes(p))) {
      score = Math.min(score, 30);
    }
  }

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
    if (score === 0) continue; // skip zero-score jobs entirely — saves DB space
    toInsert.push({ userId: user._id, jobId: job._id, score });
  }

  if (toInsert.length) {
    // ordered: false — continue on duplicate key errors (race conditions)
    await UserJob.insertMany(toInsert, { ordered: false }).catch(() => {});
  }

  return toInsert.length;
};

module.exports = { matchJobsForAllUsers, matchJobsForUser, scoreJob };
