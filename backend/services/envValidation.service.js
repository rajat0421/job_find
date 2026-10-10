// Validates a positive-integer env var, falling back (with a warning) to a
// safe default when unset or invalid — never lets a bad env value produce
// NaN/negative/zero timeouts, retry counts, or time budgets at runtime.
// Shared by httpClient.service.js and fetchBudget.service.js.
const positiveIntFromEnv = (envKey, fallback) => {
  const raw = process.env[envKey];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    console.warn(`[Config] Invalid ${envKey}="${raw}" — must be a positive integer, falling back to ${fallback}`);
    return fallback;
  }
  return n;
};

module.exports = { positiveIntFromEnv };
