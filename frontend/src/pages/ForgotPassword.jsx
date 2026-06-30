import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
      setTimeout(() => navigate(`/reset-password?email=${encodeURIComponent(email)}`), 1500);
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a12] px-4">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Job<span className="text-violet-400">Find</span>
          </h1>
          <p className="text-sm text-slate-500 mt-2">Reset your password</p>
        </div>

        <div className="bg-[#12121c] border border-white/10 rounded-2xl p-7">
          <h2 className="text-base font-semibold text-white mb-1">Forgot your password?</h2>
          <p className="text-sm text-slate-500 mb-5">Enter your email and we'll send a 6-digit OTP.</p>

          {sent ? (
            <div className="text-center py-4">
              <p className="text-sm text-emerald-400 font-medium">OTP sent — redirecting...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Email address</label>
                <input
                  type="email" required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#1a1a28] border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition"
                  placeholder="you@example.com"
                />
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <button
                type="submit" disabled={loading}
                className="w-full bg-violet-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors disabled:opacity-50"
              >
                {loading ? 'Sending...' : 'Send OTP'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-sm text-slate-600 mt-5">
          Remember your password?{' '}
          <Link to="/login" className="font-medium text-violet-400 hover:text-violet-300">Sign in</Link>
        </p>
      </div>
    </div>
  );
};

export default ForgotPassword;
