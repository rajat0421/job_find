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

/**
 * Finds-or-creates a Job for one observed posting from a fetch cycle.
 *
 * Identity resolution, in order:
 *   1. Exact match on {source, sourceBoard, sourceJobId} — the most reliable
 *      signal when a provider exposes a stable ID. Found → refresh mutable
 *      fields in place (the same ID can be re-edited by the employer) and mark
 *      it seen. Never creates a duplicate for a posting we already track by ID.
 *   2. Fallback: the existing cross-source `hash` fingerprint (md5 of
 *      title-company-location) — but ONLY against docs that don't already have
 *      their own confirmed sourceJobId within this exact source+board. This is
 *      what preserves today's cross-source dedup (the same vacancy appearing on
 *      Adzuna AND a company's own ATS board collapses to one Job) while still
 *      letting two genuinely distinct postings that happen to share an
 *      identical title/company/location be told apart whenever stable IDs are
 *      available for both.
 *   3. Neither matches → genuinely new posting.
 *
 * When matched by sourceJobId, fields are overwritten — the posting may have
 * changed title/location/description/link — but NOT lastSeenAt/status/
 * missingScans if this is actually a cross-source confirmation (see the hash
 * branch below for why). When matched only by hash (effectively a different
 * source's existing doc for what looks like the same role), fields are left
 * untouched to avoid one source's data clobbering another's; only lastSeenAt
 * is bumped — status/missingScans are deliberately NOT touched here (see
 * Improvement 3 Issue B: a cross-source confirmation must not reset or mask
 * the primary source's own missing-scan count, or it could never close a
 * posting its own authoritative board has actually removed; conversely it
 * must not resurrect a posting that board has already closed).
 */
const observeJob = async ({ source, sourceBoard = null, sourceJobId = null, hash, fields }) => {
  const now = new Date();

  if (sourceJobId) {
    const byId = await Job.findOne({ source, sourceBoard, sourceJobId });
    if (byId) {
      const storedHash = await resolveStorableHash({ hash, excludeId: byId._id, source, sourceBoard, sourceJobId });

      // Improvement 5: only flag this job for rematching when a field that
      // actually feeds scoring changed (title/description/location/
      // workplaceType/salary/status) — NOT for a routine "still alive"
      // re-observation where nothing scoring-relevant moved. Comparing against
      // the job's state as it already exists in the DB (not just overwriting
      // blindly) is what keeps this cheap and correct.
      const oldFingerprint = computeJobFingerprint(byId);
      const newFingerprint = computeJobFingerprint({ ...fields, status: 'active' });
      const contentChanged = oldFingerprint !== newFingerprint;
      const set = { ...fields, hash: storedHash, lastSeenAt: now, status: 'active', missingScans: 0 };
      if (contentChanged) set.needsMatching = true;

      // `updated` (Improvement 9 audit fix) reuses this same fingerprint
      // comparison the needsMatching flag already relied on — this is the
      // "a scoring-relevant field actually changed" signal, not just "we saw
      // this job again" (a routine re-observation with no content change
      // reports updated:false, exactly like needsMatching staying false).
      // Only true if the write actually succeeded — a failed write updated
      // nothing, regardless of what the comparison found.
      try {
        await Job.updateOne({ _id: byId._id }, { $set: set });
      } catch (err) {
        console.warn(`[JobLifecycle] Failed to update observed job ${byId._id}:`, err.message);
        return { created: false, updated: false };
      }
      return { created: false, updated: contentChanged };
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
