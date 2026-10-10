const mongoose = require('mongoose');

// One document per hourly fetch cycle — records how many postings each source
// returned (fetched) vs how many were newly stored (added). Powers the admin
// analytics "today vs yesterday" view.
//
// Fields below `added` on `sources[]`, and everything from `startedAt` down at
// the top level, were added for Improvement 4 (upstream resilience/retries).
// All additive, nothing renamed or removed — existing readers of
// totalFetched/totalAdded/durationMs/sources[].name/fetched/added are unaffected.
const fetchRunSchema = new mongoose.Schema({
  sources: [{
    name:    { type: String },   // 'Adzuna' | 'Greenhouse' | 'Lever' | 'Ashby'
    fetched: { type: Number, default: 0 },
    added:   { type: Number, default: 0 },

    requestsAttempted: { type: Number, default: 0 },
    requestsFailed:    { type: Number, default: 0 },
    retries:           { type: Number, default: 0 }, // count of actual retry attempts, not total requests
    // Per-company (Greenhouse/Lever/Ashby) or per-category (Adzuna) failures.
    // `reason` is always a sanitized classification (e.g. 'timeout',
    // 'rate_limited', 'not_found') — never the raw error, URL, or credentials.
    failures: [{ name: String, reason: String, _id: false }],
    // Companies/categories never attempted at all because a time budget ran
    // out before reaching them — distinct from `failures` (which attempted
    // and failed). Never implies they were scanned, successfully or otherwise.
    skipped: [{ name: String, reason: String, _id: false }],
    aborted:  { type: Boolean, default: false }, // e.g. Adzuna's rate-limit circuit breaker tripped
    // Set when this source's own per-provider budget, or the overall cycle
    // budget, cut it off before it finished its full company/category list.
    budgetExceeded: { type: String, enum: ['provider', 'cycle', null], default: null },
    outcome:  { type: String, enum: ['success', 'partial', 'failed'], default: 'success' },

    _id: false,
  }],
  totalFetched: { type: Number, default: 0 },
  totalAdded:   { type: Number, default: 0 },
  durationMs:   { type: Number, default: 0 },

  startedAt:  { type: Date },
  finishedAt: { type: Date },
  // 'success': every source completed with no failures.
  // 'partial': at least one source had some failures but at least one source
  //            (or part of one) succeeded.
  // 'failed':  every source failed outright — this run found nothing usable,
  //            and must never be mistaken for "ran fine, zero new jobs".
  outcome: { type: String, enum: ['success', 'partial', 'failed'], default: 'success' },
  errorSummary: [{ type: String }], // concise, sanitized, human-readable lines
}, { timestamps: true });

module.exports = mongoose.model('FetchRun', fetchRunSchema);
