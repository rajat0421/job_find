const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  title: { type: String, required: true },
  company: { type: String },
  location: { type: String },
  salaryMin: { type: Number },
  salaryMax: { type: Number },
  description: { type: String },
  applyLink: { type: String },
  source: { type: String }, // 'adzuna', 'greenhouse', 'lever'
  workplaceType: { type: String }, // 'onsite' | 'remote' | 'hybrid' | null (Lever provides this)
  country: { type: String },       // e.g. 'IN' (Lever provides this)
  hash: { type: String, unique: true }, // deduplication key
  postedAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('Job', jobSchema);
