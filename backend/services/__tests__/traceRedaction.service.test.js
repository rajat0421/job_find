const {
  redactRequest, redactResponse, sanitizeUrl, sanitizeParams, sanitizeHeaders,
  redactValue, sanitizeErrorMessage, REQUEST_HEADER_ALLOWLIST, RESPONSE_HEADER_ALLOWLIST,
} = require('../traceRedaction.service');

describe('sanitizeUrl — credential-bearing URLs (the Adzuna case: app_id/app_key in the query string)', () => {
  test('redacts app_id and app_key values but keeps the URL structure and other params readable', () => {
    const url = 'https://api.adzuna.com/v1/api/jobs/in/search/1?app_id=real-id-123&app_key=real-secret-456&what=developer&where=India';
    const out = sanitizeUrl(url);
    expect(out).not.toContain('real-id-123');
    expect(out).not.toContain('real-secret-456');
    expect(out).toContain('app_id=%5BREDACTED%5D'); // URLSearchParams encodes [ ] — still a clear, readable marker
    expect(out).toContain('what=developer');
    expect(out).toContain('where=India');
  });

  test('redacts common token/secret/password param names case-insensitively', () => {
    const out = sanitizeUrl('https://example.com/api?Token=abc&API_KEY=xyz&client_secret=qqq&normal=keep-me');
    expect(out).not.toContain('abc');
    expect(out).not.toContain('xyz');
    expect(out).not.toContain('qqq');
    expect(out).toContain('normal=keep-me');
  });

  test('a URL with no sensitive params is returned unchanged in substance', () => {
    const url = 'https://boards-api.greenhouse.io/v1/boards/okta/jobs?content=true';
    expect(sanitizeUrl(url)).toBe(url);
  });

  test('never throws on a malformed URL — returns it unchanged', () => {
    expect(() => sanitizeUrl('not a url at all')).not.toThrow();
    expect(sanitizeUrl('not a url at all')).toBe('not a url at all');
  });
});

describe('sanitizeParams — axios config.params object (the same Adzuna credentials, before URL-building)', () => {
  test('redacts sensitive param values, keeps the keys and other values', () => {
    const out = sanitizeParams({ app_id: 'real-id', app_key: 'real-key', what: 'developer', where: 'India' });
    expect(out.app_id).toBe('[REDACTED]');
    expect(out.app_key).toBe('[REDACTED]');
    expect(out.what).toBe('developer');
    expect(out.where).toBe('India');
  });

  test('handles null/undefined/non-object input without throwing', () => {
    expect(sanitizeParams(null)).toBeNull();
    expect(sanitizeParams(undefined)).toBeUndefined();
    expect(sanitizeParams('not an object')).toBe('not an object');
  });
});

describe('sanitizeHeaders — allowlist, not blocklist', () => {
  test('Authorization and Cookie headers are never kept, even though they are not explicitly named in a blocklist', () => {
    const out = sanitizeHeaders({ Authorization: 'Bearer secret-token', Cookie: 'session=abc', 'Content-Type': 'application/json' }, REQUEST_HEADER_ALLOWLIST);
    expect(out.Authorization).toBeUndefined();
    expect(out.Cookie).toBeUndefined();
    expect(out['Content-Type']).toBe('application/json');
  });

  test('is case-insensitive on header names', () => {
    const out = sanitizeHeaders({ 'CONTENT-TYPE': 'application/json', authorization: 'secret' }, REQUEST_HEADER_ALLOWLIST);
    expect(out['CONTENT-TYPE']).toBe('application/json');
    expect(out.authorization).toBeUndefined();
  });

  test('response allowlist keeps rate-limit and content headers, drops set-cookie', () => {
    const out = sanitizeHeaders({
      'content-type': 'application/json',
      'x-ratelimit-remaining': '42',
      'set-cookie': 'session=abc; HttpOnly',
    }, RESPONSE_HEADER_ALLOWLIST);
    expect(out['content-type']).toBe('application/json');
    expect(out['x-ratelimit-remaining']).toBe('42');
    expect(out['set-cookie']).toBeUndefined();
  });

  test('an empty/missing headers object returns an empty object, not an error', () => {
    expect(sanitizeHeaders(undefined, REQUEST_HEADER_ALLOWLIST)).toEqual({});
  });
});

describe('redactValue — defensive recursive JSON redaction by field name', () => {
  test('redacts a sensitive field at the top level', () => {
    const out = redactValue({ title: 'Engineer', password: 'hunter2' });
    expect(out.title).toBe('Engineer');
    expect(out.password).toBe('[REDACTED]');
  });

  test('redacts a sensitive field nested arbitrarily deep, without touching sibling fields', () => {
    const out = redactValue({ job: { title: 'Engineer', meta: { internal: { api_key: 'secret-abc', note: 'keep this' } } } });
    expect(out.job.meta.internal.api_key).toBe('[REDACTED]');
    expect(out.job.meta.internal.note).toBe('keep this');
    expect(out.job.title).toBe('Engineer');
  });

  test('redacts sensitive fields inside array elements', () => {
    const out = redactValue({ jobs: [{ title: 'A', token: 'x' }, { title: 'B', secret: 'y' }] });
    expect(out.jobs[0].title).toBe('A');
    expect(out.jobs[0].token).toBe('[REDACTED]');
    expect(out.jobs[1].secret).toBe('[REDACTED]');
  });

  test('never touches a field whose NAME is safe even if its value looks sensitive-ish', () => {
    const out = redactValue({ description: 'Experience with OAuth tokens and API keys required.' });
    expect(out.description).toBe('Experience with OAuth tokens and API keys required.');
  });

  test('is bounded against pathologically deep nesting (never throws, never hangs)', () => {
    let obj = { leaf: 'x' };
    for (let i = 0; i < 50; i++) obj = { nested: obj };
    expect(() => redactValue(obj)).not.toThrow();
  });

  test('preserves real public job content completely untouched (no over-redaction)', () => {
    const job = {
      title: 'Software Architect, Java Backend',
      company: 'Okta',
      location: 'Bengaluru, India',
      description: 'A long job description mentioning years of experience and skills.',
      applyLink: 'https://www.okta.com/company/careers/opportunity/7882676',
      id: 7882676,
    };
    expect(redactValue(job)).toEqual(job);
  });
});

describe('redactRequest / redactResponse — the combined entry points traceStorage.service.js calls', () => {
  test('redactRequest sanitizes url, params, and headers together', () => {
    const out = redactRequest({
      url: 'https://api.adzuna.com/v1/api/jobs/in/search/1?app_id=x&app_key=y',
      params: { app_id: 'x', app_key: 'y', what: 'dev' },
      headers: { Authorization: 'Bearer z', 'Content-Type': 'application/json' },
      body: null,
    });
    expect(out.url).not.toContain('app_id=x');
    expect(out.params.app_id).toBe('[REDACTED]');
    expect(out.headers.Authorization).toBeUndefined();
    expect(out.headers['Content-Type']).toBe('application/json');
  });

  test('redactResponse redacts nested sensitive fields in a real-shaped job list body', () => {
    const out = redactResponse({
      headers: { 'content-type': 'application/json', 'set-cookie': 'drop-me' },
      body: { jobs: [{ id: 1, title: 'Engineer', internal_notes: { auth_token: 'leak-me' } }] },
    });
    expect(out.headers['set-cookie']).toBeUndefined();
    expect(out.headers['content-type']).toBe('application/json');
    expect(out.body.jobs[0].title).toBe('Engineer');
    expect(out.body.jobs[0].internal_notes.auth_token).toBe('[REDACTED]');
  });
});

describe('sanitizeErrorMessage — defense in depth for free-text axios error messages', () => {
  test('redacts a key=value secret embedded in an error message', () => {
    const msg = sanitizeErrorMessage('Request failed: url=https://api.adzuna.com/search?app_key=real-secret&what=dev');
    expect(msg).not.toContain('real-secret');
  });

  test('leaves an ordinary error message unchanged', () => {
    expect(sanitizeErrorMessage('timeout of 10000ms exceeded')).toBe('timeout of 10000ms exceeded');
  });

  test('caps very long messages', () => {
    const long = 'x'.repeat(2000);
    expect(sanitizeErrorMessage(long).length).toBeLessThan(600);
  });

  test('handles null/undefined without throwing', () => {
    expect(sanitizeErrorMessage(null)).toBeNull();
    expect(sanitizeErrorMessage(undefined)).toBeUndefined();
  });
});
