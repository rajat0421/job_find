const axios = require('axios');

const sendHtmlEmail = async (to, subject, html) => {
  const res = await axios.post(
    process.env.EMAIL_API_URL,
    { to, subject, html, fromName: 'JobFind' },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.EMAIL_API_KEY || '',
      },
    }
  );
  return res.data;
};

const sendOtpEmail = (to, otp) =>
  sendHtmlEmail(
    to,
    'Verify your email — JobFind',
    `
    <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;">
      <h2 style="color:#2563eb;margin:0 0 8px;">Verify your email</h2>
      <p style="color:#555;margin:0 0 24px;">Enter this OTP to complete your registration:</p>
      <div style="font-size:36px;font-weight:bold;letter-spacing:10px;color:#1d4ed8;background:#eff6ff;padding:20px;border-radius:10px;text-align:center;">${otp}</div>
      <p style="color:#888;font-size:13px;margin-top:20px;">Expires in 10 minutes. If you didn't sign up, ignore this email.</p>
    </div>
    `
  );

const scoreBadge = (score) => {
  if (score >= 75) return { bg: '#dcfce7', color: '#15803d', label: 'Strong match' };
  if (score >= 50) return { bg: '#fef9c3', color: '#92400e', label: 'Good match' };
  return               { bg: '#f3f4f6', color: '#6b7280',  label: 'Partial match' };
};

const sendJobDigestEmail = (to, name, jobs) => {
  const jobsHtml = jobs
    .map((j, i) => {
      const badge = scoreBadge(j.score);
      const salary = j.job.salaryMin && j.job.salaryMax
        ? `₹${(j.job.salaryMin / 100000).toFixed(1)}–${(j.job.salaryMax / 100000).toFixed(1)} LPA`
        : '';
      return `
      <div style="margin-bottom:16px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <div style="padding:16px 20px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <span style="font-size:12px;font-weight:700;color:#9ca3af;">#${i + 1}</span>
              <span style="background:${badge.bg};color:${badge.color};font-size:11px;font-weight:700;padding:2px 10px;border-radius:999px;white-space:nowrap;">
                ${j.score}% &mdash; ${badge.label}
              </span>
            </div>
            <p style="margin:0 0 3px;font-size:15px;font-weight:700;color:#111827;">${j.job.title}</p>
            <p style="margin:0;font-size:13px;color:#6b7280;">${j.job.company || ''}${j.job.company && j.job.location ? ' &bull; ' : ''}${j.job.location || ''}</p>
            ${salary ? `<p style="margin:6px 0 0;font-size:13px;color:#4b5563;font-weight:500;">${salary}</p>` : ''}
          </div>
        </div>
        <div style="padding:0 20px 16px;">
          <a href="${j.job.applyLink}" style="display:inline-block;padding:8px 20px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">
            View &amp; Apply &rarr;
          </a>
        </div>
      </div>
      `;
    })
    .join('');

  const topScore = jobs[0]?.score || 0;
  const badge = scoreBadge(topScore);

  return sendHtmlEmail(
    to,
    `${jobs.length} new job matches for you — top match ${jobs[0]?.score || 0}%`,
    `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:auto;background:#f9fafb;padding:32px 16px;">

      <!-- Header -->
      <div style="background:#4f46e5;border-radius:16px;padding:28px 28px 24px;margin-bottom:24px;text-align:left;">
        <p style="margin:0 0 4px;color:#c7d2fe;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">JobFind</p>
        <h1 style="margin:0 0 8px;color:#fff;font-size:22px;font-weight:800;">Hi ${name}, your job digest is here</h1>
        <p style="margin:0;color:#c7d2fe;font-size:14px;">
          We found <strong style="color:#fff;">${jobs.length} new jobs</strong> matching your profile.
          Your top match is <strong style="color:#fff;">${topScore}%</strong>.
        </p>
      </div>

      <!-- Job list -->
      <div style="margin-bottom:24px;">
        ${jobsHtml}
      </div>

      <!-- Footer -->
      <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">
        You're receiving this because you signed up on JobFind.<br/>
        Jobs are matched to your skills, location, experience and salary preference.
      </p>
    </div>
    `
  );
};

const sendPasswordResetEmail = (to, otp) =>
  sendHtmlEmail(
    to,
    'Reset your password — JobFind',
    `
    <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;">
      <h2 style="color:#2563eb;margin:0 0 8px;">Reset your password</h2>
      <p style="color:#555;margin:0 0 24px;">Use this OTP to set a new password. It expires in 10 minutes.</p>
      <div style="font-size:36px;font-weight:bold;letter-spacing:10px;color:#1d4ed8;background:#eff6ff;padding:20px;border-radius:10px;text-align:center;">${otp}</div>
      <p style="color:#888;font-size:13px;margin-top:20px;">If you didn't request a password reset, you can safely ignore this email.</p>
    </div>
    `
  );

module.exports = { sendOtpEmail, sendPasswordResetEmail, sendJobDigestEmail };
