const mongoose = require('mongoose');

const userJobSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
  score: { type: Number, default: 0 },
  matchedSkills: [{ type: String }],
  matchedRole: { type: String, default: null },
  reasons: [{ type: String }],
  emailed: { type: Boolean, default: false },
  saved: { type: Boolean, default: false },
  applied: { type: Boolean, default: false },

  // Improvement 5 — staleness tracking, all additive/backward-compatible.
  // `matcherVersion` default 0 means "predates versioning" — always treated as
  // stale against the current MATCHER_VERSION (see jobMatcher.service.js),
  // which is exactly the safe behavior for a never-versioned legacy record.
  matcherVersion: { type: Number, default: 0 },
  // Fingerprints of the user/job scoring-relevant fields AT THE TIME this score
  // was computed. A mismatch against the currently-computed fingerprint means
  // the input that produced this score has since changed and it needs
  // recalculating. See jobMatcher.service.js's computeUserFingerprint /
  // computeJobFingerprint for exactly which fields feed each one.
  userFingerprint: { type: String, default: null },
  jobFingerprint: { type: String, default: null },
}, { timestamps: true });

userJobSchema.index({ userId: 1, jobId: 1 }, { unique: true });
// Powers the bounded, resumable matcher-version sweep in jobMatcher.service.js.
userJobSchema.index({ matcherVersion: 1 });

module.exports = mongoose.model('UserJob', userJobSchema);
