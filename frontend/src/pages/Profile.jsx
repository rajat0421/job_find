import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import api from '../services/api';
import SkillTagInput from '../components/SkillTagInput';
import RoleSelector from '../components/RoleSelector';

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

const inputCls = 'w-full bg-[#1a1a28] border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition';
const labelCls = 'block text-sm font-medium text-slate-300 mb-1.5';
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
          className="px-4 py-2.5 bg-white/5 border border-white/10 text-slate-300 rounded-lg text-sm font-medium hover:bg-white/10 transition-colors"
        >
          Add
        </button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {tags.map(tag => (
            <span key={tag} className="inline-flex items-center gap-1 bg-violet-600/15 text-violet-300 border border-violet-500/20 text-xs font-medium px-2.5 py-1 rounded-full">
              {tag}
              <button onClick={() => remove(tag)} className="hover:text-white leading-none">&times;</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

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

  useEffect(() => {
    api.get('/user/profile').then(res => {
      const u = res.data;
      setForm({
        name: u.name || '',
        desiredRoles: u.desiredRoles?.length ? u.desiredRoles : (u.desiredRole ? [u.desiredRole] : []),
        skills: u.skills || [],
        experience: u.experience ?? null,
        qualification: u.qualification || '',
        locations: u.locations || [],
        salary: u.salary ? u.salary / 100000 : '',
        remotePreference: u.remotePreference || 'any',
      });
    }).finally(() => setLoading(false));
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
    <div className="min-h-screen bg-[#0a0a12]">
      <Navbar />
      <div className="flex justify-center pt-24 text-slate-600 text-sm">Loading...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0a0a12]">
      <Navbar />
      <div className="max-w-lg mx-auto px-4 py-10">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-white">Profile</h1>
          <p className="text-sm text-slate-500 mt-0.5">Update your preferences to improve job matches</p>
        </div>

        <div className="bg-[#12121c] border border-white/10 rounded-2xl p-7">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">

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

            <RoleSelector
              selected={form.desiredRoles}
              onChange={(desiredRoles) => setForm({ ...form, desiredRoles })}
            />

            <SkillTagInput label="Skills" tags={form.skills} onChange={skills => setForm({ ...form, skills })} />

            <div>
              <label className={labelCls}>Years of experience</label>
              <div className="flex flex-wrap gap-2">
                {EXPERIENCE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm({ ...form, experience: opt.value })}
                    className={`${chipBase} ${form.experience === opt.value ? chipActive : chipIdle}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
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
                    className={`${chipBase} ${form.qualification === q ? chipActive : chipIdle}`}
                  >
                    {q}
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
                    className={`${chipBase} ${form.remotePreference === opt.value ? chipActive : chipIdle}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}
            {success && (
              <p className="text-sm text-emerald-400">
                Profile updated successfully.{' '}
                <Link to="/dashboard" className="underline underline-offset-2 hover:text-emerald-300 transition-colors">
                  Go to home →
                </Link>
              </p>
            )}

            <button
              type="submit" disabled={saving}
              className="w-full bg-violet-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors disabled:opacity-50 mt-1"
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Profile;
