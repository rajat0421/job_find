require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error('MONGO_URI not set'); process.exit(1); }

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;
  const users = db.collection('users');

  // Safety pass: users with desiredRole but no desiredRoles — copy it over before unsetting
  const orphaned = await users.find({
    desiredRole: { $nin: [null, ''] },
    $or: [{ desiredRoles: { $exists: false } }, { desiredRoles: { $size: 0 } }],
  }).toArray();

  if (orphaned.length) {
    console.log(`Safety-copying desiredRole → desiredRoles for ${orphaned.length} user(s)...`);
    for (const u of orphaned) {
      await users.updateOne({ _id: u._id }, { $set: { desiredRoles: [u.desiredRole] } });
    }
  } else {
    console.log('No orphaned users found — all users already have desiredRoles.');
  }

  // Unset desiredRole from every document
  const result = await users.updateMany({}, { $unset: { desiredRole: '' } });
  console.log(`Unset desiredRole on ${result.modifiedCount} document(s).`);

  await mongoose.disconnect();
  console.log('Done.');
}

run().catch((err) => { console.error(err); process.exit(1); });
