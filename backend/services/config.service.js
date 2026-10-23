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

// Maximum age (in days) of a posting's own publication date (`postedAt`,
// never updatedAt/lastSeenAt/sourceUpdatedAt — see dailyEmail.job.js's
// isPostingFreshEnough for why) that still permits it to go out in an email
// digest. Centralized here, not scattered as a literal in the email
// pipeline, so an operator can retune either value via Config without a
// deploy — same pattern as getEmailThreshold above.
//
// Adzuna gets its own, shorter default: platforms/adzuna.js never calls
// sweepMissingJobs (its keyword search can't prove a specific posting has
// closed), so an Adzuna-sourced job's `status` can lag reality far longer
// than one of the other three sources, which do get board-level closure
// detection within a few missed scans. A shorter age ceiling is the only
// closure signal this pipeline has for Adzuna jobs specifically.
const DEFAULT_EMAIL_FRESHNESS_MAX_AGE_DAYS = 30;
const ADZUNA_EMAIL_FRESHNESS_MAX_AGE_DAYS = 14;

const asPositiveIntDays = (raw, fallback) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const getEmailFreshnessConfig = async () => {
  const [defaultRaw, adzunaRaw] = await Promise.all([
    getConfigValue('emailFreshnessMaxAgeDays', DEFAULT_EMAIL_FRESHNESS_MAX_AGE_DAYS),
    getConfigValue('emailFreshnessMaxAgeDaysAdzuna', ADZUNA_EMAIL_FRESHNESS_MAX_AGE_DAYS),
  ]);
  return {
    defaultMaxAgeDays: asPositiveIntDays(defaultRaw, DEFAULT_EMAIL_FRESHNESS_MAX_AGE_DAYS),
    adzunaMaxAgeDays: asPositiveIntDays(adzunaRaw, ADZUNA_EMAIL_FRESHNESS_MAX_AGE_DAYS),
  };
};

module.exports = {
  getConfigValue,
  getEmailThreshold,
  getEmailFreshnessConfig,
  DEFAULT_EMAIL_FRESHNESS_MAX_AGE_DAYS,
  ADZUNA_EMAIL_FRESHNESS_MAX_AGE_DAYS,
};
