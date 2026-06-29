import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const AdminUsers = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { logout } = useAuth();

  useEffect(() => {
    api.get('/admin/users')
      .then((r) => setUsers(r.data))
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <span className="text-xl font-bold text-blue-600">JobFind</span>
          <span className="ml-3 text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">Admin</span>
        </div>
        <button onClick={handleLogout} className="text-sm text-red-500 hover:text-red-700">Logout</button>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">All Users</h1>
          <p className="text-sm text-gray-500 mt-0.5">{users.length} total registered</p>
        </div>

        {loading ? (
          <div className="text-center text-gray-400 py-20">Loading...</div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Email', 'Name', 'Skills', 'Exp', 'Location', 'Status', 'Jobs Matched', 'Top Score', 'Joined', ''].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((u) => (
                  <tr key={u._id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {u.email}
                      {u.isAdmin && <span className="ml-1 text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded">admin</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{u.name || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {u.skills?.slice(0, 3).map((s) => (
                          <span key={s} className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full">{s}</span>
                        ))}
                        {u.skills?.length > 3 && (
                          <span className="text-xs text-gray-400">+{u.skills.length - 3}</span>
                        )}
                        {!u.skills?.length && <span className="text-gray-400 text-xs">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{u.experience != null ? `${u.experience}y` : '—'}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{u.locations?.join(', ') || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full w-fit ${u.isEmailVerified ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {u.isEmailVerified ? 'Verified' : 'Unverified'}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full w-fit ${u.isOnboarded ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                          {u.isOnboarded ? 'Onboarded' : 'Pending'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 font-medium">{u.jobsMatched}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold px-2 py-1 rounded-full ${u.topScore >= 75 ? 'bg-green-100 text-green-700' : u.topScore >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'}`}>
                        {u.topScore}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/admin/users/${u._id}`)}
                        className="text-blue-600 hover:text-blue-800 text-xs font-medium"
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

export default AdminUsers;
