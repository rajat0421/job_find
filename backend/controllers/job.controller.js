const UserJob = require('../models/UserJob');

const getMatchedJobs = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const minScore = parseInt(req.query.minScore) || 40;

    const filter = { userId: req.user.id, score: { $gte: minScore } };

    const [total, userJobs] = await Promise.all([
      UserJob.countDocuments(filter),
      UserJob.find(filter)
        .sort({ score: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('jobId'),
    ]);

    const jobs = userJobs
      .filter((uj) => uj.jobId) // skip UserJobs whose Job was deleted
      .map((uj) => ({
        ...uj.jobId.toObject(),
        score: uj.score,
        matchedSkills: uj.matchedSkills || [],
        matchedRole: uj.matchedRole || null,
        reasons: uj.reasons || [],
        saved: uj.saved,
        applied: uj.applied,
        userJobId: uj._id,
      }));

    res.json({ jobs, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const toggleSaved = async (req, res) => {
  try {
    const uj = await UserJob.findOne({ userId: req.user.id, jobId: req.params.jobId });
    if (!uj) return res.status(404).json({ message: 'Job not found' });
    uj.saved = !uj.saved;
    await uj.save();
    res.json({ saved: uj.saved });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const markApplied = async (req, res) => {
  try {
    const result = await UserJob.updateOne(
      { userId: req.user.id, jobId: req.params.jobId },
      { applied: true }
    );
    if (!result.matchedCount) return res.status(404).json({ message: 'Job not found' });
    res.json({ message: 'Marked as applied' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getMatchedJobs, toggleSaved, markApplied };
