import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
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
        <button
          type="button"
          onClick={add}
          className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 transition-colors"
        >
          Add
        </button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2.5 py-1 rounded-full"
            >
              {tag}
              <button onClick={() => remove(tag)} className="ml-0.5 hover:text-blue-900">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

const Onboarding = () => {
  const [form, setForm] = useState({
    name: '',
    skills: [],
    experience: '',
    locations: [],
    salary: '',
    remotePreference: 'any',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user, login, token } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setError('Name is required');
    if (!form.skills.length) return setError('Add at least one skill');
    if (!form.experience) return setError('Experience is required');
    if (!form.locations.length) return setError('Add at least one location');
    setError('');
    setLoading(true);
    try {
      await api.post('/user/onboard', {
        ...form,
        experience: Number(form.experience),
        salary: form.salary ? Number(form.salary) : undefined,
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
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="w-full max-w-lg mx-auto bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <div className="mb-7 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Set up your profile</h1>
          <p className="text-sm text-gray-500 mt-1">
            We'll use this to match you with the right jobs
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full name</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Rajat Talekar"
            />
          </div>

          <TagInput
            label="Skills (press Enter or click Add)"
            placeholder="e.g. Node.js"
            tags={form.skills}
            onChange={(skills) => setForm({ ...form, skills })}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Years of experience
            </label>
            <input
              type="number"
              min="0"
              max="40"
              required
              value={form.experience}
              onChange={(e) => setForm({ ...form, experience: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="2"
            />
          </div>

          <TagInput
            label="Preferred locations (press Enter or click Add)"
            placeholder="e.g. Bangalore"
            tags={form.locations}
            onChange={(locations) => setForm({ ...form, locations })}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Expected salary (LPA in ₹) — optional
            </label>
            <input
              type="number"
              min="0"
              value={form.salary}
              onChange={(e) => setForm({ ...form, salary: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g. 12 (for ₹12 LPA)"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Work preference
            </label>
            <div className="flex gap-2 flex-wrap">
              {REMOTE_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
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

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-60 mt-2"
          >
            {loading ? 'Saving...' : 'Start finding jobs →'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Onboarding;
