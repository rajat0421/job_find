const User = require('../models/User');
const { matchJobsForUser } = require('../services/jobMatcher.service');

const onboard = async (req, res) => {
  try {
    const { name, skills, experience, locations, salary, remotePreference, desiredRoles, qualification } = req.body;
    if (!name || !skills?.length || experience == null || !locations?.length)
      return res.status(400).json({ message: 'Name, skills, experience and locations are required' });

    await User.updateOne(
      { _id: req.user.id },
      {
        name, skills, experience, locations, salary, remotePreference,
        desiredRoles: desiredRoles || [],
        qualification: qualification || null,
        isOnboarded: true,
      }
    );

    res.json({ message: 'Profile saved. Welcome aboard!' });

    // Fire-and-forget: score all existing jobs immediately so the dashboard isn't empty
    matchJobsForUser(req.user.id).catch((err) =>
      console.error('[Matcher] Onboard match failed:', err.message)
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const { name, skills, experience, locations, salary, remotePreference, desiredRoles, qualification } = req.body;
    const update = {};
    if (name              !== undefined) update.name              = name;
    if (skills            !== undefined) update.skills            = skills;
    if (experience        !== undefined) update.experience        = experience;
    if (locations         !== undefined) update.locations         = locations;
    if (remotePreference  !== undefined) update.remotePreference  = remotePreference;
    if (qualification     !== undefined) update.qualification     = qualification || null;
    if (desiredRoles      !== undefined) {
      update.desiredRoles = desiredRoles || [];
    }
    // salary can be 0 or null (user clearing it) — only skip if not sent at all
    if (salary !== undefined) update.salary = salary || null;

    await User.updateOne({ _id: req.user.id }, { $set: update });
    res.json({ message: 'Profile updated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const toggleEmailPause = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('emailPaused');
    const next = !user.emailPaused;
    await User.updateOne({ _id: req.user.id }, { $set: { emailPaused: next } });
    res.json({ emailPaused: next });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { onboard, getProfile, updateProfile, toggleEmailPause };
