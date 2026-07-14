const ResumeProfile = require('../models/ResumeProfile');
const User = require('../models/User');
const { parseResume } = require('../services/resumeParser.service');
const { matchJobsForUser } = require('../services/jobMatcher.service');

// POST /api/resume/upload  (multipart: field "file")
// Extract → hash → (cache or Gemini) → save staging ResumeProfile. Does NOT touch User.
const uploadResume = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const profile = await parseResume({
      userId: req.user.id,
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
    });

    res.status(201).json({
      resumeProfileId: profile._id,
      parsed: profile.parsedJson,
      fromCache: profile.fromCache,
      fileName: profile.fileName,
    });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || 'Failed to parse resume' });
  }
};

// GET /api/resume — latest staging/confirmed profile for the user
const getResume = async (req, res) => {
  try {
    const profile = await ResumeProfile.findOne({ userId: req.user.id }).sort({ createdAt: -1 }).lean();
    if (!profile) return res.status(404).json({ message: 'No resume parsed yet' });
    res.json({
      resumeProfileId: profile._id,
      parsed: profile.parsedJson,
      status: profile.status,
      fileName: profile.fileName,
      createdAt: profile.createdAt,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/resume/confirm — apply the user-reviewed values to the User profile.
// Overwrites a field ONLY when the reviewed value has content. An empty
// value (blank name, [] array, missing experience) is treated as "not detected"
// and leaves the existing profile field untouched — so a field the resume
// missed never wipes what the user already had.
const confirmResume = async (req, res) => {
  try {
    const { name, skills, desiredRoles, experienceYears, locations, education, resumeProfileId } = req.body;

    const update = {};
    if (typeof name === 'string' && name.trim()) update.name = name.trim();
    if (Array.isArray(skills) && skills.length) update.skills = skills;
    if (Array.isArray(desiredRoles) && desiredRoles.length) update.desiredRoles = desiredRoles;
    // Only set experience when a positive value was provided (0/blank = not detected → keep existing)
    if (experienceYears !== undefined && experienceYears !== null && experienceYears !== '' && Number(experienceYears) > 0) {
      update.experience = Number(experienceYears);
    }
    if (Array.isArray(locations) && locations.length) update.locations = locations;
    // Highest / first education line → qualification (best-effort)
    if (Array.isArray(education) && education.length && education[0]?.trim()) update.qualification = education[0].trim();
    update.isOnboarded = true;

    await User.updateOne({ _id: req.user.id }, { $set: update });

    // Mark the staging record confirmed
    if (resumeProfileId) {
      await ResumeProfile.updateOne(
        { _id: resumeProfileId, userId: req.user.id },
        { $set: { status: 'confirmed', confirmedAt: new Date() } }
      );
    }

    res.json({ message: 'Profile updated from resume' });

    // Fire-and-forget: re-match this user against recent jobs with the new profile
    matchJobsForUser(req.user.id).catch((e) => console.error('[Resume] re-match failed:', e.message));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE /api/resume — remove the user's parsed resume records
const deleteResume = async (req, res) => {
  try {
    await ResumeProfile.deleteMany({ userId: req.user.id });
    res.json({ message: 'Resume data deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { uploadResume, getResume, confirmResume, deleteResume };
