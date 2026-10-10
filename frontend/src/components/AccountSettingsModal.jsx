import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAccountModal } from '../context/AccountModalContext';
import api from '../services/api';
import { FOCUS_RING } from './ui';
import { IconUserCircle, IconClose } from './icons';
import { AccountInfoSection, ChangePasswordSection, DeleteAccountSection } from './AccountSections';

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// A single instance of this is rendered once at the app root (see App.jsx),
// controlled entirely by AccountModalContext — it is not a route and never
// touches the URL. Opening/closing/interacting with it never navigates,
// reloads, or loses whatever page it's layered over.
const AccountSettingsModal = () => {
  const { isOpen, close } = useAccountModal();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // True while the delete-account request is actually in flight — the
  // backdrop and Escape both refuse to close while this is true, so a
  // destructive operation already underway can't be interrupted/hidden.
  const [deleting, setDeleting] = useState(false);
  const panelRef = useRef(null);

  // Fetch fresh each time the modal opens (not on every app load) — mirrors
  // Account.jsx's own data source exactly (same endpoint, same shape).
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    api.get('/user/profile').then(r => setProfile(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, [isOpen]);

  // Prevent background scroll while open.
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, [isOpen]);

  // Move focus into the dialog on open; trap Tab within it; Escape closes
  // unless a deletion is in progress.
  useEffect(() => {
    if (!isOpen) return;
    panelRef.current?.focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (deleting) return;
        close();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusables = Array.from(panelRef.current.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => !el.disabled);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, deleting, close]);

  if (!isOpen) return null;

  const handleBackdropClick = () => {
    if (deleting) return; // never dismiss while a delete request is actually in flight
    close();
  };

  const handleCloseClick = () => {
    if (deleting) return;
    close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-modal-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md max-h-[85vh] flex flex-col bg-card/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl ring-1 ring-violet-500/20 focus:outline-none"
      >
        <div className="shrink-0 flex items-start justify-between gap-4 px-6 py-5 border-b border-white/[0.07]">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-full bg-violet-600/20 border border-violet-500/30 text-violet-300 flex items-center justify-center shrink-0">
              <IconUserCircle className="w-4.5 h-4.5" />
            </span>
            <div className="min-w-0">
              <h2 id="account-modal-title" className="text-base font-bold text-white">Account settings</h2>
              <p className="text-xs text-slate-500 mt-0.5">Manage your sign-in and account details.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCloseClick}
            disabled={deleting}
            aria-label="Close account settings"
            className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40 ${FOCUS_RING}`}
          >
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-6 flex flex-col gap-4">
          {loading ? (
            <p className="text-sm text-slate-600 text-center py-6">Loading...</p>
          ) : (
            <>
              <AccountInfoSection profile={profile} onEditProfile={close} />
              <ChangePasswordSection hasPassword={!!profile?.hasPassword} />
              <DeleteAccountSection
                hasPassword={!!profile?.hasPassword}
                onDeletingChange={setDeleting}
                onDeleted={() => { close(); logout(); navigate('/'); }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AccountSettingsModal;
