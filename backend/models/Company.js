const mongoose = require('mongoose');

// A source company for the ATS fetchers (Greenhouse / Lever / Ashby).
// `token` is the board/company slug used in each provider's public API URL.
// Managed from the admin portal so adding coverage needs no code change/redeploy.
const companySchema = new mongoose.Schema({
  name:     { type: String, required: true },
  provider: { type: String, required: true, enum: ['greenhouse', 'lever', 'ashby'] },
  token:    { type: String, required: true },
  region:   { type: String, default: 'global' }, // lever only: 'global' | 'eu'
  enabled:  { type: Boolean, default: true },
  lastFetchedAt: { type: Date, default: null },
  lastJobCount:  { type: Number, default: null }, // jobs returned on last fetch (null = never)
}, { timestamps: true });

// One row per provider+token
companySchema.index({ provider: 1, token: 1 }, { unique: true });

module.exports = mongoose.model('Company', companySchema);
