const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const OtpVerification = require('../models/OtpVerification');
const { generateOtp, otpExpiry } = require('../utils/otp');
const { sendOtpEmail, sendPasswordResetEmail } = require('../services/email.service');
const { matchJobsForUser } = require('../services/jobMatcher.service');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const register = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password required' });

    const existing = await User.findOne({ email });
    if (existing && existing.isEmailVerified)
      return res.status(409).json({ message: 'Email already registered' });

    // Unverified user — update their password (they may have retyped it) and resend OTP
    if (existing && !existing.isEmailVerified) {
      const hashed = await bcrypt.hash(password, 10);
      await User.updateOne({ email }, { password: hashed });
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
    if (!user.password) return res.status(400).json({ message: 'This account uses Google sign-in. Please continue with Google.' });

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

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    const user = await User.findOne({ email });
    // Always respond the same way to prevent email enumeration
    if (!user || !user.isEmailVerified) {
      return res.json({ message: 'If this email is registered, an OTP has been sent.' });
    }

    const otp = generateOtp();
    await OtpVerification.deleteMany({ email, type: 'password_reset' });
    await OtpVerification.create({ email, otp, type: 'password_reset', expiresAt: otpExpiry() });

    res.json({ message: 'If this email is registered, an OTP has been sent.' });

    sendPasswordResetEmail(email, otp).catch((err) =>
      console.error('[Email] Password reset OTP failed for', email, ':', err.message)
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) return res.status(400).json({ message: 'Email, OTP and new password are required' });
    if (newPassword.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });

    const record = await OtpVerification.findOne({ email, otp, type: 'password_reset' });
    if (!record || record.expiresAt < new Date()) return res.status(400).json({ message: 'Invalid or expired OTP' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await User.updateOne({ email }, { password: hashed });
    await OtpVerification.deleteMany({ email, type: 'password_reset' });

    res.json({ message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const googleAuth = async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ message: 'Google credential is required' });

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ message: 'Invalid Google credential' });
    }

    const { sub: googleId, email, name, email_verified } = payload;
    if (!email_verified) return res.status(403).json({ message: 'Google email is not verified' });

    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({ email, name, googleId, isEmailVerified: true });
    } else if (!user.googleId) {
      // Existing local account signing in with Google for the first time — link it
      await User.updateOne({ email }, { googleId, isEmailVerified: true, name: user.name || name });
      user = await User.findOne({ email });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, isOnboarded: user.isOnboarded, name: user.name, email: user.email });

    if (user.isOnboarded) {
      matchJobsForUser(user._id).catch((err) =>
        console.error('[Matcher] Google login match failed:', err.message)
      );
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { register, verifyOtp, login, resendOtp, forgotPassword, resetPassword, googleAuth };
