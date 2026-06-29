const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { onboard, getProfile, updateProfile } = require('../controllers/user.controller');

router.post('/onboard', protect, onboard);
router.get('/profile', protect, getProfile);
router.put('/profile', protect, updateProfile);

module.exports = router;
