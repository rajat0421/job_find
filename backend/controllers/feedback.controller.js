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
      status: 'pending',
    });

    res.json(fb);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Public — only approved feedbacks
const getFeedback = async (req, res) => {
  try {
    const feedbacks = await Feedback.find({ status: 'approved' })
      .sort({ timestamp: -1 })
      .limit(50)
      .select('message name timestamp likes dislikes');
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
    const likeIdx = fb.likes.findIndex(id => id.toString() === uid);
    const dislikeIdx = fb.dislikes.findIndex(id => id.toString() === uid);

    if (likeIdx === -1) {
      fb.likes.push(req.user.id);
      if (dislikeIdx !== -1) fb.dislikes.splice(dislikeIdx, 1); // remove dislike if switching
    } else {
      fb.likes.splice(likeIdx, 1); // toggle off
    }
    await fb.save();
    res.json({ likes: fb.likes, dislikes: fb.dislikes });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const toggleDislike = async (req, res) => {
  try {
    const fb = await Feedback.findById(req.params.id);
    if (!fb) return res.status(404).json({ message: 'Feedback not found' });

    const uid = req.user.id.toString();
    const dislikeIdx = fb.dislikes.findIndex(id => id.toString() === uid);
    const likeIdx = fb.likes.findIndex(id => id.toString() === uid);

    if (dislikeIdx === -1) {
      fb.dislikes.push(req.user.id);
      if (likeIdx !== -1) fb.likes.splice(likeIdx, 1); // remove like if switching
    } else {
      fb.dislikes.splice(dislikeIdx, 1); // toggle off
    }
    await fb.save();
    res.json({ likes: fb.likes, dislikes: fb.dislikes });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Admin — all feedbacks with status
const adminGetFeedback = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const feedbacks = await Feedback.find(filter)
      .sort({ timestamp: -1 })
      .limit(200)
      .select('message name timestamp status likes dislikes');
    res.json(feedbacks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const approveFeedback = async (req, res) => {
  try {
    const fb = await Feedback.findByIdAndUpdate(req.params.id, { status: 'approved' }, { new: true });
    if (!fb) return res.status(404).json({ message: 'Feedback not found' });
    res.json(fb);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const declineFeedback = async (req, res) => {
  try {
    const fb = await Feedback.findByIdAndUpdate(req.params.id, { status: 'declined' }, { new: true });
    if (!fb) return res.status(404).json({ message: 'Feedback not found' });
    res.json(fb);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const deleteFeedback = async (req, res) => {
  try {
    const fb = await Feedback.findByIdAndDelete(req.params.id);
    if (!fb) return res.status(404).json({ message: 'Feedback not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { submitFeedback, getFeedback, toggleLike, toggleDislike, adminGetFeedback, approveFeedback, declineFeedback, deleteFeedback };
