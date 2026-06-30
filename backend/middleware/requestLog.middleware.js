const RequestLog = require('../models/RequestLog');

const ACTION_MAP = {
  'POST /api/auth/register': 'Register',
  'POST /api/auth/login': 'Login',
  'POST /api/auth/verify-otp': 'Verify Email',
  'POST /api/auth/resend-otp': 'Resend OTP',
  'POST /api/auth/forgot-password': 'Forgot Password',
  'POST /api/auth/reset-password': 'Reset Password',
  'POST /api/user/onboard': 'Onboarding',
  'GET /api/user/profile': 'View Profile',
  'PUT /api/user/profile': 'Profile Update',
  'GET /api/jobs/matched': 'View Matched Jobs',
};

const SENSITIVE_KEYS = ['password', 'newPassword', 'token'];

const sanitize = (body) => {
  if (!body || typeof body !== 'object') return body;
  const clean = { ...body };
  SENSITIVE_KEYS.forEach((k) => {
    if (clean[k] !== undefined) clean[k] = '[REDACTED]';
  });
  return clean;
};

const requestLogMiddleware = (req, res, next) => {
  if (
    req.path.startsWith('/api/admin') ||
    req.path === '/api/health' ||
    req.path.startsWith('/api/dev')
  ) {
    return next();
  }

  const timestamp = new Date();
  const originalJson = res.json.bind(res);
  let resBody;

  res.json = (body) => {
    resBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    const key = `${req.method} ${req.path}`;
    const action = ACTION_MAP[key] || `${req.method} ${req.path}`;

    RequestLog.create({
      method: req.method,
      path: req.path,
      action,
      reqBody: sanitize(req.body),
      resBody,
      statusCode: res.statusCode,
      userId: req.user?.id || null,
      email: req.body?.email || null,
      ip: req.ip,
      timestamp,
    }).catch((err) => console.error('[RequestLog]', err.message));
  });

  next();
};

module.exports = requestLogMiddleware;
