const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { submitFeedback, getFeedback, toggleLike, addReply } = require('../controllers/feedback.controller');

router.post('/',            protect, submitFeedback);
router.get('/',             protect, getFeedback);
router.post('/:id/like',   protect, toggleLike);
router.post('/:id/reply',  protect, addReply);

module.exports = router;
