import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import api from '../services/api';

const REMOTE_OPTIONS = ['any', 'remote', 'hybrid', 'office'];

const TagInput = ({ label, placeholder, tags, onChange }) => {
  const [input, setInput] = useState('');
  const add = () => {
    const val = input.trim();
    if (val && !tags.includes(val)) onChange([...tags, val]);
    setInput('');
  };
  const remove = (tag) => onChange(tags.filter((t) => t !== tag));

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder={placeholder}
        />
        <button type="button" onClick={add} className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">
          Add
        </button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {tags.map((tag) => (
            <span key={tag} className="flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2.5 py-1 rounded-full">
              {tag}
              <button onClick={() => remove(tag)} className="hover:text-blue-900">×</button>
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
    api.get('/user/profile').then((res) => {
      const u = res.data;
      setForm({
        name: u.name || '',
        skills: u.skills || [],
        experience: u.experience || '',
        locations: u.locations || [],
        salary: u.salary || '',
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
        salary: form.salary ? Number(form.salary) : undefined,
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
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="flex justify-center pt-20 text-gray-400">Loading...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-lg mx-auto px-4 py-8">
        <h1 className="text-xl font-bold text-gray-900 mb-6">Edit profile</h1>

        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <TagInput label="Skills" placeholder="e.g. Node.js" tags={form.skills} onChange={(skills) => setForm({ ...form, skills })} />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Years of experience</label>
              <input
                type="number" min="0" max="40"
                value={form.experience}
                onChange={(e) => setForm({ ...form, experience: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <TagInput label="Preferred locations" placeholder="e.g. Bangalore" tags={form.locations} onChange={(locations) => setForm({ ...form, locations })} />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Expected salary (LPA)</label>
              <input
                type="number" min="0"
                value={form.salary}
                onChange={(e) => setForm({ ...form, salary: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Work preference</label>
              <div className="flex gap-2 flex-wrap">
                {REMOTE_OPTIONS.map((opt) => (
                  <button
                    key={opt} type="button"
                    onClick={() => setForm({ ...form, remotePreference: opt })}
                    className={`px-4 py-2 rounded-lg text-sm capitalize border transition-colors ${
                      form.remotePreference === opt
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-300 text-gray-600 hover:border-gray-400'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}
            {success && <p className="text-sm text-green-600">Profile updated!</p>}

            <button
              type="submit" disabled={saving}
              className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-60"
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
