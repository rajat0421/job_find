// Regression coverage for stripHtml's entity-decode-before-tag-strip fix.
//
// Root cause this guards against: the old implementation stripped literal
// "<...>" tag syntax BEFORE decoding HTML entities. Greenhouse's `content`
// field can arrive with its own tags entity-escaped (a literal "&lt;p&gt;",
// not "<p>") — verified directly against a real captured response (see
// test-utils/fixtures/greenhouse-okta-7882676.raw.json, fetched read-only
// from https://boards-api.greenhouse.io/v1/boards/okta/jobs/7882676 while
// tracing a real stored job during a prior investigation). Against that
// shape, the old tag-stripping regex found nothing to strip (no literal
// "<...>" existed yet), and decoding entities afterward then revealed raw,
// never-stripped "<p>"/"<div>"/"<li>"/"<a>" tags sitting in what was supposed
// to be plain text.

const { stripHtml } = require('../greenhouse');
const realFixture = require('../../test-utils/fixtures/greenhouse-okta-7882676.raw.json');

describe('ordinary (non-escaped) HTML', () => {
  test('strips literal tags and collapses whitespace', () => {
    expect(stripHtml('<p>Hello <strong>world</strong></p>')).toBe('Hello world');
  });

  test('decodes ordinary entities', () => {
    expect(stripHtml('<p>Tom &amp; Jerry&#39;s &quot;Adventure&quot;</p>')).toBe('Tom & Jerry\'s "Adventure"');
  });
});

describe('HTML-entity-encoded tags (the actual Greenhouse shape)', () => {
  test('a string with encoded <div>, <p>, <li>, and <a> tags becomes readable plain text, not retained markup', () => {
    const encoded =
      '&lt;div&gt;&lt;p&gt;Intro paragraph.&lt;/p&gt;' +
      '&lt;ul&gt;&lt;li&gt;First requirement&lt;/li&gt;&lt;li&gt;Second requirement&lt;/li&gt;&lt;/ul&gt;' +
      '&lt;p&gt;Apply via &lt;a href=&quot;https://example.com/apply&quot;&gt;this link&lt;/a&gt;.&lt;/p&gt;&lt;/div&gt;';

    const out = stripHtml(encoded);

    expect(out).not.toMatch(/[<>]/); // no tag syntax survives at all
    expect(out).toContain('Intro paragraph.');
    expect(out).toContain('- First requirement');
    expect(out).toContain('- Second requirement');
    expect(out).toContain('this link (https://example.com/apply)');
  });

  test('a bare encoded tag with no other markup is fully decoded and stripped', () => {
    expect(stripHtml('&lt;p&gt;Just text&lt;/p&gt;')).toBe('Just text');
  });
});

describe('double-encoded entities (observed directly in real Greenhouse content)', () => {
  test('"&amp;amp;" (a doubly-escaped ampersand) decodes down to a single "&"', () => {
    expect(stripHtml('Applicants &amp;amp; Employees')).toBe('Applicants & Employees');
  });

  test('"&amp;nbsp;" (a doubly-escaped non-breaking space) decodes to a single space, not a literal entity', () => {
    expect(stripHtml('&lt;p&gt;&amp;nbsp;&lt;/p&gt;')).toBe('');
  });

  test('a bounded number of decode passes does not hang on a long chain of escaping', () => {
    const input = '&amp;amp;amp;amp;lt;p&amp;amp;amp;amp;gt;'; // deliberately absurd, not realistic
    expect(() => stripHtml(input)).not.toThrow();
  });
});

describe('structure is preserved as readable plain text', () => {
  test('paragraphs become separate lines/blocks', () => {
    const out = stripHtml('<p>First paragraph.</p><p>Second paragraph.</p>');
    expect(out).toBe('First paragraph.\n\nSecond paragraph.');
  });

  test('line breaks become newlines', () => {
    expect(stripHtml('Line one<br>Line two<br/>Line three')).toBe('Line one\nLine two\nLine three');
  });

  test('list items get a readable bullet prefix', () => {
    const out = stripHtml('<ul><li>Alpha</li><li>Beta</li></ul>');
    expect(out).toContain('- Alpha');
    expect(out).toContain('- Beta');
  });

  test('links keep both their visible text and their destination', () => {
    expect(stripHtml('<a href="https://x.test/form">request form</a>')).toBe('request form (https://x.test/form)');
  });
});

describe('safety: output can never contain tag syntax, even from malformed input', () => {
  test('an unterminated tag is stripped rather than left dangling', () => {
    const out = stripHtml('Before <img src=x onerror=alert(1) After');
    expect(out).not.toMatch(/[<>]/);
  });

  test('a stray, unmatched angle bracket never survives', () => {
    expect(stripHtml('5 < 10 and 10 > 5')).not.toMatch(/[<>]/);
  });
});

describe('null, empty, and malformed inputs', () => {
  test.each([null, undefined, ''])('returns an empty string for %p', (input) => {
    expect(stripHtml(input)).toBe('');
  });

  test('does not throw on malformed/unbalanced markup', () => {
    expect(() => stripHtml('<p><div>unbalanced</p>')).not.toThrow();
  });

  test('handles a very large input without hanging or throwing', () => {
    const big = '<p>' + 'word &amp; more '.repeat(20000) + '</p>'; // ~340KB
    const start = Date.now();
    const out = stripHtml(big);
    expect(Date.now() - start).toBeLessThan(5000);
    expect(out).toContain('word & more');
    expect(out).not.toMatch(/[<>]/);
  });
});

describe('the actual captured Greenhouse response (real fixture, not reconstructed)', () => {
  test('the fixture itself really does contain entity-escaped tags and double-escaped entities (sanity check on the fixture)', () => {
    expect(realFixture.content).toContain('&lt;div');
    expect(realFixture.content).toContain('&amp;amp;');
    expect(realFixture.content).toContain('&amp;nbsp;');
  });

  test('stripping the real content yields readable plain text with no residual markup or entities', () => {
    const out = stripHtml(realFixture.content);

    expect(out).not.toMatch(/<[a-zA-Z/][^>]*>/); // no real tag survives
    expect(out).not.toMatch(/&[a-zA-Z#][a-zA-Z0-9]*;/); // no undecoded entity survives
    expect(out).toContain('Secure Every Identity');
    expect(out).toContain('Applicants & Employees'); // the double-escaped phrase, correctly resolved
    expect(out).toContain("We're all in on this mission. If you are too, let's talk."); // &#39; decoded
    expect(out).toContain('- Work with senior engineering team in major development projects, design and implementation');
  });
});
