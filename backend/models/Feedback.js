const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  message:  { type: String, required: true, maxlength: 500 },
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name:     { type: String, default: 'Anonymous' },
  timestamp: { type: Date, default: Date.now },
  status:   { type: String, enum: ['pending', 'approved', 'declined'], default: 'pending' },
  likes:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  dislikes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
});

module.exports = mongoose.model('Feedback', feedbackSchema);
