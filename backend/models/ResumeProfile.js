const mongoose = require('mongoose');

// The AI-extracted structured profile from an uploaded resume. This is a STAGING
// record — it is never applied to the User profile until the user reviews and
// confirms. A new document is created per upload (history is preserved, not
// overwritten) so we can support version comparison later.
const resumeProfileSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  resumeHash:  { type: String, required: true },  // SHA-256 of the uploaded file — powers the per-user parse cache
  fileName:    { type: String, default: '' },
  fileType:    { type: String, default: '' },     // 'pdf' | 'docx'
  rawText:     { type: String, default: '' },     // extracted plain text (kept for future features: ATS score, match, etc.)

  // Structured output from the AI (matches the extraction schema)
  parsedJson: {
    name:            { type: String, default: '' },
    email:           { type: String, default: '' },
    phone:           { type: String, default: '' },
    summary:         { type: String, default: '' },
    skills:          [{ type: String }],
    desiredRoles:    [{ type: String }],
    experienceYears: { type: Number, default: 0 },
    education:       [{ type: String }],
    certifications:  [{ type: String }],
    projects:        [{ type: String }],
    companies:       [{ type: String }],
    locations:       [{ type: String }],
    languages:       [{ type: String }],
    tools:           [{ type: String }],
  },

  aiModel:       { type: String, default: '' },       // e.g. 'deepseek/deepseek-chat-v3-0324:free'
  promptVersion: { type: String, default: 'v1' },     // bump to force re-parse when the prompt changes
  fromCache:     { type: Boolean, default: false },   // true if reused a prior parse instead of calling the AI
  status:        { type: String, enum: ['parsed', 'confirmed'], default: 'parsed' },
  confirmedAt:   { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('ResumeProfile', resumeProfileSchema);
