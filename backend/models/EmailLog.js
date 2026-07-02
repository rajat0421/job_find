const mongoose = require('mongoose');

const emailLogSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  email:    { type: String, required: true },
  name:     { type: String, default: '' },
  jobCount: { type: Number, default: 0 },
  sentAt:   { type: Date, default: Date.now },
});

module.exports = mongoose.model('EmailLog', emailLogSchema);
