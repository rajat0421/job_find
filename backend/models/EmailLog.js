const mongoose = require('mongoose');

const emailLogSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  email:    { type: String, required: true },
  name:     { type: String, default: '' },
  jobCount: { type: Number, default: 0 },
  sentAt:   { type: Date, default: Date.now },
  // 'claimed' (Improvement 11) — a delivery attempt has reserved this exact
  // idempotency key but has not yet confirmed success or failure with the
  // email provider. It is a DISTINCT, visible state from 'sent' — never
  // conflated with it — so a crash between claiming and confirming leaves a
  // record an admin can see is ambiguous, not one that silently looks like a
  // successful send. See dailyEmail.job.js's claimDelivery() for how a row
  // moves from 'claimed' to 'sent'/'failed', and why a stuck 'claimed' row is
  // never auto-retried.
  status:   { type: String, enum: ['claimed', 'sent', 'skipped', 'failed'], default: 'sent' },
  reason:   { type: String, default: '' },
  claimedAt: { type: Date, default: null },
  // Stable key identifying ONE logical digest delivery — see
  // dailyEmail.job.js's scheduledIdempotencyKey/manualIdempotencyKey for the
  // exact format. `default: null` (not required) so every pre-existing
  // EmailLog row — and any future row from a code path that doesn't go
  // through claimDelivery() — is simply absent from the uniqueness check
  // below, rather than breaking it.
  idempotencyKey: { type: String, default: null },
});

// Powers the admin analytics time-windowed aggregations (last 24h/7d, by
// status) added in Improvement 6 — without this, those $match-on-sentAt
// queries would collection-scan as EmailLog grows. Also serves the existing
// admin email-logs listing's default sort.
emailLogSchema.index({ sentAt: -1 });

// The actual duplicate-prevention mechanism (Improvement 11): MongoDB itself
// rejects a second insert for the same idempotencyKey, so two concurrent
// processes (or a retried request) can never both claim the same delivery.
//
// MUST be `sparse: true`. Every EmailLog row that existed before this change
// — and any 'skipped' row going forward, which never goes through
// claimDelivery() — has no idempotencyKey at all. A plain (non-sparse) unique
// index treats all of those missing values as colliding nulls and would
// refuse to build at all once more than one such row exists, which would be
// true immediately on any real deployment. `sparse: true` excludes documents
// missing the field from the uniqueness check entirely, so this index builds
// safely over existing production data with no backfill or migration script
// required — Mongoose creates it automatically on next connect (`autoIndex`,
// on by default outside production). If `autoIndex` is disabled in
// production, run once after deploy:
//   db.emaillogs.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true })
emailLogSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('EmailLog', emailLogSchema);
