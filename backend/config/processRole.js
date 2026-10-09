const VALID_ROLES = ['all', 'api', 'worker'];

// 'all' (API + schedulers in one process) is the default — matches the
// current single-service Render deployment. Setting PROCESS_ROLE=api or
// PROCESS_ROLE=worker lets the API and background jobs run as separate
// processes later without any other code change.
const getProcessRole = () => {
  const raw = (process.env.PROCESS_ROLE || 'all').trim().toLowerCase();
  if (!VALID_ROLES.includes(raw)) {
    console.warn(`[ProcessRole] Unknown PROCESS_ROLE "${raw}" — falling back to "all"`);
    return 'all';
  }
  return raw;
};

module.exports = { getProcessRole, VALID_ROLES };
