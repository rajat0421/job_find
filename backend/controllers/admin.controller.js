const axios = require('axios');
const User = require('../models/User');
const Job = require('../models/Job');
const UserJob = require('../models/UserJob');
const { scoreJob } = require('../services/jobMatcher.service');

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
// Calls Adzuna live, scores results for this user, returns raw req + raw res + matched jobs
const runApiForUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const params = {
      app_id: process.env.ADZUNA_APP_ID,
      app_key: process.env.ADZUNA_APP_KEY,
      results_per_page: 50,
      what: 'software engineer developer',
      where: 'India',
    };

    const requestInfo = {
      method: 'GET',
      url: 'https://api.adzuna.com/v1/api/jobs/in/search/1',
      params: { ...params, app_key: '***hidden***' },
    };

    const response = await axios.get(requestInfo.url, { params });
    const rawJobs = response.data.results || [];

    // Score every job from this API call against this specific user
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
        return { job: jobObj, score: scoreJob(user, jobObj), rawAdzuna: j };
      })
      .sort((a, b) => b.score - a.score);

    const willShow = scored.filter((j) => j.score >= 40);
    const wontShow = scored.filter((j) => j.score < 40);

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
      request: requestInfo,
      rawResponse: {
        total_results: response.data.count,
        returned: rawJobs.length,
        results: rawJobs,
      },
      matched: {
        count: willShow.length,
        minScoreThreshold: 40,
        jobs: willShow,
      },
      filtered_out: {
        count: wontShow.length,
        jobs: wontShow,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { listUsers, getUserDetail, runApiForUser };
