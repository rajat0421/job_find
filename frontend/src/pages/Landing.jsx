import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const COMPANIES = [
  'Airbnb', 'Notion', 'Figma', 'Stripe', 'Coinbase', 'DoorDash',
  'Robinhood', 'Canva', 'Brex', 'Plaid', 'Airtable', 'Vercel',
  'Linear', 'Retool', 'Loom', 'Miro', 'Zapier', 'Webflow', 'Rippling', 'Deel',
];

const STEPS = [
  {
    n: '1',
    title: 'Tell us what you want',
    desc: 'Select your target role — Backend Dev, Data Engineer, DevOps — add your skills, experience and location. Two minutes, done.',
  },
  {
    n: '2',
    title: 'We scan every hour',
    desc: 'Our system checks 90+ job boards continuously. Every job is scored against your profile using a role-first matching algorithm.',
  },
  {
    n: '3',
    title: 'Matches hit your inbox',
    desc: 'Top jobs land in your email on your schedule — daily by default. No app to open, no feed to scroll.',
  },
];

const FEATURES = [
  {
    icon: '🎯',
    title: 'Role-first, not keyword soup',
    desc: 'We filter by your exact target title before anything else. "Technical Success Manager" never reaches a backend developer.',
  },
  {
    icon: '🏢',
    title: '90+ company job boards',
    desc: 'We scan Adzuna + Greenhouse-powered boards at Airbnb, Notion, Figma, Stripe, Coinbase and dozens more — all in one digest.',
  },
  {
    icon: '📬',
    title: 'Inbox, not a feed',
    desc: 'No app to check. No notifications to ignore. Curated matches arrive in your email exactly when you want them.',
  },
  {
    icon: '🧠',
    title: 'Smart score, not random results',
    desc: 'Every job gets a score based on role match, skill overlap, experience level, location and salary. Low scores never reach you.',
  },
];

const PLANS = [
  {
    name: 'Free',
    price: '₹0',
    sub: 'Daily digest',
    features: ['Role + skill matching', '90+ company sources', 'Daily email digest', 'Profile & preferences'],
    cta: 'Get started free',
    to: '/register',
    highlight: false,
  },
  {
    name: 'Pro',
    price: 'Premium',
    sub: 'Every 5 hours',
    features: ['Everything in Free', 'Digest every 5 hours', 'Priority matching', 'Early access to new features'],
    cta: 'Contact admin',
    to: 'mailto:rajattalekar5143@gmail.com?subject=JobFind%20Pro%20Plan',
    highlight: true,
  },
  {
    name: 'Ultra',
    price: 'Premium',
    sub: 'Every hour',
    features: ['Everything in Pro', 'Hourly job alerts', 'Fastest possible delivery', 'Priority support'],
    cta: 'Contact admin',
    to: 'mailto:rajattalekar5143@gmail.com?subject=JobFind%20Ultra%20Plan',
    highlight: false,
  },
];

const STATS = [
  { value: '90+', label: 'company boards' },
  { value: 'Hourly', label: 'job scans' },
  { value: '100%', label: 'free to start' },
];

const Landing = () => {
  const { isLoggedIn, user } = useAuth();
  if (isLoggedIn) {
    return <Navigate to={user?.isOnboarded ? '/dashboard' : '/onboarding'} replace />;
  }

  return (
    <div className="min-h-screen bg-[#0a0a12] text-white overflow-x-hidden">

      {/* ── Navbar ───────────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#0a0a12]/80 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <span className="text-lg font-bold tracking-tight select-none">
            Job<span className="text-violet-400">Find</span>
          </span>
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="text-sm text-slate-400 hover:text-white px-3 py-1.5 transition-colors"
            >
              Sign in
            </Link>
            <Link
              to="/register"
              className="text-sm bg-violet-600 hover:bg-violet-700 text-white px-4 py-1.5 rounded-lg font-medium transition-colors"
            >
              Get started
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section className="relative max-w-5xl mx-auto px-4 pt-28 pb-20 text-center">
        {/* Glow blob */}
        <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-violet-600/10 blur-[120px] rounded-full" />

        <div className="relative">
          <div className="inline-flex items-center gap-2 bg-violet-600/10 border border-violet-500/20 rounded-full px-4 py-1.5 text-xs text-violet-400 font-medium mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            Scanning 90+ job boards · Updated every hour
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold leading-[1.08] tracking-tight mb-6">
            Stop searching.<br />
            <span className="text-violet-400">Start receiving.</span>
          </h1>

          <p className="text-lg text-slate-400 max-w-lg mx-auto mb-10 leading-relaxed">
            JobFind matches jobs to your exact role and skills, then delivers a curated digest to your inbox. No scrolling required.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-5">
            <Link
              to="/register"
              className="w-full sm:w-auto bg-violet-600 hover:bg-violet-700 text-white px-8 py-3.5 rounded-xl text-sm font-semibold transition-colors"
            >
              Get your free digest →
            </Link>
            <Link
              to="/login"
              className="w-full sm:w-auto border border-white/10 hover:border-white/20 text-slate-300 hover:text-white px-8 py-3.5 rounded-xl text-sm font-semibold transition-colors"
            >
              Sign in
            </Link>
          </div>
          <p className="text-xs text-slate-600">Free forever · No credit card required</p>
        </div>
      </section>

      {/* ── Stats bar ────────────────────────────────────────────────────────── */}
      <div className="border-y border-white/[0.06] py-8">
        <div className="max-w-2xl mx-auto px-4 grid grid-cols-3 gap-4 text-center">
          {STATS.map((s) => (
            <div key={s.label}>
              <p className="text-2xl font-bold text-white">{s.value}</p>
              <p className="text-xs text-slate-500 mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Companies ────────────────────────────────────────────────────────── */}
      <section className="py-14 border-b border-white/[0.06]">
        <p className="text-center text-[10px] text-slate-600 uppercase tracking-widest mb-6">
          Sourcing from companies including
        </p>
        <div className="flex flex-wrap justify-center gap-2.5 max-w-3xl mx-auto px-4">
          {COMPANIES.map((c) => (
            <span
              key={c}
              className="text-xs text-slate-500 bg-white/[0.04] border border-white/[0.07] px-3 py-1.5 rounded-full"
            >
              {c}
            </span>
          ))}
          <span className="text-xs text-slate-600 bg-white/[0.02] border border-white/[0.04] px-3 py-1.5 rounded-full">
            + 70 more
          </span>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-4 py-20">
        <p className="text-center text-[11px] text-slate-500 uppercase tracking-widest mb-3">How it works</p>
        <h2 className="text-3xl sm:text-4xl font-bold text-center mb-14">Set it once. Receive forever.</h2>

        <div className="grid sm:grid-cols-3 gap-5">
          {STEPS.map((step) => (
            <div key={step.n} className="bg-[#12121c] border border-white/[0.07] rounded-2xl p-6">
              <span className="inline-flex w-8 h-8 rounded-full bg-violet-600/20 border border-violet-500/30 text-violet-400 text-xs font-bold items-center justify-center mb-5">
                {step.n}
              </span>
              <h3 className="text-base font-semibold text-white mb-2">{step.title}</h3>
              <p className="text-sm text-slate-500 leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-4 pb-20">
        <p className="text-center text-[11px] text-slate-500 uppercase tracking-widest mb-3">Why JobFind</p>
        <h2 className="text-3xl sm:text-4xl font-bold text-center mb-14">Built to cut the noise.</h2>

        <div className="grid sm:grid-cols-2 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-[#12121c] border border-white/[0.07] rounded-2xl p-6 flex gap-4">
              <span className="text-2xl shrink-0 mt-0.5">{f.icon}</span>
              <div>
                <h3 className="text-base font-semibold text-white mb-1.5">{f.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-4 pb-20">
        <p className="text-center text-[11px] text-slate-500 uppercase tracking-widest mb-3">Pricing</p>
        <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">Simple, honest pricing.</h2>
        <p className="text-center text-slate-500 text-sm mb-14">Start free. Upgrade when you need faster alerts.</p>

        <div className="grid sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl p-6 border flex flex-col ${
                plan.highlight
                  ? 'border-violet-500/40 bg-violet-600/10'
                  : 'border-white/[0.07] bg-[#12121c]'
              }`}
            >
              {plan.highlight && (
                <p className="text-[10px] text-violet-400 font-bold uppercase tracking-widest mb-3">Most popular</p>
              )}
              <h3 className="text-lg font-bold text-white mb-1">{plan.name}</h3>
              <p className="text-2xl font-bold text-white mb-1">{plan.price}</p>
              <p className="text-xs text-slate-500 mb-6">{plan.sub}</p>

              <ul className="flex flex-col gap-2.5 mb-6 flex-1">
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
                  className="block w-full text-center border border-white/10 hover:border-white/20 text-slate-300 hover:text-white py-2.5 rounded-lg text-sm font-semibold transition-colors"
                >
                  {plan.cta} →
                </a>
              ) : (
                <Link
                  to={plan.to}
                  className="block w-full text-center bg-violet-600 hover:bg-violet-700 text-white py-2.5 rounded-lg text-sm font-semibold transition-colors"
                >
                  {plan.cta}
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-4 pb-24">
        <div className="relative bg-[#12121c] border border-violet-500/20 rounded-3xl p-14 text-center overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-violet-600/5" />
          <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[400px] h-[150px] bg-violet-600/10 blur-[80px] rounded-full" />
          <div className="relative">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Ready to get matched?</h2>
            <p className="text-slate-400 text-sm max-w-md mx-auto mb-8 leading-relaxed">
              Set up your profile in 2 minutes. We'll start scanning 90+ job boards and send you the best matches.
            </p>
            <Link
              to="/register"
              className="inline-block bg-violet-600 hover:bg-violet-700 text-white px-10 py-3.5 rounded-xl text-sm font-semibold transition-colors"
            >
              Create free account →
            </Link>
            <p className="text-xs text-slate-700 mt-4">No credit card · No spam · Unsubscribe anytime</p>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/[0.06] py-8 px-4">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-sm font-bold">
            Job<span className="text-violet-400">Find</span>
          </span>
          <div className="flex items-center gap-6">
            <Link to="/login" className="text-xs text-slate-600 hover:text-slate-400 transition-colors">Sign in</Link>
            <Link to="/register" className="text-xs text-slate-600 hover:text-slate-400 transition-colors">Register</Link>
            <a
              href="mailto:rajattalekar5143@gmail.com"
              className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
            >
              Contact
            </a>
          </div>
          <p className="text-xs text-slate-700">© 2026 JobFind</p>
        </div>
      </footer>

    </div>
  );
};

export default Landing;
