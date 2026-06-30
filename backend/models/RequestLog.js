const mongoose = require('mongoose');

const requestLogSchema = new mongoose.Schema({
  method: { type: String },
  path: { type: String },
  action: { type: String },
  reqBody: { type: mongoose.Schema.Types.Mixed },
  resBody: { type: mongoose.Schema.Types.Mixed },
  statusCode: { type: Number },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  email: { type: String },
  ip: { type: String },
  timestamp: { type: Date, default: Date.now },
});

// Auto-delete logs older than 30 days
requestLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('RequestLog', requestLogSchema);
