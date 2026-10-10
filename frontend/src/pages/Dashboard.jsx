import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import api from '../services/api';
import {
  IconMail, IconClock, IconGrid, IconCheckCircle, IconPause,
  IconPencil, IconSparkle, IconUserCircle, IconArrowRight, IconPin,
} from '../components/icons';

const ADMIN_EMAIL = 'rajattalekar5143@gmail.com';

const SCHEDULE_TIERS = [
  { key: 24, label: 'Daily',        sublabel: 'Once per day',  premium: false },
  { key: 5,  label: 'Every 5 hrs',  sublabel: '5× per day',    premium: true  },
  { key: 1,  label: 'Every hour',   sublabel: '24× per day',   premium: true  },
];

// Focus ring used on every interactive element for visible keyboard
// navigation, consistent with the dark theme.
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a12]';

const StatCard = ({ icon: Icon, label, value, sub, highlight }) => (
  <div className="bg-[#12121c] border border-white/10 rounded-xl p-4 flex flex-col gap-2 min-h-[94px]">
    <div className="flex items-center gap-1.5 text-slate-500">
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="text-[11px] font-medium truncate">{label}</span>
    </div>
    <p className={`text-sm font-semibold leading-snug ${highlight ? 'text-emerald-400' : 'text-white'}`}>{value}</p>
    {sub && <p className="text-[11px] text-slate-600">{sub}</p>}
  </div>
);

const ScheduleSection = ({ currentInterval }) => (
  <div className="bg-[#12121c] border border-white/10 rounded-2xl p-6 mb-4">
    <div className="flex items-center justify-between mb-5">
      <p className="text-sm font-semibold text-white">Email frequency</p>
      <span className="text-xs text-slate-600 hidden sm:block">How often we send your matches</span>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {SCHEDULE_TIERS.map((tier) => {
        const isActive = currentInterval === tier.key;
        return (
          <div
            key={tier.key}
            className={`relative rounded-xl border p-4 transition-colors ${
              isActive
                ? 'border-violet-500/50 bg-violet-600/10'
                : 'border-white/[0.07] bg-[#0f0f1a]'
            }`}
          >
            {isActive && (
              <span className="absolute top-3 right-3 inline-flex items-center gap-1 text-[10px] bg-violet-600 text-white px-2 py-0.5 rounded-full font-semibold">
                <IconCheckCircle className="w-3 h-3" /> Active
              </span>
            )}
            {tier.premium && !isActive && (
              <span className="absolute top-3 right-3 inline-flex items-center gap-1 text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/25 px-2 py-0.5 rounded-full font-semibold">
                <IconSparkle className="w-3 h-3" /> Premium
              </span>
            )}
            <p className="text-white text-sm font-semibold mb-0.5 mt-0.5 pr-14">{tier.label}</p>
            <p className="text-slate-500 text-xs mb-4">{tier.sublabel}</p>
            {tier.premium ? (
              <a
                href={`mailto:${ADMIN_EMAIL}?subject=JobFind%20Premium%20—%20${encodeURIComponent(tier.label)}%20emails&body=Hi%2C%20I'd%20like%20to%20get%20job%20alerts%20${encodeURIComponent(tier.label)}%20on%20JobFind.`}
                className={`inline-flex items-center gap-1 text-xs font-medium text-violet-400 hover:text-violet-300 transition-colors rounded ${FOCUS_RING}`}
              >
                Contact us <IconArrowRight className="w-3.5 h-3.5" />
              </a>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-500">
                <IconCheckCircle className="w-3.5 h-3.5" /> Included free
              </span>
            )}
          </div>
        );
      })}
    </div>

    <div className="mt-5 pt-5 border-t border-white/[0.06] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <p className="text-xs text-slate-500 leading-relaxed">
        Want more frequent job alerts? Contact us to explore premium options.
      </p>
      <a
        href={`mailto:${ADMIN_EMAIL}?subject=JobFind%20Premium%20inquiry&body=Hi%2C%20I'm%20interested%20in%20faster%20email%20alerts%20on%20JobFind.`}
        className={`shrink-0 inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 px-3.5 py-2 rounded-lg transition-colors ${FOCUS_RING}`}
      >
        Contact us
      </a>
    </div>
  </div>
);

// Calculated from real profile fields (the exact ones JobFind's matcher
// actually reads) — never a fabricated or hardcoded number.
const COMPLETENESS_CHECKS = [
  (p) => p.skills?.length > 0,
  (p) => p.desiredRoles?.length > 0,
  (p) => p.experience != null,
  (p) => p.locations?.length > 0,
  (p) => p.salary > 0,
];
const profileCompleteness = (p) => Math.round((COMPLETENESS_CHECKS.filter((check) => check(p)).length / COMPLETENESS_CHECKS.length) * 100);
const hasAnyProfileData = (p) => COMPLETENESS_CHECKS.some((check) => check(p));

const Dashboard = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [togglingEmail, setTogglingEmail] = useState(false);

  useEffect(() => {
    api.get('/user/profile').then(r => setProfile(r.data)).catch(() => {});
  }, []);

  const getScheduleText = () => {
    if (!profile) return '—';
    const { emailIntervalHours, emailSendHourIST } = profile;
    if (emailIntervalHours === 1) return 'Every hour';
    if (emailIntervalHours === 5) return 'Every 5 hours';
    const h = emailSendHourIST % 12 || 12;
    const ampm = emailSendHourIST >= 12 ? 'PM' : 'AM';
    return `Daily at ${h}:00 ${ampm} IST`;
  };

  const handleToggleEmail = async () => {
    if (togglingEmail) return;
    setTogglingEmail(true);
    try {
      const r = await api.post('/user/unsubscribe');
      setProfile(p => ({ ...p, emailPaused: r.data.emailPaused }));
    } catch {}
    finally { setTogglingEmail(false); }
  };

  const paused = profile?.emailPaused;

  return (
    <div className="min-h-screen bg-[#0a0a12] overflow-x-hidden">
      <Navbar />

      <div className="max-w-2xl mx-auto px-4 py-10 sm:py-14">

        {/* Hero */}
        <div className="mb-8">
          <p className="text-sm text-slate-500 mb-2">Hi {user?.name || 'there'} 👋</p>
          <h1 className="text-[26px] sm:text-3xl font-bold text-white leading-tight tracking-tight mb-3">
            Your next opportunity, delivered.
          </h1>
          <p className="text-slate-400 text-sm sm:text-[15px] leading-relaxed max-w-md mb-5">
            Personalized job matches based on your skills, experience, and preferences — delivered straight to your inbox.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium pl-2 pr-2.5 py-1 rounded-full border ${
              paused ? 'bg-slate-500/10 text-slate-400 border-slate-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${paused ? 'bg-slate-500' : 'bg-emerald-400'}`} />
              {paused ? 'Recommendations paused' : 'Recommendations active'}
            </span>
            {!paused && profile && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-white/5 text-slate-400 border border-white/10">
                <IconClock className="w-3.5 h-3.5" /> {getScheduleText()}
              </span>
            )}
            {profile && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-white/5 text-slate-400 border border-white/10">
                <IconUserCircle className="w-3.5 h-3.5" /> Profile {profileCompleteness(profile)}% complete
              </span>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <StatCard icon={paused ? IconPause : IconCheckCircle} label="Status" value={paused ? 'Paused' : 'Active'} highlight={!paused} />
          <StatCard icon={IconMail} label="Delivery" value={paused ? 'Off' : getScheduleText()} />
          <StatCard icon={IconGrid} label="Coverage" value="90+ sources" sub="boards monitored" />
        </div>

        {/* Schedule upgrade */}
        {profile && (
          <ScheduleSection currentInterval={profile.emailIntervalHours ?? 24} />
        )}

        {/* How it works — intentionally lighter-weight than the sections above */}
        <div className="bg-[#12121c]/60 border border-white/[0.06] rounded-xl p-5 mb-4">
          <p className="text-xs font-medium text-slate-500 mb-4">How it works</p>
          <div className="flex flex-col gap-3">
            {[
              'JobFind collects opportunities from supported job sources.',
              'Jobs are scored against your skills and preferences.',
              'Relevant matches are delivered by email.',
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="shrink-0 w-5 h-5 rounded-full bg-white/5 text-slate-500 text-[10px] flex items-center justify-center font-semibold mt-0.5">
                  {i + 1}
                </span>
                <p className="text-[13px] text-slate-500 leading-relaxed">{step}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Profile snapshot */}
        {profile && (
          <div className="bg-[#12121c] border border-white/10 rounded-2xl p-6 mb-4">
            <div className="flex items-center justify-between mb-5">
              <p className="text-sm font-semibold text-white">Your job preferences</p>
              <Link
                to="/profile"
                className={`inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-colors ${FOCUS_RING}`}
              >
                <IconPencil className="w-3.5 h-3.5" /> Edit profile
              </Link>
            </div>

            {hasAnyProfileData(profile) ? (
              <>
                {profile.skills?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {profile.skills.map(s => (
                      <span key={s} className="text-xs bg-violet-600/15 text-violet-300 border border-violet-500/20 px-2.5 py-1 rounded-full break-words max-w-full">
                        {s}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-400">
                  {profile.experience != null && (
                    <span className="inline-flex items-center gap-1.5">
                      <IconClock className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                      {profile.experience} yr{profile.experience !== 1 ? 's' : ''} experience
                    </span>
                  )}
                  {profile.locations?.length > 0 && (
                    <span className="inline-flex items-center gap-1.5">
                      <IconPin className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                      {profile.locations.join(', ')}
                    </span>
                  )}
                  {profile.salary > 0 && (
                    <span className="inline-flex items-center gap-1.5">₹{(profile.salary / 100000).toFixed(0)} LPA expected</span>
                  )}
                  {profile.remotePreference && profile.remotePreference !== 'any' && (
                    <span className="capitalize">{profile.remotePreference}</span>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-5">
                <p className="text-sm text-slate-400 mb-4 max-w-sm mx-auto leading-relaxed">
                  Your profile is empty. Add your skills and preferences so JobFind can start matching you with relevant roles.
                </p>
                <Link
                  to="/profile"
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 px-4 py-2 rounded-lg transition-colors ${FOCUS_RING}`}
                >
                  Complete your profile <IconArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Footer — the full feedback form/list now lives on its own page
            (/feedback); this is just a compact entry point, kept alongside
            the unsubscribe action so the dashboard still ends with a clear,
            intentional close rather than an abrupt empty gap. */}
        {profile && (
          <div className="mt-2 pt-6 border-t border-white/[0.06] text-center space-y-3">
            <div className="flex items-center justify-center gap-4 text-xs">
              <Link
                to="/feedback"
                className={`text-slate-500 hover:text-slate-300 transition-colors rounded ${FOCUS_RING}`}
              >
                Share feedback
              </Link>
              <span className="text-slate-800">·</span>
              <button
                onClick={handleToggleEmail}
                disabled={togglingEmail}
                className={`text-slate-500 hover:text-slate-300 underline underline-offset-2 transition-colors disabled:opacity-50 rounded ${FOCUS_RING}`}
              >
                {togglingEmail
                  ? '...'
                  : paused
                  ? 'Resume job emails'
                  : 'Stop receiving job emails'}
              </button>
            </div>
            <p className="text-xs text-slate-700">
              Check your spam folder if you haven't received anything yet
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
