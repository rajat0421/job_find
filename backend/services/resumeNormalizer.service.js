// Canonicalize AI-extracted data so it lines up with the app's own vocabulary
// (skill display names + the matcher's known roles in jobMatcher.service.js).

// Skill display-name canonicalization. Key is a lowercased alias; value is the
// preferred display form we store on the profile.
const SKILL_CANONICAL = {
  nodejs: 'Node.js', 'node js': 'Node.js', node: 'Node.js',
  reactjs: 'React', 'react.js': 'React',
  nextjs: 'Next.js', 'next js': 'Next.js',
  vuejs: 'Vue.js', 'vue js': 'Vue.js',
  expressjs: 'Express.js', express: 'Express.js',
  'amazon web services': 'AWS', aws: 'AWS',
  'google cloud platform': 'GCP', 'google cloud': 'GCP', gcp: 'GCP',
  'microsoft azure': 'Azure', azure: 'Azure',
  postgresql: 'Postgres', postgres: 'Postgres',
  mongo: 'MongoDB', mongodb: 'MongoDB',
  js: 'JavaScript', javascript: 'JavaScript',
  ts: 'TypeScript', typescript: 'TypeScript',
  'c sharp': 'C#', csharp: 'C#', 'dot net': '.NET', dotnet: '.NET',
  k8s: 'Kubernetes', kubernetes: 'Kubernetes',
  'ci/cd': 'CI/CD', cicd: 'CI/CD',
  rest: 'REST API', 'rest api': 'REST API', restful: 'REST API',
  html5: 'HTML', css3: 'CSS',
  golang: 'Go',
};

const canonicalSkill = (raw) => {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const key = trimmed.toLowerCase();
  if (SKILL_CANONICAL[key]) return SKILL_CANONICAL[key];
  // Preserve well-formed acronyms/casing; otherwise title-case single words lightly
  return trimmed;
};

// De-dupe case-insensitively while keeping the first (canonical) form.
const uniqCanonical = (arr, mapFn) => {
  const seen = new Set();
  const out = [];
  for (const item of arr || []) {
    const v = mapFn(item);
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
};

// The app's canonical roles (must intersect ROLE_KEYWORDS in jobMatcher.service.js
// so resume-driven profiles match strongly).
const CANONICAL_ROLES = [
  'Software Engineer', 'Backend Developer', 'Frontend Developer', 'Full Stack Developer',
  'DevOps Engineer', 'Data Engineer', 'Data Scientist', 'Mobile Developer', 'QA Engineer',
  'Cybersecurity', 'ML Engineer', 'AI Engineer', 'Cloud Architect', 'Product Manager',
];
const ROLE_ALIASES = {
  'sde': 'Software Engineer', 'swe': 'Software Engineer', 'software developer': 'Software Engineer',
  'backend engineer': 'Backend Developer', 'back end developer': 'Backend Developer',
  'frontend engineer': 'Frontend Developer', 'front end developer': 'Frontend Developer', 'ui developer': 'Frontend Developer',
  'fullstack developer': 'Full Stack Developer', 'full-stack developer': 'Full Stack Developer',
  'devops': 'DevOps Engineer', 'sre': 'DevOps Engineer', 'site reliability engineer': 'DevOps Engineer',
  'ml engineer': 'ML Engineer', 'machine learning engineer': 'ML Engineer',
  'data analyst': 'Data Scientist',
  'qa': 'QA Engineer', 'sdet': 'QA Engineer', 'test engineer': 'QA Engineer',
};

const canonicalRole = (raw) => {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const key = trimmed.toLowerCase();
  if (ROLE_ALIASES[key]) return ROLE_ALIASES[key];
  const exact = CANONICAL_ROLES.find((r) => r.toLowerCase() === key);
  if (exact) return exact;
  return trimmed; // keep custom roles (matcher falls back to the raw name)
};

// Infer up to 3 roles from skills when the AI couldn't determine desiredRoles.
const inferRolesFromSkills = (skills) => {
  const set = new Set((skills || []).map((s) => s.toLowerCase()));
  const has = (...ks) => ks.some((k) => set.has(k.toLowerCase()));
  const roles = [];

  const frontend = has('React', 'Next.js', 'Vue.js', 'Angular', 'TypeScript', 'HTML', 'CSS');
  const backend = has('Node.js', 'Express.js', 'Django', 'Flask', 'Spring', 'Java', 'Python', 'Go', 'MongoDB', 'Postgres', 'Redis');
  const data = has('Pandas', 'NumPy', 'PyTorch', 'TensorFlow', 'Spark', 'SQL', 'Machine Learning');
  const devops = has('Docker', 'Kubernetes', 'AWS', 'GCP', 'Azure', 'Terraform', 'CI/CD');

  if (frontend && backend) roles.push('Full Stack Developer');
  else if (backend) roles.push('Backend Developer');
  else if (frontend) roles.push('Frontend Developer');
  if (data) roles.push('Data Scientist');
  if (devops) roles.push('DevOps Engineer');
  roles.push('Software Engineer'); // always a reasonable catch-all

  return [...new Set(roles)].slice(0, 3);
};

// Normalize the full parsed object in place-safe manner and return a clean copy.
const normalizeParsed = (parsed) => {
  const p = parsed || {};
  const skills = uniqCanonical([...(p.skills || []), ...(p.tools || [])], canonicalSkill);
  let desiredRoles = uniqCanonical(p.desiredRoles || [], canonicalRole).slice(0, 3);
  if (desiredRoles.length === 0) desiredRoles = inferRolesFromSkills(skills);

  const clean = (arr) => uniqCanonical(arr || [], (x) => String(x || '').trim() || null);

  return {
    name: (p.name || '').trim(),
    email: (p.email || '').trim(),
    phone: (p.phone || '').trim(),
    summary: (p.summary || '').trim(),
    skills,
    desiredRoles,
    experienceYears: Math.max(0, Math.round(Number(p.experienceYears) || 0)),
    education: clean(p.education),
    certifications: clean(p.certifications),
    projects: clean(p.projects),
    companies: clean(p.companies),
    locations: clean(p.locations),
    languages: clean(p.languages),
    tools: clean(p.tools),
  };
};

module.exports = { normalizeParsed, inferRolesFromSkills, canonicalSkill, canonicalRole };
