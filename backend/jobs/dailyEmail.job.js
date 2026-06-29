const cron = require('node-cron');
const User = require('../models/User');
const UserJob = require('../models/UserJob');
const { sendJobDigestEmail } = require('../services/email.service');

// EMAIL_INTERVAL_HOURS — how often to send: 1, 5, or 24 (default: 24)
// EMAIL_SEND_HOUR_IST  — which IST hour to send at for 24h mode (default: 8 = 8:00 AM IST)
const buildCronSchedule = () => {
  const interval = parseInt(process.env.EMAIL_INTERVAL_HOURS || '24', 10);
  const hourIST  = parseInt(process.env.EMAIL_SEND_HOUR_IST  || '8',  10);

  if (interval === 24) return { schedule: `0 ${hourIST} * * *`, label: `every 24h at ${hourIST}:00 IST` };
  if (interval === 1)  return { schedule: `0 * * * *`,           label: `every 1h` };
  return { schedule: `0 */${interval} * * *`, label: `every ${interval}h` };
};

const sendDigest = async () => {
  console.log('[EmailDigest] Running...');
  const users = await User.find({ isOnboarded: true, isEmailVerified: true });

  for (const user of users) {
    // emailed: false is the cache — a job marked true is never sent again
    const newJobs = await UserJob.find({
      userId: user._id,
      emailed: false,
      score: { $gte: 50 },
    })
      .sort({ score: -1 })
      .limit(10)
      .populate('jobId');

    if (!newJobs.length) continue;

    const jobsData = newJobs.map((uj) => ({ job: uj.jobId, score: uj.score }));

    try {
      await sendJobDigestEmail(user.email, user.name || 'there', jobsData);
      await UserJob.updateMany(
        { _id: { $in: newJobs.map((uj) => uj._id) } },
        { emailed: true }
      );
      console.log(`[EmailDigest] Sent to ${user.email} — ${newJobs.length} jobs`);
    } catch (err) {
      console.error(`[EmailDigest] Failed for ${user.email}:`, err.message);
    }
  }

  console.log('[EmailDigest] Done');
};

const startDailyEmailCron = () => {
  const { schedule, label } = buildCronSchedule();

  cron.schedule(schedule, sendDigest, { timezone: 'Asia/Kolkata' });

  console.log(`[Cron] Email digest scheduled — ${label}`);
};

module.exports = { startDailyEmailCron };
