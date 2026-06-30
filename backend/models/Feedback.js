const mongoose = require('mongoose');

const replySchema = new mongoose.Schema({
  message:   { type: String, required: true, maxlength: 300 },
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name:      { type: String, default: 'Anonymous' },
  timestamp: { type: Date, default: Date.now },
});

const feedbackSchema = new mongoose.Schema({
  message:   { type: String, required: true, maxlength: 500 },
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name:      { type: String, default: 'Anonymous' },
  timestamp: { type: Date, default: Date.now },
  likes:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  replies:   [replySchema],
});

module.exports = mongoose.model('Feedback', feedbackSchema);
