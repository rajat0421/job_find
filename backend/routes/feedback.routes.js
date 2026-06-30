const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { submitFeedback, getFeedback } = require('../controllers/feedback.controller');

router.post('/', protect, submitFeedback);
router.get('/', protect, getFeedback);

module.exports = router;
