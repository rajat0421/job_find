const crypto = require('crypto');
const User = require('../models/User');
const Job = require('../models/Job');
const UserJob = require('../models/UserJob');

// Bump this ONLY when scoreJobDetailed's actual scoring logic changes in a way
// that would produce a different score/reasons for the SAME user+job inputs —
// e.g. a weight changes, a new scoring dimension is added, role/skill matching
// logic changes. Do NOT bump for refactors, comments, logging, or unrelated
// code changes that don't alter scoring output. Bumping it marks every
// existing UserJob stale, which the bounded version sweep below then works
// through gradually — so treat it as a meaningful, infrequent event.
const MATCHER_VERSION = 1;

// Skill "families": keys are normalized skill names (lowercase, no spaces/dots/hyphens).
// Values are lowercase substrings to look for in the job text — including a skill's
// wider ecosystem so e.g. a "Python" user matches a "Django / FastAPI / Pandas" job
// that never literally says "Python". Only ever ADDS match credit; never removes.
const SKILL_SYNONYMS = {
  // Languages
  python: ['django', 'flask', 'fastapi', 'pandas', 'numpy', 'pytorch', 'tensorflow', 'scikit', 'celery', 'pyspark'],
  java: ['spring', 'spring boot', 'springboot', 'hibernate', 'jvm', 'maven', 'gradle', 'micronaut'],
  javascript: ['js', 'node', 'nodejs', 'node.js', 'react', 'angular', 'vue', 'typescript', 'es6'],
  js: ['javascript', 'node', 'react'],
  typescript: ['ts', 'javascript'],
  ts: ['typescript'],
  golang: ['go', 'gin', 'gorm'],
  csharp: ['c#', '.net', 'dotnet', 'asp.net', 'aspnet'],
  dotnet: ['.net', 'c#', 'asp.net', 'aspnet'],
  php: ['laravel', 'symfony', 'wordpress'],
  ruby: ['rails', 'ruby on rails'],
  scala: ['spark', 'akka'],
  kotlin: ['android', 'jetpack'],
  swift: ['ios', 'swiftui', 'objective-c'],
  rust: ['tokio', 'actix'],

  // Frontend
  react: ['reactjs', 'react.js', 'redux', 'next.js', 'nextjs', 'react native'],
  angular: ['angularjs', 'rxjs', 'ngrx'],
  vue: ['vuejs', 'vue.js', 'nuxt'],
  nextjs: ['next', 'next.js', 'react'],
  next: ['nextjs', 'next.js', 'react'],

  // Backend / runtime
  node: ['nodejs', 'node.js', 'express', 'nestjs'],
  nodejs: ['node', 'node.js', 'express', 'nestjs'],
  express: ['expressjs', 'express.js', 'node'],
  expressjs: ['express', 'express.js', 'node'],

  // Databases
  sql: ['mysql', 'postgresql', 'postgres', 'mssql', 'oracle', 'plsql', 'sql server'],
  mysql: ['sql', 'mariadb'],
  postgres: ['postgresql', 'pg', 'sql'],
  postgresql: ['postgres', 'pg', 'sql'],
  mongo: ['mongodb', 'mongoose', 'nosql'],
  mongodb: ['mongo', 'mongoose', 'nosql'],
  redis: ['cache', 'caching', 'memcached'],
  elasticsearch: ['elastic', 'opensearch', 'kibana'],

  // Cloud / infra / devops
  aws: ['amazon web services', 'ec2', 's3', 'lambda', 'dynamodb', 'cloudformation', 'ecs', 'eks'],
  gcp: ['google cloud', 'google cloud platform', 'bigquery', 'gke'],
  azure: ['microsoft azure', 'aks', 'azure devops'],
  docker: ['kubernetes', 'k8s', 'containers', 'containerization'],
  kubernetes: ['k8s', 'docker', 'helm', 'containers'],
  devops: ['ci/cd', 'jenkins', 'terraform', 'ansible', 'gitlab ci', 'github actions'],
  terraform: ['infrastructure as code', 'iac', 'devops'],

  // Data / ML / AI
  machinelearning: ['ml', 'deep learning', 'tensorflow', 'pytorch', 'scikit', 'nlp', 'computer vision'],
  ml: ['machine learning', 'deep learning', 'tensorflow', 'pytorch'],
  ai: ['artificial intelligence', 'machine learning', 'llm', 'genai', 'generative ai'],
  datascience: ['data scientist', 'machine learning', 'pandas', 'numpy', 'statistics'],
  spark: ['pyspark', 'hadoop', 'big data', 'databricks'],

  // QA / testing
  selenium: ['webdriver', 'test automation', 'automation testing'],
  cypress: ['test automation', 'e2e', 'playwright'],
  restapi: ['rest', 'restful', 'api', 'graphql', 'web services'],
  manualtesting: ['qa', 'quality assurance', 'test cases', 'functional testing'],
  testautomation: ['selenium', 'cypress', 'playwright', 'automation'],

  // Identity / security (helps IAM / AD / Okta profiles)
  iam: ['identity', 'access management', 'okta', 'active directory', 'azure ad', 'entra', 'sso', 'saml', 'oauth', 'ldap'],
  okta: ['iam', 'sso', 'identity', 'auth0', 'saml'],
  activedirectory: ['active directory', 'ad', 'ldap', 'azure ad', 'entra'],
  microsoftentraid: ['entra', 'azure ad', 'active directory', 'iam', 'identity'],

  // ERP / enterprise (helps SAP profiles)
  sap: ['s/4hana', 'sap mm', 'sap sd', 'sap fico', 'abap', 'erp'],
  saps4hana: ['sap', 's/4hana', 'erp', 'sap mm'],
  sapmm: ['sap', 'materials management', 'procure to pay', 'erp'],
  proculetopay: ['procure to pay', 'p2p', 'sap mm', 'sourcing'],
  salesforce: ['apex', 'lightning', 'crm', 'visualforce', 'sfdc'],
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
//   • related tech role (generic keyword)    → 22  (e.g. Backend job for a Frontend user)
//   • no tech signal                          → 0
// Returns { score, matchedRole } — matchedRole is the exact role hit, or null.
// Note: "related" (22) sits above the "no role set" neutral (20) so specifying a role
// never scores worse than leaving it blank.
const scoreRole = (titleLower, roles) => {
  if (roles.length) {
    for (const r of roles) {
      const keywords = ROLE_KEYWORDS[r] || [r.toLowerCase()];
      if (keywords.some((k) => titleLower.includes(k))) return { score: 40, matchedRole: r };
    }
    if (GENERIC_TECH_KEYWORDS.some((k) => titleLower.includes(k))) return { score: 22, matchedRole: null };
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
  // Prefer Lever's explicit workplaceType; fall back to scanning the location string
  const isRemote = job.workplaceType === 'remote' || jobLoc.includes('remote');
  const isHybrid = job.workplaceType === 'hybrid' || jobLoc.includes('hybrid');
  const locHit = (user.locations || []).find((l) => jobLoc.includes(l.toLowerCase()));
  if (locHit) { score += 10; reasons.push(`Located in ${locHit}`); }
  else if (isRemote && user.remotePreference !== 'office') { score += 8; reasons.push('Remote position'); }
  else if (isHybrid && user.remotePreference !== 'office') { score += 6; reasons.push('Hybrid position'); }

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
// _matchJobsForUser (insert-only mode) skips jobs a user already has a UserJob
// for, so this is a backfill: it guarantees eventual coverage even if a cron
// run is missed (Render spin-down) or a user onboarded after a job's original
// fetch window passed. Kept as-is — see Improvement 5's report for why this
// policy wasn't changed, and why it's no longer the *only* coverage path.
const MATCH_WINDOW = 2000;

// Bounded batch of jobs flagged needsMatching (brand new, or had a
// scoring-relevant field change) to process PER CRON TICK, regardless of how
// large the backlog is. This is what gives eventual coverage to jobs outside
// MATCH_WINDOW and to jobs whose content changed after their original fetch —
// without ever scanning the whole Job collection in one pass. A job is only
// marked processed (needsMatching:false) after matching has run for it against
// every currently onboarded user in this same tick — if the tick throws partway
// through, nothing gets marked, so the same jobs are retried next cycle.
const PENDING_BATCH_SIZE = 200;

// Bounded batch of UserJob records to bring up to the current MATCHER_VERSION
// per cron tick. Exists so a version bump (which makes every existing record
// stale at once) is worked through gradually rather than in one unbounded pass.
const VERSION_SWEEP_BATCH_SIZE = 300;

// Excludes closed/expired postings from new matches. Written as $nin rather than
// requiring status:'active' so it's safe against pre-existing Job documents that
// predate the lifecycle fields entirely — Mongoose applies the schema default
// ('active') on read for any doc missing the field, and MongoDB's $nin (like $ne)
// also matches documents where the field doesn't exist at all, so no backfill
// migration is required for this filter to behave correctly on old records.
const ACTIVE_JOB_FILTER = { status: { $nin: ['closed', 'expired'] } };
// Mirrors ACTIVE_JOB_FILTER's $ne/$nin-for-legacy-compatibility pattern: matches
// true AND documents missing the field entirely (pre-migration jobs), so no
// backfill is needed for this filter to behave correctly on old records either.
const PENDING_JOB_FILTER = { needsMatching: { $ne: false } };

// Order-independent, stable fingerprint of the scoring-relevant USER fields —
// exactly the fields scoreJobDetailed actually reads. Deliberately excludes
// name, email, qualification, email schedule settings, lastEmailedAt, etc. —
// changing those must never be treated as invalidating an existing score.
const computeUserFingerprint = (user) => {
  const payload = JSON.stringify({
    desiredRoles: [...(user.desiredRoles || [])].sort(),
    skills: [...(user.skills || [])].sort(),
    experience: user.experience ?? null,
    locations: [...(user.locations || [])].sort(),
    salary: user.salary ?? null,
    remotePreference: user.remotePreference || 'any',
  });
  return crypto.createHash('md5').update(payload).digest('hex');
};

// Stable fingerprint of the scoring-relevant JOB fields — exactly the fields
// scoreJobDetailed actually reads, plus status (an inactive job is a different
// scoring input in the sense that it should never be matched at all).
// Deliberately excludes company, applyLink, postedAt, lastSeenAt, sourceJobId,
// missingScans, etc. — a fetch cycle merely re-confirming a job is still alive
// must never look like a scoring-relevant change.
const computeJobFingerprint = (job) => {
  const payload = JSON.stringify({
    title: job.title || '',
    description: job.description || '',
    location: job.location || '',
    workplaceType: job.workplaceType || null,
    salaryMin: job.salaryMin ?? null,
    salaryMax: job.salaryMax ?? null,
    status: job.status || 'active',
  });
  return crypto.createHash('md5').update(payload).digest('hex');
};

const matchJobsForAllUsers = async () => {
  const users = await User.find({ isOnboarded: true, isEmailVerified: true });

  // Two candidate sets, two different treatments — see _matchJobsForUser:
  //  - recentJobs: the existing fast path, insert-only (a job in this window
  //    with no UserJob yet gets one; if it already has one, it's left alone —
  //    a job's content changing routes it through needsMatching instead, so
  //    this window doesn't need to re-check every pair's staleness every tick).
  //  - pendingJobs: bounded backlog of new/changed jobs, insert-OR-UPDATE —
  //    this is what actually fixes stale scores and out-of-window coverage.
  const recentJobs = await Job.find(ACTIVE_JOB_FILTER).sort({ createdAt: -1 }).limit(MATCH_WINDOW);
  const pendingJobs = await Job.find({ ...ACTIVE_JOB_FILTER, ...PENDING_JOB_FILTER })
    .sort({ updatedAt: 1 }) // oldest-pending-first so nothing starves behind a constant stream of new jobs
    .limit(PENDING_BATCH_SIZE);

  console.log(`[Matcher] ${recentJobs.length} recent jobs + ${pendingJobs.length} pending job(s) × ${users.length} users`);

  let totalCreated = 0;
  let totalUpdated = 0;
  for (const user of users) {
    const recentResult = await _matchJobsForUser(user, recentJobs, { updateExisting: false });
    const pendingResult = await _matchJobsForUser(user, pendingJobs, { updateExisting: true });
    totalCreated += recentResult.created + pendingResult.created;
    totalUpdated += pendingResult.updated;
  }

  // Only mark pending jobs processed now that every onboarded user has been
  // checked against them this tick. If the loop above threw, execution never
  // reaches here, so these jobs stay needsMatching:true for the next cron tick.
  if (pendingJobs.length) {
    await Job.updateMany({ _id: { $in: pendingJobs.map((j) => j._id) } }, { $set: { needsMatching: false } });
  }

  console.log(`[Matcher] Done — ${totalCreated} new match(es) created, ${totalUpdated} stale match(es) refreshed`);
};

const matchJobsForUser = async (userId) => {
  const user = await User.findById(userId);
  if (!user) return;

  // Step 1: refresh this user's EXISTING matches if their profile changed —
  // bounded by this one user's own match count (indexed by userId), not by
  // the size of the Job collection, so it reaches matches on jobs far outside
  // the latest-500 window without a full scan.
  const refreshed = await rescoreUserMatches(user);

  // Step 2: discover brand-new matches among recent jobs (existing behavior,
  // unchanged policy — see Improvement 5's report on why latest-500 stays).
  const jobs = await Job.find(ACTIVE_JOB_FILTER).sort({ createdAt: -1 }).limit(500);
  const { created } = await _matchJobsForUser(user, jobs, { updateExisting: false });

  console.log(`[Matcher] ${user.email}: ${refreshed} match(es) refreshed, ${created} new match(es) among ${jobs.length} recent jobs`);
};

// Rescores a single user's EXISTING UserJob records whose stored fingerprint/
// version no longer matches current — i.e. the user's profile changed, the
// matched job's content changed, or MATCHER_VERSION changed. Never creates new
// records (that's _matchJobsForUser's job) and never deletes — a pair that now
// scores 0 is simply updated to 0 and left for the existing score-threshold
// filters (job listings, email digest) to exclude, preserving saved/applied/
// emailed history intact.
const rescoreUserMatches = async (user) => {
  const userFingerprint = computeUserFingerprint(user);
  const userJobs = await UserJob.find({ userId: user._id }).populate('jobId');

  const ops = [];
  for (const uj of userJobs) {
    if (!uj.jobId) continue; // orphaned — its own Job doc was hard-deleted; not this function's concern
    const jobFingerprint = computeJobFingerprint(uj.jobId);
    const isCurrent = uj.matcherVersion === MATCHER_VERSION
      && uj.userFingerprint === userFingerprint
      && uj.jobFingerprint === jobFingerprint;
    if (isCurrent) continue; // nothing changed — no scoring work needed

    const { score, matchedSkills, matchedRole, reasons } = scoreJobDetailed(user, uj.jobId);
    ops.push({
      updateOne: {
        filter: { _id: uj._id },
        update: { $set: { score, matchedSkills, matchedRole, reasons, matcherVersion: MATCHER_VERSION, userFingerprint, jobFingerprint } },
      },
    });
  }

  if (ops.length) await UserJob.bulkWrite(ops);
  return ops.length;
};

// Bounded, resumable pass bringing UserJob records up to MATCHER_VERSION after
// a scoring-algorithm change. Called once per match cron tick (see
// jobs/matchJobs.job.js) — each tick only advances VERSION_SWEEP_BATCH_SIZE
// records, so a version bump never triggers one unbounded rescore of the whole
// collection; the remaining backlog is simply picked up by subsequent ticks,
// since the query itself is "whatever's still stale," not an offset/cursor.
const sweepStaleMatcherVersions = async () => {
  const stale = await UserJob.find({ matcherVersion: { $ne: MATCHER_VERSION } })
    .limit(VERSION_SWEEP_BATCH_SIZE)
    .populate('userId')
    .populate('jobId');

  const ops = [];
  for (const uj of stale) {
    if (!uj.userId || !uj.jobId) continue; // orphaned — leave alone
    const { score, matchedSkills, matchedRole, reasons } = scoreJobDetailed(uj.userId, uj.jobId);
    const userFingerprint = computeUserFingerprint(uj.userId);
    const jobFingerprint = computeJobFingerprint(uj.jobId);
    ops.push({
      updateOne: {
        filter: { _id: uj._id },
        update: { $set: { score, matchedSkills, matchedRole, reasons, matcherVersion: MATCHER_VERSION, userFingerprint, jobFingerprint } },
      },
    });
  }

  if (ops.length) await UserJob.bulkWrite(ops);
  return ops.length;
};

// `updateExisting: false` (used for the recent-jobs window and onboarding/
// login discovery): exactly today's behavior — insert a UserJob only for a
// (user, job) pair that doesn't have one yet; an existing pair is left alone.
// `updateExisting: true` (used for the pending-jobs batch): ALSO checks
// existing pairs for staleness and refreshes them in place — this is what
// propagates a job content change into an already-existing match.
const _matchJobsForUser = async (user, jobs, { updateExisting = false } = {}) => {
  if (!jobs.length) return { created: 0, updated: 0 };

  const existing = await UserJob.find({ userId: user._id, jobId: { $in: jobs.map((j) => j._id) } });
  const existingByJobId = new Map(existing.map((uj) => [uj.jobId.toString(), uj]));

  const userFingerprint = computeUserFingerprint(user); // computed once per user, not per job
  const toInsert = [];
  const ops = [];

  for (const job of jobs) {
    const existingUj = existingByJobId.get(job._id.toString());

    if (existingUj) {
      if (!updateExisting) continue; // insert-only mode: a job already matched is left alone here

      const jobFingerprint = computeJobFingerprint(job);
      const isCurrent = existingUj.matcherVersion === MATCHER_VERSION
        && existingUj.userFingerprint === userFingerprint
        && existingUj.jobFingerprint === jobFingerprint;
      if (isCurrent) continue; // already reflects this job's current content and this user's current profile

      const { score, matchedSkills, matchedRole, reasons } = scoreJobDetailed(user, job);
      ops.push({
        updateOne: {
          filter: { _id: existingUj._id },
          update: { $set: { score, matchedSkills, matchedRole, reasons, matcherVersion: MATCHER_VERSION, userFingerprint, jobFingerprint } },
        },
      });
      continue;
    }

    const { score, matchedSkills, matchedRole, reasons } = scoreJobDetailed(user, job);
    if (score === 0) continue; // no record created for a non-match, same as before
    toInsert.push({
      userId: user._id,
      jobId: job._id,
      score,
      matchedSkills,
      matchedRole,
      reasons,
      matcherVersion: MATCHER_VERSION,
      userFingerprint,
      jobFingerprint: computeJobFingerprint(job),
    });
  }

  if (toInsert.length) await UserJob.insertMany(toInsert, { ordered: false }).catch(() => {});
  if (ops.length) await UserJob.bulkWrite(ops).catch(() => {});

  return { created: toInsert.length, updated: ops.length };
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
  const isRemote = job.workplaceType === 'remote' || jobLoc.includes('remote');
  const isHybrid = job.workplaceType === 'hybrid' || jobLoc.includes('hybrid');
  const locHit = (user.locations || []).find(l => jobLoc.includes(l.toLowerCase()));
  if (locHit) {
    breakdown.location = { score: 10, max: 10, detail: `Exact match — "${locHit}" in job location` };
    score += 10;
  } else if (isRemote && user.remotePreference !== 'office') {
    breakdown.location = { score: 8, max: 10, detail: `Job is remote${job.workplaceType ? ' (workplaceType)' : ''} — near match` };
    score += 8;
  } else if (isHybrid && user.remotePreference !== 'office') {
    breakdown.location = { score: 6, max: 10, detail: 'Job is hybrid — partial match' };
    score += 6;
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

module.exports = {
  matchJobsForAllUsers,
  matchJobsForUser,
  rescoreUserMatches,
  sweepStaleMatcherVersions,
  scoreJob,
  scoreJobDetailed,
  scoreJobWithBreakdown,
  computeUserFingerprint,
  computeJobFingerprint,
  MATCHER_VERSION,
};
