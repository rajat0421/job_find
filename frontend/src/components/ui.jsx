import { Link } from 'react-router-dom';

// Shared design-system primitives (pre-launch redesign). These consolidate
// styling that was previously copy-pasted, near-identically, across many
// pages (Login/Register/ForgotPassword/ResetPassword/VerifyEmail/Onboarding/
// Profile/Dashboard) — the goal is to stop duplicating style strings, not to
// change how any of those pages behave.

// Visible keyboard-focus ring used on every primary interactive element
// (buttons, links, cards acting as links). Pairs with index.css's global
// `:focus-visible` outline, which is the fallback for anything not using
// this class directly.
export const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

// Shared text-input styling — the exact class string every auth/profile/
// onboarding form already used independently.
export const inputCls = 'w-full bg-field border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition';
export const labelCls = 'block text-sm font-medium text-slate-300 mb-1.5';

// The responsive page shell used by every signed-in page (Dashboard, Profile,
// Resume, Feedback) and the public landing page's nav/sections — replaces
// each page's own hardcoded `max-w-2xl` (≈672px, the "too narrow" container
// the redesign brief called out) with one shared, wider container so the
// header and page content always line up and desktop space is used
// intentionally. `max-w-5xl` (1024px) was already in use on the landing
// page's own nav/hero — reusing it (rather than inventing a new breakpoint)
// is what makes every route's horizontal alignment consistent.
export const PageContainer = ({ className = '', children }) => (
  <div className={`max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>
);

const BUTTON_VARIANTS = {
  primary: 'bg-violet-600 hover:bg-violet-700 text-white',
  secondary: 'bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200',
  ghost: 'text-slate-400 hover:text-white',
};

// A plain <button>; `as="a"`/`as={Link}` isn't supported here on purpose —
// call sites needing a link-styled-as-button use LinkButton below, so the
// semantic element always matches the actual behavior (navigation vs action).
export const Button = ({ variant = 'primary', className = '', disabled, children, ...props }) => (
  <button
    disabled={disabled}
    className={`inline-flex items-center justify-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${BUTTON_VARIANTS[variant]} ${FOCUS_RING} ${className}`}
    {...props}
  >
    {children}
  </button>
);

export const LinkButton = ({ to, variant = 'primary', className = '', children, ...props }) => (
  <Link
    to={to}
    className={`inline-flex items-center justify-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors ${BUTTON_VARIANTS[variant]} ${FOCUS_RING} ${className}`}
    {...props}
  >
    {children}
  </Link>
);

// The shared outer shell for every auth page (Login/Register/ForgotPassword/
// ResetPassword/VerifyEmail) — centered logo + subtitle, a card, and an
// optional footer line. Each page keeps its own form/fields/validation;
// only the identical wrapping markup moves here.
export const AuthShell = ({ subtitle, children, footer }) => (
  <div className="min-h-screen flex items-center justify-center bg-surface px-4 py-10">
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <Link to="/" className={`inline-block text-2xl font-bold text-white tracking-tight hover:opacity-80 transition-opacity rounded ${FOCUS_RING}`}>
          Job<span className="text-violet-400">Find</span>
        </Link>
        {subtitle && <p className="text-sm text-slate-500 mt-2">{subtitle}</p>}
      </div>

      <div className="bg-card border border-white/10 rounded-2xl p-7">
        {children}
      </div>

      {footer && <p className="text-center text-sm text-slate-600 mt-5">{footer}</p>}
    </div>
  </div>
);
