const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  isEmailVerified: { type: Boolean, default: false },
  isOnboarded: { type: Boolean, default: false },
  skills: [{ type: String }],
  experience: { type: Number },
  locations: [{ type: String }],
  salary: { type: Number },
  desiredRole:  { type: String, default: null },
  desiredRoles: [{ type: String }],
  remotePreference: { type: String, enum: ['remote', 'hybrid', 'office', 'any'], default: 'any' },
  emailIntervalHours: { type: Number, default: 24 },   // 1 | 5 | 24
  emailSendHourIST:   { type: Number, default: 10 },   // 0-23, only used when interval is 24
  lastEmailedAt:      { type: Date,   default: null },
  emailPaused:        { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
