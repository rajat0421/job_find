const mongoose = require('mongoose');

// A single sentinel document tracking the running totals for UpstreamTrace —
// record count and total compressed-body bytes currently retained. Updated
// via atomic $inc on every insert/prune so traceStorage.service.js never has
// to run a $sum aggregation over the trace collection just to decide whether
// it's over budget (see that file for why: avoiding a per-write collection
// scan). $inc is atomic per-document in MongoDB, so this is safe under
// concurrent writers (e.g. a worker process and the main server both
// ingesting) without any additional locking.
//
// This is a soft, best-effort counter, not a source of truth enforced by
// MongoDB itself — a crash between inserting a trace and incrementing this
// counter (or the equivalent for a delete) could drift it slightly over long
// uptimes. That's an acceptable characteristic for a soft storage BUDGET
// target (see TRACE_STORAGE_BUDGET_BYTES), not a hard cap MongoDB enforces;
// the hard backstops are the TTL index and the per-body/per-record limits,
// which don't depend on this counter being perfectly exact.
const traceStorageStatsSchema = new mongoose.Schema({
  _id: { type: String, default: 'singleton' },
  totalRecords: { type: Number, default: 0 },
  totalStoredBytes: { type: Number, default: 0 },
  // Last time the counter above was recomputed from the real collection via
  // a full aggregation (see traceStorage.service.js's reconcileIfDue) —
  // this is what bounds drift from sources the per-write $inc/$dec can never
  // see on its own: a crash between a write and its counter update, or
  // MongoDB's own background TTL deletions, which happen entirely outside
  // this service's code.
  lastReconciledAt: { type: Date, default: null },
});

module.exports = mongoose.model('TraceStorageStats', traceStorageStatsSchema);
