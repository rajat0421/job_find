const cron = require('node-cron');
const User = require('../models/User');
const UserJob = require('../models/UserJob');
const { sendJobDigestEmail } = require('../services/email.service');

const startDailyEmailCron = () => {
  // Runs every day at 8:00 AM server time
  cron.schedule('0 8 * * *', async () => {
    console.log('[Cron] Sending daily job digest...');

    const users = await User.find({ isOnboarded: true, isEmailVerified: true });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    for (const user of users) {
      const newJobs = await UserJob.find({
        userId: user._id,
        emailed: false,
        score: { $gte: 50 },
        createdAt: { $gte: todayStart },
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
        console.log(`[DailyEmail] Sent to ${user.email} — ${newJobs.length} jobs`);
      } catch (err) {
        console.error(`[DailyEmail] Failed for ${user.email}:`, err.message);
      }
    }

    console.log('[Cron] Daily email done');
  });

  console.log('[Cron] Daily email scheduled — runs at 8 AM');
};

module.exports = { startDailyEmailCron };
