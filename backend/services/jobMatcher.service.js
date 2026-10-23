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
//
// 1 → 2: fixes a real false-positive incident (role matching treated a bare
// "backend" substring inside "Software Architect, Java Backend" as an exact
// role match; experience detection found "junior" inside "mentor junior
// engineers" and labeled a 15+-year Principal/Architect role "Fresher /
// junior friendly" for a 1-year-experience user). Existing UserJob rows
// computed under version 1 must be rescored — unchanged fingerprints alone
// would never trigger that, since neither the user's profile nor the job's
// content actually changed; only the scoring code did.
const MATCHER_VERSION = 2;

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

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Word-boundary-aware containment check — unlike a bare `.includes()`, this
// will not match a short token like "ad" inside "leading"/"already", "go"
// inside "going"/"goal", "ml" inside "html", or "ios" inside "scenarios".
// Real incident: "Active Directory"'s synonym "ad" matched the Okta
// architect posting purely via the word "leading" ("le-AD-ing"), crediting
// an unrelated skill. Safe for multi-word/punctuated tokens too (e.g.
// "active directory", "node.js") — `(?<![a-z0-9])`/`(?![a-z0-9])` only
// forbids an adjacent letter/digit immediately touching the token, which a
// normal word boundary inside the token itself (a space, a dot) doesn't
// trigger.
const hasToken = (text, token) =>
  new RegExp(`(?<![a-z0-9])${escapeRegExp(token)}(?![a-z0-9])`, 'i').test(text);

// Returns the list of user skills that appear in the job text (name or synonym)
const getMatchedSkills = (userSkills, jobText) => {
  const text = jobText.toLowerCase();
  const matched = [];
  for (const skill of userSkills) {
    const n = normalizeSkill(skill);
    if (hasToken(text, n)) { matched.push(skill); continue; }
    const synonyms = SKILL_SYNONYMS[n] || [];
    if (synonyms.some((s) => hasToken(text, s))) matched.push(skill);
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

// Job-family-changing title words: architecture, director/VP/executive-level
// positions genuinely belong to a different track than a plain IC Developer/
// Engineer role, even when the title also happens to mention a role keyword
// in passing. Real incident: "Software Architect, Java Backend" contains the
// bare word "backend" and used to score an EXACT match for a "Backend
// Developer" search — it's an Architect role, not a Backend Developer one.
// Deliberately excludes pure seniority modifiers ("principal", "staff",
// "senior", "lead") — those describe HOW SENIOR an IC role is, not a
// DIFFERENT job family, so "Principal Backend Engineer" is still correctly
// an exact Backend match (seniority/experience fit is handled separately —
// see SENIOR_TITLE_PATTERNS and scoreExperience below).
const ROLE_FAMILY_OVERRIDE_WORDS = ['architect', 'director', 'vice president', 'vp ', 'head of', 'chief'];

// An override word only disqualifies a keyword match when it's NOT already
// part of that same matched keyword — e.g. "director" inside the matched
// keyword "director of engineering" (a deliberate, correct exact match for
// "Engineering Manager") must not disqualify itself. An override word
// appearing elsewhere in the title, unexplained by the match itself (e.g.
// "architect" alongside a bare "backend" hit), means the title most likely
// belongs to a materially different position that merely mentions the keyword.
const hasUnexplainedOverride = (titleLower, matchedKeyword) =>
  ROLE_FAMILY_OVERRIDE_WORDS.some((w) => titleLower.includes(w) && !matchedKeyword.includes(w.trim()));

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
      const exactMatch = keywords.find((k) => titleLower.includes(k) && !hasUnexplainedOverride(titleLower, k));
      if (exactMatch) return { score: 40, matchedRole: r };
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

// Caps score below email threshold when a junior user's title OR description
// signals a senior/IC-senior role. "architect" was missing here — a real
// incident: "Software Architect, Java Backend" has none of the original
// words below in its TITLE, so a junior user's score was never capped despite
// the role requiring 15+ years.
const SENIOR_TITLE_PATTERNS = ['senior', 'lead', 'sr.', 'principal', 'staff', 'architect'];

// ── "Other people" references ───────────────────────────────────────────────
// A description mentioning who the role mentors/manages/works alongside is
// evidence about THOSE people's level, never about the advertised position's
// own level. Real incident: "Lead and mentor junior engineers" made a 15+
// year Principal/Architect role read as "Fresher / junior friendly" purely
// because the word "junior" appeared, with zero regard for context.
const PEOPLE_REFERENCE_VERBS = [
  'mentor', 'mentoring', 'manage', 'managing', 'lead', 'leading', 'coach', 'coaching',
  'supervise', 'supervising', 'guide', 'guiding', 'train', 'training', 'hire', 'hiring',
  'onboard', 'onboarding', 'support', 'supporting', 'collaborate with', 'collaborating with',
  'work with', 'working with', 'partner with', 'partnering with', 'alongside',
];
const PEOPLE_REFERENCE_NOUNS = [
  'engineer', 'engineers', 'developer', 'developers', 'colleague', 'colleagues', 'staff',
  'team member', 'team members', 'peer', 'peers', 'talent', 'candidate', 'candidates',
  'hire', 'hires', 'report', 'reports', 'mentee', 'mentees', 'teammate', 'teammates',
];
const OTHER_PEOPLE_RE = new RegExp(
  `\\b(?:${PEOPLE_REFERENCE_VERBS.map(escapeRegExp).join('|')})\\b(?:\\s+\\w+){0,4}\\s+(?:junior|senior)\\b` +
  `(?:\\s+(?:${PEOPLE_REFERENCE_NOUNS.map(escapeRegExp).join('|')}))?`,
  'gi'
);

// Returns `lowerText` with every "mentor junior engineers"-shaped reference
// blanked out (same length, so later substring/index logic is unaffected),
// so seniority/experience keyword scanning never mistakes a reference to
// OTHER people's level for the advertised position's own level. Never
// mutates the input.
const maskOtherPeopleReferences = (lowerText) =>
  lowerText.replace(OTHER_PEOPLE_RE, (m) => ' '.repeat(m.length));

// ── Explicit minimum-experience extraction ──────────────────────────────────
// Deliberately conservative and narrowly scoped to the handful of phrasings
// actually seen in real postings — "15+ years", "15 years of experience",
// "minimum of 15 years", "at least 15 years", and ranges like "2-4 years"
// (whose LOWER bound is the real floor). Every pattern anchors on the literal
// word "year(s)" immediately next to the number — this is what keeps it from
// firing on unrelated numbers ("20 engineers", "500ms", a requisition code)
// that merely happen to share a sentence with the real requirement. This is
// intentionally NOT a general-purpose NLP extractor — ambiguous phrasings
// that don't match one of these forms are left unrecognized rather than
// guessed at (see scoreExperience below for what "unrecognized" then does).
const RANGE_YEARS_RE = /\b(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\s*\+?\s*years?\b/gi;
const PLUS_YEARS_RE = /\b(\d{1,2})\s*\+\s*years?\b/gi;
const MINIMUM_YEARS_RE = /\b(?:minimum\s+of\s+|at\s+least\s+)(\d{1,2})\s*\+?\s*years?\b/gi;
const YEARS_OF_EXPERIENCE_RE = /\b(\d{1,2})\s*\+?\s*years?\s+(?:of\s+)?(?:[a-z]+\s+){0,3}(?:experience|development|engineering|work)\b/gi;

// Returns the highest-confidence stated minimum (the role's real floor, when
// multiple experience mentions exist — e.g. a posting listing both a general
// "15+ years" bar and a narrower "4+ years in AWS" nice-to-have), or `null`
// if nothing recognizable was found. Never invents a number from an isolated
// digit — every candidate must match one of the explicit patterns above.
const extractMinExperienceYears = (text) => {
  const candidates = [];
  let scrubbed = text;
  let m;
  const rangeRe = new RegExp(RANGE_YEARS_RE);
  while ((m = rangeRe.exec(text))) {
    candidates.push(Number(m[1])); // the range's lower bound is its real floor
    scrubbed = scrubbed.replace(m[0], ' '.repeat(m[0].length)); // don't let the range's own numbers double-feed the patterns below
  }
  for (const pattern of [PLUS_YEARS_RE, MINIMUM_YEARS_RE, YEARS_OF_EXPERIENCE_RE]) {
    const re = new RegExp(pattern);
    while ((m = re.exec(scrubbed))) candidates.push(Number(m[1]));
  }
  return candidates.length ? Math.max(...candidates) : null;
};

// ── Experience/seniority scoring (Phase 3/4 fix) ────────────────────────────
// Returns { eligible, points, reason, detail, statedMinYears, capped }.
// `eligible: false` is a hard gate — an explicit, high-confidence minimum-
// years requirement the user doesn't meet must override role/skill overlap
// entirely, not just reduce points (see computeMatchScore below, which short-
// circuits the whole score to 0 when this fires). The softer `capped` path
// (title/description signals seniority but no extractable number) keeps the
// job visible in-app at a reduced score, below the email threshold, exactly
// as the pre-existing junior-title cap already did.
const scoreExperience = (user, titleLower, maskedText) => {
  const userExp = user.experience ?? 0;
  const { primary, adjacent } = getUserLevel(userExp);

  const statedMinYears = extractMinExperienceYears(maskedText);
  if (statedMinYears !== null && userExp < statedMinYears) {
    return {
      eligible: false, points: 0, reason: null, capped: false, statedMinYears,
      detail: `Requires ${statedMinYears}+ years — profile has ${userExp}`,
    };
  }

  const juniorHints = EXP_HINTS.junior.filter((h) => maskedText.includes(h));
  const midHints = EXP_HINTS.mid.filter((h) => maskedText.includes(h));
  const seniorHints = EXP_HINTS.senior.filter((h) => maskedText.includes(h));
  const hasAnyHint = juniorHints.length || midHints.length || seniorHints.length;

  let points;
  let reason = null;
  let hit = null;
  if (EXP_HINTS[primary].some((h) => maskedText.includes(h))) {
    points = 15;
    hit = EXP_HINTS[primary].find((h) => maskedText.includes(h));
    reason = primary === 'junior' ? 'Fresher / junior friendly' : `Suited to ${primary}-level experience`;
  } else if (adjacent && EXP_HINTS[adjacent].some((h) => maskedText.includes(h))) {
    points = 8;
    hit = EXP_HINTS[adjacent].find((h) => maskedText.includes(h));
  } else if (!hasAnyHint) {
    points = 7; // no experience level mentioned anywhere (after masking other-people refs) — neutral, NOT junior-friendly evidence
  } else {
    points = 0; // a different level is explicitly signaled
  }

  // Title-level seniority (now including "architect" — see SENIOR_TITLE_PATTERNS)
  // OR a genuine senior self-description surviving the other-people mask
  // (e.g. "Principal Software Engineer" in the body, not just the title) caps
  // a junior user's score, exactly like before, but no longer relies on the
  // title alone.
  const seniorSignal = SENIOR_TITLE_PATTERNS.some((p) => titleLower.includes(p)) || seniorHints.length > 0;
  let capped = false;
  if (primary === 'junior' && seniorSignal) {
    capped = true;
    if (reason === 'Fresher / junior friendly') reason = null; // never claim junior-friendly for a role that independently signals seniority
  }

  return { eligible: true, points, reason, capped, statedMinYears: null, detail: hit ? `Level match — "${hit}" (user is ${primary})` : (hasAnyHint ? `Wrong level — job mentions a different experience tier (user is ${primary})` : 'No experience level mentioned — neutral') };
};

// ── Shared scoring core ──────────────────────────────────────────────────────
// Single implementation of record for BOTH scoreJobDetailed (the lean,
// production path) and scoreJobWithBreakdown (the admin debug view) — see
// Phase 6: having two independent copies of this logic is exactly how a
// future fix could silently apply to only one of them.
const computeMatchScore = (user, job) => {
  const titleLower = (job.title || '').toLowerCase();
  const rawText = `${job.title || ''} ${job.description || ''}`.toLowerCase();
  const maskedText = maskOtherPeopleReferences(rawText);
  const parts = {};

  // ── Role (0..40, graded — not a hard gate) ──────────────────────────────────
  const roles = user.desiredRoles || [];
  const role = scoreRole(titleLower, roles);
  if (role.score === 0 && TITLE_BLACKLIST.some((t) => titleLower.includes(t))) {
    return {
      score: 0, eligible: false, ineligibleReason: 'blacklisted_title',
      matchedRole: null, matchedSkills: [], reasons: [],
      parts: { role: { score: 0, max: 40, detail: 'Non-tech title (blacklisted), no role affinity' } },
    };
  }
  parts.role = {
    score: role.score, max: 40, matchedRole: role.matchedRole,
    detail: role.matchedRole
      ? `Exact match → ${role.matchedRole}`
      : role.score > 0
        ? (roles.length ? 'Related tech role (not an exact role match)' : 'No role set — tech title, neutral')
        : (roles.length ? `No affinity with: ${roles.join(', ')}` : 'No role set, no tech signal'),
  };

  // ── Skills (gate — must match ≥1 if user has skills; up to 30 pts) ─────────
  let matchedSkills = [];
  if (user.skills?.length) {
    matchedSkills = getMatchedSkills(user.skills, rawText);
    if (matchedSkills.length === 0) {
      return {
        score: 0, eligible: false, ineligibleReason: 'no_skill_overlap',
        matchedRole: role.matchedRole, matchedSkills: [], reasons: [],
        parts: { ...parts, skills: { score: 0, max: 30, detail: `0/${user.skills.length} skills found — filtered out` } },
      };
    }
    const pts = Math.min(15 + (matchedSkills.length - 1) * 5, 30);
    parts.skills = { score: pts, max: 30, matched: matchedSkills, total: user.skills.length, detail: `${matchedSkills.length}/${user.skills.length} matched: ${matchedSkills.join(', ')}` };
  } else {
    parts.skills = { score: 0, max: 30, detail: 'No skills on profile' };
  }

  // ── Explicit experience-requirement eligibility gate (Phase 3) ─────────────
  // Placed before location/salary/soft-experience points accumulate, so an
  // unambiguous requirement mismatch overrides role/skill similarity entirely
  // — the exact fix for the Okta incident (88/100 despite a 15+-year
  // requirement against a 1-year profile).
  const userExp = user.experience ?? 0;
  const earlyMinYears = extractMinExperienceYears(maskedText);
  if (earlyMinYears !== null && userExp < earlyMinYears) {
    return {
      score: 0, eligible: false, ineligibleReason: 'experience_requirement',
      matchedRole: role.matchedRole, matchedSkills, reasons: [],
      parts: { ...parts, experience: { score: 0, max: 15, detail: `Requires ${earlyMinYears}+ years — profile has ${userExp}`, statedMinYears: earlyMinYears } },
      cap: `Ineligible — requires ${earlyMinYears}+ years, profile has ${userExp}`,
    };
  }

  let score = parts.role.score + parts.skills.score;
  const reasons = [];
  if (role.matchedRole) reasons.push(`Fits your ${role.matchedRole} role`);
  else if (role.score > 0 && roles.length) reasons.push('Related tech role');
  if (matchedSkills.length) reasons.push(`Matches your ${matchedSkills.slice(0, 3).join(', ')} skill${matchedSkills.length > 1 ? 's' : ''}`);

  // ── Location (10 pts) ───────────────────────────────────────────────────────
  const jobLoc = (job.location || '').toLowerCase();
  const isRemote = job.workplaceType === 'remote' || jobLoc.includes('remote');
  const isHybrid = job.workplaceType === 'hybrid' || jobLoc.includes('hybrid');
  const locHit = (user.locations || []).find((l) => jobLoc.includes(l.toLowerCase()));
  if (locHit) {
    parts.location = { score: 10, max: 10, detail: `Exact match — "${locHit}" in job location` };
    score += 10; reasons.push(`Located in ${locHit}`);
  } else if (isRemote && user.remotePreference !== 'office') {
    parts.location = { score: 8, max: 10, detail: `Job is remote${job.workplaceType ? ' (workplaceType)' : ''} — near match` };
    score += 8; reasons.push('Remote position');
  } else if (isHybrid && user.remotePreference !== 'office') {
    parts.location = { score: 6, max: 10, detail: 'Job is hybrid — partial match' };
    score += 6; reasons.push('Hybrid position');
  } else {
    parts.location = { score: 0, max: 10, detail: `No match — job: "${job.location || 'unspecified'}", user wants: ${user.locations?.join(', ') || 'any'}` };
  }

  // ── Salary (5 pts) ──────────────────────────────────────────────────────────
  if (user.salary) {
    const low = user.salary * 0.70, high = user.salary * 1.50;
    const { salaryMax: jMax, salaryMin: jMin } = job;
    const fmt = (v) => `₹${(v / 100000).toFixed(1)}L`;
    if (jMax && jMin) {
      if (jMax >= low && jMin <= high) { parts.salary = { score: 5, max: 5, detail: `Job ${fmt(jMin)}–${fmt(jMax)} fits expectation` }; score += 5; }
      else { parts.salary = { score: 0, max: 5, detail: `Job ${fmt(jMin)}–${fmt(jMax)} outside user expectation ${fmt(user.salary)}` }; }
    } else if (jMax) {
      if (jMax >= low) { parts.salary = { score: 5, max: 5, detail: `Job max ${fmt(jMax)} meets expectation` }; score += 5; }
      else { parts.salary = { score: 0, max: 5, detail: `Job max ${fmt(jMax)} below expectation` }; }
    } else if (jMin) {
      if (jMin <= high) { parts.salary = { score: 5, max: 5, detail: `Job min ${fmt(jMin)} within range` }; score += 5; }
      else { parts.salary = { score: 0, max: 5, detail: `Job min ${fmt(jMin)} above expectation` }; }
    } else {
      parts.salary = { score: 3, max: 5, detail: 'No salary listed — neutral' }; score += 3;
    }
  } else {
    parts.salary = { score: 3, max: 5, detail: 'User has no salary expectation — neutral' }; score += 3;
  }

  // ── Experience (15 pts) + junior-cap safeguard ─────────────────────────────
  const exp = scoreExperience(user, titleLower, maskedText);
  parts.experience = { score: exp.points, max: 15, detail: exp.detail, statedMinYears: exp.statedMinYears };
  score += exp.points;
  if (exp.reason) reasons.push(exp.reason);

  let cap;
  if (exp.capped) {
    score = Math.min(score, 30);
    cap = 'Capped at 30 — junior user, senior title/description';
  }

  return {
    score: Math.min(score, 100), eligible: true, ineligibleReason: null,
    matchedRole: role.matchedRole, matchedSkills, reasons, parts, cap,
  };
};

// ── Scoring weights: role(40) + skills(30) + exp(15) + location(10) + salary(5)
// Returns { score, matchedSkills, matchedRole, reasons } — a human-readable
// explanation stored alongside the score so the UI can show WHY a job matched.
// Thin wrapper over computeMatchScore (see Phase 6) — preserves this exact
// output contract unchanged.
const scoreJobDetailed = (user, job) => {
  const r = computeMatchScore(user, job);
  return { score: r.score, matchedSkills: r.matchedSkills, matchedRole: r.matchedRole, reasons: r.reasons };
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

// Returns a stats object describing what actually happened this run — see
// Improvement 6 (production observability): matchJobs.job.js persists this
// into a MatchRun document so "the cron tick started" is never confused with
// "the cron tick succeeded". On failure, the partial stats accumulated so far
// are attached to the thrown error as `err.matchStats` (rather than swallowed)
// so the caller can still record what DID complete before the failure.
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

  const stats = {
    usersConsidered: users.length,
    recentJobsConsidered: recentJobs.length,
    pendingJobsConsidered: pendingJobs.length,
    created: 0,
    updated: 0,
    errors: 0,
    pendingMarkedProcessed: false,
  };

  try {
    for (const user of users) {
      const recentResult = await _matchJobsForUser(user, recentJobs, { updateExisting: false });
      const pendingResult = await _matchJobsForUser(user, pendingJobs, { updateExisting: true });
      stats.created += recentResult.created + pendingResult.created;
      stats.updated += pendingResult.updated;
      stats.errors += recentResult.insertErrors + recentResult.updateErrors
        + pendingResult.insertErrors + pendingResult.updateErrors;
    }

    // Only mark pending jobs processed now that every onboarded user has been
    // checked against them this tick. If the loop above threw, execution never
    // reaches here, so these jobs stay needsMatching:true for the next cron tick.
    if (pendingJobs.length) {
      await Job.updateMany({ _id: { $in: pendingJobs.map((j) => j._id) } }, { $set: { needsMatching: false } });
    }
    stats.pendingMarkedProcessed = true;
  } catch (err) {
    err.matchStats = stats; // let the caller record partial progress even though this run failed
    throw err;
  }

  console.log(`[Matcher] Done — ${stats.created} new match(es) created, ${stats.updated} stale match(es) refreshed${stats.errors ? `, ${stats.errors} operation(s) had errors` : ''}`);
  return stats;
};

// Bounded (index-covered by Job's {needsMatching,status,updatedAt} index)
// snapshot of the pending-match backlog — how many jobs are waiting, and how
// long the oldest one has been waiting. Used by monitoring.service.js; never
// loads the jobs themselves, just a count and one id's timestamp.
const getPendingMatchBacklog = async () => {
  const pendingFilter = { ...ACTIVE_JOB_FILTER, ...PENDING_JOB_FILTER };
  const [count, oldest] = await Promise.all([
    Job.countDocuments(pendingFilter),
    Job.findOne(pendingFilter).sort({ updatedAt: 1 }).select('updatedAt'),
  ]);
  return {
    count,
    oldestPendingAgeMs: oldest ? Date.now() - new Date(oldest.updatedAt).getTime() : null,
  };
};

// Bounded (index-covered by UserJob's {matcherVersion} index) count of
// UserJob records not yet brought up to MATCHER_VERSION by sweepStaleMatcherVersions.
// A plain count, not the records themselves — safe to call on every dashboard load.
const getMatcherVersionBacklog = () => UserJob.countDocuments({ matcherVersion: { $ne: MATCHER_VERSION } });

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
  if (!jobs.length) return { created: 0, updated: 0, insertErrors: 0, updateErrors: 0 };

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

  // Both writes are tolerant-but-visible: a failure here (most commonly a
  // duplicate-key race on the unique {userId,jobId} index — e.g. two overlapping
  // processes both matching the same pending job) must not abort the rest of
  // this tick, since every other user/job pair here is independent. Previously
  // these failures were swallowed entirely with no count or log line, making
  // "matching errors and incomplete batches" (Improvement 6) invisible. Now
  // they're counted and logged (sanitized — error message only) so the
  // dashboard/MatchRun can surface a 'partial' outcome instead of a silent one.
  let insertErrors = 0;
  let updateErrors = 0;
  if (toInsert.length) {
    await UserJob.insertMany(toInsert, { ordered: false }).catch((err) => {
      insertErrors += 1;
      console.error(`[Matcher] insertMany failed for user ${user._id} (${toInsert.length} pair(s) attempted):`, err.message);
    });
  }
  if (ops.length) {
    await UserJob.bulkWrite(ops).catch((err) => {
      updateErrors += 1;
      console.error(`[Matcher] bulkWrite failed for user ${user._id} (${ops.length} pair(s) attempted):`, err.message);
    });
  }

  return { created: toInsert.length, updated: ops.length, insertErrors, updateErrors };
};

// Thin wrapper over computeMatchScore (see Phase 6) — preserves this exact
// output contract ({score, breakdown}) and every breakdown.<dimension>
// {score,max,detail} shape the admin UI (AdminUserDetail.jsx) already reads,
// plus `breakdown.cap` (a plain string, same field the admin UI already
// renders as a warning banner) now covering BOTH the original junior-title
// cap and the new explicit-experience-requirement ineligibility, and
// `breakdown.eligible`/`breakdown.ineligibleReason` for the admin portal to
// show precisely why a position passed or failed.
const scoreJobWithBreakdown = (user, job) => {
  const r = computeMatchScore(user, job);
  return {
    score: r.score,
    breakdown: { ...r.parts, total: r.score, eligible: r.eligible, ineligibleReason: r.ineligibleReason, ...(r.cap ? { cap: r.cap } : {}) },
  };
};

module.exports = {
  matchJobsForAllUsers,
  matchJobsForUser,
  rescoreUserMatches,
  sweepStaleMatcherVersions,
  getPendingMatchBacklog,
  getMatcherVersionBacklog,
  scoreJob,
  scoreJobDetailed,
  scoreJobWithBreakdown,
  computeUserFingerprint,
  computeJobFingerprint,
  MATCHER_VERSION,
  // Exported so monitoring.service.js can compute an ideal (best-case, cron-
  // runs-every-hour-with-no-new-backlog) drain-time estimate for the two
  // backlogs these batch sizes bound — reusing the real constants rather
  // than duplicating them as a second, driftable copy.
  PENDING_BATCH_SIZE,
  VERSION_SWEEP_BATCH_SIZE,
};
