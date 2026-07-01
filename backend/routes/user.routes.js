const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { onboard, getProfile, updateProfile, toggleEmailPause } = require('../controllers/user.controller');

router.post('/onboard', protect, onboard);
router.get('/profile', protect, getProfile);
router.put('/profile', protect, updateProfile);
router.post('/unsubscribe', protect, toggleEmailPause);

module.exports = router;
