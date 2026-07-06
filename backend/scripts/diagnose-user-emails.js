require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error('MONGO_URI not set'); process.exit(1); }

const email = process.argv[2];
if (!email) { console.error('Usage: node scripts/diagnose-user-emails.js <email>'); process.exit(1); }

const User = require('../models/User');
const UserJob = require('../models/UserJob');
const Job = require('../models/Job');

// Mirror of isDue() in jobs/dailyEmail.job.js
const getISTHour = () => {
  const nowUTC = new Date();
  const istMinutes = nowUTC.getUTCHours() * 60 + nowUTC.getUTCMinutes() + (5 * 60 + 30);
  return Math.floor(istMinutes / 60) % 24;
};
const isDue = (user) => {
  const now = Date.now();
  const intervalMs = user.emailIntervalHours * 60 * 60 * 1000;
  if (user.emailIntervalHours === 24 && getISTHour() !== user.emailSendHourIST) return false;
  return !user.lastEmailedAt || (now - new Date(user.lastEmailedAt).getTime()) >= intervalMs;
};

async function run() {
  await mongoose.connect(MONGO_URI);

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) { console.log(`No user found for ${email}`); await mongoose.disconnect(); return; }

  console.log('\n═══════════ USER FLAGS ═══════════');
  console.log(`Name:              ${user.name}`);
  console.log(`isEmailVerified:   ${user.isEmailVerified}`);
  console.log(`isOnboarded:       ${user.isOnboarded}`);
  console.log(`emailPaused:       ${user.emailPaused}`);
  console.log(`emailIntervalHours:${user.emailIntervalHours}`);
  console.log(`emailSendHourIST:  ${user.emailSendHourIST}`);
  console.log(`lastEmailedAt:     ${user.lastEmailedAt || 'Never'}`);
  console.log(`desiredRoles:      ${JSON.stringify(user.desiredRoles)}`);
  console.log(`skills:            ${JSON.stringify(user.skills)}`);
  console.log(`locations:         ${JSON.stringify(user.locations)}`);

  console.log('\n═══════════ DIGEST ELIGIBILITY ═══════════');
  const passesQuery = user.isOnboarded && user.isEmailVerified && !user.emailPaused;
  console.log(`Passes digest query (onboarded+verified+not paused): ${passesQuery}`);
  console.log(`Currently DUE (isDue): ${isDue(user)}  [current IST hour: ${getISTHour()}]`);

  console.log('\n═══════════ STORED UserJob RECORDS ═══════════');
  const [total, unread, sendable] = await Promise.all([
    UserJob.countDocuments({ userId: user._id }),
    UserJob.countDocuments({ userId: user._id, emailed: false }),
    UserJob.countDocuments({ userId: user._id, emailed: false, score: { $gte: 50 } }),
  ]);
  console.log(`Total matches:                       ${total}`);
  console.log(`Unread (emailed:false):              ${unread}`);
  console.log(`SENDABLE (emailed:false, score>=50): ${sendable}  ← what the digest would send`);

  const top = await UserJob.find({ userId: user._id }).sort({ score: -1 }).limit(5).populate('jobId');
  console.log('\nTop 5 stored matches:');
  for (const uj of top) {
    console.log(`  ${uj.score}%  emailed=${uj.emailed}  ${uj.jobId?.title || '(job deleted)'} @ ${uj.jobId?.company || '?'}`);
  }

  console.log('\n═══════════ "Technical Consultant" JOBS IN DB ═══════════');
  const tcJobs = await Job.find({ title: { $regex: 'technical consultant', $options: 'i' } }).select('title company createdAt source').limit(10);
  if (!tcJobs.length) {
    console.log('None found in Job collection — these jobs were never fetched/stored.');
  } else {
    for (const j of tcJobs) {
      const uj = await UserJob.findOne({ userId: user._id, jobId: j._id });
      console.log(`  [${j.source}] "${j.title}" @ ${j.company} (fetched ${j.createdAt?.toISOString().slice(0,10)}) — UserJob for this user: ${uj ? `${uj.score}% emailed=${uj.emailed}` : 'MISSING'}`);
    }
  }

  console.log('\n═══════════ VERDICT ═══════════');
  if (!passesQuery) console.log('→ User is excluded from the digest query (check flags above).');
  else if (sendable === 0 && total === 0) console.log('→ User has NO stored matches at all — matching never wrote UserJobs for him (window/timing bug). Run backfill.');
  else if (sendable === 0 && unread === 0) console.log('→ All matches were already emailed — nothing new to send.');
  else if (sendable === 0) console.log('→ Has unread matches but none score >= 50.');
  else console.log(`→ ${sendable} sendable job(s) waiting. If not sent, he was never DUE while the server was awake (cron/spin-down).`);

  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
