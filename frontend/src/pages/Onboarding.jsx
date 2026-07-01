import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import SkillTagInput from '../components/SkillTagInput';

const ROLES = [
  'Backend Developer',
  'Frontend Developer',
  'Full Stack Developer',
  'Software Engineer',
  'DevOps Engineer',
  'Data Engineer',
  'Data Scientist',
  'ML Engineer',
  'AI Engineer',
  'Mobile Developer',
  'QA Engineer',
  'Cloud Architect',
  'Cybersecurity',
  'Blockchain Developer',
  'Embedded Engineer',
  'Tech Lead',
  'Engineering Manager',
  'Product Manager',
];

const MAX_ROLES = 3;

const REMOTE_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'office', label: 'In-office' },
];

const inputCls = 'w-full bg-[#1a1a28] border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition';
const labelCls = 'block text-sm font-medium text-slate-300 mb-1.5';

const RoleSelector = ({ selected, onChange }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  const atMax = selected.length >= MAX_ROLES;

  const suggestions = query.trim()
    ? ROLES.filter(r => r.toLowerCase().includes(query.toLowerCase()) && !selected.includes(r))
    : ROLES.filter(r => !selected.includes(r));

  const add = (role) => {
    if (atMax || selected.includes(role)) return;
    onChange([...selected, role]);
    setQuery('');
    setOpen(false);
  };

  const addCustom = () => {
    const val = query.trim();
    if (!val || atMax || selected.includes(val)) return;
    onChange([...selected, val]);
    setQuery('');
    setOpen(false);
  };

  const remove = (role) => onChange(selected.filter(r => r !== role));

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestions.length === 1) {
        add(suggestions[0]);
      } else if (query.trim() && !ROLES.includes(query.trim())) {
        addCustom();
      } else if (suggestions[0]) {
        add(suggestions[0]);
      }
    }
    if (e.key === 'Escape') setOpen(false);
  };

  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={wrapperRef}>
      <label className={labelCls}>What job titles are you interested in?</label>
      <p className="text-xs text-slate-600 mb-2">Search or type a role — pick up to {MAX_ROLES}</p>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map(role => (
            <span key={role} className="inline-flex items-center gap-1 bg-violet-600/20 text-violet-300 border border-violet-500/30 text-xs font-medium px-2.5 py-1 rounded-full">
              {role}
              <button type="button" onClick={() => remove(role)} className="hover:text-white leading-none ml-0.5">&times;</button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <input
          type="text"
          value={query}
          disabled={atMax}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={atMax ? `Max ${MAX_ROLES} selected` : 'Search or type a role…'}
          className={`${inputCls} ${atMax ? 'opacity-40 cursor-not-allowed' : ''}`}
        />

        {/* Dropdown */}
        {open && !atMax && (
          <div className="absolute z-10 mt-1 w-full bg-[#1a1a28] border border-white/10 rounded-lg shadow-xl max-h-52 overflow-y-auto">
            {suggestions.length > 0 ? (
              suggestions.map(role => (
                <button
                  key={role}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); add(role); }}
                  className="w-full text-left px-3.5 py-2.5 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
                >
                  {role}
                </button>
              ))
            ) : null}
            {/* Custom entry option */}
            {query.trim() && !ROLES.map(r => r.toLowerCase()).includes(query.trim().toLowerCase()) && (
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); addCustom(); }}
                className="w-full text-left px-3.5 py-2.5 text-sm text-violet-400 hover:bg-white/5 transition-colors border-t border-white/5"
              >
                Add "{query.trim()}"
              </button>
            )}
            {suggestions.length === 0 && !query.trim() && (
              <p className="px-3.5 py-3 text-xs text-slate-600">All roles selected</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

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

const Onboarding = () => {
  const [form, setForm] = useState({
    name: '', desiredRoles: [], skills: [], experience: '',
    locations: [], salary: '', remotePreference: 'any',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user, login, token } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setError('Full name is required');
    if (!form.desiredRoles.length) return setError('Add at least one role you are looking for');
    if (!form.skills.length) return setError('Add at least one skill');
    if (!form.experience) return setError('Years of experience is required');
    if (!form.locations.length) return setError('Add at least one preferred location');
    setError('');
    setLoading(true);
    try {
      await api.post('/user/onboard', {
        ...form,
        experience: Number(form.experience),
        salary: form.salary ? Number(form.salary) * 100000 : undefined,
      });
      login(token, { ...user, name: form.name, isOnboarded: true });
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a12] px-4 py-12">
      <div className="max-w-lg mx-auto">

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Job<span className="text-violet-400">Find</span>
          </h1>
          <p className="text-slate-500 text-sm mt-2">Set up your profile so we can match you with the right jobs</p>
        </div>

        <div className="bg-[#12121c] border border-white/10 rounded-2xl p-7">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">

            <div>
              <label className={labelCls}>Full name</label>
              <input
                type="text" required
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

            <SkillTagInput
              label="Skills"
              tags={form.skills}
              onChange={(skills) => setForm({ ...form, skills })}
            />

            <div>
              <label className={labelCls}>Years of experience</label>
              <input
                type="number" min="0" max="40" required
                value={form.experience}
                onChange={(e) => setForm({ ...form, experience: e.target.value })}
                className={inputCls}
                placeholder="2"
              />
            </div>

            <TagInput
              label="Preferred locations"
              hint="Press Enter or click Add after each location"
              placeholder="e.g. Bangalore, Mumbai, Remote..."
              tags={form.locations}
              onChange={(locations) => setForm({ ...form, locations })}
            />

            <div>
              <label className={labelCls}>
                Expected salary{' '}
                <span className="text-slate-500 font-normal">(LPA — optional)</span>
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
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      form.remotePreference === opt.value
                        ? 'bg-violet-600 text-white border-violet-600'
                        : 'border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200 bg-transparent'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit" disabled={loading}
              className="w-full bg-violet-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors disabled:opacity-50 mt-1"
            >
              {loading ? 'Saving...' : 'Save and start matching'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
