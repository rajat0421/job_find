const axios = require('axios');

const sendHtmlEmail = async (to, subject, html) => {
  const res = await axios.post(
    process.env.EMAIL_API_URL,
    { to, subject, html },
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

const sendJobDigestEmail = (to, name, jobs) => {
  const jobsHtml = jobs
    .map(
      (j, i) => `
      <div style="margin-bottom:24px;padding-bottom:24px;border-bottom:1px solid #e5e7eb;">
        <h3 style="margin:0 0 4px;font-size:16px;">${i + 1}. ${j.job.title}</h3>
        <p style="margin:0;color:#6b7280;font-size:14px;">${j.job.company || '—'} &bull; ${j.job.location || '—'}</p>
        <p style="margin:8px 0;">
          <span style="background:#dbeafe;color:#1d4ed8;padding:3px 10px;border-radius:999px;font-size:13px;font-weight:600;">${j.score}% match</span>
        </p>
        ${j.job.salaryMin ? `<p style="color:#6b7280;font-size:13px;margin:4px 0;">₹${(j.job.salaryMin / 100000).toFixed(1)}–${(j.job.salaryMax / 100000).toFixed(1)} LPA</p>` : ''}
        <a href="${j.job.applyLink}" style="display:inline-block;margin-top:10px;padding:8px 18px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-size:14px;">Apply Now →</a>
      </div>
    `
    )
    .join('');

  return sendHtmlEmail(
    to,
    `Good morning ${name} 👋 — ${jobs.length} new jobs matched today`,
    `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;">
      <h2 style="color:#111827;margin:0 0 8px;">Good morning, ${name}!</h2>
      <p style="color:#6b7280;margin:0 0 24px;">We found <strong>${jobs.length} new jobs</strong> matching your profile today.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 24px;" />
      ${jobsHtml}
      <p style="color:#9ca3af;font-size:12px;margin-top:32px;">You're receiving this because you signed up on JobFind.</p>
    </div>
    `
  );
};

module.exports = { sendOtpEmail, sendJobDigestEmail };
