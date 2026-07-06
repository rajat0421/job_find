const User = require('../models/User');
const Job = require('../models/Job');
const UserJob = require('../models/UserJob');

const SKILL_SYNONYMS = {
  react: ['reactjs', 'react.js'],
  node: ['nodejs', 'node.js'],
  nodejs: ['node', 'node.js'],
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

// Returns the list of user skills that appear in the job text (name or synonym)
const getMatchedSkills = (userSkills, jobText) => {
  const text = jobText.toLowerCase();
  const matched = [];
  for (const skill of userSkills) {
    const n = normalizeSkill(skill);
    if (text.includes(n)) { matched.push(skill); continue; }
    const synonyms = SKILL_SYNONYMS[n] || [];
    if (synonyms.some((s) => text.includes(s))) matched.push(skill);
  }
  return matched;
};

// ── Role → title keyword mapping ──────────────────────────────────────────────
// Used to filter jobs whose title doesn't match what the user is looking for
const ROLE_KEYWORDS = {
  'Backend Developer':    ['backend', 'back-end', 'back end', 'software engineer', 'software developer', 'api developer', 'api engineer', 'platform engineer', 'server engineer', 'node developer', 'python developer', 'java developer', 'golang', 'ruby developer', 'php developer'],
  'Frontend Developer':   ['frontend', 'front-end', 'front end', 'ui developer', 'ui engineer', 'react developer', 'react engineer', 'angular developer', 'vue developer', 'javascript developer', 'web developer', 'web engineer'],
  'Full Stack Developer': ['full stack', 'full-stack', 'fullstack', 'software engineer', 'software developer', 'web developer', 'web engineer'],
  'DevOps Engineer':      ['devops', 'dev ops', 'site reliability', 'sre', 'platform engineer', 'infrastructure engineer', 'cloud engineer', 'systems engineer', 'reliability engineer', 'build engineer'],
  'Data Engineer':        ['data engineer', 'data pipeline', 'etl', 'analytics engineer', 'big data engineer'],
  'Data Scientist':       ['data scientist', 'machine learning', 'ml engineer', 'ai engineer', 'research scientist', 'applied scientist', 'computer vision', 'nlp engineer'],
  'Mobile Developer':     ['mobile developer', 'mobile engineer', 'ios developer', 'ios engineer', 'android developer', 'android engineer', 'react native', 'flutter'],
  'QA Engineer':          ['qa engineer', 'quality assurance', 'test engineer', 'sdet', 'automation engineer', 'quality engineer', 'software test'],
  'Cybersecurity':        ['security engineer', 'security analyst', 'penetration', 'infosec', 'cybersecurity', 'information security', 'appsec', 'devsecops'],
  'Product Manager':      ['product manager', 'product owner', 'product lead', 'product director', 'group product manager', 'senior product manager'],
  'Software Engineer':    ['software engineer', 'software developer', 'sde', 'swe', 'application developer', 'application engineer'],
  'ML Engineer':          ['machine learning engineer', 'ml engineer', 'deep learning engineer', 'research engineer', 'mlops engineer'],
  'AI Engineer':          ['ai engineer', 'artificial intelligence engineer', 'generative ai', 'llm engineer', 'prompt engineer', 'applied ai'],
  'Cloud Architect':      ['cloud architect', 'solutions architect', 'cloud engineer', 'aws architect', 'azure architect', 'gcp architect'],
  'Blockchain Developer': ['blockchain developer', 'blockchain engineer', 'web3 developer', 'smart contract', 'solidity developer', 'defi developer'],
  'Embedded Engineer':    ['embedded engineer', 'embedded developer', 'firmware engineer', 'rtos', 'iot engineer', 'embedded systems'],
  'Tech Lead':            ['tech lead', 'technical lead', 'lead engineer', 'lead developer', 'engineering lead', 'lead software'],
  'Engineering Manager':  ['engineering manager', 'head of engineering', 'vp of engineering', 'vp engineering', 'director of engineering'],
};

// Backstop filter: drops obvious non-tech titles when a job has NO role affinity at all.
// (A job that matches the user's role or a generic tech keyword is never blacklisted.)
const TITLE_BLACKLIST = [
  'sales', 'marketing', 'recruiter', 'talent acquisition', 'human resources',
  'account executive', 'customer success', 'scrum master', 'agile coach',
  'technical account',
];

// Generic signals that a title is a tech/engineering role even if it doesn't match
// the user's exact desiredRole — enables similarity-based (not pass/fail) role scoring.
const GENERIC_TECH_KEYWORDS = [
  'engineer', 'developer', 'programmer', 'architect', 'consultant',
  'analyst', 'scientist', 'administrator', 'sde', 'swe', 'devops', 'technical',
];

// Graded role affinity (0..40) instead of a hard pass/fail gate.
//   • exact match to one of the user's roles → 40
//   • related tech role (generic keyword)    → 15  (e.g. Backend job for a Frontend user)
//   • no tech signal                          → 0
// Returns { score, matchedRole } — matchedRole is the exact role hit, or null.
const scoreRole = (titleLower, roles) => {
  if (roles.length) {
    for (const r of roles) {
      const keywords = ROLE_KEYWORDS[r] || [r.toLowerCase()];
      if (keywords.some((k) => titleLower.includes(k))) return { score: 40, matchedRole: r };
    }
    if (GENERIC_TECH_KEYWORDS.some((k) => titleLower.includes(k))) return { score: 15, matchedRole: null };
    return { score: 0, matchedRole: null };
  }
  // No roles set → neutral if it looks like a tech role
  if (GENERIC_TECH_KEYWORDS.some((k) => titleLower.includes(k))) return { score: 20, matchedRole: null };
  return { score: 0, matchedRole: null };
};

// ── Experience ────────────────────────────────────────────────────────────────
const EXP_HINTS = {
  junior: ['junior', 'fresher', 'entry level', 'entry-level', 'associate', '0-1', '0-2', '1-2', '0 to 2', '1 to 2'],
  mid:    ['mid level', 'mid-level', '2-4', '3-5', '2-5', '3-6', '2 to 4', '3 to 5', '2 to 5'],
  senior: ['senior', 'lead', 'sr.', 'principal', 'staff', '5+', '6+', '7+', '5-8', '7-10', '8+'],
};

const getUserLevel = (exp) => {
  if (exp <= 2) return { primary: 'junior', adjacent: 'mid' };
  if (exp <= 5) return { primary: 'mid',    adjacent: null };
  return           { primary: 'senior',  adjacent: 'mid' };
};

// Caps score below email threshold when a junior user's title signals a senior/IC title
// (management titles are already eliminated by role filter or blacklist above)
const SENIOR_TITLE_PATTERNS = ['senior', 'lead', 'sr.', 'principal', 'staff'];

// ── Scoring weights: role(40) + skills(30) + exp(15) + location(10) + salary(5)
// Returns { score, matchedSkills, matchedRole, reasons } — a human-readable
// explanation stored alongside the score so the UI can show WHY a job matched.
const scoreJobDetailed = (user, job) => {
  const titleLower = (job.title || '').toLowerCase();
  const text = `${job.title} ${job.description || ''}`.toLowerCase();
  const empty = { score: 0, matchedSkills: [], matchedRole: null, reasons: [] };
  const reasons = [];

  // ── Step 1: Role (0..40, graded — not a hard gate) ───────────────────────────
  const roles = user.desiredRoles || [];
  const role = scoreRole(titleLower, roles);
  // Backstop: only drop when there's NO role affinity AND the title is clearly non-tech
  if (role.score === 0 && TITLE_BLACKLIST.some((t) => titleLower.includes(t))) return empty;
  let score = role.score;
  if (role.matchedRole) reasons.push(`Fits your ${role.matchedRole} role`);
  else if (role.score > 0 && roles.length) reasons.push('Related tech role');

  // ── Step 2: Skills (gate — must match ≥1 if user has skills; up to 30 pts) ────
  let matchedSkills = [];
  if (user.skills?.length) {
    matchedSkills = getMatchedSkills(user.skills, text);
    if (matchedSkills.length === 0) return empty; // skills are the core relevance signal
    score += Math.min(15 + (matchedSkills.length - 1) * 5, 30); // 1→15, 2→20, 3→25, 4+→30
    reasons.push(`Matches your ${matchedSkills.slice(0, 3).join(', ')} skill${matchedSkills.length > 1 ? 's' : ''}`);
  }

  // ── Step 3: Location (10 pts) ────────────────────────────────────────────────
  const jobLoc = (job.location || '').toLowerCase();
  const isRemote = jobLoc.includes('remote');
  const locHit = (user.locations || []).find((l) => jobLoc.includes(l.toLowerCase()));
  if (locHit) { score += 10; reasons.push(`Located in ${locHit}`); }
  else if (isRemote && user.remotePreference !== 'office') { score += 8; reasons.push('Remote position'); }

  // ── Step 4: Salary (5 pts) ───────────────────────────────────────────────────
  if (user.salary) {
    const low = user.salary * 0.70;
    const high = user.salary * 1.50;
    const { salaryMax: jMax, salaryMin: jMin } = job;
    if      (jMax && jMin) { if (jMax >= low && jMin <= high) score += 5; }
    else if (jMax)         { if (jMax >= low)                 score += 5; }
    else if (jMin)         { if (jMin <= high)                score += 5; }
    else                   { score += 3; } // no salary listed = neutral
  } else {
    score += 3; // user hasn't set expectation = neutral
  }

  // ── Step 5: Experience (15 pts) ──────────────────────────────────────────────
  const { primary, adjacent } = getUserLevel(user.experience ?? 0);
  const allHints = Object.values(EXP_HINTS).flat();
  const hasAnyHint = allHints.some((h) => text.includes(h));
  if (EXP_HINTS[primary].some((h) => text.includes(h))) {
    score += 15;
    reasons.push(primary === 'junior' ? 'Fresher / junior friendly' : `Suited to ${primary}-level experience`);
  } else if (adjacent && EXP_HINTS[adjacent].some((h) => text.includes(h))) {
    score += 8;
  } else if (!hasAnyHint) {
    score += 7; // no experience level mentioned = neutral
  }
  // else: 0 — wrong level explicitly mentioned

  // ── Step 6: Cap junior users for senior IC titles ────────────────────────────
  if (primary === 'junior' && SENIOR_TITLE_PATTERNS.some((p) => titleLower.includes(p))) {
    score = Math.min(score, 30);
  }

  return { score: Math.min(score, 100), matchedSkills, matchedRole: role.matchedRole, reasons };
};

// Thin wrapper — most callers just need the number
const scoreJob = (user, job) => scoreJobDetailed(user, job).score;

// How many of the most-recent jobs to score each user against per run.
// _matchJobsForUser skips jobs a user already has a UserJob for, so this is a
// backfill: it guarantees eventual coverage even if a cron run is missed (Render
// spin-down) or a user onboarded after a job's original fetch window passed.
const MATCH_WINDOW = 2000;

const matchJobsForAllUsers = async () => {
  const users = await User.find({ isOnboarded: true, isEmailVerified: true });
  const jobs = await Job.find().sort({ createdAt: -1 }).limit(MATCH_WINDOW);

  console.log(`[Matcher] ${jobs.length} recent jobs × ${users.length} users`);
  let totalNew = 0;
  for (const user of users) totalNew += await _matchJobsForUser(user, jobs);
  console.log(`[Matcher] Done — ${totalNew} new match(es) created`);
};

const matchJobsForUser = async (userId) => {
  const user = await User.findById(userId);
  if (!user) return;

  const jobs = await Job.find().sort({ createdAt: -1 }).limit(500);
  console.log(`[Matcher] Onboard match: ${jobs.length} jobs for user ${user.email}`);

  const created = await _matchJobsForUser(user, jobs);
  console.log(`[Matcher] Onboard match done: ${created} UserJob records created for ${user.email}`);
};

const _matchJobsForUser = async (user, jobs) => {
  if (!jobs.length) return 0;

  const existing = await UserJob.find({ userId: user._id, jobId: { $in: jobs.map((j) => j._id) } }).select('jobId');
  const existingSet = new Set(existing.map((uj) => uj.jobId.toString()));

  const toInsert = [];
  for (const job of jobs) {
    if (existingSet.has(job._id.toString())) continue;
    const { score, matchedSkills, matchedRole, reasons } = scoreJobDetailed(user, job);
    if (score === 0) continue;
    toInsert.push({ userId: user._id, jobId: job._id, score, matchedSkills, matchedRole, reasons });
  }

  if (toInsert.length) {
    await UserJob.insertMany(toInsert, { ordered: false }).catch(() => {});
  }

  return toInsert.length;
};

const scoreJobWithBreakdown = (user, job) => {
  const titleLower = job.title.toLowerCase();
  const text = `${job.title} ${job.description || ''}`.toLowerCase();
  const breakdown = {};

  // ── Role (graded — exact 40 / related tech 15 / none 0) ──────────────────────
  const roles = user.desiredRoles || [];
  const role = scoreRole(titleLower, roles);
  if (role.score === 0 && TITLE_BLACKLIST.some(t => titleLower.includes(t))) {
    return { score: 0, breakdown: { role: { score: 0, max: 40, detail: 'Non-tech title (blacklisted), no role affinity' } } };
  }
  if (role.matchedRole) {
    breakdown.role = { score: 40, max: 40, detail: `Exact match → ${role.matchedRole}` };
  } else if (role.score > 0) {
    breakdown.role = { score: role.score, max: 40, detail: roles.length ? 'Related tech role (not an exact role match)' : 'No role set — tech title, neutral' };
  } else {
    breakdown.role = { score: 0, max: 40, detail: roles.length ? `No affinity with: ${roles.join(', ')}` : 'No role set, no tech signal' };
  }
  let score = breakdown.role.score;

  // ── Skills ──────────────────────────────────────────────────────────────────
  if (user.skills?.length) {
    const matched = getMatchedSkills(user.skills, text);
    if (matched.length === 0) return { score: 0, breakdown: { ...breakdown, skills: { score: 0, max: 30, detail: `0/${user.skills.length} skills found — filtered out` } } };
    const pts = Math.min(15 + (matched.length - 1) * 5, 30);
    breakdown.skills = { score: pts, max: 30, matched, total: user.skills.length, detail: `${matched.length}/${user.skills.length} matched: ${matched.join(', ')}` };
    score += pts;
  } else {
    breakdown.skills = { score: 0, max: 30, detail: 'No skills on profile' };
  }

  // ── Location ─────────────────────────────────────────────────────────────────
  const jobLoc = (job.location || '').toLowerCase();
  const isRemote = jobLoc.includes('remote');
  const locHit = (user.locations || []).find(l => jobLoc.includes(l.toLowerCase()));
  if (locHit) {
    breakdown.location = { score: 10, max: 10, detail: `Exact match — "${locHit}" in job location` };
    score += 10;
  } else if (isRemote && user.remotePreference !== 'office') {
    breakdown.location = { score: 8, max: 10, detail: 'Job is remote — near match' };
    score += 8;
  } else {
    breakdown.location = { score: 0, max: 10, detail: `No match — job: "${job.location || 'unspecified'}", user wants: ${user.locations?.join(', ') || 'any'}` };
  }

  // ── Salary ───────────────────────────────────────────────────────────────────
  if (user.salary) {
    const low = user.salary * 0.70, high = user.salary * 1.50;
    const { salaryMax: jMax, salaryMin: jMin } = job;
    const fmt = v => `₹${(v / 100000).toFixed(1)}L`;
    if (jMax && jMin) {
      if (jMax >= low && jMin <= high) { breakdown.salary = { score: 5, max: 5, detail: `Job ${fmt(jMin)}–${fmt(jMax)} fits expectation` }; score += 5; }
      else { breakdown.salary = { score: 0, max: 5, detail: `Job ${fmt(jMin)}–${fmt(jMax)} outside user expectation ${fmt(user.salary)}` }; }
    } else if (jMax) {
      if (jMax >= low) { breakdown.salary = { score: 5, max: 5, detail: `Job max ${fmt(jMax)} meets expectation` }; score += 5; }
      else { breakdown.salary = { score: 0, max: 5, detail: `Job max ${fmt(jMax)} below expectation` }; }
    } else if (jMin) {
      if (jMin <= high) { breakdown.salary = { score: 5, max: 5, detail: `Job min ${fmt(jMin)} within range` }; score += 5; }
      else { breakdown.salary = { score: 0, max: 5, detail: `Job min ${fmt(jMin)} above expectation` }; }
    } else { breakdown.salary = { score: 3, max: 5, detail: 'No salary listed — neutral' }; score += 3; }
  } else {
    breakdown.salary = { score: 3, max: 5, detail: 'User has no salary expectation — neutral' }; score += 3;
  }

  // ── Experience ───────────────────────────────────────────────────────────────
  const { primary, adjacent } = getUserLevel(user.experience ?? 0);
  const allHints = Object.values(EXP_HINTS).flat();
  const hasAnyHint = allHints.some(h => text.includes(h));
  if (EXP_HINTS[primary].some(h => text.includes(h))) {
    const hit = EXP_HINTS[primary].find(h => text.includes(h));
    breakdown.experience = { score: 15, max: 15, detail: `Level match — "${hit}" in job (user is ${primary})` };
    score += 15;
  } else if (adjacent && EXP_HINTS[adjacent].some(h => text.includes(h))) {
    const hit = EXP_HINTS[adjacent].find(h => text.includes(h));
    breakdown.experience = { score: 8, max: 15, detail: `Adjacent level — "${hit}" in job (user is ${primary})` };
    score += 8;
  } else if (!hasAnyHint) {
    breakdown.experience = { score: 7, max: 15, detail: 'No experience level mentioned — neutral' };
    score += 7;
  } else {
    breakdown.experience = { score: 0, max: 15, detail: `Wrong level — job mentions different experience tier (user is ${primary})` };
  }

  // ── Junior cap ───────────────────────────────────────────────────────────────
  if (primary === 'junior' && SENIOR_TITLE_PATTERNS.some(p => titleLower.includes(p))) {
    score = Math.min(score, 30);
    breakdown.cap = 'Capped at 30 — junior user, senior title';
  }

  const total = Math.min(score, 100);
  return { score: total, breakdown: { ...breakdown, total } };
};

module.exports = { matchJobsForAllUsers, matchJobsForUser, scoreJob, scoreJobDetailed, scoreJobWithBreakdown };
