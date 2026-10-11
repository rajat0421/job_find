// Regression coverage for the false-positive role/seniority incident: JobFind
// emailed a 15+-year Principal/Architect posting to a 1-year-experience user
// at 88/100, labeled "Fresher / junior friendly" — reproduced and verified
// against the real stored documents during investigation, fixed here. These
// are pure unit tests (scoreJobDetailed/scoreJobWithBreakdown/getMatchedSkills
// touch no database at all) — no mocks, no network, no production access.

const { scoreJobDetailed, scoreJobWithBreakdown } = require('../jobMatcher.service');

const baseUser = (overrides = {}) => ({
  desiredRoles: ['Backend Developer'],
  skills: ['Java', 'MySQL'],
  experience: 1,
  locations: ['Remote'],
  remotePreference: 'any',
  salary: null,
  ...overrides,
});

const baseJob = (overrides = {}) => ({
  title: 'Backend Developer',
  description: 'Build APIs using Java and MySQL.',
  location: 'Remote',
  workplaceType: null,
  salaryMin: null,
  salaryMax: null,
  ...overrides,
});

// A realistic reconstruction of the real incident's shape — NOT the verbatim
// stored description (which lives only in production), but faithful to the
// exact phrasing that caused the bug: "15+ years of Software Development",
// "Lead and mentor junior engineers", and strong senior signals ("Principal
// Software Engineer", "senior engineering team") — all confirmed present in
// the real captured Greenhouse response during the read-only investigation.
const architectJobDescription =
  'We are looking for an experienced Principal Software Engineer to join our team. ' +
  'Work with senior engineering team in major development projects, design and implementation. ' +
  'Lead and mentor junior engineers. Required Knowledge, Skills, And Abilities: ' +
  '15+ years of Software Development in Java, preferably significant experience with Hibernate and Spring Boot. ' +
  '4+ years experience automating and deploying large scale production services in AWS, GCP or similar. ' +
  'Experience working with relational databases, ideally MySQL, PostgreSQL or GraphDB.';

describe('1. Role matching: a bare keyword inside a materially different title is not an exact match', () => {
  test('"Software Architect, Java Backend" does not score an exact 40 for a Backend Developer search', () => {
    const user = baseUser();
    const job = baseJob({ title: 'Software Architect, Java Backend', description: 'Build backend systems in Java.' });

    const { breakdown } = scoreJobWithBreakdown(user, job);

    expect(breakdown.role.score).not.toBe(40);
    expect(breakdown.role.matchedRole).toBeNull();
  });

  test('a genuinely relevant backend engineering position still scores an exact role match', () => {
    const user = baseUser();
    for (const title of ['Backend Developer', 'Backend Engineer', 'Java Backend Engineer', 'Senior Backend Engineer', 'Principal Backend Engineer']) {
      const { breakdown } = scoreJobWithBreakdown(user, baseJob({ title }));
      expect(breakdown.role.score).toBe(40);
      expect(breakdown.role.matchedRole).toBe('Backend Developer');
    }
  });

  test('a fallback-keyword exact role (no ROLE_KEYWORDS entry) still works — MERN Stack Developer', () => {
    const user = baseUser({ desiredRoles: ['MERN Stack Developer'] });
    const { breakdown } = scoreJobWithBreakdown(user, baseJob({ title: 'MERN Stack Developer' }));
    expect(breakdown.role.score).toBe(40);
  });

  test('an unrelated senior/executive title containing a broad keyword is not an exact match', () => {
    const user = baseUser();
    const { breakdown } = scoreJobWithBreakdown(user, baseJob({ title: 'VP of Platform Engineering' }));
    expect(breakdown.role.score).not.toBe(40);
  });

  test('a legitimate management-role exact match is NOT demoted by its own keyword containing an override word', () => {
    const user = baseUser({ desiredRoles: ['Engineering Manager'] });
    const { breakdown } = scoreJobWithBreakdown(user, baseJob({ title: 'Director of Engineering', description: 'Lead the engineering org.' }));
    expect(breakdown.role.score).toBe(40);
    expect(breakdown.role.matchedRole).toBe('Engineering Manager');
  });
});

describe('2 & 4. Explicit high minimum-experience requirement is a hard eligibility gate', () => {
  test('a 15+ year Principal/Architect role is fully ineligible for a 1-year profile, and is never labeled junior-friendly', () => {
    const user = baseUser({ experience: 1 });
    const job = baseJob({ title: 'Principal Software Engineer', description: architectJobDescription });

    const detailed = scoreJobDetailed(user, job);
    expect(detailed.score).toBe(0);
    expect(detailed.reasons).not.toContain('Fresher / junior friendly');

    const { breakdown } = scoreJobWithBreakdown(user, job);
    expect(breakdown.eligible).toBe(false);
    expect(breakdown.ineligibleReason).toBe('experience_requirement');
    expect(breakdown.experience.statedMinYears).toBe(15);
  });

  test('rejected regardless of overlapping skills — even a user matching every listed skill is still ineligible', () => {
    const user = baseUser({ experience: 1, skills: ['Java', 'Hibernate', 'Spring Boot', 'AWS', 'GCP', 'MySQL', 'PostgreSQL'] });
    const job = baseJob({ title: 'Software Architect, Java Backend', description: architectJobDescription });

    const detailed = scoreJobDetailed(user, job);
    expect(detailed.score).toBe(0);
  });

  test('a smaller, closer experience shortfall against an explicit minimum is also rejected', () => {
    const user = baseUser({ experience: 3 });
    const job = baseJob({ description: '5+ years of experience required for this role.' });
    expect(scoreJobDetailed(user, job).score).toBe(0);
  });

  test('a user who meets the explicit minimum is not blocked by the gate', () => {
    const user = baseUser({ experience: 16 });
    const job = baseJob({ title: 'Principal Software Engineer', description: architectJobDescription });
    const { breakdown } = scoreJobWithBreakdown(user, job);
    expect(breakdown.eligible).toBe(true);
  });
});

describe('3. References to other people never establish the ADVERTISED position\'s own seniority', () => {
  test('"Lead and mentor junior engineers" alone (no numeric requirement) does not make the role junior-friendly', () => {
    const user = baseUser({ experience: 1 });
    const job = baseJob({
      title: 'Backend Engineer',
      description: 'Build scalable APIs using Java and MySQL. Lead and mentor junior engineers on the team.',
    });

    const { reasons } = scoreJobDetailed(user, job);
    expect(reasons).not.toContain('Fresher / junior friendly');
  });

  test('"collaborate with senior developers" alone does not establish the role itself is senior (no cap for a junior user)', () => {
    const user = baseUser({ experience: 1 });
    const job = baseJob({
      title: 'Backend Developer',
      description: 'Build APIs using Java and MySQL. Collaborate with senior developers across the org.',
    });

    const { breakdown } = scoreJobWithBreakdown(user, job);
    expect(breakdown.cap).toBeUndefined(); // not capped — "senior" here describes colleagues, not this role
  });

  test('a genuine senior self-description (not about other people) still caps a junior user\'s score', () => {
    const user = baseUser({ experience: 1 });
    const job = baseJob({ title: 'Senior Backend Developer', description: 'Build APIs using Java and MySQL. Senior-level ownership of the platform.' });

    const { breakdown } = scoreJobWithBreakdown(user, job);
    expect(breakdown.cap).toBeDefined();
    expect(breakdown.total).toBeLessThanOrEqual(30);
  });
});

describe('5. Genuinely entry-level postings remain eligible and junior-friendly', () => {
  test('an explicit 0-2 years / fresher-welcome posting stays eligible and labeled junior-friendly for a 1-year profile', () => {
    const user = baseUser({ experience: 1 });
    const job = baseJob({
      title: 'Backend Developer',
      description: 'Entry level role for a fresher. 0-2 years of experience required. Build APIs using Java and MySQL.',
    });

    const { score, reasons } = scoreJobDetailed(user, job);
    expect(score).toBeGreaterThan(0);
    expect(reasons).toContain('Fresher / junior friendly');
  });
});

describe('6. A missing/unrecognized experience requirement is never treated as junior-friendly evidence', () => {
  test('no experience language at all → neutral, not junior-friendly', () => {
    const user = baseUser({ experience: 1 });
    const job = baseJob({ title: 'Backend Developer', description: 'Build APIs using Java and MySQL.' });

    const { reasons } = scoreJobDetailed(user, job);
    expect(reasons).not.toContain('Fresher / junior friendly');
  });
});

describe('7. Seniority detection still works on a description normalized through the current HTML pipeline', () => {
  test('an entity-encoded description (the real Greenhouse shape) still triggers the experience gate after stripHtml normalization', () => {
    const { stripHtml } = require('../../platforms/greenhouse');
    const encoded =
      '&lt;p&gt;We are looking for a seasoned &lt;strong&gt;Principal Engineer&lt;/strong&gt; to join our team. ' +
      'Lead and mentor junior engineers.&lt;/p&gt;&lt;p&gt;Required: 15+ years of Software Development in Java.&lt;/p&gt;';
    const normalized = stripHtml(encoded);

    expect(normalized).not.toMatch(/[<>]/); // confirms normalization actually ran
    expect(normalized).toContain('15+ years');

    const user = baseUser({ experience: 1 });
    const job = baseJob({ title: 'Principal Software Engineer', description: normalized });
    const { score, reasons } = scoreJobDetailed(user, job);
    expect(score).toBe(0);
    expect(reasons).not.toContain('Fresher / junior friendly');
  });
});

describe('8. Skill synonym tokens match as whole words, not as substrings of unrelated words', () => {
  test('"AD" / Active Directory matches legitimately', () => {
    const { breakdown } = scoreJobWithBreakdown(
      baseUser({ skills: ['Active Directory'] }),
      baseJob({ description: 'Experience with Active Directory and LDAP required.' })
    );
    expect(breakdown.skills.matched).toContain('Active Directory');
  });

  test('"AD" as a standalone abbreviation still matches', () => {
    const { breakdown } = scoreJobWithBreakdown(
      baseUser({ skills: ['Active Directory'] }),
      baseJob({ description: 'Knowledge of AD integration and SSO required.' })
    );
    expect(breakdown.skills.matched).toContain('Active Directory');
  });

  // Note: when NOTHING matches, the breakdown short-circuits to the existing
  // "0 skills found — filtered out" ineligible shape (no `matched` array at
  // all, by design — see computeMatchScore) — so these negative assertions
  // default to an empty array rather than assuming `matched` is present.
  test('"ad" does NOT match inside "leading"', () => {
    const { breakdown } = scoreJobWithBreakdown(
      baseUser({ skills: ['Active Directory'] }),
      baseJob({ description: 'You will be leading cross-functional initiatives.' })
    );
    expect(breakdown.skills.matched || []).not.toContain('Active Directory');
  });

  test('"ad" does NOT match inside "leader" or "architectural"', () => {
    const { breakdown } = scoreJobWithBreakdown(
      baseUser({ skills: ['Active Directory'] }),
      baseJob({ description: 'A thought leader who drives architectural strategy.' })
    );
    expect(breakdown.skills.matched || []).not.toContain('Active Directory');
  });

  test('other short synonym tokens ("ml", "go", "ios") do not match inside unrelated words', () => {
    expect(scoreJobWithBreakdown(baseUser({ skills: ['ML'] }), baseJob({ description: 'Proficient in HTML and CSS.' })).breakdown.skills.matched || []).not.toContain('ML');
    expect(scoreJobWithBreakdown(baseUser({ skills: ['Golang'] }), baseJob({ description: 'Going forward we will migrate services.' })).breakdown.skills.matched || []).not.toContain('Golang');
    expect(scoreJobWithBreakdown(baseUser({ skills: ['Swift'] }), baseJob({ description: 'Review various scenarios before the release.' })).breakdown.skills.matched || []).not.toContain('Swift');
  });

  test('a single-letter skill ("C") is not matched against every word containing that letter', () => {
    const { breakdown } = scoreJobWithBreakdown(
      baseUser({ skills: ['C'] }),
      baseJob({ description: 'Secure every identity. We value career growth and collaboration.' })
    );
    expect(breakdown.skills.matched || []).not.toContain('C');
  });

  test('a single-letter skill ("C") still matches when it genuinely appears as its own word', () => {
    const { breakdown } = scoreJobWithBreakdown(
      baseUser({ skills: ['C'] }),
      baseJob({ description: 'Strong experience with C and embedded systems required.' })
    );
    expect(breakdown.skills.matched).toContain('C');
  });
});

describe('9. The production scorer and the admin breakdown scorer always agree', () => {
  test.each([
    ['exact role match', baseUser(), baseJob()],
    ['architect role-family override', baseUser(), baseJob({ title: 'Software Architect, Java Backend' })],
    ['experience eligibility gate', baseUser({ experience: 1 }), baseJob({ title: 'Principal Software Engineer', description: architectJobDescription })],
    ['blacklisted title', baseUser(), baseJob({ title: 'Sales Representative', description: 'Sell our product.' })],
    ['no skill overlap', baseUser({ skills: ['Rust'] }), baseJob({ description: 'Python and Django role.' })],
    ['entry-level junior match', baseUser({ experience: 1 }), baseJob({ description: '0-2 years of experience, fresher welcome. Java and MySQL.' })],
  ])('%s: scoreJobDetailed and scoreJobWithBreakdown agree on the final score', (_name, user, job) => {
    const detailed = scoreJobDetailed(user, job);
    const { score } = scoreJobWithBreakdown(user, job);
    expect(detailed.score).toBe(score);
  });
});
