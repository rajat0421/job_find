const cron = require('node-cron');
const User = require('../models/User');
const UserJob = require('../models/UserJob');
const { sendJobDigestEmail } = require('../services/email.service');

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
  const users = await User.find({ isOnboarded: true, isEmailVerified: true });
  const due = users.filter(isDue);

  if (!due.length) return;
  console.log(`[EmailDigest] ${due.length} user(s) due`);

  for (const user of due) {
    const newJobs = await UserJob.find({
      userId: user._id,
      emailed: false,
      score: { $gte: 50 },
    })
      .sort({ score: -1 })
      .limit(10)
      .populate('jobId');

    if (!newJobs.length) continue;

    try {
      await sendJobDigestEmail(user.email, user.name || 'there', newJobs.map((uj) => ({ job: uj.jobId, score: uj.score })));
      await UserJob.updateMany({ _id: { $in: newJobs.map((uj) => uj._id) } }, { emailed: true });
      await User.updateOne({ _id: user._id }, { lastEmailedAt: new Date() });
      console.log(`[EmailDigest] Sent to ${user.email} — ${newJobs.length} jobs`);
    } catch (err) {
      console.error(`[EmailDigest] Failed for ${user.email}:`, err.message);
    }
  }
};

const startDailyEmailCron = () => {
  // Runs every hour on the hour (IST) — per-user schedule is evaluated inside sendDigest
  cron.schedule('0 * * * *', sendDigest, { timezone: 'Asia/Kolkata' });
  console.log('[Cron] Email digest scheduled — runs every hour, per-user schedule applied');
};

module.exports = { startDailyEmailCron };
