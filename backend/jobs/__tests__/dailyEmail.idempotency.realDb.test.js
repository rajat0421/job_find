// Real-database validation for Improvement 11. The claim decision LOGIC is
// already exercised against mocks in dailyEmail.idempotency.test.js — this
// file proves what only a real MongoDB instance can: that the unique+sparse
// index on EmailLog.idempotencyKey (a) builds successfully over a collection
// that already has legacy rows with no idempotencyKey at all (the exact
// migration concern this improvement's report calls out), and (b) actually
// rejects a genuine concurrent duplicate insert with a real E11000 error.

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.setTimeout(60000);

let mongod;
let EmailLog;
let claimDelivery;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  EmailLog = require('../../models/EmailLog');
  // Deliberately seed LEGACY rows (no idempotencyKey — exactly what every
  // EmailLog document looked like before this improvement) BEFORE building
  // indexes, to prove the sparse unique index builds cleanly over them.
  await EmailLog.collection.insertMany([
    { userId: new mongoose.Types.ObjectId(), email: 'legacy1@x.com', name: '', jobCount: 2, status: 'sent' },
    { userId: new mongoose.Types.ObjectId(), email: 'legacy2@x.com', name: '', jobCount: 0, status: 'skipped' },
    { userId: new mongoose.Types.ObjectId(), email: 'legacy3@x.com', name: '', jobCount: 0, status: 'failed' },
  ]);
  await EmailLog.init(); // builds declared indexes — must NOT throw despite the legacy rows above

  ({ claimDelivery } = require('../dailyEmail.job'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('the sparse unique index builds successfully over a collection containing legacy rows with no idempotencyKey', async () => {
  const indexes = await EmailLog.collection.indexes();
  const idx = indexes.find((i) => i.name === 'idempotencyKey_1');
  expect(idx).toBeTruthy();
  expect(idx.unique).toBe(true);
  expect(idx.sparse).toBe(true);
});

test('multiple legacy rows with no idempotencyKey coexist without violating the unique index (sparse behavior)', async () => {
  const count = await EmailLog.countDocuments({ idempotencyKey: { $exists: false } });
  expect(count).toBeGreaterThanOrEqual(3); // the legacy rows above all survived index creation
});

test('a genuine concurrent duplicate claim: exactly one of two simultaneous inserts for the same key succeeds, the other gets a real E11000', async () => {
  const key = `scheduled:${new mongoose.Types.ObjectId()}:2026-03-01T04`;
  const attempt = () => EmailLog.create({ userId: new mongoose.Types.ObjectId(), email: 'race@x.com', name: '', idempotencyKey: key, status: 'claimed' });

  const results = await Promise.allSettled([attempt(), attempt()]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(rejected[0].reason.code).toBe(11000);

  const rows = await EmailLog.find({ idempotencyKey: key });
  expect(rows).toHaveLength(1); // never two rows for the same logical delivery
});

test('claimDelivery() end-to-end against real Mongo: second claim for the same key is refused, not duplicated', async () => {
  const key = `scheduled:${new mongoose.Types.ObjectId()}:2026-03-01T05`;
  const meta = { userId: new mongoose.Types.ObjectId(), email: 'realflow@x.com', name: 'Real Flow' };

  const first = await claimDelivery(key, meta);
  const second = await claimDelivery(key, meta);

  expect(first.claimed).toBe(true);
  expect(second.claimed).toBe(false);

  const rows = await EmailLog.find({ idempotencyKey: key });
  expect(rows).toHaveLength(1);
});

test('claimDelivery() allows a real retry after the claim is marked failed, via the atomic conditional transition', async () => {
  const key = `scheduled:${new mongoose.Types.ObjectId()}:2026-03-01T06`;
  const meta = { userId: new mongoose.Types.ObjectId(), email: 'retry@x.com', name: 'Retry' };

  const first = await claimDelivery(key, meta);
  expect(first.claimed).toBe(true);
  await EmailLog.findByIdAndUpdate(first.doc._id, { $set: { status: 'failed', reason: 'smtp down' } });

  const retry = await claimDelivery(key, meta);

  expect(retry.claimed).toBe(true);
  expect(retry.doc._id.toString()).toBe(first.doc._id.toString()); // same row, reused — not a second record
  const rows = await EmailLog.find({ idempotencyKey: key });
  expect(rows).toHaveLength(1);
});
