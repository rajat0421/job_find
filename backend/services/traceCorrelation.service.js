const Job = require('../models/Job');
const UpstreamTrace = require('../models/UpstreamTrace');

// Best-effort, non-blocking correlation: after a provider adapter finishes
// processing one upstream response, this records which upstream job IDs were
// observed in it and resolves them to the CURRENT internal Job _ids (via the
// same {source, sourceBoard, sourceJobId} index jobLifecycle.service.js's own
// identity resolution already relies on) — so an admin debugging a specific
// job can find its trace starting from either the upstream provider job ID
// or the internal MongoDB Job _id (Phase 4). This is deliberately a SEPARATE,
// AFTER-THE-FACT query rather than threading trace IDs through
// jobLifecycle.service.js itself — it never touches, and can never affect,
// the already-tested identity/upsert logic there.
//
// Never throws — a failure here must never affect ingestion, and runs after
// the Job upserts for this response have already completed, so the
// resultingJobIds lookup reflects this cycle's real, current state.
const correlateTrace = async ({ traceId, source, sourceBoard = null, observedSourceJobIds = [] }) => {
  if (!traceId || !observedSourceJobIds.length) return;
  try {
    const jobs = await Job.find({ source, sourceBoard, sourceJobId: { $in: observedSourceJobIds } })
      .select('_id')
      .lean();
    await UpstreamTrace.updateOne(
      { traceId },
      { $set: { observedSourceJobIds, resultingJobIds: jobs.map((j) => j._id) } }
    );
  } catch (err) {
    console.error(`[TraceCorrelation] Failed to correlate trace ${traceId}:`, err.message);
  }
};

module.exports = { correlateTrace };
