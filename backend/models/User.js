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
  remotePreference: { type: String, enum: ['remote', 'hybrid', 'office', 'any'], default: 'any' },
  isAdmin: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
