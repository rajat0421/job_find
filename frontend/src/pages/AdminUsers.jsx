import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import adminApi from '../services/adminApi';
import AdminNav from '../components/AdminNav';

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

// ── Users list ────────────────────────────────────────────────────
const UsersList = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
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

  return (
    <div className="min-h-screen bg-[#0a0a12]">
      {/* Fix Greenhouse HTML / Re-score All Users / Backfill Matches moved to
          Overview's "Maintenance actions" section — this page is for finding
          and inspecting a user, not for running pipeline-wide operations. */}
      <AdminNav
        active="users"
        right={
          <button onClick={handleLogout} className="text-sm text-red-400 hover:text-red-300 font-medium">
            Exit admin
          </button>
        }
      />

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
                  {['Email', 'Name', 'Status', 'Exp', 'Desired roles', 'Current matches', 'Top score', 'Joined', ''].map((h) => (
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
                      <div className="flex flex-col gap-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full w-fit whitespace-nowrap ${u.isEmailVerified ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
                          {u.isEmailVerified ? 'Verified' : 'Unverified'}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full w-fit whitespace-nowrap ${u.isOnboarded ? 'bg-blue-500/10 text-blue-400' : 'bg-white/5 text-slate-500'}`}>
                          {u.isOnboarded ? 'Onboarded' : 'Pending'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{u.experience != null ? `${u.experience}y` : '—'}</td>
                    {/* Full skills list and preferred locations already live on the
                        user-detail page (Profile tab) — kept out of this table to
                        avoid repeating verbose, already-truncated data here. */}
                    <td className="px-4 py-3 text-slate-400 text-xs max-w-[220px] truncate" title={u.desiredRoles?.join(', ')}>
                      {u.desiredRoles?.length ? u.desiredRoles.join(', ') : '—'}
                    </td>
                    {/* Both scoped to the CURRENT matcher version server-side (see
                        admin.controller.js) — a stale pre-rescore match or score
                        never shows here as if it were current. */}
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
