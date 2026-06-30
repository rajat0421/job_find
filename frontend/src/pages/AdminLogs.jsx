import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import adminApi from '../services/adminApi';

const ALL_ACTIONS = [
  'all',
  'Register',
  'Login',
  'Verify Email',
  'Resend OTP',
  'Forgot Password',
  'Reset Password',
  'Onboarding',
  'View Profile',
  'Profile Update',
  'View Matched Jobs',
];

const ACTION_COLORS = {
  'Register':        'bg-blue-100 text-blue-700',
  'Login':           'bg-green-100 text-green-700',
  'Verify Email':    'bg-purple-100 text-purple-700',
  'Resend OTP':      'bg-purple-50 text-purple-600',
  'Forgot Password': 'bg-orange-100 text-orange-700',
  'Reset Password':  'bg-orange-100 text-orange-700',
  'Onboarding':      'bg-teal-100 text-teal-700',
  'View Profile':    'bg-gray-100 text-gray-600',
  'Profile Update':  'bg-indigo-100 text-indigo-700',
  'View Matched Jobs': 'bg-gray-100 text-gray-600',
};

const toIST = (iso) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }) + ' IST';

const StatusBadge = ({ code }) => {
  const ok = code < 400;
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
      {code}
    </span>
  );
};

const JsonViewer = ({ data, label }) => {
  const [open, setOpen] = useState(false);
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
    return <span className="text-gray-400 text-xs">—</span>;
  }
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
      >
        {open ? 'Hide' : 'View'} {label}
      </button>
      {open && (
        <pre className="mt-1.5 bg-gray-900 text-green-400 text-xs rounded-lg p-3 overflow-auto max-h-48 leading-relaxed min-w-[220px] max-w-xs">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
};

const LIMIT = 50;

const AdminLogs = () => {
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [actionFilter, setActionFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [emailSearch, setEmailSearch] = useState('');
  const [emailInput, setEmailInput] = useState('');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: LIMIT };
      if (actionFilter !== 'all') params.action = actionFilter;
      if (statusFilter !== 'all') params.status = statusFilter;
      if (emailSearch) params.email = emailSearch;

      const r = await adminApi.get('/admin/logs', { params });
      setLogs(r.data.logs);
      setTotal(r.data.total);
      setPages(r.data.pages || 1);
    } catch {
      // adminApi interceptor handles 403 → redirect
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, statusFilter, emailSearch]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const applyEmail = () => {
    setEmailSearch(emailInput.trim());
    setPage(1);
  };

  const resetFilters = () => {
    setActionFilter('all');
    setStatusFilter('all');
    setEmailInput('');
    setEmailSearch('');
    setPage(1);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-xl font-bold text-blue-600">JobFind</span>
          <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">Admin</span>
          <nav className="flex items-center gap-1 ml-4">
            <button
              onClick={() => navigate('/admin')}
              className="text-sm text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Users
            </button>
            <button
              className="text-sm font-semibold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg"
            >
              API Logs
            </button>
          </nav>
        </div>
        <button
          onClick={() => { localStorage.removeItem('adminToken'); window.location.href = '/admin'; }}
          className="text-sm text-red-500 hover:text-red-700"
        >
          Exit admin
        </button>
      </div>

      <div className="max-w-screen-xl mx-auto px-4 py-8">
        <div className="mb-5">
          <h1 className="text-xl font-bold text-gray-900">API Activity Logs</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {total.toLocaleString()} requests captured · auto-deleted after 30 days
          </p>
        </div>

        {/* Filters */}
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex flex-wrap gap-3 items-end mb-4">
          {/* Action */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Action</label>
            <select
              value={actionFilter}
              onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
              className="text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {ALL_ACTIONS.map((a) => (
                <option key={a} value={a}>{a === 'all' ? 'All actions' : a}</option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All</option>
              <option value="success">Success (2xx/3xx)</option>
              <option value="error">Error (4xx/5xx)</option>
            </select>
          </div>

          {/* Email search */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyEmail()}
                placeholder="Search email..."
                className="text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 w-44 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={applyEmail}
                className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Go
              </button>
            </div>
          </div>

          {(actionFilter !== 'all' || statusFilter !== 'all' || emailSearch) && (
            <button
              onClick={resetFilters}
              className="text-sm text-gray-500 hover:text-gray-700 border border-gray-300 px-3 py-1.5 rounded-lg transition-colors self-end"
            >
              Clear filters
            </button>
          )}

          <button
            onClick={fetchLogs}
            className="ml-auto text-sm text-gray-600 hover:text-gray-900 border border-gray-300 px-3 py-1.5 rounded-lg transition-colors self-end"
          >
            ↺ Refresh
          </button>
        </div>

        {/* Table */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Timestamp (IST)', 'Action', 'Email', 'Method', 'Path', 'Status', 'Request Body', 'Response'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center text-gray-400 py-20">Loading...</td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-gray-400 py-20">No logs found</td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log._id} className="hover:bg-gray-50 transition-colors align-top">
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap font-mono">
                      {toIST(log.timestamp)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${ACTION_COLORS[log.action] || 'bg-gray-100 text-gray-600'}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-xs whitespace-nowrap">
                      {log.email || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded font-mono ${
                        log.method === 'GET' ? 'bg-blue-50 text-blue-600' :
                        log.method === 'POST' ? 'bg-green-50 text-green-700' :
                        log.method === 'PUT' || log.method === 'PATCH' ? 'bg-yellow-50 text-yellow-700' :
                        'bg-red-50 text-red-600'
                      }`}>
                        {log.method}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 font-mono whitespace-nowrap">
                      {log.path}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge code={log.statusCode} />
                    </td>
                    <td className="px-4 py-3">
                      <JsonViewer data={log.reqBody} label="Req" />
                    </td>
                    <td className="px-4 py-3">
                      <JsonViewer data={log.resBody} label="Res" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-gray-500">
              Page {page} of {pages} · {total.toLocaleString()} total
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                disabled={page === 1}
                className="text-sm border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40 transition-colors"
              >
                ← Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(p + 1, pages))}
                disabled={page === pages}
                className="text-sm border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40 transition-colors"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminLogs;
