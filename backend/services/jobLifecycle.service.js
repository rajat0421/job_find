const Job = require('../models/Job');
const { computeJobFingerprint } = require('./jobMatcher.service');

// How many consecutive COMPLETE, trustworthy scans of a posting's own board must
// miss it before it's marked closed. Configurable via env for tuning without a
// code change; defaults to 3 (~3 hours at the current hourly cadence).
const MISSING_SCAN_THRESHOLD = Number(process.env.JOB_MISSING_SCAN_THRESHOLD) || 3;

// Age-based fallback: a posting unseen for this many days is marked expired,
// regardless of source. This is the ONLY lifecycle mechanism available for
// Adzuna (see platforms/adzuna.js) and a safety net for every other source.
const EXPIRY_AGE_DAYS = Number(process.env.JOB_EXPIRY_AGE_DAYS) || 45;

// `hash` carries two jobs that turn out to conflict once stable IDs are in play:
// (1) it's the cross-source dedup fingerprint used by the hash-fallback lookup
// below, and (2) it's uniquely indexed in the schema. Two DISTINCT postings
// (different confirmed sourceJobIds) can legitimately share an identical
// title+company+location fingerprint — without disambiguation, inserting the
// second one as-is throws a real MongoDB duplicate-key error (E11000) on the
// unique `hash` index, which observeJob's own catch block swallows, silently
// DROPPING that second posting rather than tracking it. This was verified
// against a real (disposable) MongoDB instance, not just an in-memory fake —
// see services/__tests__/jobLifecycle.realDb.test.js.
//
// Fix: when the canonical hash is already held by a DIFFERENT doc, store a
// disambiguated variant (suffixed with this posting's own stable identity)
// instead of the raw hash for THIS doc only. The canonical, undisambiguated
// hash value continues to resolve to exactly one "representative" doc via the
// plain hash-fallback query below, so cross-source dedup for providers without
// a stable ID is completely unaffected — they still collapse onto that one
// representative doc exactly as before. The disambiguated doc remains
// perfectly reachable on every future fetch via its own sourceJobId (checked
// first, above the hash-fallback path), so it never needs the canonical hash
// to be found again. A disambiguated hash can only collide with another
// disambiguated hash if source+sourceBoard+sourceJobId AND the raw hash are
// all identical — which is already excluded by the sourceJobId lookup finding
// it directly instead.
const resolveStorableHash = async ({ hash, excludeId, source, sourceBoard, sourceJobId }) => {
  const collisionQuery = excludeId ? { hash, _id: { $ne: excludeId } } : { hash };
  const collision = await Job.findOne(collisionQuery).select('_id');
  if (!collision) return hash;
  if (!sourceJobId) return hash; // nothing to disambiguate with — same residual risk the old hash-only flow always had
  return `${hash}::${source}:${sourceBoard || ''}:${sourceJobId}`;
};

// Fields a provider can report for one posting, and that are safe to merge
// into an existing document. Deliberately excludes `salaryMin`/`salaryMax` —
// no provider currently supplies values reliable enough to risk them here
// (see greenhouse.js's comment on why Greenhouse's per-company custom
// metadata fields aren't parsed), but the allow-list keeps this future-proof
// if that ever changes.
const MERGEABLE_FIELDS = ['title', 'company', 'location', 'salaryMin', 'salaryMax', 'description', 'applyLink', 'postedAt', 'sourceUpdatedAt', 'workplaceType', 'country'];

// A provider's fetch for one posting can under-report a field it normally
// provides (a transient API hiccup, a field the posting's own employer left
// blank this one time) — e.g. Greenhouse's `first_published` being briefly
// absent must never erase a previously-recorded `postedAt`. Stripping out
// null/undefined/'' here, rather than blindly spreading the provider's raw
// `fields` into `$set`, is what prevents that: a field simply isn't part of
// the update at all when the provider didn't actually supply it this time.
// This is intentionally conservative — no existing business rule asks for
// "provider removed this value" to mean "clear it," so we never do that here.
const sanitizeFields = (fields = {}) => {
  const out = {};
  for (const key of MERGEABLE_FIELDS) {
    const value = fields[key];
    if (value === null || value === undefined || value === '') continue;
    out[key] = value;
  }
  return out;
};

// Fingerprint of the document state that would ACTUALLY exist after writing
// `sanitized` on top of `existing` — not just `sanitized` alone. Needed
// because sanitizeFields may omit a field entirely (provider didn't supply
// it this time), in which case the resulting document keeps `existing`'s own
// value for that field, and the fingerprint comparison must reflect that, or
// a routine fetch with one missing-but-unchanged field would look like a
// content change and wastefully flag needsMatching.
const FINGERPRINT_FIELDS = ['title', 'description', 'location', 'workplaceType', 'salaryMin', 'salaryMax'];
const projectedFingerprint = (existing, sanitized) => {
  const projected = { status: 'active' };
  for (const key of FINGERPRINT_FIELDS) {
    projected[key] = key in sanitized ? sanitized[key] : existing[key];
  }
  return computeJobFingerprint(projected);
};

// Shared by the by-ID match and the legacy-hash-upgrade match below — both
// cases have "confidently identified an existing document that should now be
// treated as this exact posting," and both need the identical refresh
// policy: recompute the storable hash, only flag needsMatching when a
// scoring-relevant field actually changes, reactivate/reset the lifecycle
// counters (the same ID being re-observed means it's alive again by
// definition), and never touch `firstSeenAt` — this document's real history
// predates this particular write.
const applyIdentifiedUpdate = async ({ existing, fields, hash, source, sourceBoard, sourceJobId, now }) => {
  const sanitized = sanitizeFields(fields);
  const storedHash = await resolveStorableHash({ hash, excludeId: existing._id, source, sourceBoard, sourceJobId });
  const contentChanged = computeJobFingerprint(existing) !== projectedFingerprint(existing, sanitized);

  const set = { ...sanitized, source, sourceBoard, sourceJobId, hash: storedHash, lastSeenAt: now, status: 'active', missingScans: 0 };
  if (contentChanged) set.needsMatching = true;

  try {
    await Job.updateOne({ _id: existing._id }, { $set: set });
  } catch (err) {
    console.warn(`[JobLifecycle] Failed to update observed job ${existing._id}:`, err.message);
    return { created: false, updated: false };
  }
  return { created: false, updated: contentChanged };
};

/**
 * Finds-or-creates a Job for one observed posting from a fetch cycle.
 *
 * Identity resolution, in order:
 *   1. Exact match on {source, sourceBoard, sourceJobId} — the most reliable
 *      signal when a provider exposes a stable ID. Found → refresh mutable
 *      fields in place (the same ID can be re-edited by the employer) and mark
 *      it seen. Never creates a duplicate for a posting we already track by ID.
 *   2. Legacy upgrade: a document that predates sourceJobId tracking entirely
 *      (created before this feature shipped, so it has no sourceJobId at
 *      all) but whose canonical hash, source, and board all match exactly
 *      what this fetch just observed. This is treated with the SAME
 *      confidence as #1 — not a cross-source guess — because `hash` is
 *      uniquely indexed, so at most one document can hold it; matching on
 *      hash + this exact source + this exact board is strictly MORE specific
 *      than the plain by-ID lookup would need, just missing the ID itself.
 *      The match upgrades that same document in place (stable Mongo _id
 *      preserved, no new document created) by writing its sourceJobId/
 *      sourceBoard for the first time and refreshing content fields — fixing
 *      the previous behavior where such a document could only ever be found
 *      via the hash-fallback below, which deliberately never refreshes
 *      content (see #3), leaving it permanently stale.
 *   3. Fallback: the existing cross-source `hash` fingerprint (md5 of
 *      title-company-location) — but ONLY against docs that don't already have
 *      their own confirmed sourceJobId within this exact source+board. This is
 *      what preserves today's cross-source dedup (the same vacancy appearing on
 *      Adzuna AND a company's own ATS board collapses to one Job) while still
 *      letting two genuinely distinct postings that happen to share an
 *      identical title/company/location be told apart whenever stable IDs are
 *      available for both.
 *   4. Neither matches → genuinely new posting.
 *
 * When matched by sourceJobId or upgraded from a legacy hash match (#1/#2),
 * fields are refreshed (see sanitizeFields — missing/null incoming values
 * never erase a previously-stored one) — but NOT lastSeenAt/status/
 * missingScans if this is actually a cross-source confirmation (see the hash
 * branch below for why). When matched only by hash across a DIFFERENT source
 * or board (#3), fields are left untouched to avoid one source's data
 * clobbering another's; only lastSeenAt is bumped — status/missingScans are
 * deliberately NOT touched here (see Improvement 3 Issue B: a cross-source
 * confirmation must not reset or mask the primary source's own missing-scan
 * count, or it could never close a posting its own authoritative board has
 * actually removed; conversely it must not resurrect a posting that board
 * has already closed).
 */
const observeJob = async ({ source, sourceBoard = null, sourceJobId = null, hash, fields }) => {
  const now = new Date();

  if (sourceJobId) {
    const byId = await Job.findOne({ source, sourceBoard, sourceJobId });
    if (byId) {
      return applyIdentifiedUpdate({ existing: byId, fields, hash, source, sourceBoard, sourceJobId, now });
    }

    // Legacy upgrade — see case #2 above. Intentionally does NOT also require
    // the raw `hash` to be free of any OTHER document's claim (resolveStorableHash
    // already handles the extremely rare case where a different doc holds this
    // exact hash by disambiguating instead of colliding), only that THIS
    // candidate itself has no sourceJobId yet and matches on source + board.
    const legacyMatch = await Job.findOne({
      hash,
      source,
      sourceJobId: null,
      $or: [{ sourceBoard }, { sourceBoard: null }],
    });
    if (legacyMatch) {
      return applyIdentifiedUpdate({ existing: legacyMatch, fields, hash, source, sourceBoard, sourceJobId, now });
    }
  }

  const hashQuery = sourceJobId
    ? {
        hash,
        $or: [
          { sourceJobId: null },
          { sourceJobId: { $exists: false } },
          { source: { $ne: source } },
          { sourceBoard: { $ne: sourceBoard } },
        ],
      }
    : { hash };

  const byHash = await Job.findOne(hashQuery);
  if (byHash) {
    // Cross-source (or ID-less) confirmation only — just mark it still alive.
    // Not touching status/missingScans here is the fix for Issue B: this must
    // never reset a counter another source's own sweep is relying on, and
    // must never override a closure decision an authoritative board already made.
    await Job.updateOne({ _id: byHash._id }, { $set: { lastSeenAt: now } });
    return { created: false, updated: false }; // a liveness confirmation only — no content field is ever touched here
  }

  // Note: NOT sanitizeFields here — sanitizing exists to stop a missing/null
  // incoming value from erasing a PREVIOUSLY-STORED good one, which only
  // applies to updating an existing doc. A brand-new doc has nothing to
  // erase, so a provider's genuine `null` (e.g. Ashby's intentionally
  // unparsed salary) is stored as-is, exactly as before this change.
  const storedHash = await resolveStorableHash({ hash, excludeId: null, source, sourceBoard, sourceJobId });
  try {
    await Job.create({
      ...fields,
      source,
      sourceBoard,
      sourceJobId,
      hash: storedHash,
      firstSeenAt: now,
      lastSeenAt: now,
      status: 'active',
      missingScans: 0,
    });
    return { created: true, updated: false };
  } catch (err) {
    // Race with a concurrent fetch inserting the same hash first — the same
    // tolerance the old hash-only flow always relied on.
    console.warn(`[JobLifecycle] Failed to create observed job (hash=${hash}):`, err.message);
    return { created: false, updated: false };
  }
};

/**
 * Marks postings from one specific (source, board) scan as missing when a
 * COMPLETE, trustworthy scan of that board did not observe them.
 *
 * Only call this for providers whose fetch is a full current snapshot of a
 * board (Greenhouse, Lever, Ashby) — NEVER for Adzuna, whose fetch is a
 * limited keyword/category search and can never prove a specific job is gone.
 * The caller is responsible for not invoking this when the scan failed, timed
 * out, or came back suspiciously/unverifiably empty.
 *
 * Conservative by design: only increments missingScans for previously-active
 * jobs not present in `observedSourceJobIds`; a job is only closed after
 * MISSING_SCAN_THRESHOLD consecutive misses. Never deletes anything.
 */
const sweepMissingJobs = async ({ source, sourceBoard = null, observedSourceJobIds = [] }) => {
  const candidates = await Job.find({
    source,
    sourceBoard,
    sourceJobId: { $ne: null },
    status: 'active',
  }).select('_id sourceJobId missingScans');

  const observed = new Set(observedSourceJobIds);
  const missing = candidates.filter((j) => !observed.has(j.sourceJobId));
  if (!missing.length) return { missing: 0, closed: 0 };

  let closed = 0;
  for (const job of missing) {
    const missingScans = (job.missingScans || 0) + 1;
    const update = { missingScans };
    if (missingScans >= MISSING_SCAN_THRESHOLD) {
      update.status = 'closed';
      closed++;
    }
    await Job.updateOne({ _id: job._id }, { $set: update });
  }
  return { missing: missing.length, closed };
};

/**
 * Age-based expiry fallback. A posting still marked 'active' but not confirmed
 * seen in EXPIRY_AGE_DAYS is marked 'expired'. Never deletes records — only
 * flips status, so historical saved/applied views are unaffected.
 */
const expireStaleJobs = async () => {
  const cutoff = new Date(Date.now() - EXPIRY_AGE_DAYS * 24 * 60 * 60 * 1000);
  const result = await Job.updateMany(
    { status: 'active', lastSeenAt: { $lt: cutoff } },
    { $set: { status: 'expired' } }
  );
  return result.modifiedCount || 0;
};

module.exports = {
  observeJob,
  sweepMissingJobs,
  expireStaleJobs,
  MISSING_SCAN_THRESHOLD,
  EXPIRY_AGE_DAYS,
};
