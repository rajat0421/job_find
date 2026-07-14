const Config = require('../models/Config');

// Read a Config value by key, falling back to a default if missing/unreadable.
const getConfigValue = async (key, fallback) => {
  try {
    const doc = await Config.findOne({ key }).lean();
    return doc && doc.value !== undefined && doc.value !== '' ? doc.value : fallback;
  } catch {
    return fallback;
  }
};

// Minimum match score required to email a job. Admin-tunable via the
// `emailScoreThreshold` Config key; defaults to 50.
const getEmailThreshold = async () => {
  const raw = await getConfigValue('emailScoreThreshold', 50);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 50;
};

module.exports = { getConfigValue, getEmailThreshold };
