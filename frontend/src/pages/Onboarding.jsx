import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const REMOTE_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'office', label: 'In-office' },
];

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
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      {hint && <p className="text-xs text-slate-400 mb-2">{hint}</p>}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          className="flex-1 border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={add}
          className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors"
        >
          Add
        </button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {tags.map(tag => (
            <span key={tag} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs font-medium px-2.5 py-1 rounded-md">
              {tag}
              <button onClick={() => remove(tag)} className="hover:text-indigo-900 leading-none">&times;</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

const Onboarding = () => {
  const [form, setForm] = useState({
    name: '', skills: [], experience: '',
    locations: [], salary: '', remotePreference: 'any',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user, login, token } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setError('Full name is required');
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
    <div className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="max-w-lg mx-auto">

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Job<span className="text-indigo-600">Find</span>
          </h1>
          <p className="text-slate-500 text-sm mt-2">Set up your profile so we can match you with the right jobs</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-7 shadow-sm">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Full name</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                placeholder="Your full name"
              />
            </div>

            <TagInput
              label="Skills"
              hint="Press Enter or click Add after each skill"
              placeholder="e.g. Node.js, React, Python..."
              tags={form.skills}
              onChange={(skills) => setForm({ ...form, skills })}
            />

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Years of experience</label>
              <input
                type="number" min="0" max="40" required
                value={form.experience}
                onChange={(e) => setForm({ ...form, experience: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
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
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Expected salary <span className="text-slate-400 font-normal">(LPA — optional)</span>
              </label>
              <input
                type="number" min="0"
                value={form.salary}
                onChange={(e) => setForm({ ...form, salary: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                placeholder="e.g. 12"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Work preference</label>
              <div className="flex gap-2 flex-wrap">
                {REMOTE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm({ ...form, remotePreference: opt.value })}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      form.remotePreference === opt.value
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'border-slate-300 text-slate-600 hover:border-slate-400 hover:text-slate-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-60 mt-1"
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
