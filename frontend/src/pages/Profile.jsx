import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import api from '../services/api';
import SkillTagInput from '../components/SkillTagInput';
import RoleSelector from '../components/RoleSelector';
import { PageContainer, inputCls, labelCls, FOCUS_RING } from '../components/ui';

const EXPERIENCE_OPTIONS = [
  { value: 0,  label: 'Fresher' },
  { value: 1,  label: '1 Year' },
  { value: 2,  label: '2 Years' },
  { value: 3,  label: '3 Years' },
  { value: 4,  label: '4 Years' },
  { value: 5,  label: '5 Years' },
  { value: 6,  label: '6 Years' },
  { value: 7,  label: '7 Years' },
  { value: 8,  label: '8 Years' },
  { value: 9,  label: '9 Years' },
  { value: 10, label: '10+ Years' },
];

const QUALIFICATION_OPTIONS = [
  'B.E / B.Tech',
  'M.Tech',
  'BCA',
  'MCA',
  'B.Sc',
  'M.Sc',
  'MBA',
  'Diploma',
  'PhD',
  'Other',
];

const REMOTE_OPTIONS = [
  { value: 'any',    label: 'Any' },
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'office', label: 'In-office' },
];

const chipBase = 'px-3.5 py-2 rounded-lg text-sm font-medium border transition-colors';
const chipActive = 'bg-violet-600 text-white border-violet-600';
const chipIdle = 'border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200 bg-transparent';

const TagInput = ({ label, hint, placeholder, tags, onChange }) => {
  const [input, setInput] = useState('');
  const add = () => {
    const val = input.trim();
    if (val && !tags.includes(val)) onChange([...tags, val]);
    setInput('');
  };
  const remove = (tag) => onChange(tags.filter(t => t !== tag));

  return (
    <div>
      <label className={labelCls}>{label}</label>
      {hint && <p className="text-xs text-slate-600 mb-2">{hint}</p>}
      <div className="flex gap-2">
        <input
          type="text" value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          className={inputCls}
          placeholder={placeholder}
        />
        <button
          type="button" onClick={add}
          className={`px-4 py-2.5 bg-white/5 border border-white/10 text-slate-300 rounded-lg text-sm font-medium hover:bg-white/10 transition-colors ${FOCUS_RING}`}
        >
          Add
        </button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {tags.map(tag => (
            <span key={tag} className="inline-flex items-center gap-1 bg-violet-600/15 text-violet-300 border border-violet-500/20 text-xs font-medium px-2.5 py-1 rounded-full break-words max-w-full">
              {tag}
              <button type="button" onClick={() => remove(tag)} aria-label={`Remove ${tag}`} className="hover:text-white leading-none p-1 -m-1 rounded">&times;</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

// Small section heading used to group related fields — purely organizational,
// no change to the fields themselves or what gets submitted.
const Section = ({ title, children }) => (
  <div className="flex flex-col gap-5">
    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</p>
    {children}
  </div>
);

const Profile = () => {
  const { user, login, token } = useAuth();
  const [form, setForm] = useState({
    name: '', desiredRoles: [], skills: [], experience: null,
    qualification: '', locations: [], salary: '', remotePreference: 'any',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  // Guards the one-time initial populate from ever running twice and
  // clobbering an in-progress edit — e.g. if this effect's logic is ever
  // touched again later and starts firing more than once. Currently the form
  // itself is hidden behind the full-page "Loading..." state until this
  // first response arrives, so there's no live edit to protect against yet,
  // but this makes that invariant explicit rather than implicit.
  const hasInitialized = useRef(false);

  useEffect(() => {
    const applyProfile = (u) => {
      if (hasInitialized.current) return;
      hasInitialized.current = true;
      setForm({
        // Root cause of the blank Full-name report: this previously fell
        // back straight to '' when the saved profile had no name, ignoring
        // the name JobFind already has for this session (set at login/
        // onboarding, exposed via AuthContext). Preferring the saved
        // profile's name when present, and only falling back to the
        // authenticated user's name — never hardcoded — fixes that without
        // ever overwriting a real saved name.
        name: u.name || user?.name || '',
        desiredRoles: u.desiredRoles || [],
        skills: u.skills || [],
        experience: u.experience ?? null,
        qualification: u.qualification || '',
        locations: u.locations || [],
        salary: u.salary ? u.salary / 100000 : '',
        remotePreference: u.remotePreference || 'any',
      });
    };

    api.get('/user/profile').then(res => {
      applyProfile(res.data);
    }).catch(() => {
      // Previously un-handled: a failed request silently left the form at
      // its empty initial state with zero indication anything went wrong —
      // indistinguishable from "this user just has no saved profile". Now it
      // still falls back to the known authenticated name (never leaves a
      // known name blank) and says so, rather than failing silently.
      if (!hasInitialized.current) {
        hasInitialized.current = true;
        setForm(f => ({ ...f, name: user?.name || f.name }));
      }
      setLoadError('Could not load your saved profile — showing what we know from your account. Refresh to try again.');
    }).finally(() => setLoading(false));
    // Intentionally run once on mount only — `user` is read synchronously
    // from AuthContext's initial state (backed by localStorage), so it's
    // already correct on this first run without needing to be a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.put('/user/profile', {
        ...form,
        salary: form.salary ? Number(form.salary) * 100000 : undefined,
      });
      login(token, { ...user, name: form.name });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <div className="flex justify-center pt-24 text-slate-600 text-sm">Loading...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <PageContainer className="py-10">
        {/* Root cause of the "too far left" report: this inner width cap had
            no `mx-auto` of its own, so it sat flush against the left edge of
            the already-centered PageContainer instead of being centered
            within it. */}
        <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-white">Profile</h1>
          <p className="text-sm text-slate-500 mt-0.5">Update your preferences to improve job matches</p>
        </div>

        {loadError && (
          <p className="text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-6" role="alert">{loadError}</p>
        )}

        <div className="bg-card border border-white/10 rounded-2xl p-7">
          <form onSubmit={handleSubmit} className="flex flex-col gap-8">

            <Section title="About you">
              <div>
                <label className={labelCls}>Full name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputCls}
                  placeholder="Your full name"
                />
              </div>
              <div>
                <label className={labelCls}>
                  Highest qualification{' '}
                  <span className="text-slate-500 font-normal">(optional)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {QUALIFICATION_OPTIONS.map(q => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setForm({ ...form, qualification: form.qualification === q ? '' : q })}
                      className={`${chipBase} ${form.qualification === q ? chipActive : chipIdle} ${FOCUS_RING}`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </Section>

            <Section title="Role & skills">
              <RoleSelector
                selected={form.desiredRoles}
                onChange={(desiredRoles) => setForm({ ...form, desiredRoles })}
              />
              <SkillTagInput label="Skills" tags={form.skills} onChange={skills => setForm({ ...form, skills })} />
            </Section>

            <Section title="Experience & location">
              <div>
                <label className={labelCls}>Years of experience</label>
                <div className="flex flex-wrap gap-2">
                  {EXPERIENCE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setForm({ ...form, experience: opt.value })}
                      className={`${chipBase} ${form.experience === opt.value ? chipActive : chipIdle} ${FOCUS_RING}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <TagInput
                label="Preferred locations"
                hint="Press Enter or click Add after each location"
                placeholder="e.g. Bangalore, Mumbai, Remote..."
                tags={form.locations}
                onChange={locations => setForm({ ...form, locations })}
              />
            </Section>

            <Section title="Preferences">
              <div>
                <label className={labelCls}>
                  Expected salary <span className="text-slate-500 font-normal">(LPA — optional)</span>
                </label>
                <input
                  type="number" min="0"
                  value={form.salary}
                  onChange={(e) => setForm({ ...form, salary: e.target.value })}
                  className={inputCls}
                  placeholder="e.g. 12"
                />
              </div>

              <div>
                <label className={labelCls}>Work preference</label>
                <div className="flex gap-2 flex-wrap">
                  {REMOTE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setForm({ ...form, remotePreference: opt.value })}
                      className={`${chipBase} ${form.remotePreference === opt.value ? chipActive : chipIdle} ${FOCUS_RING}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </Section>

            {error && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2" role="alert">{error}</p>
            )}
            {success && (
              <p className="text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2" role="status">
                Profile updated successfully.{' '}
                <Link to="/dashboard" className={`underline underline-offset-2 hover:text-emerald-300 transition-colors rounded ${FOCUS_RING}`}>
                  Go to home →
                </Link>
              </p>
            )}

            <button
              type="submit" disabled={saving}
              className={`w-full bg-violet-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors disabled:opacity-50 ${FOCUS_RING}`}
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </form>
        </div>
        </div>
      </PageContainer>
    </div>
  );
};

export default Profile;
