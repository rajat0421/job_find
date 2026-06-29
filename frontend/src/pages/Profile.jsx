import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import api from '../services/api';
import SkillTagInput from '../components/SkillTagInput';

const REMOTE_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'office', label: 'In-office' },
];

const TagInput = ({ label, placeholder, tags, onChange }) => {
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
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          className="flex-1 border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
          placeholder={placeholder}
        />
        <button type="button" onClick={add} className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors">
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

const Profile = () => {
  const { user, login, token } = useAuth();
  const [form, setForm] = useState({
    name: '', skills: [], experience: '', locations: [], salary: '', remotePreference: 'any',
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
        skills: u.skills || [],
        experience: u.experience ?? '',
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
        experience: Number(form.experience),
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
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <div className="flex justify-center pt-24 text-slate-400 text-sm">Loading...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-slate-900">Profile</h1>
          <p className="text-sm text-slate-500 mt-0.5">Update your preferences to improve job matches</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-7 shadow-sm">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Full name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
              />
            </div>

            <SkillTagInput label="Skills" tags={form.skills} onChange={skills => setForm({ ...form, skills })} />

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Years of experience</label>
              <input
                type="number" min="0" max="40"
                value={form.experience}
                onChange={(e) => setForm({ ...form, experience: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
              />
            </div>

            <TagInput label="Preferred locations" placeholder="e.g. Bangalore" tags={form.locations} onChange={locations => setForm({ ...form, locations })} />

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Expected salary <span className="text-slate-400 font-normal">(LPA)</span>
              </label>
              <input
                type="number" min="0"
                value={form.salary}
                onChange={(e) => setForm({ ...form, salary: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
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
                        : 'border-slate-300 text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}
            {success && <p className="text-sm text-emerald-600">Profile updated successfully.</p>}

            <button
              type="submit" disabled={saving}
              className="w-full bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-60 mt-1"
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
