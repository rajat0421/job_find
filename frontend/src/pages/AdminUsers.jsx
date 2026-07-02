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
      await adminApi.get('/admin/users'); // verify the token works
      onSuccess();
    } catch {
      localStorage.removeItem('adminToken');
      setError('Invalid token. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-gray-900">Admin Access</h1>
          <p className="text-sm text-gray-500 mt-1">Enter your admin token to continue</p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="relative">
            <input
              type={show ? 'text' : 'password'}
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
              placeholder="Admin token"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
            >
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-60"
          >
            {loading ? 'Verifying...' : 'Enter admin panel'}
          </button>
        </form>
      </div>
    </div>
  );
};

// ── Users list ────────────────────────────────────────────────────
const UsersList = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState(null);
  const [rescoring, setRescoring] = useState(false);
  const [rescoreResult, setRescoreResult] = useState(null);
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
    if (!window.confirm('This will strip raw HTML from all Greenhouse job descriptions and re-score all affected UserJob records. Continue?')) return;
    setFixing(true);
    setFixResult(null);
    try {
      const r = await adminApi.post('/admin/fix-greenhouse');
      setFixResult(r.data);
    } catch (e) {
      setFixResult({ error: e.response?.data?.message || e.message });
    } finally {
      setFixing(false);
    }
  };

  const handleRescoreAll = async () => {
    if (!window.confirm('Re-score all UserJob records for all users using the latest algorithm? This removes irrelevant matches. Continue?')) return;
    setRescoring(true);
    setRescoreResult(null);
    try {
      const r = await adminApi.post('/admin/rescore-all');
      setRescoreResult(r.data);
    } catch (e) {
      setRescoreResult({ error: e.response?.data?.message || e.message });
    } finally {
      setRescoring(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-xl font-bold text-blue-600">JobFind</span>
          <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">Admin</span>
          <nav className="flex items-center gap-1 ml-4">
            <button className="text-sm font-semibold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg">
              Users
            </button>
            <button
              onClick={() => navigate('/admin/logs')}
              className="text-sm text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              API Logs
            </button>
            <button
              onClick={() => navigate('/admin/email-logs')}
              className="text-sm text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Email Logs
            </button>
            <button
              onClick={() => navigate('/admin/feedback')}
              className="text-sm text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Feedback
            </button>
          </nav>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleFixGreenhouse}
            disabled={fixing}
            className="text-xs bg-amber-100 text-amber-700 hover:bg-amber-200 border border-amber-300 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-60"
          >
            {fixing ? 'Fixing...' : 'Fix Greenhouse HTML'}
          </button>
          {fixResult && (
            <span className={`text-xs ${fixResult.error ? 'text-red-500' : 'text-green-600'}`}>
              {fixResult.error || `${fixResult.jobsFixed} cleaned, ${fixResult.rescored} rescored, ${fixResult.removed} removed`}
            </span>
          )}
          <button
            onClick={handleRescoreAll}
            disabled={rescoring}
            className="text-xs bg-indigo-100 text-indigo-700 hover:bg-indigo-200 border border-indigo-300 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-60"
          >
            {rescoring ? 'Rescoring...' : 'Re-score All Users'}
          </button>
          {rescoreResult && (
            <span className={`text-xs ${rescoreResult.error ? 'text-red-500' : 'text-green-600'}`}>
              {rescoreResult.error || `${rescoreResult.rescored} updated, ${rescoreResult.removed} removed`}
            </span>
          )}
          <button onClick={handleLogout} className="text-sm text-red-500 hover:text-red-700">
            Exit admin
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">All Users</h1>
          <p className="text-sm text-gray-500 mt-0.5">{users.length} total registered</p>
        </div>

        {loading ? (
          <div className="text-center text-gray-400 py-20">Loading...</div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Email', 'Name', 'Roles', 'Skills', 'Exp', 'Location', 'Status', 'Jobs Matched', 'Top Score', 'Joined', ''].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((u) => (
                  <tr key={u._id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{u.email}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{u.name || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1 max-w-[160px]">
                        {u.desiredRoles?.length ? u.desiredRoles.map((r) => (
                          <span key={r} className="bg-purple-50 text-purple-700 text-xs px-2 py-0.5 rounded-full whitespace-nowrap w-fit">{r}</span>
                        )) : <span className="text-gray-400 text-xs">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1 max-w-[180px]">
                        {u.skills?.slice(0, 3).map((s) => (
                          <span key={s} className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full whitespace-nowrap">{s}</span>
                        ))}
                        {u.skills?.length > 3 && <span className="text-xs text-gray-400">+{u.skills.length - 3}</span>}
                        {!u.skills?.length && <span className="text-gray-400 text-xs">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{u.experience != null ? `${u.experience}y` : '—'}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{u.locations?.join(', ') || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full w-fit whitespace-nowrap ${u.isEmailVerified ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {u.isEmailVerified ? 'Verified' : 'Unverified'}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full w-fit whitespace-nowrap ${u.isOnboarded ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                          {u.isOnboarded ? 'Onboarded' : 'Pending'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 font-medium text-center">{u.jobsMatched}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs font-bold px-2 py-1 rounded-full ${u.topScore >= 75 ? 'bg-green-100 text-green-700' : u.topScore >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'}`}>
                        {u.topScore}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/admin/users/${u._id}`)}
                        className="text-blue-600 hover:text-blue-800 text-xs font-medium whitespace-nowrap"
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

// ── Root component with token gate ────────────────────────────────
const AdminUsers = () => {
  const [authed, setAuthed] = useState(!!localStorage.getItem('adminToken'));
  return authed ? <UsersList /> : <TokenGate onSuccess={() => setAuthed(true)} />;
};

export default AdminUsers;
