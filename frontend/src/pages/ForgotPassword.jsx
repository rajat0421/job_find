import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { AuthShell, inputCls, labelCls, FOCUS_RING } from '../components/ui';

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
    <AuthShell
      subtitle="Reset your password"
      footer={<>Remember your password? <Link to="/login" className={`font-medium text-violet-400 hover:text-violet-300 rounded ${FOCUS_RING}`}>Sign in</Link></>}
    >
      <h2 className="text-base font-semibold text-white mb-1">Forgot your password?</h2>
      <p className="text-sm text-slate-500 mb-5">Enter your email and we'll send a 6-digit OTP.</p>

      {sent ? (
        <div className="text-center py-4" role="status">
          <p className="text-sm text-emerald-400 font-medium">OTP sent — redirecting...</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className={labelCls}>Email address</label>
            <input
              type="email" required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
              placeholder="you@example.com"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2" role="alert">{error}</p>
          )}

          <button
            type="submit" disabled={loading}
            className={`w-full bg-violet-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors disabled:opacity-50 ${FOCUS_RING}`}
          >
            {loading ? 'Sending...' : 'Send OTP'}
          </button>
        </form>
      )}
    </AuthShell>
  );
};

export default ForgotPassword;
