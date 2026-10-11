const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
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
// No external, non-transactional storage is involved: resumes are parsed
// in-memory at upload time (multer memoryStorage — see resume.routes.js)
// and only the extracted JSON is persisted, in ResumeProfile. Every record
// this endpoint touches lives in this same MongoDB database, so a real
// multi-document transaction (not just careful ordering) can make the whole
// cascade atomic where the deployment supports one.
//
// Two paths, in order of preference:
//
//  1. Transactional (used whenever this MongoDB deployment is a replica set
//     or mongos — e.g. any MongoDB Atlas cluster, including the free tier,
//     which always runs as a replica set). All six deletes run inside a
//     single session.withTransaction(): if ANY of them fails, the driver
//     aborts the transaction and the server guarantees none of them were
//     applied — "nothing was deleted" is then a true statement even though
//     the failure happened partway through the cascade.
//
//  2. Sequential fallback (only reached if the transaction attempt fails
//     with the specific "this deployment doesn't support transactions"
//     error — e.g. a standalone, non-replica-set MongoDB). This is the
//     previous behavior: auxiliary collections deleted before the User
//     document, in order, with NO rollback — so a failure here can leave a
//     real partial deletion behind. Each step is counted; a failure after
//     at least one step has already committed is reported as a partial
//     failure, never misreported as "nothing was deleted". Every step is
//     still scoped only to this user's own ids/email, and every step is a
//     no-op when re-run against already-deleted records, so retrying the
//     exact same request is always safe, finishes the job, and can never
//     touch another user's data.
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

// The MongoDB server's exact, stable error text for "a transaction was
// attempted against a deployment that isn't a replica set or mongos" (code
// 20 / IllegalOperation). Matching on this lets the fallback trigger only
// for "transactions aren't supported here" — any other error thrown inside
// the transaction is treated as a genuine failure that the driver has
// already safely rolled back.
const isTransactionsUnsupported = (err) =>
  /Transaction numbers are only allowed on a replica set member or mongos/i.test(err?.message || '');

// The full cascade, as an ordered list of thunks, so the transactional path
// and the sequential fallback share one definition of "what deleting an
// account means" instead of maintaining two copies that could drift apart.
// `session` is attached via the query builder's `.session()` — omitted
// (falsy) it's a no-op, so the fallback path issues plain, unsessioned
// queries identical to before.
const buildCascadeSteps = (userId, email, session) => {
  const withSession = (query) => (session ? query.session(session) : query);
  return [
    () => withSession(UserJob.deleteMany({ userId })),
    () => withSession(ResumeProfile.deleteMany({ userId })),
    () => withSession(Feedback.deleteMany({ userId })),
    () => withSession(EmailLog.deleteMany({ userId })),
    () => withSession(OtpVerification.deleteMany({ email })),
    () => withSession(User.deleteOne({ _id: userId })),
  ];
};

const deleteAccount = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const { confirmation } = req.body;
    if (confirmation !== 'DELETE') {
      return res.status(400).json({ message: 'Type DELETE to confirm account deletion' });
    }

    const userId = user._id;
    const email = user.email;

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        for (const step of buildCascadeSteps(userId, email, session)) {
          await step();
        }
      });
      return res.json({ message: 'Account deleted' });
    } catch (txnErr) {
      if (!isTransactionsUnsupported(txnErr)) {
        // A genuine failure mid-transaction. withTransaction has already
        // aborted it server-side, so — unlike the sequential fallback below
        // — nothing was actually written. "Nothing was deleted" is accurate
        // here specifically because this path is atomic.
        console.error('[Account] Transactional deletion failed for user', req.user.id, ':', txnErr.message);
        return res.status(500).json({ message: 'Failed to delete your account — please try again. Nothing was deleted.' });
      }
      // Unsupported deployment — fall through to the sequential path. No
      // write from the aborted transaction attempt was ever committed.
    } finally {
      await session.endSession();
    }

    let stepsCompleted = 0;
    try {
      for (const step of buildCascadeSteps(userId, email, null)) {
        await step();
        stepsCompleted++;
      }
      res.json({ message: 'Account deleted' });
    } catch (err) {
      const total = 6;
      console.error(
        '[Account] Sequential deletion failed for user', req.user.id,
        `after ${stepsCompleted}/${total} steps:`, err.message
      );
      if (stepsCompleted === 0) {
        res.status(500).json({ message: 'Failed to delete your account — please try again. Nothing was deleted.' });
      } else {
        // Some records are already gone — do not claim success, and do not
        // claim nothing was deleted either. Every remaining step is scoped
        // to this same user and safe to re-run, so a retry is the correct
        // recovery action and won't duplicate or misdirect any deletion.
        res.status(500).json({
          message: 'Account deletion did not finish — some of your data was already removed. Please try again; it is safe to retry and will not affect any other account.',
        });
      }
    }
  } catch (err) {
    console.error('[Account] Deletion failed for user', req.user.id, ':', err.message);
    res.status(500).json({ message: 'Failed to delete your account — please try again. Nothing was deleted.' });
  }
};

module.exports = { onboard, getProfile, updateProfile, toggleEmailPause, changePassword, deleteAccount };
