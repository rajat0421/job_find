// Guards Improvement 7: email digest content, escaping, and provider contract.
// buildJobDigestHtml/buildDigestSubject/etc. are pure functions, so most of
// this is tested directly without mocking axios; sendJobDigestEmail/
// sendAdminDigestCopy are tested separately with axios mocked to confirm the
// provider payload shape. No real email is ever sent — axios.post is always
// mocked.

jest.mock('axios');
const axios = require('axios');
const {
  sendJobDigestEmail,
  buildJobDigestHtml,
  buildDigestSubject,
  buildPreheader,
  escapeHtml,
  isSafeHttpUrl,
  workplaceLabel,
  salaryLabel,
  JOBFIND_DASHBOARD_URL,
} = require('../email.service');

beforeEach(() => {
  jest.clearAllMocks();
  axios.post.mockResolvedValue({ data: { success: true } });
});

const job = (overrides = {}) => ({
  title: 'Backend Engineer',
  company: 'Acme Corp',
  location: 'Bangalore',
  applyLink: 'https://boards.greenhouse.io/acme/jobs/123',
  ...overrides,
});

const entry = (overrides = {}) => ({
  job: job(overrides.job),
  score: 82,
  matchedSkills: ['Python', 'Docker'],
  matchedRole: 'Backend Developer',
  reasons: ['Fits your Backend Developer role', 'Matches your Python, Docker skills'],
  ...overrides,
});

describe('branding and key sections (#1)', () => {
  test('the rendered HTML contains JobFind branding, a personalized greeting, and the closing/unsubscribe section', () => {
    const html = buildJobDigestHtml('Priya', [entry()]);

    expect(html).toMatch(/JobFind/);
    expect(html).toMatch(/Personalized Job Digest/);
    expect(html).toMatch(/Hi Priya/);
    expect(html).toMatch(/Update your profile/);
    expect(html).toMatch(/Manage email preferences/);
    expect(html).toMatch(/signed up for job alerts/);
  });

  test('falls back to a neutral greeting when no display name is available', () => {
    const html = buildJobDigestHtml('', [entry()]);
    expect(html).toMatch(/Hi there/);
  });
});

describe('HTML escaping of untrusted/external content (#2)', () => {
  test('a malicious job title and company are escaped, never rendered as live HTML', () => {
    const malicious = entry({ job: { title: '<script>alert(1)</script>', company: '<img src=x onerror=alert(1)>' } });
    const html = buildJobDigestHtml('Priya', [malicious]);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('a malicious display name is escaped', () => {
    const html = buildJobDigestHtml('<b>Hacker</b>', [entry()]);
    expect(html).not.toContain('<b>Hacker</b>');
    expect(html).toContain('&lt;b&gt;Hacker&lt;/b&gt;');
  });

  test('escapeHtml handles quotes, ampersands and non-string/nullish input safely', () => {
    expect(escapeHtml(`O'Reilly & Sons "Jobs"`)).toBe('O&#39;Reilly &amp; Sons &quot;Jobs&quot;');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('application links (#3)', () => {
  test('a valid https applyLink is rendered as the CTA target', () => {
    const html = buildJobDigestHtml('Priya', [entry()]);
    expect(html).toContain('href="https://boards.greenhouse.io/acme/jobs/123"');
  });

  test('an unsafe or malformed applyLink (e.g. javascript: URI) never appears as a link target', () => {
    const unsafe = entry({ job: { applyLink: 'javascript:alert(1)' } });
    const html = buildJobDigestHtml('Priya', [unsafe]);
    expect(html).not.toContain('javascript:alert(1)');
    expect(html).not.toMatch(/View &amp; Apply/); // no CTA button rendered at all for this job
  });

  test('a missing applyLink omits the CTA without throwing', () => {
    const noLink = entry({ job: { applyLink: undefined } });
    expect(() => buildJobDigestHtml('Priya', [noLink])).not.toThrow();
    expect(buildJobDigestHtml('Priya', [noLink])).not.toMatch(/View &amp; Apply/);
  });

  test('isSafeHttpUrl accepts only absolute http(s) URLs', () => {
    expect(isSafeHttpUrl('https://example.com/job/1')).toBe(true);
    expect(isSafeHttpUrl('http://example.com/job/1')).toBe(true);
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('ftp://example.com')).toBe(false);
    expect(isSafeHttpUrl('not a url')).toBe(false);
    expect(isSafeHttpUrl('')).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
  });
});

describe('salary and workplace type — shown only when meaningful (#4)', () => {
  test('a job with no salary fields renders no salary text at all', () => {
    const html = buildJobDigestHtml('Priya', [entry({ job: { salaryMin: undefined, salaryMax: undefined } })]);
    expect(html).not.toMatch(/LPA/);
  });

  test('a full salary range is shown', () => {
    const html = buildJobDigestHtml('Priya', [entry({ job: { salaryMin: 800000, salaryMax: 1200000 } })]);
    expect(html).toMatch(/₹8\.0 LPA.*₹12\.0 LPA/);
  });

  test('a salary with only a max bound is shown as "Up to", not fabricated as a range', () => {
    const html = buildJobDigestHtml('Priya', [entry({ job: { salaryMax: 1500000 } })]);
    expect(html).toMatch(/Up to ₹15\.0 LPA/);
  });

  test('a salary with only a min bound is shown as "From"', () => {
    const html = buildJobDigestHtml('Priya', [entry({ job: { salaryMin: 600000 } })]);
    expect(html).toMatch(/From ₹6\.0 LPA/);
  });

  test('workplaceType is shown only for the three known normalized values', () => {
    expect(workplaceLabel({ workplaceType: 'remote' })).toBe('Remote');
    expect(workplaceLabel({ workplaceType: 'hybrid' })).toBe('Hybrid');
    expect(workplaceLabel({ workplaceType: 'onsite' })).toBe('On-site');
    expect(workplaceLabel({ workplaceType: null })).toBeNull();
    expect(workplaceLabel({ workplaceType: 'some weird value' })).toBeNull();
  });

  test('a job with no workplaceType shows no workplace claim, even if the location string says "Remote"', () => {
    const html = buildJobDigestHtml('Priya', [entry({ job: { location: 'Remote (India)', workplaceType: null } })]);
    // the location itself is still shown as plain text, but no separate "Remote" workplace badge is fabricated from it
    expect(html).toContain('Remote (India)');
    expect(html).not.toMatch(/·&nbsp;Remote</); // no standalone workplace-label line
  });
});

describe('score, matched skills and reasons (#5)', () => {
  test('score is shown out of 100, not as a hire-probability percentage', () => {
    const html = buildJobDigestHtml('Priya', [entry({ score: 82 })]);
    expect(html).toContain('82/100');
    expect(html).not.toContain('82%');
  });

  test('matched skills are rendered as individual chips', () => {
    const html = buildJobDigestHtml('Priya', [entry({ matchedSkills: ['Python', 'Docker'] })]);
    expect(html).toContain('Python');
    expect(html).toContain('Docker');
  });

  test('reasons are rendered as a list', () => {
    const html = buildJobDigestHtml('Priya', [entry({ reasons: ['Fits your Backend Developer role'] })]);
    expect(html).toContain('Fits your Backend Developer role');
  });

  test('duplicate reasons are not repeated in the same card', () => {
    const html = buildJobDigestHtml('Priya', [entry({ reasons: ['Remote position', 'Remote position'] })]);
    const occurrences = html.split('Remote position').length - 1;
    expect(occurrences).toBe(1);
  });
});

describe('missing/malformed optional fields do not break rendering (#6)', () => {
  test('null/undefined matchedSkills and reasons render gracefully', () => {
    expect(() => buildJobDigestHtml('Priya', [entry({ matchedSkills: null, reasons: null })])).not.toThrow();
  });

  test('malformed (non-array) matchedSkills/reasons are ignored rather than crashing', () => {
    expect(() => buildJobDigestHtml('Priya', [entry({ matchedSkills: 'not-an-array', reasons: 42 })])).not.toThrow();
  });

  test('a job missing title/company/location entirely still renders', () => {
    const bare = { job: {}, score: 10 };
    expect(() => buildJobDigestHtml('Priya', [bare])).not.toThrow();
    expect(buildJobDigestHtml('Priya', [bare])).toContain('Untitled role');
  });

  test('an empty jobs array renders without throwing', () => {
    expect(() => buildJobDigestHtml('Priya', [])).not.toThrow();
  });
});

describe('ordering is passed through, never re-derived by the template (#7)', () => {
  test('job cards render in the exact order given, with no reordering/dedup inside the template', () => {
    const jobs = [entry({ job: { title: 'Alpha Role' }, score: 90 }), entry({ job: { title: 'Beta Role' }, score: 70 }), entry({ job: { title: 'Alpha Role' }, score: 90 })];
    const fullHtml = buildJobDigestHtml('Priya', jobs);
    // The hidden preheader also mentions the top job's title — skip past the
    // visible greeting so indices below only compare actual job-card positions.
    const html = fullHtml.slice(fullHtml.indexOf('Hi Priya'));

    const alphaFirstIdx = html.indexOf('Alpha Role');
    const betaIdx = html.indexOf('Beta Role');
    const alphaSecondIdx = html.indexOf('Alpha Role', alphaFirstIdx + 1);

    expect(alphaFirstIdx).toBeGreaterThan(-1);
    expect(betaIdx).toBeGreaterThan(alphaFirstIdx); // Beta comes after the first Alpha, matching input order
    // The caller-provided duplicate (same title twice) is still rendered as two
    // separate cards — the template passes through whatever it's given and does
    // not take it upon itself to deduplicate (that's the matcher/digest query's job).
    expect(alphaSecondIdx).toBeGreaterThan(betaIdx);
  });
});

describe('unsubscribe and preference links (#8)', () => {
  test('profile and preferences links are absolute URLs, not relative paths', () => {
    const html = buildJobDigestHtml('Priya', [entry()]);
    expect(html).toMatch(/href="https?:\/\/[^"]+\/profile"/);
    expect(html).toMatch(/href="https?:\/\/[^"]+\/dashboard"/);
  });
});

describe('prominent "Open JobFind Dashboard" CTA (follow-up to Improvement 7)', () => {
  test('appears at the end of every regular user digest, linking to the exact fixed dashboard URL', () => {
    expect(JOBFIND_DASHBOARD_URL).toBe('https://jobfind.runwavelabs.com/dashboard');

    const html = buildJobDigestHtml('Priya', [entry()]);

    expect(html).toContain('Want to update your profile or job preferences?');
    expect(html).toContain('Open JobFind Dashboard');
    expect(html).toContain(`href="${JOBFIND_DASHBOARD_URL}"`);
    // It's the last link in the document — i.e. at the end of the digest.
    expect(html.lastIndexOf(JOBFIND_DASHBOARD_URL)).toBeGreaterThan(html.lastIndexOf('Manage email preferences'));
  });

  test('still appears, with the existing profile/preferences links and unsubscribe copy intact, even with zero jobs', () => {
    const html = buildJobDigestHtml('Priya', []);

    expect(html).toContain(JOBFIND_DASHBOARD_URL);
    expect(html).toMatch(/href="https?:\/\/[^"]+\/profile"/);
    expect(html).toMatch(/href="https?:\/\/[^"]+\/dashboard"/);
    expect(html).toContain('To stop these emails');
  });

  test('the dashboard CTA is a fixed literal, unaffected even if FRONTEND_URL changes (unlike the profile/preferences links, which intentionally do follow it)', () => {
    const originalEnv = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://some-other-configured-domain.example.com';
    jest.resetModules();
    const { buildJobDigestHtml: rebuiltBuildHtml, JOBFIND_DASHBOARD_URL: rebuiltConstant } = require('../email.service');

    const html = rebuiltBuildHtml('Priya', [entry()]);

    expect(rebuiltConstant).toBe('https://jobfind.runwavelabs.com/dashboard');
    // The prominent CTA specifically must stay pinned to the fixed URL...
    expect(html).toContain('>Open JobFind Dashboard');
    expect(html.match(/href="https:\/\/jobfind\.runwavelabs\.com\/dashboard"/g)).toHaveLength(1);
    // ...even though the OTHER links correctly follow the configured FRONTEND_URL.
    expect(html).toContain('href="https://some-other-configured-domain.example.com/profile"');

    process.env.FRONTEND_URL = originalEnv;
  });
});

describe('subject lines (#3 upstream / preheader)', () => {
  test('subject is singular for exactly one job, plural otherwise, and never repeats the raw score', () => {
    expect(buildDigestSubject([entry()])).toBe('Your new JobFind match is ready');
    expect(buildDigestSubject([entry(), entry()])).toBe('Your 2 new JobFind matches are ready');
    expect(buildDigestSubject([entry(), entry()])).not.toMatch(/\d+%/);
  });

  test('preheader summarizes the top match using real data, capped to a reasonable length', () => {
    const preheader = buildPreheader([entry({ job: { title: 'Backend Engineer', company: 'Acme' }, score: 82 })]);
    expect(preheader).toContain('Backend Engineer');
    expect(preheader).toContain('Acme');
    expect(preheader.length).toBeLessThanOrEqual(150);
  });

  test('preheader does not throw for an empty jobs array', () => {
    expect(() => buildPreheader([])).not.toThrow();
  });
});

describe('provider request format (#10)', () => {
  test('sendJobDigestEmail posts the expected {to, subject, html, fromName} shape to the configured provider', async () => {
    await sendJobDigestEmail('user@example.com', 'Priya', [entry()]);

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [, body] = axios.post.mock.calls[0];
    expect(body.to).toBe('user@example.com');
    expect(body.fromName).toBe('JobFind');
    expect(typeof body.subject).toBe('string');
    expect(typeof body.html).toBe('string');
    expect(body.html).toContain('Backend Engineer');
  });

  test('a failed provider response (200 but success:false) still throws, preserving existing failure-safety semantics', async () => {
    axios.post.mockResolvedValue({ data: { success: false, error: 'provider rejected' } });
    await expect(sendJobDigestEmail('user@example.com', 'Priya', [entry()])).rejects.toThrow('provider rejected');
  });
});
