const crypto = require('crypto');

const generateOtp = () => crypto.randomInt(100000, 999999).toString();

const otpExpiry = () => new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

module.exports = { generateOtp, otpExpiry };
