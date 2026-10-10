const mongoose = require('mongoose');

const emailLogSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  email:    { type: String, required: true },
  name:     { type: String, default: '' },
  jobCount: { type: Number, default: 0 },
  sentAt:   { type: Date, default: Date.now },
  status:   { type: String, enum: ['sent', 'skipped', 'failed'], default: 'sent' },
  reason:   { type: String, default: '' },
});

// Powers the admin analytics time-windowed aggregations (last 24h/7d, by
// status) added in Improvement 6 — without this, those $match-on-sentAt
// queries would collection-scan as EmailLog grows. Also serves the existing
// admin email-logs listing's default sort.
emailLogSchema.index({ sentAt: -1 });

module.exports = mongoose.model('EmailLog', emailLogSchema);
