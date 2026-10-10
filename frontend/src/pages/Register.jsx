import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import GoogleAuthButton from '../components/GoogleAuthButton';
import api from '../services/api';
import { AuthShell, inputCls, FOCUS_RING } from '../components/ui';

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
const generatePassword = () =>
  Array.from({ length: 14 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');

const Register = () => {
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleGenerate = () => {
    setForm({ ...form, password: generatePassword() });
    setShowPassword(true);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(form.password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/register', form);
      navigate('/verify-email', { state: { email: form.email } });
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      subtitle="Matched jobs delivered to your inbox"
      footer={<>Already have an account? <Link to="/login" className={`font-medium text-violet-400 hover:text-violet-300 rounded ${FOCUS_RING}`}>Sign in</Link></>}
    >
      <h2 className="text-base font-semibold text-white mb-5">Create your account</h2>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">Email address</label>
          <input
            type="email" required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className={inputCls}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-slate-300">Password</label>
            <button
              type="button"
              onClick={handleGenerate}
              className={`text-xs font-medium text-violet-400 hover:text-violet-300 transition-colors rounded ${FOCUS_RING}`}
            >
              Generate strong
            </button>
          </div>

          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              required minLength={6}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className={`${inputCls} pr-24`}
              placeholder="Min 6 characters"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
              {form.password && (
                <button type="button" onClick={handleCopy} className={`text-xs text-slate-500 hover:text-slate-300 transition-colors rounded ${FOCUS_RING}`}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              )}
              <button type="button" onClick={() => setShowPassword(v => !v)} className={`text-xs text-slate-500 hover:text-slate-300 transition-colors rounded ${FOCUS_RING}`}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2" role="alert">{error}</p>
        )}

        <button
          type="submit" disabled={loading}
          className={`w-full bg-violet-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors disabled:opacity-50 mt-1 ${FOCUS_RING}`}
        >
          {loading ? 'Creating account...' : 'Create account'}
        </button>
      </form>

      <div className="flex items-center gap-3 my-5">
        <div className="flex-1 h-px bg-white/10" />
        <span className="text-xs text-slate-600">OR</span>
        <div className="flex-1 h-px bg-white/10" />
      </div>

      <div className="flex justify-center">
        <GoogleAuthButton onError={setError} />
      </div>
    </AuthShell>
  );
};

export default Register;
