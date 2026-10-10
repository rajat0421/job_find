import { useState, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { AuthShell, inputCls, labelCls, FOCUS_RING } from '../components/ui';

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const prefillEmail = searchParams.get('email') || '';

  const [email, setEmail] = useState(prefillEmail);
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const inputRefs = useRef([]);
  const navigate = useNavigate();

  const handleDigit = (i, val) => {
    const v = val.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[i] = v;
    setDigits(next);
    if (v && i < 5) inputRefs.current[i + 1]?.focus();
  };

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) inputRefs.current[i - 1]?.focus();
  };

  const handlePaste = (e) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!text) return;
    e.preventDefault();
    const next = [...digits];
    text.split('').forEach((c, i) => { next[i] = c; });
    setDigits(next);
    inputRefs.current[Math.min(text.length, 5)]?.focus();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const otp = digits.join('');
    if (otp.length < 6) return setError('Enter the full 6-digit OTP');
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { email, otp, newPassword });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const digitInput = 'w-11 h-12 text-center text-lg font-semibold bg-field border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition';

  return (
    <AuthShell
      subtitle="Set a new password"
      footer={<>Back to <Link to="/login" className={`font-medium text-violet-400 hover:text-violet-300 rounded ${FOCUS_RING}`}>Sign in</Link></>}
    >
      {success ? (
        <div className="text-center py-4" role="status">
          <p className="text-sm text-emerald-400 font-medium">Password reset — redirecting to login...</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">

          {!prefillEmail && (
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
          )}

          <div>
            <label className={labelCls}>
              OTP from your email{prefillEmail && <span className="text-slate-500 font-normal"> ({prefillEmail})</span>}
            </label>
            <div className="flex gap-2 justify-between" onPaste={handlePaste}>
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => (inputRefs.current[i] = el)}
                  type="text" inputMode="numeric" maxLength={1}
                  value={d}
                  onChange={(e) => handleDigit(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  className={digitInput}
                />
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>New password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={`${inputCls} pr-16`}
                placeholder="Min. 8 characters"
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
            type="submit" disabled={loading}
            className={`w-full bg-violet-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors disabled:opacity-50 ${FOCUS_RING}`}
          >
            {loading ? 'Resetting...' : 'Reset password'}
          </button>

          <p className="text-center text-xs text-slate-600">
            Didn't get the OTP?{' '}
            <Link to="/forgot-password" className={`text-violet-400 hover:text-violet-300 rounded ${FOCUS_RING}`}>Resend</Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
};

export default ResetPassword;
