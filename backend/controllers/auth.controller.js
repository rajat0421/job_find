const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const OtpVerification = require('../models/OtpVerification');
const { generateOtp, otpExpiry } = require('../utils/otp');
const { sendOtpEmail } = require('../services/email.service');
const { matchJobsForUser } = require('../services/jobMatcher.service');

const register = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password required' });

    const existing = await User.findOne({ email });
    if (existing && existing.isEmailVerified)
      return res.status(409).json({ message: 'Email already registered' });

    // Unverified user — resend OTP instead of blocking them
    if (existing && !existing.isEmailVerified) {
      const otp = generateOtp();
      await OtpVerification.deleteMany({ email });
      await OtpVerification.create({ email, otp, expiresAt: otpExpiry() });
      res.status(201).json({ message: 'Registered. Check your email for the OTP.' });
      sendOtpEmail(email, otp).catch((err) =>
        console.error('[Email] OTP send failed for', email, ':', err.message)
      );
      return;
    }

    const hashed = await bcrypt.hash(password, 10);
    await User.create({ email, password: hashed });

    const otp = generateOtp();
    await OtpVerification.deleteMany({ email });
    await OtpVerification.create({ email, otp, expiresAt: otpExpiry() });

    // Respond immediately — don't make the user wait for email delivery
    res.status(201).json({ message: 'Registered. Check your email for the OTP.' });

    // Send email in background — if it fails it logs but doesn't block
    sendOtpEmail(email, otp).catch((err) =>
      console.error('[Email] OTP send failed for', email, ':', err.message)
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const record = await OtpVerification.findOne({ email, otp });

    if (!record || record.expiresAt < new Date())
      return res.status(400).json({ message: 'Invalid or expired OTP' });

    await User.updateOne({ email }, { isEmailVerified: true });
    await OtpVerification.deleteMany({ email });

    const user = await User.findOne({ email });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({ message: 'Email verified', token, isOnboarded: user.isOnboarded });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    if (!user.isEmailVerified) return res.status(403).json({ message: 'Please verify your email first' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, isOnboarded: user.isOnboarded, name: user.name });

    // Fire-and-forget: score any new jobs since the user last logged in
    if (user.isOnboarded) {
      matchJobsForUser(user._id).catch((err) =>
        console.error('[Matcher] Login match failed:', err.message)
      );
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const resendOtp = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.isEmailVerified) return res.status(400).json({ message: 'Email already verified' });

    const otp = generateOtp();
    await OtpVerification.deleteMany({ email });
    await OtpVerification.create({ email, otp, expiresAt: otpExpiry() });

    res.json({ message: 'OTP resent' });

    sendOtpEmail(email, otp).catch((err) =>
      console.error('[Email] Resend OTP failed for', email, ':', err.message)
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { register, verifyOtp, login, resendOtp };
