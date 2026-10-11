const zlib = require('zlib');
const UpstreamTrace = require('../models/UpstreamTrace');
const TraceStorageStats = require('../models/TraceStorageStats');
const { redactRequest, redactResponse } = require('./traceRedaction.service');
const { positiveIntFromEnv } = require('./envValidation.service');

// Configurable, documented defaults (Phase 5). All validated against the
// actual payload shapes seen in production: the real captured Greenhouse
// response used elsewhere in this codebase for regression tests
// (test-utils/fixtures/greenhouse-okta-7882676.raw.json) is ~9KB for ONE
// job; a full board listing of ~380 jobs at a similar size would be roughly
// 3-4MB of JSON, comfortably under the 5MB per-body cap with headroom for
// larger boards. Gzip on JSON text typically yields 70-90% reduction, so a
// 5MB JSON body compresses to well under 1MB in the common case — safely
// inside MongoDB's 16MB hard document-size limit even before accounting for
// the rest of the trace document's (small) metadata fields.
const MAX_BODY_BYTES = positiveIntFromEnv('TRACE_MAX_BODY_BYTES', 5 * 1024 * 1024); // 5 MiB
const MAX_RECORDS = positiveIntFromEnv('TRACE_MAX_RECORDS', 5000);
const STORAGE_BUDGET_BYTES = positiveIntFromEnv('TRACE_STORAGE_BUDGET_BYTES', 200 * 1024 * 1024); // 200 MiB
// TRACE_RETENTION_DAYS is read directly by models/UpstreamTrace.js for the
// TTL index value (index options are fixed at schema-definition time, so it
// can't be re-read per call) — exported here too so one place documents it.
const RETENTION_DAYS = positiveIntFromEnv('TRACE_RETENTION_DAYS', 7);

// Bounds how many old records a single prune pass will delete — pruning runs
// inline after a trace write that pushes totals over budget, so this must
// stay small and fast, never a full-collection cleanup sweep.
const MAX_PRUNE_PER_PASS = 100;

// How often a full reconciliation against the real collection is allowed to
// run (see reconcileIfDue below). The running $inc/$dec counter in
// TraceStorageStats is a soft, best-effort figure — it cannot see MongoDB's
// own background TTL deletions at all (those happen entirely outside this
// service's code, on mongod's own schedule), and a process crash between an
// insert/delete and its corresponding counter update leaves the counter
// permanently off by that amount. This bounds how long such drift can
// persist before it's corrected, without re-aggregating the collection on
// every single write.
const RECONCILE_INTERVAL_MS = positiveIntFromEnv('TRACE_RECONCILE_INTERVAL_MS', 60 * 60 * 1000); // 1 hour

// Recognizes the job-list shape of each provider's response generically
// (Greenhouse/Ashby: {jobs:[...]}, Lever: a bare array, Adzuna: {results:[...]})
// without needing provider-specific parsing here — this is what lets oversized
// responses be truncated to a bounded, still-useful subset of real job
// objects instead of being dropped outright or cut as an arbitrary string.
const extractJobList = (body) => {
  if (Array.isArray(body)) return { list: body, wrapperKey: null, bareArray: true };
  if (body && Array.isArray(body.jobs)) return { list: body.jobs, wrapperKey: 'jobs', bareArray: false };
  if (body && Array.isArray(body.results)) return { list: body.results, wrapperKey: 'results', bareArray: false };
  return { list: null, wrapperKey: null, bareArray: false };
};

// Decides how (or whether) to retain a redacted response body, enforcing the
// per-body size cap. Never returns a body that would, on its own, make
// MongoDB's document-size limit a risk (see MAX_BODY_BYTES's margin above).
const buildBodyCapture = (redactedBody) => {
  if (redactedBody == null) {
    return { status: 'none', gzip: null, originalSize: null, storedSize: null, isArray: false, itemCount: null, omittedReason: null };
  }

  let json;
  try {
    json = JSON.stringify(redactedBody);
  } catch (err) {
    return { status: 'omitted', gzip: null, originalSize: null, storedSize: null, isArray: false, itemCount: null, omittedReason: 'not_serializable' };
  }

  const originalSize = Buffer.byteLength(json, 'utf8');
  const { list, wrapperKey, bareArray } = extractJobList(redactedBody);
  const isArray = Array.isArray(redactedBody);
  const itemCount = list ? list.length : null;

  if (originalSize <= MAX_BODY_BYTES) {
    const gzip = zlib.gzipSync(json);
    return { status: 'complete', gzip, originalSize, storedSize: gzip.length, isArray, itemCount, omittedReason: null };
  }

  // Oversized. If it's a recognizable job list, keep a bounded, EXPLICITLY
  // marked-partial subset of real job objects rather than an arbitrary
  // string cut (which could produce invalid JSON) or dropping it entirely.
  if (list) {
    const kept = [];
    let runningSize = 128; // rough allowance for the wrapper/marker fields below
    for (const item of list) {
      let itemSize;
      try {
        itemSize = Buffer.byteLength(JSON.stringify(item), 'utf8');
      } catch {
        continue; // skip an unserializable item rather than aborting the whole capture
      }
      if (runningSize + itemSize > MAX_BODY_BYTES) break;
      kept.push(item);
      runningSize += itemSize;
    }

    // Always a valid, self-describing JSON document — `_truncated: true` and
    // the before/after counts make it unmistakable that this is a partial
    // capture, never presentable as the complete original response.
    const truncatedWrapper = bareArray
      ? { _truncated: true, _originalCount: list.length, _keptCount: kept.length, items: kept }
      : { ...redactedBody, [wrapperKey]: kept, _truncated: true, _originalCount: list.length, _keptCount: kept.length };

    const truncatedJson = JSON.stringify(truncatedWrapper);
    const gzip = zlib.gzipSync(truncatedJson);
    return { status: 'truncated', gzip, originalSize, storedSize: gzip.length, isArray, itemCount, omittedReason: 'exceeds_max_body_size' };
  }

  // Not a recognizable list shape and too large to keep whole — metadata
  // only; still useful for correlating that this request happened, just
  // without the body content.
  return { status: 'omitted', gzip: null, originalSize, storedSize: 0, isArray, itemCount, omittedReason: 'exceeds_max_body_size' };
};

// Deletes the oldest records (by requestedAt) until both the record-count and
// storage-budget limits are satisfied, or until MAX_PRUNE_PER_PASS records
// have been removed this call — bounded so a single trace write can never
// trigger an unbounded cleanup sweep.
//
// Safe under a concurrent writer doing the same thing: both could read the
// same "oldest" doc before either deletes it, but only ONE `deleteOne` call
// actually removes it (MongoDB guarantees that) — `deletedCount` is checked
// before decrementing the counter specifically so the LOSING side of that
// race never double-decrements for a deletion that didn't actually happen in
// ITS call. Without this check, every such race would silently under-count
// the real total (making the budget look like it has more room than it
// does) — this was verified as a real gap, not a hypothetical one, and is
// exactly the kind of drift reconcileIfDue (below) also exists to bound.
const pruneIfNeeded = async () => {
  let stats = await TraceStorageStats.findById('singleton').lean();
  if (!stats) return;

  let attempts = 0;
  while (
    attempts < MAX_PRUNE_PER_PASS &&
    (stats.totalRecords > MAX_RECORDS || stats.totalStoredBytes > STORAGE_BUDGET_BYTES)
  ) {
    attempts += 1;
    const oldest = await UpstreamTrace.findOne({}).sort({ requestedAt: 1 }).select('_id bodyStoredSize').lean();
    if (!oldest) break;

    const result = await UpstreamTrace.deleteOne({ _id: oldest._id });
    if (result.deletedCount !== 1) {
      // Lost the race — another process already deleted this exact doc.
      // Re-read the real counter instead of guessing, so the loop's
      // continue/stop decision reflects ground truth, not a stale estimate.
      stats = await TraceStorageStats.findById('singleton').lean() || stats;
      continue;
    }

    const freedBytes = oldest.bodyStoredSize || 0;
    await TraceStorageStats.updateOne(
      { _id: 'singleton' },
      { $inc: { totalRecords: -1, totalStoredBytes: -freedBytes } }
    );
    stats = { ...stats, totalRecords: stats.totalRecords - 1, totalStoredBytes: stats.totalStoredBytes - freedBytes };
  }
};

// Recomputes the real totals from the collection itself and OVERWRITES the
// counter (not an increment) — the ground-truth correction for whatever
// per-write tracking can't see. The collection is itself bounded to
// MAX_RECORDS by pruneIfNeeded, so this aggregation is cheap even though it
// touches every document — it is NOT run on every write (see
// RECONCILE_INTERVAL_MS / reconcileIfDue).
const reconcileStorageStats = async () => {
  const [agg] = await UpstreamTrace.aggregate([
    { $group: { _id: null, totalRecords: { $sum: 1 }, totalStoredBytes: { $sum: { $ifNull: ['$bodyStoredSize', 0] } } } },
  ]);
  const totalRecords = agg?.totalRecords || 0;
  const totalStoredBytes = agg?.totalStoredBytes || 0;
  await TraceStorageStats.updateOne(
    { _id: 'singleton' },
    { $set: { totalRecords, totalStoredBytes, lastReconciledAt: new Date() } },
    { upsert: true }
  );
  return { totalRecords, totalStoredBytes };
};

// Opportunistically triggers reconcileStorageStats, but only if the last one
// was more than RECONCILE_INTERVAL_MS ago (or never happened) — keeping the
// cost of ground-truth correction off the hot path of every single trace
// write, while still bounding how long counter drift can persist.
const reconcileIfDue = async () => {
  const stats = await TraceStorageStats.findById('singleton').lean();
  const sinceLast = stats?.lastReconciledAt ? Date.now() - new Date(stats.lastReconciledAt).getTime() : Infinity;
  if (sinceLast < RECONCILE_INTERVAL_MS) return;
  await reconcileStorageStats();
};

// The main entry point, called from services/httpClient.service.js for every
// upstream ingestion request (success or failure). Never throws — a failure
// here must never break a successful (or failed) upstream fetch; the caller
// doesn't even need to await this if it doesn't want the write to block
// anything (see httpClient.service.js for how it's actually invoked).
const recordTrace = async (trace) => {
  try {
    const redactedReq = redactRequest({ url: trace.url, params: trace.params, headers: trace.requestHeaders, body: trace.requestBody });
    const redactedRes = redactResponse({ headers: trace.responseHeaders, body: trace.responseBody });
    const bodyCapture = buildBodyCapture(redactedRes.body);

    await UpstreamTrace.create({
      traceId: trace.traceId,
      provider: trace.provider,
      operation: trace.operation,
      boardToken: trace.boardToken ?? null,
      method: trace.method || 'GET',
      url: redactedReq.url,
      requestHeaders: redactedReq.headers,
      requestBody: redactedReq.body,
      requestedAt: trace.requestedAt,
      success: trace.success,
      statusCode: trace.statusCode ?? null,
      durationMs: trace.durationMs,
      retries: trace.retries || 0,
      respondedAt: trace.respondedAt ?? null,
      responseHeaders: redactedRes.headers,
      errorKind: trace.errorKind ?? null,
      errorMessage: trace.errorMessage ?? null,
      bodyCaptureStatus: bodyCapture.status,
      bodyOmittedReason: bodyCapture.omittedReason,
      bodyOriginalSize: bodyCapture.originalSize,
      bodyStoredSize: bodyCapture.storedSize,
      bodyGzip: bodyCapture.gzip,
      bodyIsArray: bodyCapture.isArray,
      bodyItemCount: bodyCapture.itemCount,
    });

    await TraceStorageStats.updateOne(
      { _id: 'singleton' },
      { $inc: { totalRecords: 1, totalStoredBytes: bodyCapture.storedSize || 0 } },
      { upsert: true }
    );

    await pruneIfNeeded();
    await reconcileIfDue();
  } catch (err) {
    // Logging failure must never surface as an ingestion failure — see the
    // module comment. Sanitized message only; never the raw trace payload.
    console.error('[TraceStorage] Failed to record upstream trace:', err.message);
  }
};

// Decompresses and parses a stored trace's body for the admin viewer. Returns
// null if there's no body to decompress (status 'none'/'omitted') — callers
// should check `bodyCaptureStatus` first rather than relying on this to
// signal that distinction.
const decompressBody = (upstreamTrace) => {
  if (!upstreamTrace?.bodyGzip) return null;
  try {
    // A Buffer field read back via `.lean()` can come back as a BSON Binary
    // wrapper rather than a native Buffer, depending on the driver version —
    // normalize to a real Buffer before handing it to zlib either way.
    const raw = upstreamTrace.bodyGzip;
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw.buffer ?? raw);
    const json = zlib.gunzipSync(buf).toString('utf8');
    return JSON.parse(json);
  } catch (err) {
    console.error('[TraceStorage] Failed to decompress trace body:', err.message);
    return null;
  }
};

module.exports = {
  recordTrace,
  decompressBody,
  pruneIfNeeded,
  reconcileStorageStats,
  reconcileIfDue,
  buildBodyCapture, // exported for focused unit testing
  extractJobList,
  MAX_BODY_BYTES,
  MAX_RECORDS,
  STORAGE_BUDGET_BYTES,
  RETENTION_DAYS,
  MAX_PRUNE_PER_PASS,
  RECONCILE_INTERVAL_MS,
};
