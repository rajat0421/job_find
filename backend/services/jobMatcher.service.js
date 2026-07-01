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

// Applied only when user has NOT set a desiredRole — filters obvious non-engineering titles
const TITLE_BLACKLIST = [
  'manager', 'director', 'vice president', ' vp ', 'head of',
  'chief ', 'president', 'sales', 'marketing', 'recruiter',
  'talent acquisition', 'human resources', 'account executive',
  'customer success', 'scrum master', 'agile coach',
  'technical account', 'solution architect', 'solutions architect',
];

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
const scoreJob = (user, job) => {
  const titleLower = job.title.toLowerCase();

  // ── Step 1: Role filter / blacklist ─────────────────────────────────────────
  const roles = user.desiredRoles?.length ? user.desiredRoles : (user.desiredRole ? [user.desiredRole] : []);
  if (roles.length) {
    // User has specified roles → job title MUST match at least one
    const allKeywords = roles.flatMap(r => ROLE_KEYWORDS[r] || [r.toLowerCase()]);
    if (!allKeywords.some((k) => titleLower.includes(k))) return 0;
  } else {
    // No role specified → at least filter out obvious non-engineering titles
    if (TITLE_BLACKLIST.some((term) => titleLower.includes(term))) return 0;
  }

  let score = 0;

  // ── Step 2: Role score (40 if role set, 20 neutral) ─────────────────────────
  score += roles.length ? 40 : 20;

  // ── Step 3: Skill matching (up to 30 pts, must match ≥1 if user has skills) ─
  const text = `${job.title} ${job.description || ''}`.toLowerCase();
  if (user.skills?.length) {
    const { matched } = countSkillMatches(user.skills, text);
    if (matched === 0) return 0;
    score += Math.min(15 + (matched - 1) * 5, 30); // 1→15, 2→20, 3→25, 4+→30
  }

  // ── Step 4: Location (10 pts) ────────────────────────────────────────────────
  const jobLoc = (job.location || '').toLowerCase();
  const isRemote = jobLoc.includes('remote');
  const locMatch = (user.locations || []).some((l) => jobLoc.includes(l.toLowerCase()));
  if (locMatch) score += 10;
  else if (isRemote && user.remotePreference !== 'office') score += 8;

  // ── Step 5: Salary (5 pts) ───────────────────────────────────────────────────
  if (user.salary) {
    const low  = user.salary * 0.70;
    const high = user.salary * 1.50;
    const { salaryMax: jMax, salaryMin: jMin } = job;
    if      (jMax && jMin) { if (jMax >= low && jMin <= high) score += 5; }
    else if (jMax)         { if (jMax >= low)                 score += 5; }
    else if (jMin)         { if (jMin <= high)                score += 5; }
    else                   { score += 3; } // no salary listed = neutral
  } else {
    score += 3; // user hasn't set expectation = neutral
  }

  // ── Step 6: Experience (15 pts) ──────────────────────────────────────────────
  const { primary, adjacent } = getUserLevel(user.experience ?? 0);
  const allHints = Object.values(EXP_HINTS).flat();
  const hasAnyHint = allHints.some((h) => text.includes(h));

  if (EXP_HINTS[primary].some((h) => text.includes(h))) {
    score += 15;
  } else if (adjacent && EXP_HINTS[adjacent].some((h) => text.includes(h))) {
    score += 8;
  } else if (!hasAnyHint) {
    score += 7; // no experience level mentioned = neutral
  }
  // else: 0 — wrong level explicitly mentioned

  // ── Step 7: Cap junior users for senior IC titles ────────────────────────────
  if (primary === 'junior') {
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
  for (const user of users) await _matchJobsForUser(user, jobs);
  console.log('[Matcher] Done');
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
    const score = scoreJob(user, job);
    if (score === 0) continue;
    toInsert.push({ userId: user._id, jobId: job._id, score });
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

  // ── Role ────────────────────────────────────────────────────────────────────
  const roles = user.desiredRoles?.length ? user.desiredRoles : (user.desiredRole ? [user.desiredRole] : []);
  if (roles.length) {
    const allKeywords = roles.flatMap(r => ROLE_KEYWORDS[r] || [r.toLowerCase()]);
    const hit = allKeywords.find(k => titleLower.includes(k));
    if (!hit) return { score: 0, breakdown: { role: { score: 0, max: 40, detail: `Title did not match any keyword for: ${roles.join(', ')}` } } };
    breakdown.role = { score: 40, max: 40, detail: `"${hit}" matched in title → role: ${roles.join(', ')}` };
  } else {
    if (TITLE_BLACKLIST.some(t => titleLower.includes(t))) return { score: 0, breakdown: { role: { score: 0, max: 40, detail: 'Non-engineering title (blacklisted) — no role set' } } };
    breakdown.role = { score: 20, max: 40, detail: 'No role set — neutral score' };
  }
  let score = breakdown.role.score;

  // ── Skills ──────────────────────────────────────────────────────────────────
  if (user.skills?.length) {
    const matched = [];
    for (const skill of user.skills) {
      const n = normalizeSkill(skill);
      if (text.includes(n)) { matched.push(skill); continue; }
      if ((SKILL_SYNONYMS[n] || []).some(s => text.includes(s))) matched.push(skill);
    }
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

module.exports = { matchJobsForAllUsers, matchJobsForUser, scoreJob, scoreJobWithBreakdown };
