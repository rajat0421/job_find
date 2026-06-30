import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import api from '../services/api';

const StatCard = ({ label, value, highlight }) => (
  <div className="bg-[#12121c] border border-white/10 rounded-xl p-4">
    <p className="text-[11px] text-slate-500 uppercase tracking-widest mb-2">{label}</p>
    <p className={`text-sm font-semibold ${highlight ? 'text-emerald-400' : 'text-white'}`}>{value}</p>
  </div>
);

const Dashboard = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);

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

  return (
    <div className="min-h-screen bg-[#0a0a12]">
      <Navbar />

      <div className="max-w-2xl mx-auto px-4 py-14">

        {/* Hero */}
        <div className="mb-10">
          <p className="text-xs text-violet-400 font-semibold uppercase tracking-widest mb-3">JobFind</p>
          <h1 className="text-3xl font-bold text-white mb-3 leading-tight">
            Hi {user?.name || 'there'} —<br />
            <span className="text-slate-400 font-normal text-2xl">your job digest is active.</span>
          </h1>
          <p className="text-slate-500 text-sm">
            Matched jobs are sent to{' '}
            <span className="text-slate-300 font-medium">{user?.email}</span>
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <StatCard label="Status" value="Active" highlight />
          <StatCard label="Digest" value={getScheduleText()} />
          <StatCard label="Sources" value="90+ companies" />
        </div>

        {/* How it works */}
        <div className="bg-[#12121c] border border-white/10 rounded-2xl p-6 mb-4">
          <p className="text-[11px] text-slate-500 uppercase tracking-widest mb-5">How it works</p>
          <div className="flex flex-col gap-4">
            {[
              'We scan Adzuna + 90+ Greenhouse company boards continuously',
              'Jobs are scored against your skills, location, experience and salary',
              'The top matches land in your inbox on your schedule',
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="shrink-0 w-5 h-5 rounded-full bg-violet-600/20 border border-violet-500/30 text-violet-400 text-[10px] flex items-center justify-center font-bold mt-0.5">
                  {i + 1}
                </span>
                <p className="text-sm text-slate-400 leading-relaxed">{step}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Profile snapshot */}
        {profile && (
          <div className="bg-[#12121c] border border-white/10 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[11px] text-slate-500 uppercase tracking-widest">Your profile</p>
              <Link
                to="/profile"
                className="text-xs text-violet-400 hover:text-violet-300 font-medium transition-colors"
              >
                Edit →
              </Link>
            </div>

            {profile.skills?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                {profile.skills.map(s => (
                  <span key={s} className="text-xs bg-violet-600/15 text-violet-300 border border-violet-500/20 px-2.5 py-1 rounded-full">
                    {s}
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-slate-500">
              {profile.experience != null && (
                <span>{profile.experience} yr{profile.experience !== 1 ? 's' : ''} experience</span>
              )}
              {profile.locations?.length > 0 && <span>{profile.locations.join(', ')}</span>}
              {profile.salary > 0 && <span>₹{(profile.salary / 100000).toFixed(0)} LPA</span>}
              {profile.remotePreference && profile.remotePreference !== 'any' && (
                <span className="capitalize">{profile.remotePreference}</span>
              )}
            </div>
          </div>
        )}

        <p className="text-center text-xs text-slate-700 mt-10">
          Check your spam folder if you haven't received anything yet
        </p>
      </div>
    </div>
  );
};

export default Dashboard;
