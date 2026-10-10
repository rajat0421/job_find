import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { inputCls, labelCls, FOCUS_RING } from './ui';

// The three building blocks of "account settings" — shared verbatim between
// the standalone /account page (Account.jsx, kept for backward-compat direct
// links) and the glass modal (AccountSettingsModal.jsx) opened from the
// navbar, so neither duplicates this logic independently.

export const AccountInfoSection = ({ profile, onEditProfile }) => (
  <div className="bg-card border border-white/10 rounded-2xl p-5">
    <div className="flex items-center justify-between mb-3">
      <p className="text-sm font-semibold text-white">Account info</p>
      <Link
        to="/profile"
        onClick={onEditProfile}
        className={`text-xs text-violet-400 hover:text-violet-300 font-medium transition-colors rounded ${FOCUS_RING}`}
      >
        Edit profile →
      </Link>
    </div>
    <div className="flex flex-col gap-1.5 text-sm">
      <p className="text-slate-400">Name: <span className="text-slate-200">{profile?.name || '—'}</span></p>
      <p className="text-slate-400">Email: <span className="text-slate-200">{profile?.email}</span></p>
      <p className="text-slate-400">
        Sign-in method:{' '}
        <span className="text-slate-200">
          {profile?.googleId ? 'Google' : 'Email & password'}{profile?.googleId && profile?.hasPassword ? ' + password' : ''}
        </span>
      </p>
    </div>
  </div>
);

export const ChangePasswordSection = ({ hasPassword, idAnchor }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) return setError('New password must be at least 8 characters');
    if (newPassword !== confirmPassword) return setError('New passwords do not match');
    setSubmitting(true);
    try {
      await api.post('/user/change-password', { currentPassword, newPassword });
      // Only clear on confirmed success — a failed request (see catch below)
      // leaves everything the user typed exactly as it was.
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setSuccess(true);
      setTimeout(() => setSuccess(false), 4000);
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div id={idAnchor} className="bg-card border border-white/10 rounded-2xl p-5 scroll-mt-20">
      <p className="text-sm font-semibold text-white mb-1">Change password</p>

      {!hasPassword ? (
        <p className="text-sm text-slate-500">
          Your account signs in with Google — there's no JobFind password to change. To change how you sign in, manage it from your Google account.
        </p>
      ) : (
        <>
          <p className="text-xs text-slate-600 mb-4">Use a password you don't use anywhere else.</p>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div>
              <label className={labelCls}>Current password</label>
              <input type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={inputCls} placeholder="Your current password" autoComplete="current-password" disabled={submitting} />
            </div>
            <div>
              <label className={labelCls}>New password</label>
              <input type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputCls} placeholder="Min. 8 characters" autoComplete="new-password" disabled={submitting} />
            </div>
            <div>
              <label className={labelCls}>Confirm new password</label>
              <input type="password" required minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputCls} placeholder="Re-enter new password" autoComplete="new-password" disabled={submitting} />
            </div>

            {error && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2" role="alert">{error}</p>}
            {success && <p className="text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2" role="status">Password updated.</p>}

            <button type="submit" disabled={submitting} className={`self-start bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50 ${FOCUS_RING}`}>
              {submitting ? 'Updating...' : 'Update password'}
            </button>
          </form>
        </>
      )}
    </div>
  );
};

// `onDeletingChange` (optional) reports whether a delete request is currently
// in flight — the modal uses this to refuse to close via backdrop/Escape
// while a destructive operation is actually in progress.
export const DeleteAccountSection = ({ hasPassword, idAnchor, onDeleted, onDeletingChange }) => {
  const [expanded, setExpanded] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = confirmation === 'DELETE' && (!hasPassword || password.length > 0);

  const setSubmittingAndReport = (val) => {
    setSubmitting(val);
    onDeletingChange?.(val);
  };

  const handleDelete = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmittingAndReport(true);
    setError('');
    try {
      await api.delete('/user/account', { data: { password: hasPassword ? password : undefined, confirmation } });
      onDeleted();
    } catch (err) {
      // Failure leaves the typed confirmation/password in place — the user
      // doesn't have to re-type everything to retry.
      setError(err.response?.data?.message || 'Something went wrong');
      setSubmittingAndReport(false);
    }
  };

  return (
    <div id={idAnchor} className="bg-card border border-red-500/20 rounded-2xl p-5 scroll-mt-20">
      <p className="text-sm font-semibold text-red-400 mb-1">Delete account</p>
      <p className="text-sm text-slate-500 mb-4">
        This permanently deletes your JobFind account, profile, saved/applied job matches, and resume uploads. This cannot be undone.
      </p>

      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={`text-sm font-semibold text-red-400 border border-red-500/30 hover:bg-red-500/10 px-4 py-2.5 rounded-lg transition-colors ${FOCUS_RING}`}
        >
          Delete account
        </button>
      ) : (
        <form onSubmit={handleDelete} className="flex flex-col gap-3 border-t border-red-500/20 pt-4">
          {hasPassword && (
            <div>
              <label className={labelCls}>Current password</label>
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="Confirm your password" autoComplete="current-password" disabled={submitting} />
            </div>
          )}
          <div>
            <label className={labelCls}>
              Type <span className="font-mono text-red-400">DELETE</span> to confirm
            </label>
            <input type="text" required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className={inputCls} placeholder="DELETE" autoComplete="off" disabled={submitting} />
          </div>

          {error && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2" role="alert">{error}</p>}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={!canSubmit || submitting}
              className={`bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS_RING}`}
            >
              {submitting ? 'Deleting...' : 'Permanently delete account'}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => { setExpanded(false); setPassword(''); setConfirmation(''); setError(''); }}
              className={`text-sm font-medium text-slate-400 hover:text-white px-4 py-2.5 rounded-lg transition-colors disabled:opacity-40 ${FOCUS_RING}`}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
