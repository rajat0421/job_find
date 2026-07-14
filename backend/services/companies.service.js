const Company = require('../models/Company');

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// JSON fallback used only when the Company collection hasn't been seeded yet
// (or a DB read fails), so fetching never silently returns nothing.
const jsonFallback = (provider) => {
  if (provider === 'greenhouse') {
    return require('../data/greenhouseBoards.json').map((token) => ({ name: cap(token), token, region: 'global' }));
  }
  if (provider === 'lever') {
    return require('../data/leverCompanies.json').map((c) => ({ name: c.company, token: c.token, region: c.region || 'global' }));
  }
  if (provider === 'ashby') {
    return require('../data/ashbyBoards.json').map((c) => ({ name: c.company, token: c.board, region: 'global' }));
  }
  return [];
};

// Returns enabled companies for a provider as [{ _id?, name, token, region }].
// Prefers the DB (admin-managed); falls back to the JSON seed lists if empty.
const getCompanies = async (provider) => {
  try {
    const rows = await Company.find({ provider, enabled: true }).lean();
    if (rows.length) return rows.map((r) => ({ _id: r._id, name: r.name, token: r.token, region: r.region || 'global' }));
  } catch (err) {
    console.warn(`[Companies] DB read failed for ${provider}, using JSON fallback:`, err.message);
  }
  return jsonFallback(provider);
};

module.exports = { getCompanies };
