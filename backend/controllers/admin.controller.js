const axios = require('axios');
const crypto = require('crypto');
const User = require('../models/User');
const Job = require('../models/Job');
const UserJob = require('../models/UserJob');
const RequestLog = require('../models/RequestLog');
const EmailLog = require('../models/EmailLog');
const Config = require('../models/Config');
const { scoreJob, scoreJobWithBreakdown, matchJobsForAllUsers } = require('../services/jobMatcher.service');

const generateJobHash = (title, company, location) =>
  crypto.createHash('md5').update(`${title}-${company}-${location}`).digest('hex');

// Fetch + score Adzuna jobs live for a specific user (no DB save)
const runAdzunaForUser = async (user) => {
  const roles = user.desiredRoles?.length ? user.desiredRoles : [];
  const where = user.locations?.[0] || 'India';
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  const url = 'https://api.adzuna.com/v1/api/jobs/in/search/1';

  // One query per role + one query per skill
  const queries = [];
  if (roles.length) {
    roles.slice(0, 2).forEach(r => queries.push({ label: `role: ${r}`, what: r }));
  }
  if (user.skills?.length) {
    user.skills.forEach(s => queries.push({ label: `skill: ${s}`, what: s }));
  }
  if (!queries.length) queries.push({ label: 'default', what: 'software developer' });

  const requests = [];
  const seenUrls = new Set();
  const allRaw = [];

  for (const q of queries) {
    const params = { app_id: appId, app_key: appKey, results_per_page: 50, what: q.what, where };
    requests.push({ label: q.label, params: { ...params, app_key: '***hidden***' } });
    try {
      const response = await axios.get(url, { params });
      for (const j of (response.data.results || [])) {
        const link = j.redirect_url;
        if (seenUrls.has(link)) continue; // dedup across queries
        seenUrls.add(link);
        allRaw.push(j);
      }
    } catch (err) {
      console.error(`[AdminRunAPI] Adzuna query "${q.what}" failed:`, err.message);
    }
  }

  const scored = allRaw
    .map((j) => {
      const jobObj = {
        title: j.title?.label || j.title || '',
        company: j.company?.display_name || '',
        location: j.location?.display_name || '',
        salaryMin: j.salary_min,
        salaryMax: j.salary_max,
        description: j.description || '',
        applyLink: j.redirect_url,
      };
      return { job: jobObj, score: scoreJob(user, jobObj) };
    })
    .sort((a, b) => b.score - a.score);

  return {
    platform: 'Adzuna',
    requests,
    total_fetched: allRaw.length,
    raw_results: allRaw,
    matched: scored.filter((j) => j.score >= 40),
    filtered_out: scored.filter((j) => j.score < 40),
  };
};

// Fetch + score Greenhouse jobs live for a specific user (no DB save)
const { BOARDS: GREENHOUSE_BOARDS, stripHtml } = require('../platforms/greenhouse');

const runGreenhouseForUser = async (user) => {
  const allJobs = [];
  const boardResults = [];

  for (const board of GREENHOUSE_BOARDS) {
    try {
      const res = await axios.get(
        `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`,
        { timeout: 8000 }
      );
      const jobs = res.data?.jobs || [];
      boardResults.push({ board, count: jobs.length });

      for (const j of jobs) {
        const jobObj = {
          title: j.title || '',
          company: board.charAt(0).toUpperCase() + board.slice(1),
          location: j.location?.name || '',
          salaryMin: null,
          salaryMax: null,
          description: stripHtml(j.content),
          applyLink: j.absolute_url,
        };
        allJobs.push({ job: jobObj, score: scoreJob(user, jobObj) });
      }
    } catch {
      boardResults.push({ board, count: 0, error: true });
    }
  }

  allJobs.sort((a, b) => b.score - a.score);

  return {
    platform: 'Greenhouse',
    boards: boardResults,
    total_fetched: allJobs.length,
    matched: allJobs.filter((j) => j.score >= 40),
    filtered_out: allJobs.filter((j) => j.score < 40),
  };
};

// Fetch + score Lever jobs live for a specific user (no DB save)
const { COMPANIES: LEVER_COMPANIES, stripHtml: leverStripHtml } = require('../platforms/lever');

const buildLeverDescription = (j) => {
  const parts = [];
  if (j.descriptionPlain) parts.push(j.descriptionPlain);
  else if (j.description) parts.push(leverStripHtml(j.description));
  for (const section of j.lists || []) {
    if (section.text) parts.push(section.text);
    if (section.content) parts.push(leverStripHtml(section.content));
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
};

const runLeverForUser = async (user) => {
  const allJobs = [];
  const companyResults = [];
  const active = LEVER_COMPANIES.filter((c) => c.enabled !== false);

  for (const { company, token, region } of active) {
    const base = region === 'eu' ? 'https://api.eu.lever.co' : 'https://api.lever.co';
    try {
      const res = await axios.get(`${base}/v0/postings/${token}`, {
        params: { mode: 'json' }, timeout: 8000,
      });
      const jobs = Array.isArray(res.data) ? res.data : [];
      companyResults.push({ company, count: jobs.length });

      for (const j of jobs) {
        const jobObj = {
          title: j.text || '',
          company,
          location: j.categories?.location || (j.categories?.allLocations || []).join(', ') || '',
          salaryMin: null,
          salaryMax: null,
          description: buildLeverDescription(j),
          applyLink: j.applyUrl || j.hostedUrl || '',
        };
        allJobs.push({ job: jobObj, score: scoreJob(user, jobObj) });
      }
    } catch {
      companyResults.push({ company, count: 0, error: true });
    }
  }

  allJobs.sort((a, b) => b.score - a.score);

  return {
    platform: 'Lever',
    boards: companyResults,
    total_fetched: allJobs.length,
    matched: allJobs.filter((j) => j.score >= 40),
    filtered_out: allJobs.filter((j) => j.score < 40),
  };
};

// GET /api/admin/users
const listUsers = async (_req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });

    const withStats = await Promise.all(
      users.map(async (u) => {
        const jobCount = await UserJob.countDocuments({ userId: u._id });
        const top = await UserJob.findOne({ userId: u._id }).sort({ score: -1 });
        return {
          _id: u._id,
          name: u.name,
          email: u.email,
          isEmailVerified: u.isEmailVerified,
          isOnboarded: u.isOnboarded,
          isAdmin: u.isAdmin,
          skills: u.skills,
          experience: u.experience,
          locations: u.locations,
          salary: u.salary,
          remotePreference: u.remotePreference,
          createdAt: u.createdAt,
          jobsMatched: jobCount,
          topScore: top?.score || 0,
        };
      })
    );

    res.json(withStats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/admin/users/:id
const getUserDetail = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const userJobs = await UserJob.find({ userId: user._id })
      .sort({ score: -1 })
      .limit(50)
      .populate('jobId', '-description');

    res.json({
      user,
      jobs: userJobs.map((uj) => ({
        score: uj.score,
        emailed: uj.emailed,
        saved: uj.saved,
        applied: uj.applied,
        createdAt: uj.createdAt,
        job: uj.jobId,
      })),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/admin/users/:id/run-api
// Runs all platforms live for this user — returns per-platform breakdown + combined totals
const runApiForUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const [adzuna, greenhouse, lever] = await Promise.allSettled([
      runAdzunaForUser(user),
      runGreenhouseForUser(user),
      runLeverForUser(user),
    ]);

    const platforms = [
      adzuna.status === 'fulfilled' ? adzuna.value : { platform: 'Adzuna', error: adzuna.reason?.message },
      greenhouse.status === 'fulfilled' ? greenhouse.value : { platform: 'Greenhouse', error: greenhouse.reason?.message },
      lever.status === 'fulfilled' ? lever.value : { platform: 'Lever', error: lever.reason?.message },
    ];

    const totalFetched = platforms.reduce((s, p) => s + (p.total_fetched || 0), 0);
    const totalMatched = platforms.reduce((s, p) => s + (p.matched?.length || 0), 0);
    const totalFiltered = platforms.reduce((s, p) => s + (p.filtered_out?.length || 0), 0);

    res.json({
      user: {
        name: user.name,
        email: user.email,
        skills: user.skills,
        experience: user.experience,
        locations: user.locations,
        salary: user.salary,
        remotePreference: user.remotePreference,
      },
      summary: { totalFetched, totalMatched, totalFiltered },
      platforms,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PATCH /api/admin/users/:id/email-schedule
const updateEmailSchedule = async (req, res) => {
  try {
    const { emailIntervalHours, emailSendHourIST } = req.body;
    const update = {};

    if (emailIntervalHours !== undefined) {
      const interval = Number(emailIntervalHours);
      if (![1, 5, 24].includes(interval)) return res.status(400).json({ message: 'emailIntervalHours must be 1, 5, or 24' });
      update.emailIntervalHours = interval;
    }

    if (emailSendHourIST !== undefined) {
      const hour = Number(emailSendHourIST);
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) return res.status(400).json({ message: 'emailSendHourIST must be 0–23' });
      update.emailSendHourIST = hour;
    }

    await User.updateOne({ _id: req.params.id }, update);
    res.json({ message: 'Email schedule updated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/admin/fix-greenhouse
// Strips HTML from all existing Greenhouse job descriptions, then re-scores every UserJob that references them
const fixGreenhouseDescriptions = async (_req, res) => {
  try {
    const ghJobs = await Job.find({ source: 'greenhouse' });
    let jobsFixed = 0;

    for (const job of ghJobs) {
      const clean = stripHtml(job.description);
      if (clean !== job.description) {
        job.description = clean;
        await job.save();
        jobsFixed++;
      }
    }

    // Re-score all UserJob records that point to greenhouse jobs
    const ghJobIds = ghJobs.map((j) => j._id);
    const userJobs = await UserJob.find({ jobId: { $in: ghJobIds } }).populate('userId').populate('jobId');

    const toDelete = [];
    const ops = [];
    for (const uj of userJobs) {
      if (!uj.jobId || !uj.userId) { toDelete.push(uj._id); continue; }
      const newScore = scoreJob(uj.userId, uj.jobId);
      if (newScore === 0) {
        toDelete.push(uj._id);
      } else if (newScore !== uj.score) {
        ops.push({ updateOne: { filter: { _id: uj._id }, update: { $set: { score: newScore } } } });
      }
    }

    if (ops.length) await UserJob.bulkWrite(ops);
    if (toDelete.length) await UserJob.deleteMany({ _id: { $in: toDelete } });

    res.json({ message: 'Done', jobsFixed, rescored: ops.length, removed: toDelete.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/admin/rescore-all
// Re-scores ALL UserJob records across all users using the current scoring algorithm
// Removes records that now score 0 (no skill match)
const rescoreAllUsers = async (_req, res) => {
  try {
    const users = await User.find({ isOnboarded: true, isEmailVerified: true });
    let totalRescored = 0;
    let totalRemoved = 0;

    for (const user of users) {
      const userJobs = await UserJob.find({ userId: user._id }).populate('jobId');
      const toDelete = [];
      const ops = [];

      for (const uj of userJobs) {
        if (!uj.jobId) { toDelete.push(uj._id); continue; }
        const newScore = scoreJob(user, uj.jobId);
        if (newScore === 0) {
          toDelete.push(uj._id);
        } else if (newScore !== uj.score) {
          ops.push({ updateOne: { filter: { _id: uj._id }, update: { $set: { score: newScore } } } });
          totalRescored++;
        }
      }

      if (ops.length) await UserJob.bulkWrite(ops);
      if (toDelete.length) {
        await UserJob.deleteMany({ _id: { $in: toDelete } });
        totalRemoved += toDelete.length;
      }
    }

    res.json({ message: 'Done', rescored: totalRescored, removed: totalRemoved });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/admin/backfill-matches
// Scores every active user against recent jobs, creating any MISSING UserJob records.
// Fixes users who never got matched to jobs due to the fetch/match timing window.
const backfillMatches = async (_req, res) => {
  try {
    await matchJobsForAllUsers();
    res.json({ message: 'Backfill complete — check server logs for new match count' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50, action, status, email } = req.query;
    const filter = {};
    if (action && action !== 'all') filter.action = action;
    if (status === 'error') filter.statusCode = { $gte: 400 };
    if (status === 'success') filter.statusCode = { $lt: 400 };
    if (email) filter.email = { $regex: email, $options: 'i' };

    const skip = (Number(page) - 1) * Number(limit);
    const [logs, total] = await Promise.all([
      RequestLog.find(filter).sort({ timestamp: -1 }).skip(skip).limit(Number(limit)).lean(),
      RequestLog.countDocuments(filter),
    ]);

    res.json({ logs, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getConfig = async (_req, res) => {
  try {
    const docs = await Config.find().lean();
    const cfg = {};
    docs.forEach((d) => { cfg[d.key] = d.value; });
    res.json(cfg);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const updateConfig = async (req, res) => {
  try {
    const updates = req.body; // { key: value, ... }
    await Promise.all(
      Object.entries(updates).map(([key, value]) =>
        Config.findOneAndUpdate({ key }, { key, value }, { upsert: true })
      )
    );
    res.json({ message: 'Config updated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const triggerEmailDigest = async (_req, res) => {
  try {
    const { sendDigest } = require('../jobs/dailyEmail.job');
    await sendDigest({ force: true });
    res.json({ message: 'Digest triggered' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getEmailScheduleStats = async (_req, res) => {
  try {
    const [byInterval, total, paused] = await Promise.all([
      User.aggregate([
        { $match: { isOnboarded: true, isEmailVerified: true } },
        { $group: { _id: '$emailIntervalHours', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      User.countDocuments({ isOnboarded: true, isEmailVerified: true }),
      User.countDocuments({ isOnboarded: true, isEmailVerified: true, emailPaused: true }),
    ]);
    res.json({ byInterval, total, paused });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const setGlobalEmailSchedule = async (req, res) => {
  try {
    const { emailIntervalHours, emailSendHourIST } = req.body;
    const update = {};

    if (emailIntervalHours !== undefined) {
      const interval = Number(emailIntervalHours);
      if (![1, 5, 24].includes(interval)) return res.status(400).json({ message: 'emailIntervalHours must be 1, 5, or 24' });
      update.emailIntervalHours = interval;
    }
    if (emailSendHourIST !== undefined) {
      const hour = Number(emailSendHourIST);
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) return res.status(400).json({ message: 'emailSendHourIST must be 0–23' });
      update.emailSendHourIST = hour;
    }

    const result = await User.updateMany({ isOnboarded: true, isEmailVerified: true }, update);
    res.json({ message: 'Global schedule updated', usersUpdated: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getEmailLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50, email, status } = req.query;
    const filter = {};
    if (email) filter.email = { $regex: email, $options: 'i' };
    if (status && status !== 'all') filter.status = status;
    const skip = (Number(page) - 1) * Number(limit);
    const [logs, total] = await Promise.all([
      EmailLog.find(filter).sort({ sentAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      EmailLog.countDocuments(filter),
    ]);
    res.json({ logs, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getJobBreakdown = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    const job = await Job.findById(req.params.jobId);
    if (!job) return res.status(404).json({ message: 'Job not found' });
    const result = scoreJobWithBreakdown(user, job);
    res.json({ job: { title: job.title, company: job.company, location: job.location }, ...result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getUpcomingEmails = async (_req, res) => {
  try {
    const users = await User.find({ isOnboarded: true, isEmailVerified: true, emailPaused: { $ne: true } })
      .select('name email emailIntervalHours emailSendHourIST lastEmailedAt');

    const now = new Date();
    const IST_OFFSET_MIN = 5 * 60 + 30;

    const upcoming = users.map((u) => {
      let nextAt;
      if (u.emailIntervalHours === 24) {
        const sendMinutesUTC = u.emailSendHourIST * 60 - IST_OFFSET_MIN;
        const todayMidnightUTC = new Date(now);
        todayMidnightUTC.setUTCHours(0, 0, 0, 0);
        let ms = todayMidnightUTC.getTime() + sendMinutesUTC * 60 * 1000;
        if (ms <= now.getTime()) ms += 24 * 60 * 60 * 1000;
        nextAt = new Date(ms);
      } else {
        nextAt = u.lastEmailedAt
          ? new Date(new Date(u.lastEmailedAt).getTime() + u.emailIntervalHours * 60 * 60 * 1000)
          : now;
      }
      return {
        _id: u._id,
        name: u.name,
        email: u.email,
        emailIntervalHours: u.emailIntervalHours,
        emailSendHourIST: u.emailSendHourIST,
        lastEmailedAt: u.lastEmailedAt,
        nextAt: nextAt.toISOString(),
        overdue: nextAt <= now,
      };
    }).sort((a, b) => new Date(a.nextAt) - new Date(b.nextAt));

    res.json(upcoming);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const sendDigestForUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const { sendJobDigestEmail, sendAdminDigestCopy } = require('../services/email.service');
    const EmailLog = require('../models/EmailLog');
    const Config = require('../models/Config');

    const newJobs = await UserJob.find({ userId: user._id, emailed: false, score: { $gte: 50 } })
      .sort({ score: -1 })
      .limit(10)
      .populate('jobId');

    if (!newJobs.length) return res.status(400).json({ message: 'No unread jobs with score ≥ 50 for this user' });

    const jobsPayload = newJobs.map((uj) => ({ job: uj.jobId, score: uj.score }));
    const sentAt = new Date();

    await sendJobDigestEmail(user.email, user.name || 'there', jobsPayload);
    await UserJob.updateMany({ _id: { $in: newJobs.map((uj) => uj._id) } }, { emailed: true });
    await User.updateOne({ _id: user._id }, { lastEmailedAt: sentAt });
    await EmailLog.create({ userId: user._id, email: user.email, name: user.name || '', jobCount: newJobs.length });

    const adminCfg = await Config.findOne({ key: 'adminNotificationEmail' });
    if (adminCfg?.value) {
      sendAdminDigestCopy(adminCfg.value, user.email, user.name || 'there', sentAt, jobsPayload)
        .catch((err) => console.error('[Admin] sendDigestForUser admin copy failed:', err.message));
    }

    res.json({ message: `Email sent to ${user.email} with ${newJobs.length} jobs` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { listUsers, getUserDetail, runApiForUser, updateEmailSchedule, getEmailScheduleStats, setGlobalEmailSchedule, triggerEmailDigest, getConfig, updateConfig, fixGreenhouseDescriptions, rescoreAllUsers, backfillMatches, getLogs, getEmailLogs, getJobBreakdown, sendDigestForUser, getUpcomingEmails };
