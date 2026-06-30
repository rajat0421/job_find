import { useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const VerifyEmail = () => {
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resent, setResent] = useState(false);
  const refs = useRef([]);
  const { state } = useLocation();
  const navigate = useNavigate();
  const { login } = useAuth();
  const email = state?.email || '';

  if (!email) {
    navigate('/register', { replace: true });
    return null;
  }

  const handleChange = (index, value) => {
    if (!/^\d?$/.test(value)) return;
    const next = [...digits];
    next[index] = value;
    setDigits(next);
    if (value && index < 5) refs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const next = [...digits];
    pasted.split('').forEach((char, i) => { next[i] = char; });
    setDigits(next);
    refs.current[Math.min(pasted.length, 5)]?.focus();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const otp = digits.join('');
    if (otp.length < 6) return setError('Enter the full 6-digit code');
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/verify-otp', { email, otp });
      login(res.data.token, { email, isOnboarded: res.data.isOnboarded });
      navigate(res.data.isOnboarded ? '/dashboard' : '/onboarding');
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      await api.post('/auth/resend-otp', { email });
      setResent(true);
      setTimeout(() => setResent(false), 5000);
    } catch {}
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a12] px-4">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Job<span className="text-violet-400">Find</span>
          </h1>
        </div>

        <div className="bg-[#12121c] border border-white/10 rounded-2xl p-7">
          <div className="mb-6">
            <h2 className="text-base font-semibold text-white">Check your email</h2>
            <p className="text-sm text-slate-500 mt-1">
              We sent a 6-digit code to{' '}
              <span className="font-medium text-slate-300">{email}</span>
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex gap-2 justify-between">
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => (refs.current[i] = el)}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={d}
                  onChange={(e) => handleChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  onPaste={handlePaste}
                  className="w-11 h-12 text-center text-lg font-semibold bg-[#1a1a28] border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition"
                />
              ))}
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}
            {resent && <p className="text-sm text-emerald-400">Verification code resent.</p>}

            <button
              type="submit" disabled={loading}
              className="w-full bg-violet-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Verify email'}
            </button>
          </form>

          <p className="text-sm text-slate-600 mt-4">
            Didn't receive a code?{' '}
            <button onClick={handleResend} className="font-medium text-violet-400 hover:text-violet-300 transition-colors">
              Resend
            </button>
          </p>

          <div className="mt-4 flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3.5 py-3">
            <span className="text-amber-400 text-sm mt-px shrink-0">⚠</span>
            <p className="text-xs text-amber-400/80 leading-relaxed">
              Email landing in spam? Check your <span className="font-semibold text-amber-400">Spam</span> or <span className="font-semibold text-amber-400">Junk</span> folder — our emails sometimes end up there.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmail;
