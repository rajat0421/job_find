const Feedback = require('../models/Feedback');
const User = require('../models/User');

const submitFeedback = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ message: 'Feedback message is required' });

    const user = await User.findById(req.user.id).select('name');
    const fb = await Feedback.create({
      message: message.trim(),
      userId: req.user.id,
      name: user?.name || 'Anonymous',
    });

    res.json(fb);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getFeedback = async (req, res) => {
  try {
    const feedbacks = await Feedback.find()
      .sort({ timestamp: -1 })
      .limit(50)
      .select('message name timestamp userId');
    res.json(feedbacks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { submitFeedback, getFeedback };
