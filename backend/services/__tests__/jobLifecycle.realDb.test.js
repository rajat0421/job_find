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

// Real-database regression tests for the legacy-identity-upgrade fix: every
// existing Greenhouse job created before sourceJobId/sourceBoard tracking
// shipped (confirmed directly against production: 0 of 26,634 stored
// Greenhouse jobs had a sourceJobId) was permanently stuck being "confirmed
// alive" via the hash-fallback path on every subsequent fetch — which never
// writes sourceJobId, and never refreshes title/description/location/
// applyLink/postedAt. A legacy job's content was effectively frozen forever
// at whatever it was on the day it was first created, while still silently
// marked "seen" every cycle via lastSeenAt.
describe('Legacy identity upgrade — a pre-existing hash-only document gains a stable ID (real MongoDB)', () => {
  test('a legacy document (no sourceJobId at all) is upgraded in place on its next observation, not duplicated', async () => {
    // Simulate a job created by code that predates sourceJobId tracking —
    // genuinely has no sourceJobId/sourceBoard field at all, not just null,
    // matching what was verified directly against real stored documents.
    const legacy = await Job.create({
      title: 'Software Architect, Java Backend', company: 'Okta', location: 'Bengaluru, India',
      hash: 'legacy-hash-1', source: 'greenhouse', status: 'active',
      firstSeenAt: new Date('2026-06-30'), lastSeenAt: new Date('2026-06-30'),
    });
    expect(legacy.sourceJobId).toBeNull(); // schema default on a hydrated doc; genuinely absent on real pre-existing production documents — both read as "no stable ID yet" to observeJob's queries

    const result = await observeJob({
      source: 'greenhouse', sourceBoard: 'okta', sourceJobId: '7882676', hash: 'legacy-hash-1',
      fields: { title: 'Software Architect, Java Backend', company: 'Okta', location: 'Bengaluru, India' },
    });

    const all = await Job.find({}).lean();
    expect(all).toHaveLength(1); // upgraded in place — never a second document
    expect(all[0]._id.toString()).toBe(legacy._id.toString()); // same stable Mongo _id
    expect(all[0].sourceJobId).toBe('7882676');
    expect(all[0].sourceBoard).toBe('okta');
    expect(all[0].firstSeenAt.toISOString()).toBe(new Date('2026-06-30').toISOString()); // true history preserved
    expect(result.created).toBe(false);
  });

  test('once upgraded, the SAME document is found directly by ID on the next fetch — no further hash dependency', async () => {
    await Job.create({
      title: 'Old Title', company: 'Okta', location: 'Bengaluru, India',
      hash: 'legacy-hash-2', source: 'greenhouse', status: 'active',
    });
    const first = await observeJob({
      source: 'greenhouse', sourceBoard: 'okta', sourceJobId: '999', hash: 'legacy-hash-2',
      fields: { title: 'Old Title', company: 'Okta', location: 'Bengaluru, India' },
    });
    expect(first.created).toBe(false);

    // Title changes AND the hash the fetcher would now compute changes too
    // (hash is derived from title+company+location) — the by-ID path must
    // still find the SAME document directly, with no legacy/hash lookup at all.
    const second = await observeJob({
      source: 'greenhouse', sourceBoard: 'okta', sourceJobId: '999', hash: 'a-totally-different-hash',
      fields: { title: 'New Title', company: 'Okta', location: 'Bengaluru, India' },
    });

    const all = await Job.find({}).lean();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe('New Title');
    expect(all[0].sourceJobId).toBe('999');
    expect(second.created).toBe(false);
    expect(second.updated).toBe(true); // title is scoring-relevant — correctly flagged
  });

  test('content is actually refreshed on the upgrading observation — not just lastSeenAt', async () => {
    await Job.create({
      title: 'Stale Title', description: 'Stale description', location: 'Old City',
      company: 'Okta', hash: 'legacy-hash-3', source: 'greenhouse', status: 'active',
    });

    await observeJob({
      source: 'greenhouse', sourceBoard: 'okta', sourceJobId: '111', hash: 'legacy-hash-3',
      fields: { title: 'Fresh Title', company: 'Okta', location: 'New City', description: 'Fresh description', applyLink: 'https://okta.example/111' },
    });

    const doc = await Job.findOne({ sourceJobId: '111' }).lean();
    expect(doc.title).toBe('Fresh Title');
    expect(doc.description).toBe('Fresh description');
    expect(doc.location).toBe('New City');
    expect(doc.applyLink).toBe('https://okta.example/111');
  });

  test('a cross-source document (different source) is never upgraded by a same-hash Greenhouse observation — the existing cross-source dedup still wins', async () => {
    // An Adzuna-originated doc for what looks like the same role, no sourceJobId.
    const adzuna = await Job.create({
      title: 'Software Architect', company: 'Okta', location: 'Bengaluru, India',
      hash: 'cross-source-hash', source: 'adzuna', status: 'active',
    });

    await observeJob({
      source: 'greenhouse', sourceBoard: 'okta', sourceJobId: '222', hash: 'cross-source-hash',
      fields: { title: 'Software Architect', company: 'Okta', location: 'Bengaluru, India' },
    });

    // The legacy-upgrade path only ever applies WITHIN the same source — a
    // different source matching by hash is the pre-existing, unchanged,
    // intentional cross-source dedup (see the "cross-source dedup still
    // resolves to the one canonical representative doc" test above): it
    // must NOT be granted Greenhouse's identity, and no second document is
    // created for what looks like the same role under a different source.
    const all = await Job.find({}).lean();
    expect(all).toHaveLength(1);
    expect(all[0]._id.toString()).toBe(adzuna._id.toString());
    expect(all[0].source).toBe('adzuna');
    expect(all[0].sourceJobId).toBeNull(); // never granted Greenhouse's ID
  });

  test('a missing/null incoming field never erases a previously-stored value during a legacy upgrade', async () => {
    await Job.create({
      title: 'Engineer', company: 'Okta', location: 'Remote', applyLink: 'https://okta.example/already-set',
      postedAt: new Date('2026-01-01'), hash: 'legacy-hash-4', source: 'greenhouse', status: 'active',
    });

    // This observation's fields omit applyLink/postedAt entirely (as if the
    // provider didn't supply them this time) — they must survive untouched.
    await observeJob({
      source: 'greenhouse', sourceBoard: 'okta', sourceJobId: '333', hash: 'legacy-hash-4',
      fields: { title: 'Engineer', company: 'Okta', location: 'Remote', applyLink: null, postedAt: null },
    });

    const doc = await Job.findOne({ sourceJobId: '333' }).lean();
    expect(doc.applyLink).toBe('https://okta.example/already-set');
    expect(doc.postedAt.toISOString()).toBe(new Date('2026-01-01').toISOString());
  });

  test('repeated fetches of the same posting after the upgrade are idempotent — one document throughout', async () => {
    await Job.create({
      title: 'Engineer', company: 'Okta', location: 'Remote',
      hash: 'legacy-hash-5', source: 'greenhouse', status: 'active',
    });

    for (let i = 0; i < 5; i++) {
      await observeJob({
        source: 'greenhouse', sourceBoard: 'okta', sourceJobId: '444', hash: 'legacy-hash-5',
        fields: { title: 'Engineer', company: 'Okta', location: 'Remote' },
      });
    }

    const all = await Job.find({ sourceJobId: '444' }).lean();
    expect(all).toHaveLength(1);
  });

  test('a content change on the SAME upgrade observation correctly flags needsMatching; a no-op re-observation does not', async () => {
    const legacy = await Job.create({
      title: 'Engineer', company: 'Okta', location: 'Remote', description: 'Old description',
      hash: 'legacy-hash-6', source: 'greenhouse', status: 'active', needsMatching: false,
    });
    expect(legacy.needsMatching).toBe(false);

    const upgradeWithChange = await observeJob({
      source: 'greenhouse', sourceBoard: 'okta', sourceJobId: '555', hash: 'legacy-hash-6',
      fields: { title: 'Engineer', company: 'Okta', location: 'Remote', description: 'New description' },
    });
    expect(upgradeWithChange.updated).toBe(true);
    expect((await Job.findOne({ sourceJobId: '555' }).lean()).needsMatching).toBe(true);

    // Reset to simulate the matcher having processed it, then re-observe with NO change.
    await Job.updateOne({ sourceJobId: '555' }, { $set: { needsMatching: false } });
    const noopObservation = await observeJob({
      source: 'greenhouse', sourceBoard: 'okta', sourceJobId: '555', hash: 'legacy-hash-6',
      fields: { title: 'Engineer', company: 'Okta', location: 'Remote', description: 'New description' },
    });
    expect(noopObservation.updated).toBe(false);
    expect((await Job.findOne({ sourceJobId: '555' }).lean()).needsMatching).toBe(false);
  });
});
