import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageContainer, FOCUS_RING } from '../components/ui';

// Verified against the actual configured source lists (greenhouseBoards.json
// + leverCompanies.json + ashbyBoards.json = 137 boards, plus Adzuna as a
// fourth, separate source) — not an invented figure. No named-company list
// is shown anymore: individual company names implied a specific guaranteed
// integration per company, which isn't a claim this product makes (coverage
// comes from configured boards + Adzuna's broader market search).
const STATS = [
  { value: '130+', label: 'companies' },
  { value: '4', label: 'job sources' },
  { value: 'Hourly', label: 'fresh scans' },
];

const iconSvg = (paths) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    {paths}
  </svg>
);

const STEPS = [
  {
    icon: iconSvg(<><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20a6.5 6.5 0 0113 0" /></>),
    title: 'Set your profile',
    desc: 'Add your skills, roles and preferences — or autofill from your resume.',
  },
  {
    icon: iconSvg(<><circle cx="12" cy="12" r="8" /><path d="M8.5 12.5l2.3 2.3L16 9.5" /></>),
    title: 'Get matched',
    desc: 'Every posting is scored against your profile, hourly.',
  },
  {
    icon: iconSvg(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>),
    title: 'Check your inbox',
    desc: 'Top matches arrive on your schedule, with reasons attached.',
  },
];

const BENEFITS = [
  {
    icon: iconSvg(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>),
    title: 'Role and skill-based matching',
    desc: 'Filtered by your target roles first, then scored on skills, experience, location and salary.',
  },
  {
    icon: iconSvg(<><path d="M8 3h6l4 4v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v4h4M9.5 12.5h5M9.5 16h5" /></>),
    title: 'Resume-assisted profile setup',
    desc: 'Upload a resume and AI drafts your profile — you review and edit before anything saves.',
  },
  {
    icon: iconSvg(<><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>),
    title: 'Email delivery preferences',
    desc: 'Choose daily, every 5 hours, or hourly — matches come to your inbox on your schedule.',
  },
];

const PLANS = [
  {
    name: 'Free',
    price: '₹0',
    sub: 'Daily digest',
    features: ['Daily email digest', 'Resume & role matching'],
    cta: 'Get started free',
    to: '/register',
    highlight: false,
  },
  {
    name: 'Pro',
    price: 'Premium',
    sub: 'Every 5 hours',
    features: ['Everything in Free', 'Digest every 5 hours'],
    cta: 'Contact us',
    to: 'mailto:rajattalekar5143@gmail.com?subject=JobFind%20Pro%20Plan',
    highlight: true,
  },
  {
    name: 'Ultra',
    price: 'Premium',
    sub: 'Every hour',
    features: ['Everything in Pro', 'Hourly job alerts'],
    cta: 'Contact us',
    to: 'mailto:rajattalekar5143@gmail.com?subject=JobFind%20Ultra%20Plan',
    highlight: false,
  },
];

const Landing = () => {
  const { isLoggedIn, user } = useAuth();
  const location = useLocation();
  if (isLoggedIn) {
    return <Navigate to={user?.isOnboarded ? '/dashboard' : '/onboarding'} replace />;
  }

  const accountDeleted = !!location.state?.accountDeleted;

  return (
    <div className="min-h-screen bg-surface text-white overflow-x-hidden">

      {accountDeleted && (
        <div className="bg-emerald-500/10 border-b border-emerald-500/20 text-emerald-400 text-sm text-center py-2.5 px-4" role="status">
          Your account has been permanently deleted.
        </div>
      )}

      {/* ── Navigation ───────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-20 border-b border-white/[0.06] bg-surface/80 backdrop-blur-md">
        <PageContainer className="h-14 flex items-center justify-between">
          <span className="text-lg font-bold tracking-tight select-none">
            Job<span className="text-violet-400">Find</span>
          </span>
          <div className="flex items-center gap-2">
            <Link to="/login" className={`text-sm text-slate-400 hover:text-white px-3 py-1.5 transition-colors rounded-lg ${FOCUS_RING}`}>
              Sign in
            </Link>
            <Link to="/register" className={`text-sm bg-violet-600 hover:bg-violet-700 text-white px-4 py-1.5 rounded-lg font-medium transition-colors ${FOCUS_RING}`}>
              Get started
            </Link>
          </div>
        </PageContainer>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section className="text-center pt-20 pb-14 sm:pt-24 sm:pb-16">
        <PageContainer>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.1] tracking-tight mb-4">
            Less searching.<br />
            <span className="text-violet-400">More opportunities.</span>
          </h1>

          <p className="text-base sm:text-lg text-slate-400 max-w-md mx-auto mb-8">
            Jobs matched to your skills, delivered to your inbox.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-4">
            <Link to="/register" className={`w-full sm:w-auto bg-violet-600 hover:bg-violet-700 text-white px-8 py-3.5 rounded-xl text-sm font-semibold transition-colors ${FOCUS_RING}`}>
              Get your free digest →
            </Link>
            <Link to="/login" className={`w-full sm:w-auto border border-white/10 hover:border-white/20 text-slate-300 hover:text-white px-8 py-3.5 rounded-xl text-sm font-semibold transition-colors ${FOCUS_RING}`}>
              Sign in
            </Link>
          </div>
          <p className="text-xs text-slate-600">Free to start · Unsubscribe anytime</p>
        </PageContainer>
      </section>

      {/* ── Trust strip — one compact row, only verified figures ────────────────── */}
      <div className="border-y border-white/[0.06] py-5">
        <PageContainer>
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-1.5">
            {STATS.map((s) => (
              <p key={s.label} className="text-sm text-slate-400">
                <span className="text-white font-bold">{s.value}</span> {s.label}
              </p>
            ))}
          </div>
        </PageContainer>
      </div>

      {/* ── How it works ─────────────────────────────────────────────────────── */}
      <PageContainer className="py-14">
        <h2 className="text-xl sm:text-2xl font-bold text-center mb-10">How it works</h2>
        <div className="grid sm:grid-cols-3 gap-8 sm:gap-6 sm:divide-x sm:divide-white/[0.06]">
          {STEPS.map((step) => (
            <div key={step.title} className="flex flex-col items-center text-center sm:px-4">
              <span className="w-10 h-10 rounded-full bg-violet-500/10 text-violet-400 flex items-center justify-center mb-3">
                {step.icon}
              </span>
              <h3 className="text-sm font-semibold text-white mb-1">{step.title}</h3>
              <p className="text-xs text-slate-500 leading-relaxed max-w-[200px]">{step.desc}</p>
            </div>
          ))}
        </div>
      </PageContainer>

      {/* ── Benefits ─────────────────────────────────────────────────────────── */}
      <PageContainer className="pb-14">
        <h2 className="text-xl sm:text-2xl font-bold text-center mb-10">Why JobFind</h2>
        <div className="grid sm:grid-cols-3 gap-6">
          {BENEFITS.map((b) => (
            <div key={b.title} className="flex flex-col items-center text-center sm:items-start sm:text-left">
              <span className="w-10 h-10 rounded-xl bg-violet-500/10 text-violet-400 flex items-center justify-center mb-3">
                {b.icon}
              </span>
              <h3 className="text-sm font-semibold text-white mb-1">{b.title}</h3>
              <p className="text-xs text-slate-500 leading-relaxed">{b.desc}</p>
            </div>
          ))}
        </div>
      </PageContainer>

      {/* ── Pricing ──────────────────────────────────────────────────────────── */}
      <PageContainer className="pb-14">
        <h2 className="text-xl sm:text-2xl font-bold text-center mb-1">Simple, honest pricing</h2>
        <p className="text-center text-slate-500 text-sm mb-10">Start free. Upgrade when you need faster alerts.</p>

        <div className="grid sm:grid-cols-3 gap-4 max-w-3xl mx-auto items-stretch">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl p-5 border flex flex-col ${
                plan.highlight ? 'border-violet-500/40 bg-violet-600/10' : 'border-white/[0.07] bg-card'
              }`}
            >
              {plan.highlight && (
                <p className="text-[10px] text-violet-400 font-bold uppercase tracking-widest mb-2">Most popular</p>
              )}
              <h3 className="text-base font-bold text-white mb-1">{plan.name}</h3>
              <p className="text-xl font-bold text-white mb-0.5">{plan.price}</p>
              <p className="text-xs text-slate-500 mb-4">{plan.sub}</p>

              <ul className="flex flex-col gap-1.5 mb-5 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="text-sm text-slate-400 flex items-start gap-2">
                    <span className="text-emerald-500 shrink-0 mt-px">✓</span>
                    {f}
                  </li>
                ))}
              </ul>

              {plan.to.startsWith('mailto') ? (
                <a
                  href={plan.to}
                  className={`block w-full text-center border border-white/10 hover:border-white/20 text-slate-300 hover:text-white py-2.5 rounded-lg text-sm font-semibold transition-colors ${FOCUS_RING}`}
                >
                  {plan.cta} →
                </a>
              ) : (
                <Link
                  to={plan.to}
                  className={`block w-full text-center bg-violet-600 hover:bg-violet-700 text-white py-2.5 rounded-lg text-sm font-semibold transition-colors ${FOCUS_RING}`}
                >
                  {plan.cta}
                </Link>
              )}
            </div>
          ))}
        </div>
      </PageContainer>

      {/* ── Final CTA ────────────────────────────────────────────────────────── */}
      <PageContainer className="pb-16">
        <div className="bg-card border border-white/10 rounded-2xl px-6 py-10 sm:py-12 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-2">Ready for better job matches?</h2>
          <p className="text-slate-400 text-sm mb-7">Set up your profile in two minutes and get your first digest.</p>
          <Link to="/register" className={`inline-block bg-violet-600 hover:bg-violet-700 text-white px-8 py-3 rounded-xl text-sm font-semibold transition-colors ${FOCUS_RING}`}>
            Create free account →
          </Link>
        </div>
      </PageContainer>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/[0.06] py-8">
        <PageContainer className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-sm font-bold">
            Job<span className="text-violet-400">Find</span>
          </span>
          <div className="flex items-center gap-6">
            <Link to="/login" className={`text-xs text-slate-600 hover:text-slate-400 transition-colors rounded ${FOCUS_RING}`}>Sign in</Link>
            <Link to="/register" className={`text-xs text-slate-600 hover:text-slate-400 transition-colors rounded ${FOCUS_RING}`}>Register</Link>
            <a href="mailto:rajattalekar5143@gmail.com" className={`text-xs text-slate-600 hover:text-slate-400 transition-colors rounded ${FOCUS_RING}`}>
              Contact
            </a>
          </div>
          <p className="text-xs text-slate-700">© 2026 JobFind</p>
        </PageContainer>
      </footer>

    </div>
  );
};

export default Landing;
