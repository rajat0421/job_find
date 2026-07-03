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

const isDue = (user) => {
  const now = Date.now();
  const intervalMs = user.emailIntervalHours * 60 * 60 * 1000;

  if (user.emailIntervalHours === 24) {
    if (getISTHour() !== user.emailSendHourIST) return false;
  }

  return !user.lastEmailedAt || (now - new Date(user.lastEmailedAt).getTime()) >= intervalMs;
};

const sendDigest = async () => {
  console.log(`[EmailDigest] Running at ${new Date().toISOString()}`);
  const users = await User.find({ isOnboarded: true, isEmailVerified: true, emailPaused: { $ne: true } });
  console.log(`[EmailDigest] ${users.length} eligible user(s) found`);
  const due = users.filter(isDue);
  console.log(`[EmailDigest] ${due.length} user(s) due`);

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
      const totalUnread = await UserJob.countDocuments({ userId: user._id, emailed: false });
      const reason = totalUnread === 0
        ? 'No matched jobs yet'
        : `${totalUnread} matched job(s) but none scored ≥ 50`;
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
