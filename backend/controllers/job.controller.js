const UserJob = require('../models/UserJob');
const { MATCHER_VERSION } = require('../services/jobMatcher.service');

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

    const INACTIVE = ['closed', 'expired'];
    const jobs = userJobs
      .filter((uj) => uj.jobId) // skip UserJobs whose Job was deleted
      // Inactive postings AND stale-matcher-version scores are excluded from
      // normal recommendations, but stay visible in a user's own saved/applied
      // history — exactly the same precedent as the status check already
      // applies. A record not yet reprocessed under the CURRENT MATCHER_VERSION
      // reflects a previous scoring algorithm's judgment and must never be
      // presented as a current, verified match (the false-positive incident
      // this guards: a stale score of 88 under the old algorithm must not
      // appear as "your match" before the bounded version sweep corrects it —
      // see jobMatcher.service.js). Never filtered out of the DB query itself
      // (`filter` above) — that would ALSO hide a user's own saved/applied
      // history while it's awaiting re-scoring, not just unconfirmed new
      // recommendations.
      .filter((uj) => uj.saved || uj.applied || (!INACTIVE.includes(uj.jobId.status) && uj.matcherVersion === MATCHER_VERSION))
      .map((uj) => ({
        ...uj.jobId.toObject(),
        score: uj.score,
        matchedSkills: uj.matchedSkills || [],
        matchedRole: uj.matchedRole || null,
        reasons: uj.reasons || [],
        saved: uj.saved,
        applied: uj.applied,
        userJobId: uj._id,
        // True whenever this record hasn't been reprocessed under the current
        // scoring version yet (only possible here for a saved/applied job —
        // see the filter above). The score/reasons above are then the
        // PREVIOUS algorithm's result, not a current verified match — callers
        // should treat them as provisional (e.g. "refreshing your match...")
        // rather than display them as-is.
        matchStale: uj.matcherVersion !== MATCHER_VERSION,
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
