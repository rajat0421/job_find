const axios = require('axios');

// Absolute base for links embedded in emails (profile/preferences, unsubscribe).
// Falls back to the known production frontend domain — never a relative path,
// since a link has to resolve correctly from inside an email client, not from
// whatever page this code happens to run alongside.
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://jobfind.runwavelabs.com').replace(/\/+$/, '');

// Fixed, trusted destination for the prominent "Open JobFind Dashboard" CTA
// at the end of every digest. Deliberately a hardcoded literal — unlike
// FRONTEND_URL above (env-configurable), this one must never be influenced by
// configuration or any other input, per explicit instruction.
const JOBFIND_DASHBOARD_URL = 'https://jobfind.runwavelabs.com/dashboard';

// Job titles, company names, locations and similar fields all originate from
// external job boards (Adzuna/Greenhouse/Lever/Ashby) and must be treated as
// untrusted input — escaped before being placed in HTML, the same way any
// other external user content would be. Also used for admin-copy fields
// (user name/email) as defense in depth, even though those are first-party.
const escapeHtml = (value) => {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

// A mail header (the subject line) is never HTML-rendered, but a raw
// CR/LF inside it could still be used for header injection if it ever
// contained attacker-influenced text — strip line breaks and cap length.
const sanitizeHeaderText = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 180);

// Only ever embed an http(s) URL as a link target — a job's applyLink is
// sourced from an external board and must not be trusted blindly (e.g. a
// malformed or `javascript:` value). A job that fails this check simply has
// its "View & Apply" button omitted rather than guessing a fallback link.
const isSafeHttpUrl = (url) => {
  if (typeof url !== 'string' || !url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

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

  // Guard against a 200-but-failed response (silent failure) so the digest job
  // logs it as 'failed' with a real reason instead of falsely marking it 'sent'.
  const data = res.data;
  if (data && (data.success === false || data.error || data.ok === false)) {
    throw new Error(data.error || data.message || 'Email provider reported failure');
  }
  return data;
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

// Only the three values jobFetcher/jobLifecycle actually normalize into
// `workplaceType` are shown — never inferred from a location string, since
// that's a materially less reliable signal (see jobMatcher.service.js's own
// `isRemote`/`isHybrid`, which deliberately falls back to a text match for
// SCORING purposes, but that fallback is not reliable enough to assert as a
// fact to the user in an email).
const workplaceLabel = (job) => {
  const type = String(job?.workplaceType || '').toLowerCase();
  if (type === 'remote') return 'Remote';
  if (type === 'hybrid') return 'Hybrid';
  if (type === 'onsite') return 'On-site';
  return null;
};

// A range needs both bounds to be meaningful; a single bound is still real,
// useful information (and already meaningful to scoreJobDetailed's own salary
// scoring) so it's shown as "Up to"/"From" rather than discarded. No bounds
// at all means no salary section at all — never a fabricated figure.
const salaryLabel = (job) => {
  const min = Number(job?.salaryMin) || 0;
  const max = Number(job?.salaryMax) || 0;
  const fmt = (n) => `₹${(n / 100000).toFixed(1)} LPA`;
  if (min && max) return `${fmt(min)} – ${fmt(max)}`;
  if (max) return `Up to ${fmt(max)}`;
  if (min) return `From ${fmt(min)}`;
  return null;
};

// Renders one job's card. `entry` is `{ job, score, matchedSkills, matchedRole, reasons }`
// as assembled by dailyEmail.job.js from a populated UserJob — every field
// here is data the matcher already computed, nothing is re-derived or invented.
const renderJobCard = (entry) => {
  const job = entry?.job || {};
  const score = Math.max(0, Math.min(100, Math.round(entry?.score || 0)));
  const badge = scoreBadge(score);

  const title = escapeHtml(job.title || 'Untitled role');
  const company = escapeHtml(job.company || '');
  const location = escapeHtml(job.location || '');
  const metaLine = [company, location].filter(Boolean).join(' &nbsp;&bull;&nbsp; ');

  const workplaceSalaryLine = [workplaceLabel(job), salaryLabel(job)].filter(Boolean).join(' &nbsp;&middot;&nbsp; ');

  // matchedSkills and reasons can be missing/null on older or malformed
  // records — never assume either is an array.
  const skills = (Array.isArray(entry?.matchedSkills) ? entry.matchedSkills : [])
    .filter((s) => typeof s === 'string' && s.trim())
    .slice(0, 5);
  // Deduplicated so the same reason (e.g. from a stale re-send path) is never
  // listed twice in one card.
  const reasons = [...new Set((Array.isArray(entry?.reasons) ? entry.reasons : []).filter((r) => typeof r === 'string' && r.trim()))]
    .slice(0, 3);

  const skillsHtml = skills.length
    ? `<div style="margin-top:10px;">${skills.map((s) => `<span style="display:inline-block;background:#ede9fe;color:#5b21b6;font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;margin:0 6px 6px 0;">${escapeHtml(s)}</span>`).join('')}</div>`
    : '';

  const reasonsHtml = reasons.length
    ? `<ul style="margin:10px 0 0;padding:0 0 0 18px;color:#4b5563;font-size:13px;line-height:1.6;">${reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
    : '';

  // A job whose applyLink isn't a safe absolute http(s) URL simply gets no
  // button, rather than a broken or unsafe link.
  const ctaHtml = isSafeHttpUrl(job.applyLink)
    ? `<a href="${escapeHtml(job.applyLink)}" style="display:inline-block;margin-top:14px;padding:10px 22px;background:#4f46e5;color:#ffffff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700;">View &amp; Apply &rarr;</a>`
    : '';

  return `
  <div style="border:1px solid #e5e7eb;border-radius:12px;padding:18px 20px;margin-bottom:14px;background:#ffffff;">
    <span style="display:inline-block;background:${badge.bg};color:${badge.color};font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;">${score}/100 &mdash; ${badge.label}</span>
    <p style="margin:10px 0 2px;font-size:16px;font-weight:700;color:#111827;line-height:1.35;">${title}</p>
    ${metaLine ? `<p style="margin:0;font-size:13px;color:#6b7280;">${metaLine}</p>` : ''}
    ${workplaceSalaryLine ? `<p style="margin:6px 0 0;font-size:13px;color:#4b5563;font-weight:600;">${workplaceSalaryLine}</p>` : ''}
    ${reasonsHtml}
    ${skillsHtml}
    ${ctaHtml}
  </div>`;
};

// Concise, non-misleading preview text for clients that support an inbox
// preheader (Gmail/Apple Mail/Outlook all honor this hidden-span convention —
// it is not a special email-provider feature, just HTML the provider is
// expected to forward verbatim since it already does so for the rest of the
// template). "Top match" is the literal top-scored job in this send, not a
// claim about how recently it was posted.
const buildPreheader = (jobs) => {
  const top = jobs[0];
  if (!top?.job) return 'Your personalized JobFind job digest is ready.';
  const score = Math.max(0, Math.min(100, Math.round(top.score || 0)));
  const bits = [top.job.title, top.job.company ? `at ${top.job.company}` : null].filter(Boolean).join(' ');
  return `Top match: ${bits || 'a new role'} — ${score}/100`.slice(0, 150);
};

const buildJobDigestHtml = (name, jobs) => {
  const safeName = escapeHtml((name || '').trim() || 'there');
  const count = jobs.length;
  const topScore = Math.max(0, Math.min(100, Math.round(jobs[0]?.score || 0)));
  const preheader = escapeHtml(buildPreheader(jobs));
  const profileUrl = `${FRONTEND_URL}/profile`;
  const preferencesUrl = `${FRONTEND_URL}/dashboard`;

  const jobsHtml = jobs.map(renderJobCard).join('');

  return `
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;">${preheader}</div>
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;">&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;padding:24px 16px;">
    <div style="background:#4f46e5;border-radius:16px;padding:26px 24px;margin-bottom:20px;">
      <p style="margin:0 0 6px;color:#e0e7ff;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">JobFind &middot; Personalized Job Digest</p>
      <h1 style="margin:0;color:#ffffff;font-size:21px;font-weight:800;line-height:1.3;">Hi ${safeName}, here are your matches</h1>
    </div>

    <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.6;">
      We picked ${count} job${count === 1 ? '' : 's'} for you using your JobFind profile &mdash; your skills, target role, location and experience.
      ${count > 0 ? `Your top match scored <strong>${topScore}/100</strong>.` : ''}
    </p>

    <div>${jobsHtml}</div>

    <div style="margin-top:8px;padding-top:20px;border-top:1px solid #e5e7eb;">
      <p style="margin:0 0 14px;color:#6b7280;font-size:13px;line-height:1.6;">
        That's it for now &mdash; we'll keep matching new postings against your profile automatically.
      </p>
      <p style="margin:0 0 4px;font-size:13px;">
        <a href="${escapeHtml(profileUrl)}" style="color:#4f46e5;text-decoration:none;font-weight:600;">Update your profile</a>
        <span style="color:#d1d5db;">&nbsp;|&nbsp;</span>
        <a href="${escapeHtml(preferencesUrl)}" style="color:#4f46e5;text-decoration:none;font-weight:600;">Manage email preferences</a>
      </p>
      <p style="margin:14px 0 0;color:#9ca3af;font-size:11px;line-height:1.6;">
        You're receiving this because you signed up for job alerts on JobFind.<br/>
        To stop these emails, open &ldquo;Manage email preferences&rdquo; above and pause them from your dashboard.
      </p>
    </div>

    <div style="margin-top:18px;padding-top:18px;border-top:1px solid #e5e7eb;text-align:center;">
      <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#111827;">Want to update your profile or job preferences?</p>
      <p style="margin:0 0 14px;font-size:13px;color:#6b7280;line-height:1.6;">
        Visit your JobFind dashboard to make changes to your profile, skills, preferred roles, locations and other available settings.
      </p>
      <a href="${JOBFIND_DASHBOARD_URL}" style="display:inline-block;padding:10px 24px;background:#4f46e5;color:#ffffff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700;">Open JobFind Dashboard &rarr;</a>
    </div>
  </div>
  `;
};

// Deterministic (no randomness, nothing to mock in a test) and avoids
// repeating the exact match score in the subject — the body already shows it
// per job. Distinct from the old subject's "N new job matches" framing,
// which could be read as a claim about posting recency rather than "new to
// this digest" (these ARE jobs not yet emailed to this user, which is what
// `emailed:false` in the selection query already guarantees).
const buildDigestSubject = (jobs) => {
  const count = jobs.length;
  return count === 1 ? 'Your new JobFind match is ready' : `Your ${count} new JobFind matches are ready`;
};

const sendJobDigestEmail = (to, name, jobs) =>
  sendHtmlEmail(to, sanitizeHeaderText(buildDigestSubject(jobs)), buildJobDigestHtml(name, jobs));

const sendAdminDigestCopy = (adminEmail, userEmail, userName, sentAt, jobs) => {
  const userHtml = buildJobDigestHtml(userName, jobs);
  const ts = new Date(sentAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true,
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const safeUserName = escapeHtml(userName);
  const safeUserEmail = escapeHtml(userEmail);

  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:620px;margin:auto;">
    <div style="background:#1e1b4b;border-radius:12px;padding:16px 20px;margin-bottom:4px;">
      <p style="margin:0;color:#a5b4fc;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Admin Notification</p>
      <p style="margin:4px 0 0;color:#fff;font-size:15px;font-weight:700;">
        Sent to <span style="color:#c7d2fe;">${safeUserName}</span>
        &lt;<a href="mailto:${safeUserEmail}" style="color:#818cf8;text-decoration:none;">${safeUserEmail}</a>&gt;
      </p>
      <p style="margin:4px 0 0;color:#a5b4fc;font-size:13px;">
        ${jobs.length} job${jobs.length !== 1 ? 's' : ''} &middot; Sent at ${ts} IST
      </p>
    </div>
    ${userHtml}
  </div>
  `;

  return sendHtmlEmail(
    adminEmail,
    sanitizeHeaderText(`[JobFind] Sent to ${userName} (${userEmail}) — ${jobs.length} jobs`),
    html
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

module.exports = {
  sendOtpEmail,
  sendPasswordResetEmail,
  sendJobDigestEmail,
  sendAdminDigestCopy,
  // Exported for testing/reuse — the digest template's building blocks.
  buildJobDigestHtml,
  buildDigestSubject,
  buildPreheader,
  escapeHtml,
  isSafeHttpUrl,
  workplaceLabel,
  salaryLabel,
  JOBFIND_DASHBOARD_URL,
};
