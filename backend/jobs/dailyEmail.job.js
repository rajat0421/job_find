const cron = require('node-cron');
const User = require('../models/User');
const UserJob = require('../models/UserJob');
const EmailLog = require('../models/EmailLog');
const Config = require('../models/Config');
const { sendJobDigestEmail, sendAdminDigestCopy } = require('../services/email.service');
const { getEmailThreshold } = require('../services/config.service');
const { MATCHER_VERSION, computeUserFingerprint } = require('../services/jobMatcher.service');

const getISTHour = () => {
  // IST = UTC + 5:30 — avoid toLocaleString which returns "24" at midnight in some runtimes
  const nowUTC = new Date();
  const istOffset = 5 * 60 + 30; // minutes
  const istMinutes = nowUTC.getUTCHours() * 60 + nowUTC.getUTCMinutes() + istOffset;
  return Math.floor(istMinutes / 60) % 24;
};

// IST calendar day (YYYY-MM-DD) for a given Date — used to send daily users once per day
const istDayStr = (d) => new Date(d.getTime() + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 10);

// Grace window so a user emailed a few seconds/minutes into the previous cron run
// still counts as "due" on the next hourly tick. Without this, `now - lastEmailedAt`
// lands just under the interval (e.g. 59m55s < 1h) and the user silently drops to
// half their configured frequency, drifting later with every send.
const DUE_GRACE_MS = 5 * 60 * 1000; // 5 min (safely less than the 1h cron granularity)

// ── Idempotency (Improvement 11) ────────────────────────────────────────────
// The email cron fires at most once per hour (`20 * * * *`), so an IST
// hour-bucket is the natural, stable identifier for "which scheduled
// occurrence is this delivery for". Two executions of the SAME hour's tick
// (e.g. a crash-and-restart within the same hour, or two processes briefly
// racing) compute the IDENTICAL string; the next hour always computes a new
// one. Deliberately NOT based on Date.now()/a random id — those would be
// different on every call and defeat deduplication entirely.
const istHourBucketStr = (d) => new Date(d.getTime() + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 13); // 'YYYY-MM-DDTHH'

// A narrower bucket used ONLY for manual sends (admin "trigger now" actions).
// Wide enough to absorb a genuine retry of the same click/request (e.g. a
// client or proxy retrying a timed-out call a few seconds later); narrow
// enough that a deliberate second manual send minutes later is never blocked.
const istMinuteBucketStr = (d) => new Date(d.getTime() + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 16); // 'YYYY-MM-DDTHH:MM'

// Separate key NAMESPACES ('scheduled:' vs 'manual:') are the mechanism that
// satisfies "a manual send must never reserve or block a scheduled digest"
// (and vice versa) — the two can never collide on the same idempotency key
// even for the same user in the same minute, so claiming one never prevents
// claiming the other. Cross-trigger CONTENT duplication (the same job being
// emailed twice via two different trigger types) is independently prevented
// by the pre-existing `emailed:false` selection filter, unchanged by this work.
const scheduledIdempotencyKey = (userId, now = new Date()) => `scheduled:${userId}:${istHourBucketStr(now)}`;
const manualIdempotencyKey = (userId, now = new Date()) => `manual:${userId}:${istMinuteBucketStr(now)}`;

/**
 * Atomically claims the right to send ONE specific logical digest delivery,
 * identified by `idempotencyKey`. This — not the in-memory `running` flag
 * below, which only stops THIS process's own cron tick from overlapping
 * itself — is what actually prevents duplicate sends across concurrent
 * processes or a process restart.
 *
 * Mechanism:
 *  - The first caller for a given key wins by inserting a new EmailLog row
 *    with status:'claimed'. A unique index on idempotencyKey (see
 *    models/EmailLog.js) makes MongoDB itself — not application logic — the
 *    arbiter of "who got here first", which is what makes this safe across
 *    multiple processes, not just multiple requests in one process.
 *  - Any other caller for the same key gets a MongoDB duplicate-key error
 *    (code 11000) on that insert. This is treated as an expected "already
 *    claimed" signal, not an application error, and is resolved by reading
 *    what the existing row's status is:
 *      - 'sent'    → already genuinely delivered. Never retried — this is
 *                    the core duplicate-prevention guarantee.
 *      - 'claimed' → AMBIGUOUS: either another attempt is still in flight,
 *                    or a previous attempt crashed after claiming but before
 *                    recording an outcome. Per explicit instruction to
 *                    prefer duplicate-prevention over retrying an ambiguous
 *                    send, this is intentionally NEVER auto-retried here.
 *                    The row stays visibly 'claimed' (distinct from 'sent'
 *                    in EmailLog/admin views — never silently mistaken for a
 *                    success) until a human investigates, or — for a
 *                    SCHEDULED key — until it naturally stops mattering once
 *                    the occurrence advances (the next hour computes a brand
 *                    new key), so an abandoned claim can delay at most one
 *                    occurrence, never block all future ones.
 *      - 'failed'  → the provider definitively did NOT deliver it last time
 *                    (this is known, not ambiguous), so a retry is safe. An
 *                    atomic findOneAndUpdate transitions it back to
 *                    'claimed' ONLY if it is still 'failed' at that exact
 *                    instant, so two concurrent retries can't both win.
 */
const claimDelivery = async (idempotencyKey, meta) => {
  try {
    const doc = await EmailLog.create({ ...meta, idempotencyKey, status: 'claimed', claimedAt: new Date(), jobCount: 0 });
    return { claimed: true, doc };
  } catch (err) {
    if (err?.code !== 11000) throw err; // a genuinely unexpected error — never swallow it
    const existing = await EmailLog.findOne({ idempotencyKey });
    if (existing?.status === 'failed') {
      const reclaimed = await EmailLog.findOneAndUpdate(
        { idempotencyKey, status: 'failed' },
        { $set: { status: 'claimed', claimedAt: new Date(), reason: '' } },
        { new: true }
      );
      if (reclaimed) return { claimed: true, doc: reclaimed };
    }
    return { claimed: false, doc: existing || null };
  }
};

const isDue = (user) => {
  const now = Date.now();

  // Daily users: send once per IST calendar day at their chosen hour. Gating on the
  // calendar day (not a strict 24h-elapsed check) means an off-hour manual send
  // doesn't push the next day's scheduled email out by a full extra day.
  if (user.emailIntervalHours === 24) {
    if (getISTHour() !== user.emailSendHourIST) return false;
    if (!user.lastEmailedAt) return true;
    return istDayStr(new Date()) !== istDayStr(new Date(user.lastEmailedAt));
  }

  // Hourly / 5-hourly users: interval elapsed (with grace for cron-tick drift)
  const intervalMs = user.emailIntervalHours * 60 * 60 * 1000;
  return !user.lastEmailedAt || (now - new Date(user.lastEmailedAt).getTime()) >= intervalMs - DUE_GRACE_MS;
};

// force=true (manual "Send emails now") bypasses each user's scheduled hour/interval
// and sends to anyone with sendable jobs immediately. The cron calls it without force.
const sendDigest = async ({ force = false } = {}) => {
  console.log(`[EmailDigest] Running at ${new Date().toISOString()}${force ? ' (forced)' : ''}`);
  const users = await User.find({ isOnboarded: true, isEmailVerified: true, emailPaused: { $ne: true } });
  console.log(`[EmailDigest] ${users.length} eligible user(s) found`);
  const due = force ? users : users.filter(isDue);
  console.log(`[EmailDigest] ${due.length} user(s) ${force ? 'to process (forced)' : 'due'}`);

  if (!due.length) return;

  const adminCfg = await Config.findOne({ key: 'adminNotificationEmail' });
  const adminEmail = adminCfg?.value || null;
  const threshold = await getEmailThreshold();

  const INACTIVE = ['closed', 'expired'];

  for (const user of due) {
    // Inactive postings are dropped here, before anything below ever sees them —
    // so a UserJob pointing at a since-closed/expired job is never emailed and,
    // critically, never gets marked emailed:true just because it was excluded.
    // It simply stays emailed:false indefinitely (it will never be emailed now,
    // which is the intended outcome, not a bug to special-case further).
    //
    // matcherVersion filter: never send a score computed under an older/
    // obsolete scoring algorithm — a record not yet rescored under the current
    // MATCHER_VERSION (e.g. mid-way through the bounded version sweep after an
    // algorithm change) is excluded until that recalculation actually happens,
    // rather than emailing a potentially-obsolete score. It becomes eligible
    // again automatically once the sweep (or a per-user trigger) refreshes it.
    //
    // needsMatching filter: the attached job itself may have a content change
    // still awaiting reprocessing by the pending-batch sweep — until that
    // happens, this record's score reflects the job's PREVIOUS content, so it's
    // held back the same way.
    //
    // userFingerprint filter: a profile edit triggers matchJobsForUser/
    // rescoreUserMatches fire-and-forget (see user.controller.js's
    // updateProfile) — it is not guaranteed to finish before the next email
    // tick. matcherVersion alone can't catch this: the record was already
    // scored under the current algorithm, just against the user's PREVIOUS
    // profile. Comparing against the user's current fingerprint (already in
    // memory — no extra query) catches that race without scanning anything
    // beyond this same bounded, already-thresholded candidate list.
    const currentUserFingerprint = computeUserFingerprint(user);
    const newJobs = (await UserJob.find({
      userId: user._id,
      emailed: false,
      score: { $gte: threshold },
      matcherVersion: MATCHER_VERSION,
    })
      .sort({ score: -1 })
      .limit(10)
      .populate('jobId'))
      .filter((uj) => uj.jobId && !INACTIVE.includes(uj.jobId.status) && !uj.jobId.needsMatching
        && uj.userFingerprint === currentUserFingerprint);

    if (!newJobs.length) {
      const [totalMatched, totalUnread] = await Promise.all([
        UserJob.countDocuments({ userId: user._id }),
        UserJob.countDocuments({ userId: user._id, emailed: false }),
      ]);

      let reason;
      if (totalMatched === 0) {
        reason = 'No matching jobs found for this profile yet';
      } else if (totalUnread === 0) {
        reason = `Already notified — all ${totalMatched} matching job(s) were sent in earlier emails`;
      } else {
        reason = `${totalUnread} new job(s) found, but none scored ≥ ${threshold} (below the email threshold)`;
      }

      console.log(`[EmailDigest] Skipped ${user.email} — ${reason}`);
      await EmailLog.create({ userId: user._id, email: user.email, name: user.name || '', jobCount: 0, status: 'skipped', reason });
      continue;
    }

    // matchedSkills/matchedRole/reasons are included so the digest email
    // (Improvement 7) can explain WHY each job matched using data the matcher
    // already computed — no new scoring/explanation logic, no change to which
    // records are selected or how they're ordered/capped above.
    const jobsPayload = newJobs.map((uj) => ({
      job: uj.jobId,
      score: uj.score,
      matchedSkills: uj.matchedSkills,
      matchedRole: uj.matchedRole,
      reasons: uj.reasons,
    }));
    // Step 2 of the required ordering: claim the intended delivery BEFORE
    // sending anything. `force` (admin "send now") uses the manual namespace
    // so it can never reserve/block this user's next scheduled occurrence,
    // and vice versa — see the key builders above.
    const now = new Date();
    const idempotencyKey = force ? manualIdempotencyKey(user._id, now) : scheduledIdempotencyKey(user._id, now);
    const claim = await claimDelivery(idempotencyKey, { userId: user._id, email: user.email, name: user.name || '' });

    if (!claim.claimed) {
      // Someone else (a concurrent process, or this exact occurrence already
      // having been sent/claimed) already owns this delivery. No new
      // EmailLog row is created here — the existing claimed/sent row already
      // represents this occurrence, so a second 'skipped' row would just be
      // noise, not a correction.
      console.log(`[EmailDigest] Skipped ${user.email} — delivery already claimed for this ${force ? 'manual' : 'scheduled'} occurrence (${idempotencyKey})`);
      continue;
    }

    try {
      await sendJobDigestEmail(user.email, user.name || 'there', jobsPayload);
      // Only reachable after the provider call above resolved without
      // throwing — i.e. after sendHtmlEmail's own success check (see
      // email.service.js) has already ruled out a 200-but-failed response.
      const sentAt = new Date();
      await UserJob.updateMany({ _id: { $in: newJobs.map((uj) => uj._id) } }, { emailed: true });
      await User.updateOne({ _id: user._id }, { lastEmailedAt: sentAt });
      await EmailLog.findByIdAndUpdate(claim.doc._id, { $set: { status: 'sent', jobCount: newJobs.length, sentAt } });
      console.log(`[EmailDigest] Sent to ${user.email} — ${newJobs.length} jobs`);

      if (adminEmail) {
        sendAdminDigestCopy(adminEmail, user.email, user.name || 'there', sentAt, jobsPayload)
          .catch((err) => console.error(`[EmailDigest] Admin copy failed:`, err.message));
      }
    } catch (err) {
      console.error(`[EmailDigest] Failed for ${user.email}:`, err.message);
      // A definite, known non-delivery — UserJob/lastEmailedAt are correctly
      // left untouched (unreachable above), and this claim's own status
      // moves to 'failed', which claimDelivery() treats as safely retryable
      // the next time this same idempotency key is attempted.
      await EmailLog.findByIdAndUpdate(claim.doc._id, { $set: { status: 'failed', reason: err.message, jobCount: 0 } });
    }
  }
};

let registered = false;
let task = null;
let running = false;

// Cron-only wrapper around sendDigest(). `sendDigest` itself stays exported
// and directly callable unwrapped — the admin "trigger digest now" / "send
// digest for user" endpoints call it straight, on demand, and must keep
// working exactly as before regardless of whether a cron tick happens to be
// in flight. This guard only prevents the cron's OWN hourly tick from
// overlapping itself.
const runEmailTick = async () => {
  if (running) {
    console.warn('[Cron] Email tick skipped — previous digest run is still in progress');
    return;
  }
  running = true;
  try {
    await sendDigest();
  } finally {
    running = false;
  }
};

// Guarded against being registered twice in the same process (idempotent —
// returns the existing task instead) and against overlapping runs.
const startDailyEmailCron = () => {
  if (registered) {
    console.warn('[Cron] Email cron already registered in this process — ignoring duplicate call');
    return task;
  }
  registered = true;
  // Runs 20 min past every hour — offset from fetchJobs (which runs at :00) so fresh jobs are ready
  task = cron.schedule('20 * * * *', runEmailTick, { timezone: 'Asia/Kolkata' });
  console.log('[Cron] Email digest scheduled — runs every hour at :20, per-user schedule applied');
  return task;
};

const isEmailRunning = () => running;

module.exports = {
  startDailyEmailCron,
  sendDigest,
  isDue,
  getISTHour,
  istDayStr,
  isEmailRunning,
  // Exported for reuse (admin.controller.js's manual per-user send) and for
  // direct unit testing of the idempotency mechanism itself.
  claimDelivery,
  scheduledIdempotencyKey,
  manualIdempotencyKey,
};
