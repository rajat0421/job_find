const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { getMatchedJobs, toggleSaved, markApplied } = require('../controllers/job.controller');

router.get('/', protect, getMatchedJobs);
router.patch('/:jobId/save', protect, toggleSaved);
router.patch('/:jobId/applied', protect, markApplied);

module.exports = router;
