const mongoose = require('mongoose');

// One document per match-cron tick (:15) — mirrors FetchRun's role for the
// fetch cron. Added for Improvement 6 because, before this, a tick "running"
// was never distinguished from a tick "succeeding": matchJobsForAllUsers()
// returned nothing, so the dashboard had no way to tell a healthy run (zero
// new jobs this hour) from a run that silently failed partway through.
//
// All fields are additive and optional-safe (no unique constraints, no
// required fields) so nothing about the matching pipeline itself needs to
// change to support this — see jobs/matchJobs.job.js for how it's populated.
const matchRunSchema = new mongoose.Schema({
  startedAt:  { type: Date },
  finishedAt: { type: Date },
  durationMs: { type: Number, default: 0 },

  // 'success': the tick completed with zero write errors.
  // 'partial': the tick completed, but at least one insert/update operation
  //            failed along the way (see `errors`) — counts created/updated
  //            are still meaningful, just not complete.
  // 'failed':  the tick threw before finishing — e.g. the per-user loop
  //            itself errored, or the final "mark pending jobs processed"
  //            step failed. Whatever counts were accumulated before the
  //            throw are still recorded for visibility, but
  //            pendingMarkedProcessed is false, so next tick retries them —
  //            no manual recovery needed.
  outcome: { type: String, enum: ['success', 'partial', 'failed'], default: 'success' },

  usersConsidered:       { type: Number, default: 0 },
  recentJobsConsidered:  { type: Number, default: 0 },
  pendingJobsConsidered: { type: Number, default: 0 },
  created: { type: Number, default: 0 }, // new UserJob records inserted this run
  updated: { type: Number, default: 0 }, // existing UserJob records refreshed this run
  // Failed insert/update DB operations this run (tolerated, not fatal). Named
  // errorCount rather than `errors` — Mongoose reserves `errors` as a
  // document-level pathname for validation errors.
  errorCount: { type: Number, default: 0 },
  // Whether the pending batch's needsMatching:false write actually completed —
  // false means those jobs remain eligible and will be retried next tick.
  pendingMarkedProcessed: { type: Boolean, default: false },
  versionRescored: { type: Number, default: 0 }, // from this tick's sweepStaleMatcherVersions() call
  expiredCount:    { type: Number, default: 0 }, // from this tick's expireStaleJobs() call

  errorSummary: [{ type: String }], // concise, sanitized, human-readable lines — never raw stack traces or PII
}, { timestamps: true });

// Powers "latest run" (dashboard) and any bounded recent-history queries.
matchRunSchema.index({ createdAt: -1 });

module.exports = mongoose.model('MatchRun', matchRunSchema);
