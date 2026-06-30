const express = require('express');
const router = express.Router();
const { register, verifyOtp, login, resendOtp, forgotPassword, resetPassword } = require('../controllers/auth.controller');

router.post('/register', register);
router.post('/verify-otp', verifyOtp);
router.post('/resend-otp', resendOtp);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

module.exports = router;
