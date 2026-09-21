const express = require('express');
const router = express.Router();
const { register, verifyOtp, login, resendOtp, forgotPassword, resetPassword, googleAuth } = require('../controllers/auth.controller');

router.post('/register', register);
router.post('/verify-otp', verifyOtp);
router.post('/resend-otp', resendOtp);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/google', googleAuth);

module.exports = router;
