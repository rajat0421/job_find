// Real-database regression tests for Improvement 3 Issues A and B.
//
// jobLifecycle.service.test.js uses an in-memory fake Job model that does NOT
// enforce the unique index on `hash` — which is exactly what let a real bug
// (two distinct postings sharing a fingerprint silently colliding on insert)
// pass undetected there. This file runs the REAL Job Mongoose model, with its
// real schema and real indexes, against a disposable MongoDB instance
// (mongodb-memory-server) so the unique-hash constraint is genuinely enforced,
// not assumed.
//
// Root cause (Issue A): two postings with different confirmed sourceJobIds can
// legitimately compute the same title-company-location hash. observeJob used
// to try inserting both with that identical hash; the second insert threw a
// real MongoDB E11000 duplicate-key error, which the existing catch block
// swallowed — silently DROPPING the second posting rather than duplicating it.
// Fixed by storing a disambiguated hash (suffixed with the posting's own
// stable identity) only when the canonical hash is already taken by a
// different doc; the canonical hash keeps resolving to one "representative"
// doc for cross-source dedup, completely unaffected.
//
// Root cause (Issue B): a cross-source hash-fallback match used to reset
// status/missingScans on the matched doc. Since missingScans is the counter
// a SPECIFIC source+board's own sweepMissingJobs() relies on, an unrelated
// source confirming "I still see this" every cycle could reset that counter
// before it ever reached the closure threshold — meaning a posting genuinely
// removed from its authoritative board could never actually close as long as
// a different, less reliable source kept re-confirming it. Fixed by having a
// cross-source match only bump lastSeenAt, leaving status/missingScans solely
// under the control of the doc's own primary source's sweep.

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.setTimeout(60000);

let mongod;
let Job;
let observeJob;
let sweepMissingJobs;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  Job = require('../../models/Job');
  await Job.init(); // ensure indexes (including the unique hash index) are actually built
  ({ observeJob, sweepMissingJobs } = require('../jobLifecycle.service'));
});

afterEach(async () => {
  await Job.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('Issue A — unique hash vs. stable source identity (real MongoDB)', () => {
  const fields = { title: 'Software Engineer', company: 'Acme', location: 'Remote' };

  test('the real unique index on hash is actually active (sanity check)', async () => {
    await Job.create({ title: 'X', hash: 'raw-dupe-check', source: 'greenhouse' });
    await expect(Job.create({ title: 'Y', hash: 'raw-dupe-check', source: 'lever' })).rejects.toThrow(/E11000/);
  });

  test('two distinct postings sharing an identical fingerprint are BOTH persisted, not silently dropped', async () => {
    const r1 = await observeJob({ source: 'greenhouse', sourceBoard: 'acme', sourceJobId: 'A', hash: 'same-hash', fields });
    const r2 = await observeJob({ source: 'greenhouse', sourceBoard: 'acme', sourceJobId: 'B', hash: 'same-hash', fields });

    expect(r1.created).toBe(true);
    expect(r2.created).toBe(true); // this was `false` (silently dropped) before the fix

    const all = await Job.find({}).lean();
    expect(all).toHaveLength(2);
    expect(new Set(all.map((d) => d.sourceJobId))).toEqual(new Set(['A', 'B']));
  });

  test('re-fetching either posting afterwards updates in place — no duplicates, no re-collision', async () => {
    await observeJob({ source: 'greenhouse', sourceBoard: 'acme', sourceJobId: 'A', hash: 'same-hash', fields });
    await observeJob({ source: 'greenhouse', sourceBoard: 'acme', sourceJobId: 'B', hash: 'same-hash', fields });

    const r = await observeJob({ source: 'greenhouse', sourceBoard: 'acme', sourceJobId: 'A', hash: 'same-hash', fields: { ...fields, title: 'Senior Software Engineer' } });

    expect(r.created).toBe(false);
    const all = await Job.find({}).lean();
    expect(all).toHaveLength(2);
    expect(all.find((d) => d.sourceJobId === 'A').title).toBe('Senior Software Engineer');
  });

  test('cross-source dedup still resolves to the one canonical representative doc, not a disambiguated one', async () => {
    await observeJob({ source: 'greenhouse', sourceBoard: 'acme', sourceJobId: 'A', hash: 'shared-hash', fields });
    await observeJob({ source: 'greenhouse', sourceBoard: 'acme', sourceJobId: 'B', hash: 'shared-hash', fields });

    const r3 = await observeJob({ source: 'adzuna', sourceBoard: null, sourceJobId: 'adz-1', hash: 'shared-hash', fields: { ...fields, title: 'Adzuna text' } });

    expect(r3.created).toBe(false); // merged, no 3rd doc
    const all = await Job.find({}).lean();
    expect(all).toHaveLength(2);
    const canonical = all.find((d) => d.hash === 'shared-hash');
    expect(canonical.sourceJobId).toBe('A'); // the original representative, unaffected by Adzuna's text
    expect(canonical.title).toBe('Software Engineer');
  });

  test('saved/applied history is unaffected by hash disambiguation — both docs remain independently addressable', async () => {
    await observeJob({ source: 'greenhouse', sourceBoard: 'acme', sourceJobId: 'A', hash: 'same-hash', fields });
    await observeJob({ source: 'greenhouse', sourceBoard: 'acme', sourceJobId: 'B', hash: 'same-hash', fields });

    const docA = await Job.findOne({ sourceJobId: 'A' });
    const docB = await Job.findOne({ sourceJobId: 'B' });
    expect(docA._id.toString()).not.toBe(docB._id.toString());

    // Simulate a user saving job B specifically — its own _id must keep resolving to B, not A.
    const UserJob = new mongoose.Schema({ jobId: mongoose.Schema.Types.ObjectId, saved: Boolean });
    const UserJobModel = mongoose.models.UserJobTmp || mongoose.model('UserJobTmp', UserJob);
    const uj = await UserJobModel.create({ jobId: docB._id, saved: true });
    const reloaded = await UserJobModel.findById(uj._id).populate({ path: 'jobId', model: Job });
    expect(reloaded.jobId.sourceJobId).toBe('B');
  });
});

describe('Issue B — cross-source interference with board-level missing detection (real MongoDB)', () => {
  const fields = { title: 'Backend Engineer', company: 'Acme', location: 'Remote' };

  test('a cross-source confirmation does not reset another source\'s missing-scan count', async () => {
    await observeJob({ source: 'greenhouse', sourceBoard: 'acme', sourceJobId: 'GH-1', hash: 'h1', fields });
    await sweepMissingJobs({ source: 'greenhouse', sourceBoard: 'acme', observedSourceJobIds: [] });

    let doc = await Job.findOne({ sourceJobId: 'GH-1' }).lean();
    expect(doc.missingScans).toBe(1);

    await observeJob({ source: 'adzuna', sourceBoard: null, sourceJobId: 'ADZ-1', hash: 'h1', fields });

    doc = await Job.findOne({ sourceJobId: 'GH-1' }).lean();
    expect(doc.missingScans).toBe(1); // unchanged — this was reset to 0 before the fix
    expect(doc.status).toBe('active');
  });

  test('a posting genuinely removed from its authoritative board still closes despite ongoing cross-source noise', async () => {
    const { MISSING_SCAN_THRESHOLD } = require('../jobLifecycle.service');
    await observeJob({ source: 'greenhouse', sourceBoard: 'acme', sourceJobId: 'GH-1', hash: 'h1', fields });

    for (let i = 0; i < MISSING_SCAN_THRESHOLD; i++) {
      await sweepMissingJobs({ source: 'greenhouse', sourceBoard: 'acme', observedSourceJobIds: [] });
      await observeJob({ source: 'adzuna', sourceBoard: null, sourceJobId: 'ADZ-1', hash: 'h1', fields }); // stale aggregator keeps "seeing" it
    }

    const doc = await Job.findOne({ sourceJobId: 'GH-1' }).lean();
    expect(doc.status).toBe('closed');
  });

  test('a cross-source confirmation never revives a posting its authoritative board already closed', async () => {
    const { MISSING_SCAN_THRESHOLD } = require('../jobLifecycle.service');
    await observeJob({ source: 'greenhouse', sourceBoard: 'acme', sourceJobId: 'GH-1', hash: 'h1', fields });
    for (let i = 0; i < MISSING_SCAN_THRESHOLD; i++) {
      await sweepMissingJobs({ source: 'greenhouse', sourceBoard: 'acme', observedSourceJobIds: [] });
    }
    expect((await Job.findOne({ sourceJobId: 'GH-1' }).lean()).status).toBe('closed');

    await observeJob({ source: 'adzuna', sourceBoard: null, sourceJobId: 'ADZ-1', hash: 'h1', fields });

    const doc = await Job.findOne({ sourceJobId: 'GH-1' }).lean();
    expect(doc.status).toBe('closed'); // still closed — not reopened by Adzuna's stale confirmation
  });

  test("one board's failed scan never affects a different board's job status", async () => {
    await observeJob({ source: 'greenhouse', sourceBoard: 'board-a', sourceJobId: '1', hash: 'ha', fields });
    await observeJob({ source: 'greenhouse', sourceBoard: 'board-b', sourceJobId: '1', hash: 'hb', fields: { ...fields, company: 'Other Co' } });

    // Board A's scan failed this cycle — caller simply never calls sweepMissingJobs for it.
    // Board B's scan succeeded and is missing nothing.
    await sweepMissingJobs({ source: 'greenhouse', sourceBoard: 'board-b', observedSourceJobIds: ['1'] });

    const a = await Job.findOne({ sourceBoard: 'board-a' }).lean();
    const b = await Job.findOne({ sourceBoard: 'board-b' }).lean();
    expect(a.missingScans).toBe(0); // untouched — board A was never swept this cycle
    expect(b.missingScans).toBe(0);
    expect(a.status).toBe('active');
    expect(b.status).toBe('active');
  });
});
