import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import api from '../services/api';

const ADMIN_EMAIL = 'rajattalekar5143@gmail.com';

const SCHEDULE_TIERS = [
  { key: 24, label: 'Daily',        sublabel: 'Once per day',  premium: false },
  { key: 5,  label: 'Every 5 hrs',  sublabel: '5× per day',    premium: true  },
  { key: 1,  label: 'Every hour',   sublabel: '24× per day',   premium: true  },
];

const StatCard = ({ label, value, highlight }) => (
  <div className="bg-[#12121c] border border-white/10 rounded-xl p-4">
    <p className="text-[11px] text-slate-500 uppercase tracking-widest mb-2">{label}</p>
    <p className={`text-sm font-semibold ${highlight ? 'text-emerald-400' : 'text-white'}`}>{value}</p>
  </div>
);

const ScheduleSection = ({ currentInterval }) => (
  <div className="bg-[#12121c] border border-white/10 rounded-2xl p-6 mb-4">
    <p className="text-[11px] text-slate-500 uppercase tracking-widest mb-5">How often we email you</p>
    <div className="grid grid-cols-3 gap-3">
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
              <span className="absolute top-2.5 right-2.5 text-[9px] bg-violet-600 text-white px-1.5 py-0.5 rounded-full font-semibold tracking-wide uppercase">
                Active
              </span>
            )}
            {tier.premium && !isActive && (
              <span className="absolute top-2.5 right-2.5 text-[9px] bg-amber-500/15 text-amber-400 border border-amber-500/25 px-1.5 py-0.5 rounded-full font-semibold tracking-wide uppercase">
                Premium
              </span>
            )}
            <p className="text-white text-sm font-semibold mb-0.5 mt-0.5">{tier.label}</p>
            <p className="text-slate-500 text-xs mb-3">{tier.sublabel}</p>
            {tier.premium ? (
              <a
                href={`mailto:${ADMIN_EMAIL}?subject=JobFind%20Premium%20—%20${encodeURIComponent(tier.label)}%20emails&body=Hi%2C%20I'd%20like%20to%20get%20job%20alerts%20${encodeURIComponent(tier.label)}%20on%20JobFind.`}
                className="text-[11px] text-violet-400 hover:text-violet-300 font-medium transition-colors"
              >
                Contact admin →
              </a>
            ) : (
              <span className="text-[11px] text-emerald-500 font-medium">Free</span>
            )}
          </div>
        );
      })}
    </div>
    <p className="text-[13px] text-slate-600 mt-5 text-center">
      😅 Broke but want hourly alerts?{' '}
      <a
        href={`mailto:${ADMIN_EMAIL}?subject=Free%20Premium%20Please%20🙏`}
        className="text-violet-500 hover:text-violet-400 transition-colors"
      >
        Text Rajat
      </a>
      . He'll say "let me think about it" and then probably just do it.
    </p>
  </div>
);

const timeAgo = (date) => {
  const secs = Math.floor((Date.now() - new Date(date)) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const FeedbackCard = ({ fb, currentUserId }) => {
  const [likes, setLikes] = useState(fb.likes || []);
  const [dislikes, setDislikes] = useState(fb.dislikes || []);
  const [acting, setActing] = useState(false);

  const liked    = currentUserId && likes.some(id => id.toString() === currentUserId);
  const disliked = currentUserId && dislikes.some(id => id.toString() === currentUserId);

  const handleLike = async () => {
    if (acting) return;
    setActing(true);
    try {
      const r = await api.post(`/feedback/${fb._id}/like`);
      setLikes(r.data.likes);
      setDislikes(r.data.dislikes);
    } catch {}
    finally { setActing(false); }
  };

  const handleDislike = async () => {
    if (acting) return;
    setActing(true);
    try {
      const r = await api.post(`/feedback/${fb._id}/dislike`);
      setLikes(r.data.likes);
      setDislikes(r.data.dislikes);
    } catch {}
    finally { setActing(false); }
  };

  return (
    <div className="border border-white/[0.07] rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-slate-400">
          {fb.name?.split(' ')[0] || 'Anonymous'}
        </span>
        <span className="text-[11px] text-slate-700">{timeAgo(fb.timestamp)}</span>
      </div>

      <p className="text-sm text-slate-300 leading-relaxed">{fb.message}</p>

      <div className="flex items-center gap-4 mt-3">
        <button
          onClick={handleLike}
          disabled={acting}
          className={`flex items-center gap-1.5 text-xs transition-colors disabled:opacity-50 ${
            liked ? 'text-violet-400' : 'text-slate-600 hover:text-slate-400'
          }`}
        >
          <span>👍</span>
          {likes.length > 0 && <span>{likes.length}</span>}
        </button>
        <button
          onClick={handleDislike}
          disabled={acting}
          className={`flex items-center gap-1.5 text-xs transition-colors disabled:opacity-50 ${
            disliked ? 'text-red-400' : 'text-slate-600 hover:text-slate-400'
          }`}
        >
          <span>👎</span>
          {dislikes.length > 0 && <span>{dislikes.length}</span>}
        </button>
      </div>
    </div>
  );
};

const FEEDBACK_PAGE = 6;

const FeedbackSection = ({ currentUserId }) => {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [feedbacks, setFeedbacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(FEEDBACK_PAGE);

  useEffect(() => {
    api.get('/feedback')
      .then(r => setFeedbacks(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await api.post('/feedback', { message: message.trim() });
      setMessage('');
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 5000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send feedback');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-[#12121c] border border-white/10 rounded-2xl p-6 mb-4">
      <p className="text-[11px] text-slate-500 uppercase tracking-widest mb-1">Feedback</p>
      <p className="text-xs text-slate-600 mb-5">Your feedback helps us improve JobFind for everyone.</p>

      {/* Submit form */}
      <form onSubmit={handleSubmit} className="mb-6">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What's working? What should we improve? Anything you'd like to see?"
          maxLength={500}
          rows={3}
          className="w-full bg-[#1a1a28] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition resize-none"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-slate-700">{message.length}/500</span>
          <button
            type="submit"
            disabled={submitting || !message.trim()}
            className="bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {submitting ? 'Sending...' : 'Send feedback'}
          </button>
        </div>
        {submitted && <p className="text-xs text-emerald-400 mt-2">Thanks! Your feedback is pending review and will appear here once approved.</p>}
        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      </form>

      {/* Feedback list */}
      <div>
        <p className="text-[11px] text-slate-500 uppercase tracking-widest mb-3">What users are saying</p>
        {loading ? (
          <p className="text-sm text-slate-700 py-4">Loading...</p>
        ) : feedbacks.length === 0 ? (
          <p className="text-sm text-slate-700 text-center py-6">No feedback yet. Be the first to share!</p>
        ) : (
          <>
            <div className="columns-2 gap-3">
              {feedbacks.slice(0, visible).map((fb) => (
                <div key={fb._id} className="break-inside-avoid mb-3">
                  <FeedbackCard fb={fb} currentUserId={currentUserId} />
                </div>
              ))}
            </div>
            {visible < feedbacks.length && (
              <button
                onClick={() => setVisible(v => v + FEEDBACK_PAGE)}
                className="w-full mt-1 text-xs text-slate-600 hover:text-slate-400 py-2 transition-colors"
              >
                Show more ({feedbacks.length - visible} remaining)
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

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
            Hi {user?.name || 'there'}<br />
            <span className="text-slate-400 font-normal text-2xl">we're finding jobs for you.</span>
          </h1>
          <p className="text-slate-500 text-sm">
            Job matches are emailed to{' '}
            <span className="text-slate-300 font-medium">{user?.email}</span>
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <StatCard label="Status" value="Active" highlight />
          <StatCard label="Emails" value={getScheduleText()} />
          <StatCard label="Sources" value="90+ companies" />
        </div>

        {/* Schedule upgrade */}
        {profile && (
          <ScheduleSection currentInterval={profile.emailIntervalHours ?? 24} />
        )}

        {/* How it works */}
        <div className="bg-[#12121c] border border-white/10 rounded-2xl p-6 mb-4">
          <p className="text-[11px] text-slate-500 uppercase tracking-widest mb-5">How it works</p>
          <div className="flex flex-col gap-4">
            {[
              'We scan Adzuna + 90+ Greenhouse company boards continuously',
              'Jobs are scored against your skills, location, experience and salary',
              'The best matching jobs are emailed to you automatically',
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
          <div className="bg-[#12121c] border border-white/10 rounded-2xl p-6 mb-4">
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

        {/* Feedback */}
        <FeedbackSection currentUserId={profile?._id} />

        <p className="text-center text-xs text-slate-700 mt-10">
          Check your spam folder if you haven't received anything yet
        </p>
      </div>
    </div>
  );
};

export default Dashboard;
