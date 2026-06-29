const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const OtpVerification = require('../models/OtpVerification');
const { generateOtp, otpExpiry } = require('../utils/otp');
const { sendOtpEmail } = require('../services/email.service');

const register = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password required' });

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 10);
    await User.create({ email, password: hashed });

    const otp = generateOtp();
    await OtpVerification.deleteMany({ email });
    await OtpVerification.create({ email, otp, expiresAt: otpExpiry() });
    await sendOtpEmail(email, otp);

    res.status(201).json({ message: 'Registered. Check your email for the OTP.' });
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

    // Auto-grant admin if email matches ADMIN_EMAIL env var
    if (process.env.ADMIN_EMAIL && user.email === process.env.ADMIN_EMAIL && !user.isAdmin) {
      await User.updateOne({ _id: user._id }, { isAdmin: true });
      user.isAdmin = true;
    }

    const token = jwt.sign({ id: user._id, isAdmin: user.isAdmin }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, isOnboarded: user.isOnboarded, name: user.name, isAdmin: user.isAdmin });
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
    await sendOtpEmail(email, otp);

    res.json({ message: 'OTP resent' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { register, verifyOtp, login, resendOtp };
