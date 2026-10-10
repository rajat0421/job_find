import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import api from '../services/api';
import { PageContainer, FOCUS_RING } from '../components/ui';
import {
  IconMail, IconClock, IconGrid, IconCheckCircle, IconPause,
  IconPencil, IconSparkle, IconArrowRight, IconPin,
} from '../components/icons';

const ADMIN_EMAIL = 'rajattalekar5143@gmail.com';

const SCHEDULE_TIERS = [
  { key: 24, label: 'Daily',        sublabel: 'Once per day',  premium: false },
  { key: 5,  label: 'Every 5 hrs',  sublabel: '5× per day',    premium: true  },
  { key: 1,  label: 'Every hour',   sublabel: '24× per day',   premium: true  },
];

// ── One summary row (replaces the old hero badges + separate stat cards,
//    which showed the same status/frequency information twice). ───────────
const SummaryItem = ({ icon: Icon, label, value, highlight }) => (
  <div className="flex items-center gap-2.5 px-4 py-3 sm:px-5">
    <span className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${highlight ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-slate-400'}`}>
      <Icon className="w-4 h-4" />
    </span>
    <div className="min-w-0">
      <p className="text-[11px] text-slate-500 leading-none mb-1">{label}</p>
      <p className={`text-sm font-semibold leading-none truncate ${highlight ? 'text-emerald-400' : 'text-white'}`}>{value}</p>
    </div>
  </div>
);

const ScheduleSection = ({ currentInterval }) => (
  <div className="bg-card border border-white/10 rounded-2xl p-6 sm:p-7">
    <div className="flex items-center justify-between mb-5">
      <p className="text-sm font-semibold text-white">Email frequency</p>
      <span className="text-xs text-slate-600 hidden sm:block">How often we send your matches</span>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {SCHEDULE_TIERS.map((tier) => {
        const isActive = currentInterval === tier.key;
        return (
          <div
            key={tier.key}
            className={`relative rounded-xl border p-5 transition-colors ${
              isActive
                ? 'border-violet-500/50 bg-violet-600/10'
                : 'border-white/[0.07] bg-card-soft'
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
            <p className="text-white text-base font-semibold mb-0.5 mt-0.5 pr-14">{tier.label}</p>
            <p className="text-slate-500 text-xs mb-5">{tier.sublabel}</p>
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
    <div className="min-h-screen bg-surface overflow-x-hidden">
      <Navbar />

      <PageContainer className="py-10 sm:py-12">

        {/* 1. Welcome hero — compact, no decorative illustration */}
        <div className="mb-6 max-w-2xl">
          <p className="text-sm text-slate-500 mb-2">Hi {user?.name || 'there'} 👋</p>
          <h1 className="text-[26px] sm:text-[32px] font-bold text-white leading-tight tracking-tight mb-3">
            Your next opportunity, delivered.
          </h1>
          <p className="text-slate-400 text-sm sm:text-[15px] leading-relaxed">
            Personalized job matches based on your skills, experience, and preferences — delivered straight to your inbox.
          </p>
        </div>

        {/* 2. Compact status summary — ONE row, real data only, no duplication
            with the hero or any other section. */}
        {profile && (
          <div className="bg-card border border-white/10 rounded-2xl mb-6 grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06] overflow-hidden">
            <SummaryItem
              icon={paused ? IconPause : IconCheckCircle}
              label="Recommendations"
              value={paused ? 'Paused' : 'Active'}
              highlight={!paused}
            />
            <SummaryItem
              icon={IconMail}
              label="Delivery"
              value={paused ? 'Off' : getScheduleText()}
            />
            <SummaryItem
              icon={IconGrid}
              label="Source coverage"
              value="130+ boards monitored"
            />
          </div>
        )}

        {/* 3. Email frequency and plan options */}
        {profile && (
          <div className="mb-6">
            <ScheduleSection currentInterval={profile.emailIntervalHours ?? 24} />
          </div>
        )}

        {/* 4. Job preference summary — a balanced two-column layout on
            desktop (skills vs. the rest), since those are genuinely two
            distinct kinds of content and the wider container gives skill
            chips real room to wrap without looking cramped. */}
        {profile && (
          <div className="bg-card border border-white/10 rounded-2xl p-6 sm:p-7 mb-6">
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
              <div className="lg:grid lg:grid-cols-3 lg:gap-8">
                <div className="lg:col-span-2">
                  {profile.skills?.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {profile.skills.map(s => (
                        <span key={s} className="text-xs bg-violet-600/15 text-violet-300 border border-violet-500/20 px-2.5 py-1 rounded-full break-words max-w-full">
                          {s}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-600">No skills added yet.</p>
                  )}
                </div>

                <div className="flex flex-col gap-2 mt-4 lg:mt-0 text-sm text-slate-400 lg:border-l lg:border-white/[0.06] lg:pl-6">
                  {profile.experience != null && (
                    <span className="inline-flex items-center gap-1.5">
                      <IconClock className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                      {profile.experience} yr{profile.experience !== 1 ? 's' : ''} experience
                    </span>
                  )}
                  {profile.locations?.length > 0 && (
                    <span className="inline-flex items-start gap-1.5">
                      <IconPin className="w-3.5 h-3.5 text-slate-600 shrink-0 mt-0.5" />
                      <span className="break-words">{profile.locations.join(', ')}</span>
                    </span>
                  )}
                  {profile.salary > 0 && (
                    <span className="inline-flex items-center gap-1.5">₹{(profile.salary / 100000).toFixed(0)} LPA expected</span>
                  )}
                  {profile.remotePreference && profile.remotePreference !== 'any' && (
                    <span className="capitalize">{profile.remotePreference}</span>
                  )}
                </div>
              </div>
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

        {/* 5. Minimal footer actions — the full feedback form/list lives on
            its own page (/feedback); this is just a quiet, compact entry
            point next to the unsubscribe action. */}
        {profile && (
          <div className="pt-6 border-t border-white/[0.06] text-center space-y-3">
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
      </PageContainer>
    </div>
  );
};

export default Dashboard;
