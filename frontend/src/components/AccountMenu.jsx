import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAccountModal } from '../context/AccountModalContext';
import { FOCUS_RING } from './ui';

const initials = (nameOrEmail) => {
  const trimmed = (nameOrEmail || '').trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const itemCls = `block w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors ${FOCUS_RING}`;

// Replaces the navbar's old plain "{name} ... Sign out" row with a circular
// account icon opening a dropdown. No profile-image field exists on the User
// model (nothing to fetch), so the icon always shows initials — "an
// available profile image" would be a separate, larger feature (storing and
// serving an avatar) not implemented here.
//
// Exactly two entries by design: "Account settings" (opens the shared glass
// modal in place — see AccountSettingsModal.jsx/AccountModalContext — never
// a navigation) and "Sign out". Change password / Delete account now live
// only inside that modal, not duplicated here.
const AccountMenu = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { open: openAccountModal } = useAccountModal();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e) => {
      if (!wrapperRef.current?.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Defensive fallback — this component is only ever mounted behind
  // ProtectedRoute today, so a signed-out render shouldn't normally happen,
  // but the brief explicitly calls out signed-out behavior, so it degrades
  // correctly (existing routes, no duplicated "sign in" affordance for
  // authenticated users) rather than rendering an avatar with nothing to
  // click through to.
  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Link to="/login" className={`text-sm text-slate-400 hover:text-white transition-colors rounded ${FOCUS_RING}`}>Sign in</Link>
        <Link to="/register" className={`text-sm bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-lg font-medium transition-colors ${FOCUS_RING}`}>Create account</Link>
      </div>
    );
  }

  const displayName = user.name || user.email || 'Your account';

  const handleLogout = () => {
    setOpen(false);
    logout();
    navigate('/login');
  };

  const handleOpenSettings = () => {
    setOpen(false);
    // Passing this button so focus returns here when the modal closes.
    openAccountModal(buttonRef.current);
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${displayName}`}
        className={`w-8 h-8 shrink-0 rounded-full bg-violet-600/20 border border-violet-500/30 text-violet-300 text-xs font-bold flex items-center justify-center hover:bg-violet-600/30 transition-colors ${FOCUS_RING} ${open ? 'bg-violet-600/30' : ''}`}
      >
        {initials(user.name || user.email)}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account menu"
          className="absolute right-0 mt-2 w-60 max-w-[calc(100vw-2rem)] bg-card border border-white/10 rounded-xl shadow-2xl overflow-hidden z-30"
        >
          <div className="px-4 py-3 border-b border-white/[0.07]">
            <p className="text-sm font-semibold text-white truncate">{user.name || 'Your account'}</p>
            {user.email && <p className="text-xs text-slate-500 truncate mt-0.5">{user.email}</p>}
          </div>

          {/* Home/Profile/Resume already exist as primary navbar links — not
              duplicated here. */}
          <div className="py-1">
            <button role="menuitem" type="button" onClick={handleOpenSettings} className={itemCls}>
              Account settings
            </button>
          </div>

          <div className="py-1 border-t border-white/[0.07]">
            <button role="menuitem" type="button" onClick={handleLogout} className={itemCls}>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountMenu;
