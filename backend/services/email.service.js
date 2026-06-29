const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // Gmail App Password (not your account password)
  },
});

const sendOtpEmail = async (to, otp) => {
  await transporter.sendMail({
    from: `"JobFind" <${process.env.EMAIL_USER}>`,
    to,
    subject: 'Verify your email - JobFind',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;">
        <h2 style="color:#1a1a1a;">Verify your email</h2>
        <p style="color:#555;">Enter this OTP to complete your registration:</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#2563eb;margin:24px 0;">${otp}</div>
        <p style="color:#888;font-size:13px;">Expires in 10 minutes. If you didn't sign up, ignore this email.</p>
      </div>
    `,
  });
};

const sendJobDigestEmail = async (to, name, jobs) => {
  const jobsHtml = jobs
    .map(
      (j, i) => `
      <div style="margin-bottom:24px;padding-bottom:24px;border-bottom:1px solid #eee;">
        <h3 style="margin:0 0 4px;">${i + 1}. ${j.job.title}</h3>
        <p style="margin:0;color:#555;">${j.job.company || 'Company not listed'} &bull; ${j.job.location || 'Location not listed'}</p>
        <p style="margin:8px 0;"><span style="background:#dbeafe;color:#1d4ed8;padding:2px 10px;border-radius:999px;font-size:13px;font-weight:600;">${j.score}% match</span></p>
        ${j.job.salaryMin ? `<p style="color:#555;margin:4px 0;">₹${(j.job.salaryMin / 100000).toFixed(1)}–${(j.job.salaryMax / 100000).toFixed(1)} LPA</p>` : ''}
        <a href="${j.job.applyLink}" style="display:inline-block;margin-top:10px;padding:8px 18px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-size:14px;">Apply Now →</a>
      </div>
    `
    )
    .join('');

  await transporter.sendMail({
    from: `"JobFind" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Good morning ${name} 👋 — ${jobs.length} new jobs matched today`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;">
        <h2 style="color:#1a1a1a;">Good morning, ${name}!</h2>
        <p style="color:#555;">We found <strong>${jobs.length} new jobs</strong> that match your profile today.</p>
        <hr style="margin:24px 0;border:none;border-top:1px solid #eee;" />
        ${jobsHtml}
        <p style="color:#aaa;font-size:12px;margin-top:32px;">You're receiving this because you signed up on JobFind.</p>
      </div>
    `,
  });
};

module.exports = { sendOtpEmail, sendJobDigestEmail };
