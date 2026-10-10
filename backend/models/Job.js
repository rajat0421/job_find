const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  title: { type: String, required: true },
  company: { type: String },
  location: { type: String },
  salaryMin: { type: Number },
  salaryMax: { type: Number },
  description: { type: String },
  applyLink: { type: String },
  source: { type: String }, // 'adzuna', 'greenhouse', 'lever', 'ashby'
  workplaceType: { type: String }, // 'onsite' | 'remote' | 'hybrid' | null (Lever provides this)
  country: { type: String },       // e.g. 'IN' (Lever provides this)
  hash: { type: String, unique: true }, // cross-source dedup fingerprint — md5(title-company-location). Preserved as-is.
  postedAt: { type: Date },

  // Stable upstream identity (when the source provides one) + lifecycle tracking.
  // See services/jobLifecycle.service.js for how these are populated and used.
  sourceJobId: { type: String, default: null },  // the source's own posting ID, e.g. Greenhouse/Lever/Ashby/Adzuna job id
  sourceBoard: { type: String, default: null },  // board/company token — distinguishes IDs across boards on the same provider; null for Adzuna (no board concept)
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['active', 'closed', 'expired'], default: 'active' },
  missingScans: { type: Number, default: 0 }, // consecutive complete-scan misses since last seen; reset to 0 whenever observed again
}, { timestamps: true });

// Non-unique — speeds up the identity lookups in jobLifecycle.service.js. Deliberately
// NOT a unique index: sourceJobId is optional and not yet audited against existing
// production data for missing values or duplicates across all four providers, so a
// unique constraint here is not safe to add yet (see Improvement 3 report).
jobSchema.index({ source: 1, sourceBoard: 1, sourceJobId: 1 });
// Powers the age-based expiry sweep (status active + lastSeenAt cutoff).
jobSchema.index({ status: 1, lastSeenAt: 1 });

module.exports = mongoose.model('Job', jobSchema);
