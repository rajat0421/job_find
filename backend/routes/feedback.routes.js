const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { submitFeedback, getFeedback, toggleLike, toggleDislike } = require('../controllers/feedback.controller');

router.post('/',             protect, submitFeedback);
router.get('/',              protect, getFeedback);
router.post('/:id/like',    protect, toggleLike);
router.post('/:id/dislike', protect, toggleDislike);

module.exports = router;
