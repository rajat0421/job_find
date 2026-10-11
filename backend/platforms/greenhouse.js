const crypto = require('crypto');
const { observeJob, sweepMissingJobs } = require('../services/jobLifecycle.service');
const { getWithRetry, classifyError } = require('../services/httpClient.service');
const { createProviderDeadline } = require('../services/fetchBudget.service');

const generateJobHash = (title, company, location) =>
  crypto.createHash('md5').update(`${title}-${company}-${location}`).digest('hex');

// Board tokens are managed in the Company collection (admin portal), with the
// greenhouseBoards.json list as a seed/fallback. Find a token at:
// https://boards.greenhouse.io/<board_token>
const { getCompanies } = require('../services/companies.service');
const BOARDS = require('../data/greenhouseBoards.json'); // legacy export for admin live-test compatibility

// Named entities actually seen in job-posting HTML (quotes, dashes, spacing,
// a handful of accented Latin letters) — deliberately a small, bounded table
// rather than the full HTML5 named-entity list (2000+ entries), since numeric
// entities (&#39; / &#x27;) are handled generically below and cover virtually
// everything else. Keeping this self-contained avoids adding a dependency
// for what is, in practice, a short, stable list (see stripHtml's own comment).
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  mdash: '—', ndash: '–', hellip: '…',
  copy: '©', reg: '®', trade: '™',
  eacute: 'é', egrave: 'è', agrave: 'à', auml: 'ä',
  ouml: 'ö', uuml: 'ü', ccedil: 'ç', ntilde: 'ñ',
};

const ENTITY_RE = /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g;

const decodeEntitiesOnce = (str) => str.replace(ENTITY_RE, (full, body) => {
  if (body[0] === '#') {
    const isHex = body[1] === 'x' || body[1] === 'X';
    const codePoint = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
    if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return full;
    try { return String.fromCodePoint(codePoint); } catch { return full; }
  }
  const lower = body.toLowerCase();
  return lower in NAMED_ENTITIES ? NAMED_ENTITIES[lower] : full;
});

// Greenhouse's `content` field can arrive with its own HTML tags
// entity-escaped — a literal "&lt;p&gt;" instead of "<p>" — verified against
// a real captured response (see test-utils/fixtures/greenhouse-okta-7882676.raw.json).
// The same real response also contains entities that are escaped TWICE over
// (the literal substring "&amp;amp;" for a single "&", and "&amp;nbsp;" for
// a single non-breaking space) — inconsistent, but real. A single decode pass
// only resolves one level, so this repeats (bounded, so adversarial input
// can't loop unboundedly) until a pass changes nothing.
const MAX_DECODE_PASSES = 4;
const decodeEntities = (str) => {
  let out = str;
  for (let i = 0; i < MAX_DECODE_PASSES; i++) {
    const next = decodeEntitiesOnce(out);
    if (next === out) break;
    out = next;
  }
  return out;
};

// Converts Greenhouse's rich-text `content` into readable plain text.
//
// The critical fix: entities are decoded BEFORE tags are stripped, not after.
// The previous order stripped literal "<...>" tag syntax first and decoded
// entities second — which silently did nothing to tags written as escaped
// entities ("&lt;p&gt;"), since there was no literal "<...>" for that first
// regex to find; decoding them afterward then left raw, unstripped "<p>" tags
// sitting in the "plain text" output. Decoding first means both plain HTML
// and entity-escaped HTML go through the exact same tag-stripping pass.
//
// Output never contains a literal "<" or ">" (enforced by the final pass
// below), regardless of how malformed or adversarial the input is — this
// text must stay safe to display even if some future caller ever renders it
// without additional escaping.
const stripHtml = (html) => {
  if (!html) return '';

  let text = decodeEntities(String(html));

  // Links: keep the visible text AND the destination — Greenhouse postings
  // often carry meaningful links (accommodation forms, benefits pages) that
  // would otherwise vanish into unlabeled stripped text.
  text = text.replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
    const cleanLabel = label.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return cleanLabel ? `${cleanLabel} (${href})` : href;
  });

  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<li[^>]*>/gi, '\n- ');
  text = text.replace(/<\/(p|div|ul|ol|h[1-6])>/gi, '\n\n');

  // Everything else (strong/em/span/table cells/...) is presentational only
  // — drop the tag, keep a separating space so two adjacent inline elements
  // never fuse into one word.
  text = text.replace(/<[^>]+>/g, ' ');

  // Defense in depth: never let a stray, unterminated tag (e.g. a truncated
  // "<img src=x onerror=...") survive — this text must never be able to be
  // reinterpreted as markup.
  text = text.replace(/[<>]/g, '');

  return text
    .replace(/[^\S\n]+/g, ' ')   // collapse horizontal whitespace, keep newlines
    .replace(/ *\n */g, '\n')    // trim spaces hugging a newline
    .replace(/\n{3,}/g, '\n\n')  // at most one blank line between sections
    .trim();
};

const Company = require('../models/Company');

// `cycleDeadline` (from fetchBudget.service.js, shared across all four
// providers for one fetch run) is passed in by jobFetcher.service.js. This
// adapter also tracks its own per-provider budget independently.
const fetchJobs = async ({ cycleDeadline } = {}) => {
  let newCount = 0;
  let updatedCount = 0;
  let totalFetched = 0;
  const companies = await getCompanies('greenhouse');

  const providerDeadline = createProviderDeadline();
  const deadlines = [providerDeadline, cycleDeadline].filter(Boolean);

  const stats = { requestsAttempted: 0, requestsFailed: 0, retries: 0 };
  const companiesFailed = [];
  const companiesSkipped = [];
  let budgetExceeded = null;
  let attemptedCount = 0;

  for (let i = 0; i < companies.length; i++) {
    const { _id, name, token } = companies[i];

    // Checked BEFORE starting a new company's request — a company never
    // reached here is never attempted, never counted as scanned, and never
    // fed into sweepMissingJobs. Preserves Improvement 3's lifecycle safety:
    // only a complete, verified scan may trigger missing-job detection.
    if (providerDeadline.expired()) budgetExceeded = 'provider';
    else if (cycleDeadline?.expired()) budgetExceeded = 'cycle';
    if (budgetExceeded) {
      companiesSkipped.push(
        ...companies.slice(i).map((c) => ({ name: c.name || c.token, reason: `${budgetExceeded}_budget_exceeded` }))
      );
      console.warn(`[Greenhouse] ${budgetExceeded} time budget exceeded — skipping ${companies.length - i} remaining board(s) this cycle`);
      break;
    }

    attemptedCount++;
    let fetched = 0;
    stats.requestsAttempted++;
    try {
      const res = await getWithRetry(
        `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
        { timeout: 8000 },
        stats,
        deadlines
      );

      const jobs = res.data?.jobs || [];
      fetched = jobs.length;
      totalFetched += fetched;
      const company = name || (token.charAt(0).toUpperCase() + token.slice(1));

      // Greenhouse's job board API returns a complete current snapshot of this
      // board's open postings (no pagination) — so, once we're sure this scan
      // actually succeeded and wasn't suspiciously empty, absence from it is a
      // meaningful (though still grace-windowed) signal a posting may have closed.
      const observedIds = [];
      for (const j of jobs) {
        const sourceJobId = j.id != null ? String(j.id) : null;
        if (sourceJobId) observedIds.push(sourceJobId); // record as "seen" even if later fields are incomplete

        const title = j.title || '';
        const location = j.location?.name || '';
        const hash = generateJobHash(title, company, location);

        const { created, updated } = await observeJob({
          source: 'greenhouse',
          sourceBoard: token,
          sourceJobId,
          hash,
          fields: {
            title,
            company,
            location,
            // Greenhouse's per-company `metadata` array CAN carry custom
            // "Minimum/Maximum Salary" or "Work Experience" fields (observed
            // directly in a real captured response — see the fixture noted
            // above), but these are per-company custom form fields, not a
            // guaranteed Greenhouse schema: field names vary by company, and
            // even where the field exists its value is very often null (also
            // observed directly). Parsing company-specific custom field names
            // risks silently wrong or inconsistent salary data feeding real
            // matching for an unpredictable subset of companies, for a signal
            // that's rarely populated even where it exists. Left unmapped —
            // a deliberate decision, not an oversight.
            salaryMin: null,
            salaryMax: null,
            description: stripHtml(j.content),
            applyLink: j.absolute_url,
            // `postedAt` = when this posting first went live; `sourceUpdatedAt`
            // = when Greenhouse says it was last edited. These are genuinely
            // different timestamps (e.g. a 2026-06 posting last edited in
            // 2026-09 has first_published in June, updated_at in September) —
            // using updated_at for postedAt made every edited posting look
            // freshly-posted, which is what the old code did.
            postedAt: j.first_published ? new Date(j.first_published) : null,
            sourceUpdatedAt: j.updated_at ? new Date(j.updated_at) : null,
          },
        });
        if (created) newCount++;
        else if (updated) updatedCount++;
      }

      if (_id) await Company.updateOne({ _id }, { lastFetchedAt: new Date(), lastJobCount: fetched });

      // "fetched > 0" guards against an empty-but-unverified response (board API
      // glitch returning a valid-but-empty payload) being mistaken for "this
      // company now has zero open jobs" — see Improvement 3's lifecycle rules.
      // This only runs when the request above actually succeeded (including
      // after any internal retries) — a failed/exhausted request throws and is
      // handled in the catch block below, which never runs the sweep.
      if (fetched > 0) {
        await sweepMissingJobs({ source: 'greenhouse', sourceBoard: token, observedSourceJobIds: observedIds });
      }
    } catch (err) {
      // Board token might be wrong, company removed it, or the request failed
      // even after bounded retries — skip silently. Crucially: never run
      // missing-detection for a failed scan. Reason is classified, not the raw
      // error, so nothing sensitive ever lands in FetchRun or logs.
      const reason = classifyError(err);
      stats.requestsFailed++;
      companiesFailed.push({ name: name || token, reason });
      console.warn(`[Greenhouse] Skipped ${token}: ${reason}`);
      if (_id) await Company.updateOne({ _id }, { lastFetchedAt: new Date(), lastJobCount: 0 });
    }
  }

  return {
    added: newCount,
    updated: updatedCount,
    fetched: totalFetched,
    companiesAttempted: attemptedCount,
    companiesFailed,
    companiesSkipped,
    budgetExceeded,
    requestsAttempted: stats.requestsAttempted,
    requestsFailed: stats.requestsFailed,
    retries: stats.retries,
  };
};

module.exports = { fetchJobs, BOARDS, stripHtml };
