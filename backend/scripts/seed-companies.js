/**
 * Seed the Company collection from the JSON board lists. Idempotent — safe to
 * re-run; it upserts by (provider, token) and never deletes/disables existing rows.
 *
 * Run once after deploying the Company model:
 *   node scripts/seed-companies.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error('MONGO_URI not set'); process.exit(1); }

const Company = require('../models/Company');
const greenhouse = require('../data/greenhouseBoards.json');
const lever = require('../data/leverCompanies.json');
const ashby = require('../data/ashbyBoards.json');

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const rows = [
  // Greenhouse: flat array of tokens; derive a display name from the token
  ...greenhouse.map((token) => ({ provider: 'greenhouse', token, name: cap(token), region: 'global' })),
  // Lever: { company, token, region }
  ...lever.map((c) => ({ provider: 'lever', token: c.token, name: c.company, region: c.region || 'global' })),
  // Ashby: { company, board }
  ...ashby.map((c) => ({ provider: 'ashby', token: c.board, name: c.company, region: 'global' })),
];

async function run() {
  await mongoose.connect(MONGO_URI);

  let upserted = 0;
  for (const r of rows) {
    const res = await Company.updateOne(
      { provider: r.provider, token: r.token },
      { $setOnInsert: { ...r, enabled: true } },
      { upsert: true }
    );
    if (res.upsertedCount) upserted++;
  }

  const total = await Company.countDocuments();
  const byProvider = await Company.aggregate([{ $group: { _id: '$provider', n: { $sum: 1 } } }]);
  console.log(`Seed complete — ${upserted} new row(s) inserted, ${total} total.`);
  byProvider.forEach((p) => console.log(`  ${p._id}: ${p.n}`));

  await mongoose.disconnect();
}

run().catch((e) => { console.error(e); process.exit(1); });
