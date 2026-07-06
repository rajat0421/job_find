import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import adminApi from '../services/adminApi';

// ── Token gate ────────────────────────────────────────────────────
const TokenGate = ({ onSuccess }) => {
  const [token, setToken] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      localStorage.setItem('adminToken', token);
      await adminApi.get('/admin/users');
      onSuccess();
    } catch {
      localStorage.removeItem('adminToken');
      setError('Invalid token. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a12] px-4">
      <div className="w-full max-w-sm bg-[#12121c] rounded-2xl border border-white/10 p-8">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-slate-100">Admin Access</h1>
          <p className="text-sm text-slate-500 mt-1">Enter your admin token to continue</p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="relative">
            <input
              type={show ? 'text' : 'password'}
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full bg-[#1a1a28] border border-white/10 rounded-lg px-3 py-2.5 pr-16 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono placeholder:text-slate-600"
              placeholder="Admin token"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-300"
            >
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-violet-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-violet-700 transition-colors disabled:opacity-60"
          >
            {loading ? 'Verifying...' : 'Enter admin panel'}
          </button>
        </form>
      </div>
    </div>
  );
};

// ── Nav ───────────────────────────────────────────────────────────
const NavBtn = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`text-sm px-3 py-1.5 rounded-lg transition-colors font-medium ${
      active
        ? 'text-violet-400 bg-violet-500/10'
        : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
    }`}
  >
    {children}
  </button>
);

// ── Users list ────────────────────────────────────────────────────
const UsersList = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState(null);
  const [rescoring, setRescoring] = useState(false);
  const [rescoreResult, setRescoreResult] = useState(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    adminApi.get('/admin/users')
      .then((r) => setUsers(r.data))
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    window.location.reload();
  };

  const handleFixGreenhouse = async () => {
    if (!window.confirm('Strip HTML from all Greenhouse descriptions and re-score?')) return;
    setFixing(true); setFixResult(null);
    try {
      const r = await adminApi.post('/admin/fix-greenhouse');
      setFixResult(r.data);
    } catch (e) {
      setFixResult({ error: e.response?.data?.message || e.message });
    } finally { setFixing(false); }
  };

  const handleRescoreAll = async () => {
    if (!window.confirm('Re-score all UserJob records for all users?')) return;
    setRescoring(true); setRescoreResult(null);
    try {
      const r = await adminApi.post('/admin/rescore-all');
      setRescoreResult(r.data);
    } catch (e) {
      setRescoreResult({ error: e.response?.data?.message || e.message });
    } finally { setRescoring(false); }
  };

  const handleBackfill = async () => {
    if (!window.confirm('Match all users against recent jobs and create any missing matches?')) return;
    setBackfilling(true); setBackfillResult(null);
    try {
      const r = await adminApi.post('/admin/backfill-matches');
      setBackfillResult(r.data);
    } catch (e) {
      setBackfillResult({ error: e.response?.data?.message || e.message });
    } finally { setBackfilling(false); }
  };

  return (
    <div className="min-h-screen bg-[#0a0a12]">
      <div className="bg-[#12121c] border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-xl font-bold text-violet-400">JobFind</span>
          <span className="text-xs bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full font-medium">Admin</span>
          <nav className="flex items-center gap-1 ml-4">
            <NavBtn active>Users</NavBtn>
            <NavBtn onClick={() => navigate('/admin/logs')}>API Logs</NavBtn>
            <NavBtn onClick={() => navigate('/admin/email-logs')}>Email Logs</NavBtn>
            <NavBtn onClick={() => navigate('/admin/feedback')}>Feedback</NavBtn>
          </nav>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleFixGreenhouse}
            disabled={fixing}
            className="text-xs bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-60"
          >
            {fixing ? 'Fixing...' : 'Fix Greenhouse HTML'}
          </button>
          {fixResult && (
            <span className={`text-xs ${fixResult.error ? 'text-red-400' : 'text-green-400'}`}>
              {fixResult.error || `${fixResult.jobsFixed} cleaned, ${fixResult.rescored} rescored, ${fixResult.removed} removed`}
            </span>
          )}
          <button
            onClick={handleRescoreAll}
            disabled={rescoring}
            className="text-xs bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 border border-indigo-500/20 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-60"
          >
            {rescoring ? 'Rescoring...' : 'Re-score All Users'}
          </button>
          {rescoreResult && (
            <span className={`text-xs ${rescoreResult.error ? 'text-red-400' : 'text-green-400'}`}>
              {rescoreResult.error || `${rescoreResult.rescored} updated, ${rescoreResult.removed} removed`}
            </span>
          )}
          <button
            onClick={handleBackfill}
            disabled={backfilling}
            className="text-xs bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-60"
          >
            {backfilling ? 'Backfilling...' : 'Backfill Matches'}
          </button>
          {backfillResult && (
            <span className={`text-xs ${backfillResult.error ? 'text-red-400' : 'text-green-400'}`}>
              {backfillResult.error || backfillResult.message}
            </span>
          )}
          <button onClick={handleLogout} className="text-sm text-red-400 hover:text-red-300 font-medium">
            Exit admin
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-100">All Users</h1>
          <p className="text-sm text-slate-500 mt-0.5">{users.length} total registered</p>
        </div>

        {loading ? (
          <div className="text-center text-slate-600 py-20">Loading...</div>
        ) : (
          <div className="bg-[#12121c] border border-white/10 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-white/10">
                <tr>
                  {['Email', 'Name', 'Roles', 'Skills', 'Exp', 'Location', 'Status', 'Jobs Matched', 'Top Score', 'Joined', ''].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {users.map((u) => (
                  <tr key={u._id} className="hover:bg-white/[0.03] transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-200 whitespace-nowrap">{u.email}</td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{u.name || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1 max-w-[160px]">
                        {u.desiredRoles?.length ? u.desiredRoles.map((r) => (
                          <span key={r} className="bg-purple-500/10 text-purple-400 text-xs px-2 py-0.5 rounded-full whitespace-nowrap w-fit">{r}</span>
                        )) : <span className="text-slate-600 text-xs">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1 max-w-[180px]">
                        {u.skills?.slice(0, 3).map((s) => (
                          <span key={s} className="bg-blue-500/10 text-blue-400 text-xs px-2 py-0.5 rounded-full whitespace-nowrap">{s}</span>
                        ))}
                        {u.skills?.length > 3 && <span className="text-xs text-slate-600">+{u.skills.length - 3}</span>}
                        {!u.skills?.length && <span className="text-slate-600 text-xs">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{u.experience != null ? `${u.experience}y` : '—'}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{u.locations?.join(', ') || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full w-fit whitespace-nowrap ${u.isEmailVerified ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
                          {u.isEmailVerified ? 'Verified' : 'Unverified'}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full w-fit whitespace-nowrap ${u.isOnboarded ? 'bg-blue-500/10 text-blue-400' : 'bg-white/5 text-slate-500'}`}>
                          {u.isOnboarded ? 'Onboarded' : 'Pending'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-400 font-medium text-center">{u.jobsMatched}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs font-bold px-2 py-1 rounded-full ${u.topScore >= 75 ? 'bg-green-500/10 text-green-400' : u.topScore >= 50 ? 'bg-yellow-500/10 text-yellow-400' : 'bg-white/5 text-slate-500'}`}>
                        {u.topScore}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs whitespace-nowrap">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/admin/users/${u._id}`)}
                        className="text-violet-400 hover:text-violet-300 text-xs font-medium whitespace-nowrap"
                      >
                        View →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const AdminUsers = () => {
  const [authed, setAuthed] = useState(!!localStorage.getItem('adminToken'));
  return authed ? <UsersList /> : <TokenGate onSuccess={() => setAuthed(true)} />;
};

export default AdminUsers;
