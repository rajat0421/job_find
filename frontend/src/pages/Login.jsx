import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import GoogleAuthButton from '../components/GoogleAuthButton';
import api from '../services/api';
import { AuthShell, inputCls, labelCls, FOCUS_RING } from '../components/ui';

const Login = () => {
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/login', form);
      login(res.data.token, { email: form.email, name: res.data.name, isOnboarded: res.data.isOnboarded });
      navigate(res.data.isOnboarded ? '/dashboard' : '/onboarding');
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      subtitle="Welcome back"
      footer={<>Don't have an account? <Link to="/register" className={`font-medium text-violet-400 hover:text-violet-300 rounded ${FOCUS_RING}`}>Sign up</Link></>}
    >
      <h2 className="text-base font-semibold text-white mb-5">Sign in to your account</h2>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className={labelCls}>Email address</label>
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
            <Link to="/forgot-password" className={`text-xs text-violet-400 hover:text-violet-300 transition-colors rounded ${FOCUS_RING}`}>
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className={`${inputCls} pr-16`}
              placeholder="Your password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-300 transition-colors rounded ${FOCUS_RING}`}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2" role="alert">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className={`w-full bg-violet-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors disabled:opacity-50 mt-1 ${FOCUS_RING}`}
        >
          {loading ? 'Signing in...' : 'Sign in'}
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

export default Login;
