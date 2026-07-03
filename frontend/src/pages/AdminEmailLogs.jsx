import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import adminApi from '../services/adminApi';

const toIST = (iso) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => {
  const ampm = i < 12 ? 'AM' : 'PM';
  const h = i === 0 ? 12 : i > 12 ? i - 12 : i;
  return `${h}:00 ${ampm}`;
});

export default function AdminEmailLogs() {
  const navigate = useNavigate();

  // Global schedule state
  const [stats, setStats] = useState(null);
  const [interval, setInterval] = useState(24);
  const [hourIST, setHourIST] = useState(10);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState('');

  // Logs state
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [emailFilter, setEmailFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    const { data } = await adminApi.get('/admin/email-schedule/stats');
    setStats(data);
    const top = data.byInterval.sort((a, b) => b.count - a.count)[0];
    if (top) setInterval(top._id);
  };

  const fetchLogs = async (p = 1, email = emailFilter) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: p, limit: 50 });
      if (email) params.set('email', email);
      const { data } = await adminApi.get(`/admin/email-logs?${params}`);
      setLogs(data.logs);
      setTotal(data.total);
      setPage(data.page);
      setPages(data.pages);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchLogs(1);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      const body = { emailIntervalHours: interval };
      if (interval === 24) body.emailSendHourIST = hourIST;
      const { data } = await adminApi.patch('/admin/email-schedule/global', body);
      setSaveMsg(`✓ Applied to ${data.usersUpdated} users`);
      fetchStats();
    } catch {
      setSaveMsg('Failed to save');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 3000);
    }
  };

  const handleTrigger = async () => {
    if (!confirm('Send job emails to all due users now?')) return;
    setTriggering(true);
    setTriggerMsg('');
    try {
      await adminApi.post('/admin/trigger-digest');
      setTriggerMsg('✓ Emails sent');
      fetchLogs(1);
    } catch {
      setTriggerMsg('Failed');
    } finally {
      setTriggering(false);
      setTimeout(() => setTriggerMsg(''), 4000);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    fetchLogs(1);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-xl font-bold text-blue-600">JobFind</span>
          <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">Admin</span>
          <nav className="flex items-center gap-1 ml-4">
            <button onClick={() => navigate('/admin')} className="text-sm text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">Users</button>
            <button onClick={() => navigate('/admin/logs')} className="text-sm text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">API Logs</button>
            <button className="text-sm font-semibold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg">Email Logs</button>
            <button onClick={() => navigate('/admin/feedback')} className="text-sm text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">Feedback</button>
          </nav>
        </div>
        <button onClick={() => { localStorage.removeItem('adminToken'); navigate('/admin'); }} className="text-sm text-red-500 hover:text-red-700 font-medium">
          Exit admin
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">

        {/* Global Email Schedule */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-1">Global Email Schedule</h2>
          <p className="text-xs text-gray-400 mb-5">Applies to all onboarded + verified users at once. Overrides individual settings.</p>

          {/* Stats strip */}
          {stats && (
            <div className="flex gap-4 mb-6 flex-wrap">
              <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-2.5 flex flex-col">
                <span className="text-xs text-blue-400 font-medium">Total users</span>
                <span className="text-lg font-bold text-blue-700">{stats.total}</span>
              </div>
              <div className="bg-orange-50 border border-orange-100 rounded-lg px-4 py-2.5 flex flex-col">
                <span className="text-xs text-orange-400 font-medium">Paused</span>
                <span className="text-lg font-bold text-orange-600">{stats.paused}</span>
              </div>
              {stats.byInterval.map((s) => (
                <div key={s._id} className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 flex flex-col">
                  <span className="text-xs text-gray-400 font-medium">Every {s._id}h</span>
                  <span className="text-lg font-bold text-gray-700">{s.count} users</span>
                </div>
              ))}
            </div>
          )}

          {/* Controls */}
          <div className="flex items-end gap-4 flex-wrap">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-gray-500">Send frequency</label>
              <div className="flex gap-2">
                {[1, 5, 24].map((h) => (
                  <button
                    key={h}
                    onClick={() => setInterval(h)}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                      interval === h
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {h === 1 ? 'Every 1h' : h === 5 ? 'Every 5h' : 'Once daily'}
                  </button>
                ))}
              </div>
            </div>

            {interval === 24 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-500">Send time (IST)</label>
                <select
                  value={hourIST}
                  onChange={(e) => setHourIST(Number(e.target.value))}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
                >
                  {HOUR_LABELS.map((label, i) => (
                    <option key={i} value={i}>{label}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-3 pb-0.5 flex-wrap">
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-blue-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60 font-semibold"
              >
                {saving ? 'Applying…' : 'Apply to all users'}
              </button>
              {saveMsg && (
                <span className={`text-sm font-medium ${saveMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>
                  {saveMsg}
                </span>
              )}
              <div className="w-px h-6 bg-gray-200 mx-1" />
              <button
                onClick={handleTrigger}
                disabled={triggering}
                className="bg-green-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-60 font-semibold"
              >
                {triggering ? 'Sending…' : '▶ Send emails now'}
              </button>
              {triggerMsg && (
                <span className={`text-sm font-medium ${triggerMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>
                  {triggerMsg}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Email Logs */}
        <div>
          <form onSubmit={handleSearch} className="flex gap-3 mb-4">
            <input
              type="text"
              placeholder="Filter by email…"
              value={emailFilter}
              onChange={(e) => setEmailFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <button type="submit" className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
              Search
            </button>
            {emailFilter && (
              <button type="button" onClick={() => { setEmailFilter(''); fetchLogs(1, ''); }} className="text-sm text-gray-500 hover:text-gray-800 px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                Clear
              </button>
            )}
            <span className="ml-auto text-sm text-gray-500 self-center">{total} email{total !== 1 ? 's' : ''} sent</span>
          </form>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Sent at (IST)</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Jobs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={4} className="text-center py-12 text-gray-400">Loading…</td></tr>
                ) : logs.length === 0 ? (
                  <tr><td colSpan={4} className="text-center py-12 text-gray-400">No emails sent yet</td></tr>
                ) : logs.map((log) => (
                  <tr key={log._id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">{toIST(log.sentAt)}</td>
                    <td className="px-4 py-3 text-gray-800 font-medium">{log.name || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{log.email}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-block bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                        {log.jobCount} job{log.jobCount !== 1 ? 's' : ''}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="flex justify-center gap-2 mt-6">
              <button disabled={page <= 1} onClick={() => fetchLogs(page - 1)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-40">
                ← Prev
              </button>
              <span className="px-4 py-2 text-sm text-gray-500">Page {page} of {pages}</span>
              <button disabled={page >= pages} onClick={() => fetchLogs(page + 1)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-40">
                Next →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
