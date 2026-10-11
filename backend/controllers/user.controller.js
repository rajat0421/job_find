const bcrypt = require('bcryptjs');
const User = require('../models/User');
const UserJob = require('../models/UserJob');
const ResumeProfile = require('../models/ResumeProfile');
const Feedback = require('../models/Feedback');
const EmailLog = require('../models/EmailLog');
const OtpVerification = require('../models/OtpVerification');
const { matchJobsForUser } = require('../services/jobMatcher.service');

const onboard = async (req, res) => {
  try {
    const { name, skills, experience, locations, salary, remotePreference, desiredRoles, qualification } = req.body;
    if (!name || !skills?.length || experience == null || !locations?.length)
      return res.status(400).json({ message: 'Name, skills, experience and locations are required' });

    await User.updateOne(
      { _id: req.user.id },
      {
        name, skills, experience, locations, salary, remotePreference,
        desiredRoles: desiredRoles || [],
        qualification: qualification || null,
        isOnboarded: true,
      }
    );

    res.json({ message: 'Profile saved. Welcome aboard!' });

    // Fire-and-forget: score all existing jobs immediately so the dashboard isn't empty
    matchJobsForUser(req.user.id).catch((err) =>
      console.error('[Matcher] Onboard match failed:', err.message)
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getProfile = async (req, res) => {
  try {
    // Fetched WITH password so `hasPassword` can be derived server-side —
    // the raw hash is always stripped before the response goes out. The
    // frontend needs this boolean (not the hash) to correctly show/hide the
    // "change password" UI for Google-only accounts, which have no password
    // on file at all (see auth.controller.js's login(), which already makes
    // this same distinction server-side).
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const { password, ...rest } = user.toObject();
    res.json({ ...rest, hasPassword: !!password });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const { name, skills, experience, locations, salary, remotePreference, desiredRoles, qualification } = req.body;
    const update = {};
    if (name              !== undefined) update.name              = name;
    if (skills            !== undefined) update.skills            = skills;
    if (experience        !== undefined) update.experience        = experience;
    if (locations         !== undefined) update.locations         = locations;
    if (remotePreference  !== undefined) update.remotePreference  = remotePreference;
    if (qualification     !== undefined) update.qualification     = qualification || null;
    if (desiredRoles      !== undefined) {
      update.desiredRoles = desiredRoles || [];
    }
    // salary can be 0 or null (user clearing it) — only skip if not sent at all
    if (salary !== undefined) update.salary = salary || null;

    await User.updateOne({ _id: req.user.id }, { $set: update });
    res.json({ message: 'Profile updated' });

    // Fire-and-forget: refresh this user's existing matches if anything
    // scoring-relevant changed, and pick up any new matches too. Cheap no-op
    // when nothing relevant changed — matchJobsForUser only rescores pairs
    // whose stored fingerprint no longer matches the current profile.
    matchJobsForUser(req.user.id).catch((err) =>
      console.error('[Matcher] Profile-update match failed:', err.message)
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const toggleEmailPause = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('emailPaused');
    const next = !user.emailPaused;
    await User.updateOne({ _id: req.user.id }, { $set: { emailPaused: next } });
    res.json({ emailPaused: next });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/user/change-password — reuses the exact same bcrypt
// hash/compare primitives as login() and auth.controller.js's resetPassword,
// just gated by the current session (protect) plus the current password
// itself, rather than an emailed OTP. This is a self-service action for an
// already-authenticated user; the existing logged-out forgot/reset-password
// flow is untouched and still the only path for someone who can't log in.
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    // Google-only accounts have no password on file — nothing to change,
    // and definitely nothing to "verify" against. Matches login()'s own
    // "This account uses Google sign-in" handling.
    if (!user.password) {
      return res.status(400).json({ message: 'This account uses Google sign-in and has no password to change' });
    }

    const match = await bcrypt.compare(currentPassword, user.password);
    // 400, not 401: the frontend's axios interceptor treats any 401 as "the
    // session itself is invalid" and force-logs-out/redirects to /login —
    // correct for an expired/bad token, wrong for "you're fully authenticated
    // but mistyped your current password". Same reasoning applies to
    // deleteAccount's password check below.
    if (!match) return res.status(400).json({ message: 'Current password is incorrect' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await User.updateOne({ _id: user._id }, { $set: { password: hashed } });

    res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE /api/user/account — permanently deletes the authenticated user's
// own account (req.user.id only — never a client-supplied id) and every
// collection that stores THIS user's own data.
//
// By design, the ONLY confirmation required is the typed "DELETE" string —
// no current-password re-entry, no re-authentication with Google, no email
// confirmation loop, for either account type. Deletion is still exclusively
// scoped to the caller's own session identity (`req.user.id`, set by the
// `protect` middleware from a verified JWT) — simplifying the confirmation
// step does not touch authentication: a request must still carry a valid
// token, and it can only ever act on the account that token belongs to.
//
// Ordering is deliberate: every auxiliary collection is deleted BEFORE the
// User document itself. If any step throws, the whole request fails with
// nothing further attempted — the account and any not-yet-deleted data stay
// fully intact, and the exact same request can be safely retried later
// (deleteMany against already-removed records is a no-op). The one thing
// that must never happen is deleting the User document while an earlier
// step failed, which would orphan data with no way to clean it up afterward.
//
// Explicit data-retention decisions made here (documented since this app has
// no separate written retention policy to defer to):
//  - UserJob, ResumeProfile, Feedback, EmailLog: deleted — all keyed by this
//    user's own id and contain this user's own content/activity.
//  - OtpVerification: deleted by email (not userId — it has no userId field
//    and exists only during signup/reset, already TTL-expiring on its own).
//  - RequestLog: left untouched. It's an operational/security audit trail
//    with its own existing 30-day TTL, not user-facing content; deleting it
//    immediately on account deletion would weaken abuse investigation for a
//    tool that already self-expires.
//  - Other users' Feedback.likes/dislikes arrays: left untouched. They may
//    still reference this user's old ObjectId; that's an inert, harmless
//    dangling reference (it will just never match an existing user again),
//    not a correctness or security issue, and cleaning it would mean
//    rewriting potentially many other users' documents for a cosmetic gain.
//  - Job/Company/Config: never touched — not user-owned data.
const deleteAccount = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const { confirmation } = req.body;
    if (confirmation !== 'DELETE') {
      return res.status(400).json({ message: 'Type DELETE to confirm account deletion' });
    }

    const userId = user._id;
    await UserJob.deleteMany({ userId });
    await ResumeProfile.deleteMany({ userId });
    await Feedback.deleteMany({ userId });
    await EmailLog.deleteMany({ userId });
    await OtpVerification.deleteMany({ email: user.email });

    await User.deleteOne({ _id: userId });

    res.json({ message: 'Account deleted' });
  } catch (err) {
    console.error('[Account] Deletion failed for user', req.user.id, ':', err.message);
    res.status(500).json({ message: 'Failed to delete your account — please try again. Nothing was deleted.' });
  }
};

module.exports = { onboard, getProfile, updateProfile, toggleEmailPause, changePassword, deleteAccount };
