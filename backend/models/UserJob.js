const mongoose = require('mongoose');

const userJobSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
  score: { type: Number, default: 0 },
  emailed: { type: Boolean, default: false },
  saved: { type: Boolean, default: false },
  applied: { type: Boolean, default: false },
}, { timestamps: true });

userJobSchema.index({ userId: 1, jobId: 1 }, { unique: true });

module.exports = mongoose.model('UserJob', userJobSchema);
