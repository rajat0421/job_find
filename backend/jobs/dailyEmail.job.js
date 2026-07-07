const cron = require('node-cron');
const User = require('../models/User');
const UserJob = require('../models/UserJob');
const EmailLog = require('../models/EmailLog');
const Config = require('../models/Config');
const { sendJobDigestEmail, sendAdminDigestCopy } = require('../services/email.service');

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

  for (const user of due) {
    const newJobs = await UserJob.find({
      userId: user._id,
      emailed: false,
      score: { $gte: 50 },
    })
      .sort({ score: -1 })
      .limit(10)
      .populate('jobId');

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
        reason = `${totalUnread} new job(s) found, but none scored ≥ 50 (below the email threshold)`;
      }

      console.log(`[EmailDigest] Skipped ${user.email} — ${reason}`);
      await EmailLog.create({ userId: user._id, email: user.email, name: user.name || '', jobCount: 0, status: 'skipped', reason });
      continue;
    }

    const jobsPayload = newJobs.map((uj) => ({ job: uj.jobId, score: uj.score }));
    const sentAt = new Date();

    try {
      await sendJobDigestEmail(user.email, user.name || 'there', jobsPayload);
      await UserJob.updateMany({ _id: { $in: newJobs.map((uj) => uj._id) } }, { emailed: true });
      await User.updateOne({ _id: user._id }, { lastEmailedAt: sentAt });
      await EmailLog.create({ userId: user._id, email: user.email, name: user.name || '', jobCount: newJobs.length, status: 'sent' });
      console.log(`[EmailDigest] Sent to ${user.email} — ${newJobs.length} jobs`);

      if (adminEmail) {
        sendAdminDigestCopy(adminEmail, user.email, user.name || 'there', sentAt, jobsPayload)
          .catch((err) => console.error(`[EmailDigest] Admin copy failed:`, err.message));
      }
    } catch (err) {
      console.error(`[EmailDigest] Failed for ${user.email}:`, err.message);
      await EmailLog.create({ userId: user._id, email: user.email, name: user.name || '', jobCount: 0, status: 'failed', reason: err.message });
    }
  }
};

const startDailyEmailCron = () => {
  // Runs 20 min past every hour — offset from fetchJobs (which runs at :00) so fresh jobs are ready
  cron.schedule('20 * * * *', sendDigest, { timezone: 'Asia/Kolkata' });
  console.log('[Cron] Email digest scheduled — runs every hour at :20, per-user schedule applied');
};

module.exports = { startDailyEmailCron, sendDigest };
