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
      .select('message name timestamp userId likes replies');
    res.json(feedbacks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const toggleLike = async (req, res) => {
  try {
    const fb = await Feedback.findById(req.params.id);
    if (!fb) return res.status(404).json({ message: 'Feedback not found' });

    const uid = req.user.id.toString();
    const idx = fb.likes.findIndex(id => id.toString() === uid);
    if (idx === -1) {
      fb.likes.push(req.user.id);
    } else {
      fb.likes.splice(idx, 1);
    }
    await fb.save();
    res.json({ likes: fb.likes });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const addReply = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ message: 'Reply cannot be empty' });

    const fb = await Feedback.findById(req.params.id);
    if (!fb) return res.status(404).json({ message: 'Feedback not found' });

    const user = await User.findById(req.user.id).select('name');
    fb.replies.push({
      message: message.trim(),
      userId: req.user.id,
      name: user?.name || 'Anonymous',
    });
    await fb.save();

    res.json(fb.replies[fb.replies.length - 1]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { submitFeedback, getFeedback, toggleLike, addReply };
