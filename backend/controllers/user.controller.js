const User = require('../models/User');

const onboard = async (req, res) => {
  try {
    const { name, skills, experience, locations, salary, remotePreference } = req.body;
    if (!name || !skills?.length || !experience || !locations?.length)
      return res.status(400).json({ message: 'Name, skills, experience and locations are required' });

    await User.updateOne(
      { _id: req.user.id },
      { name, skills, experience, locations, salary, remotePreference, isOnboarded: true }
    );

    res.json({ message: 'Profile saved. Welcome aboard!' });
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
    const { name, skills, experience, locations, salary, remotePreference } = req.body;
    await User.updateOne(
      { _id: req.user.id },
      { name, skills, experience, locations, salary, remotePreference }
    );
    res.json({ message: 'Profile updated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { onboard, getProfile, updateProfile };
