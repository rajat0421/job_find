const mongoose = require('mongoose');

// One document per hourly fetch cycle — records how many postings each source
// returned (fetched) vs how many were newly stored (added). Powers the admin
// analytics "today vs yesterday" view.
const fetchRunSchema = new mongoose.Schema({
  sources: [{
    name:    { type: String },   // 'Adzuna' | 'Greenhouse' | 'Lever' | 'Ashby'
    fetched: { type: Number, default: 0 },
    added:   { type: Number, default: 0 },
    _id: false,
  }],
  totalFetched: { type: Number, default: 0 },
  totalAdded:   { type: Number, default: 0 },
  durationMs:   { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('FetchRun', fetchRunSchema);
