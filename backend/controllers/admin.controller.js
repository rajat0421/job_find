const axios = require('axios');
const crypto = require('crypto');
const User = require('../models/User');
const Job = require('../models/Job');
const UserJob = require('../models/UserJob');
const { scoreJob } = require('../services/jobMatcher.service');

const generateJobHash = (title, company, location) =>
  crypto.createHash('md5').update(`${title}-${company}-${location}`).digest('hex');

// Fetch + score Adzuna jobs live for a specific user (no DB save)
const runAdzunaForUser = async (user) => {
  const params = {
    app_id: process.env.ADZUNA_APP_ID,
    app_key: process.env.ADZUNA_APP_KEY,
    results_per_page: 50,
    what: 'software engineer developer',
    where: 'India',
  };

  const url = 'https://api.adzuna.com/v1/api/jobs/in/search/1';
  const response = await axios.get(url, { params });
  const rawJobs = response.data.results || [];

  const scored = rawJobs
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
    request: { method: 'GET', url, params: { ...params, app_key: '***hidden***' } },
    total_fetched: rawJobs.length,
    raw_results: rawJobs,
    matched: scored.filter((j) => j.score >= 40),
    filtered_out: scored.filter((j) => j.score < 40),
  };
};

// Fetch + score Greenhouse jobs live for a specific user (no DB save)
const GREENHOUSE_BOARDS = require('../platforms/greenhouse').BOARDS;

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
          description: j.content || '',
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
      .populate('jobId');

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

    const [adzuna, greenhouse] = await Promise.allSettled([
      runAdzunaForUser(user),
      runGreenhouseForUser(user),
    ]);

    const platforms = [
      adzuna.status === 'fulfilled' ? adzuna.value : { platform: 'Adzuna', error: adzuna.reason?.message },
      greenhouse.status === 'fulfilled' ? greenhouse.value : { platform: 'Greenhouse', error: greenhouse.reason?.message },
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

module.exports = { listUsers, getUserDetail, runApiForUser, updateEmailSchedule };
