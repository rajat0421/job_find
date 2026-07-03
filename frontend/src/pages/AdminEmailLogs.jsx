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

  // Admin notification email
  const [adminEmail, setAdminEmail] = useState('');
  const [adminEmailInput, setAdminEmailInput] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailSaveMsg, setEmailSaveMsg] = useState('');

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

  const fetchConfig = async () => {
    const { data } = await adminApi.get('/admin/config');
    const val = data.adminNotificationEmail || '';
    setAdminEmail(val);
    setAdminEmailInput(val);
  };

  const handleSaveEmail = async () => {
    setEmailSaving(true); setEmailSaveMsg('');
    try {
      await adminApi.patch('/admin/config', { adminNotificationEmail: adminEmailInput.trim() });
      setAdminEmail(adminEmailInput.trim());
      setEmailSaveMsg('✓ Saved');
    } catch { setEmailSaveMsg('Failed'); }
    finally {
      setEmailSaving(false);
      setTimeout(() => setEmailSaveMsg(''), 3000);
    }
  };

  useEffect(() => {
    fetchConfig();
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

  const navBtn = (label, active, onClick) => (
    <button
      onClick={onClick}
      className={`text-sm px-3 py-1.5 rounded-lg transition-colors font-medium ${
        active ? 'text-violet-400 bg-violet-500/10' : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-[#0a0a12]">
      <div className="bg-[#12121c] border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-xl font-bold text-violet-400">JobFind</span>
          <span className="text-xs bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full font-medium">Admin</span>
          <nav className="flex items-center gap-1 ml-4">
            {navBtn('Users', false, () => navigate('/admin'))}
            {navBtn('API Logs', false, () => navigate('/admin/logs'))}
            {navBtn('Email Logs', true, null)}
            {navBtn('Feedback', false, () => navigate('/admin/feedback'))}
          </nav>
        </div>
        <button onClick={() => { localStorage.removeItem('adminToken'); navigate('/admin'); }} className="text-sm text-red-400 hover:text-red-300 font-medium">
          Exit admin
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">

        {/* Admin Notification Email */}
        <div className="bg-[#12121c] border border-white/10 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-slate-200 mb-1">Admin Notification Email</h2>
          <p className="text-xs text-slate-600 mb-4">
            Every time a job email is sent to a user, a copy (with the same jobs) will be forwarded to this address.
            {adminEmail && <span className="text-violet-400 ml-1">Currently: {adminEmail}</span>}
          </p>
          <div className="flex gap-3 items-center flex-wrap">
            <input
              type="email"
              value={adminEmailInput}
              onChange={(e) => setAdminEmailInput(e.target.value)}
              placeholder="e.g. rajattalekar5143@gmail.com"
              className="bg-[#1a1a28] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 w-72 focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder:text-slate-600"
            />
            <button
              onClick={handleSaveEmail}
              disabled={emailSaving}
              className="bg-violet-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-60 font-semibold"
            >
              {emailSaving ? 'Saving…' : 'Save'}
            </button>
            {adminEmail && (
              <button
                onClick={() => { setAdminEmailInput(''); handleSaveEmail(); }}
                className="text-xs text-slate-600 hover:text-red-400 transition-colors"
              >
                Remove
              </button>
            )}
            {emailSaveMsg && (
              <span className={`text-sm font-medium ${emailSaveMsg.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>
                {emailSaveMsg}
              </span>
            )}
          </div>
        </div>

        {/* Global Email Schedule */}
        <div className="bg-[#12121c] border border-white/10 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-slate-200 mb-1">Global Email Schedule</h2>
          <p className="text-xs text-slate-600 mb-5">Applies to all onboarded + verified users at once. Overrides individual settings.</p>

          {stats && (
            <div className="flex gap-4 mb-6 flex-wrap">
              <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg px-4 py-2.5 flex flex-col">
                <span className="text-xs text-violet-400 font-medium">Total users</span>
                <span className="text-lg font-bold text-violet-300">{stats.total}</span>
              </div>
              <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg px-4 py-2.5 flex flex-col">
                <span className="text-xs text-orange-400 font-medium">Paused</span>
                <span className="text-lg font-bold text-orange-300">{stats.paused}</span>
              </div>
              {stats.byInterval.map((s) => (
                <div key={s._id} className="bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 flex flex-col">
                  <span className="text-xs text-slate-500 font-medium">Every {s._id}h</span>
                  <span className="text-lg font-bold text-slate-300">{s.count} users</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-4 flex-wrap">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-500">Send frequency</label>
              <div className="flex gap-2">
                {[1, 5, 24].map((h) => (
                  <button
                    key={h}
                    onClick={() => setInterval(h)}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                      interval === h
                        ? 'bg-violet-600 text-white border-violet-600'
                        : 'border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200'
                    }`}
                  >
                    {h === 1 ? 'Every 1h' : h === 5 ? 'Every 5h' : 'Once daily'}
                  </button>
                ))}
              </div>
            </div>

            {interval === 24 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-500">Send time (IST)</label>
                <select
                  value={hourIST}
                  onChange={(e) => setHourIST(Number(e.target.value))}
                  className="bg-[#1a1a28] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  {HOUR_LABELS.map((label, i) => <option key={i} value={i}>{label}</option>)}
                </select>
              </div>
            )}

            <div className="flex items-center gap-3 pb-0.5 flex-wrap">
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-violet-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-60 font-semibold"
              >
                {saving ? 'Applying…' : 'Apply to all users'}
              </button>
              {saveMsg && (
                <span className={`text-sm font-medium ${saveMsg.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>{saveMsg}</span>
              )}
              <div className="w-px h-6 bg-white/10 mx-1" />
              <button
                onClick={handleTrigger}
                disabled={triggering}
                className="bg-green-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-60 font-semibold"
              >
                {triggering ? 'Sending…' : '▶ Send emails now'}
              </button>
              {triggerMsg && (
                <span className={`text-sm font-medium ${triggerMsg.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>{triggerMsg}</span>
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
              className="bg-[#1a1a28] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 w-64 focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder:text-slate-600"
            />
            <button type="submit" className="bg-violet-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-violet-700 transition-colors">Search</button>
            {emailFilter && (
              <button type="button" onClick={() => { setEmailFilter(''); fetchLogs(1, ''); }} className="text-sm text-slate-500 hover:text-slate-300 px-3 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors">
                Clear
              </button>
            )}
            <span className="ml-auto text-sm text-slate-500 self-center">{total} email{total !== 1 ? 's' : ''} sent</span>
          </form>

          <div className="bg-[#12121c] border border-white/10 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-white/10">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Sent at (IST)</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Email</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Jobs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {loading ? (
                  <tr><td colSpan={4} className="text-center py-12 text-slate-600">Loading…</td></tr>
                ) : logs.length === 0 ? (
                  <tr><td colSpan={4} className="text-center py-12 text-slate-600">No emails sent yet</td></tr>
                ) : logs.map((log) => (
                  <tr key={log._id} className="hover:bg-white/[0.03] transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{toIST(log.sentAt)}</td>
                    <td className="px-4 py-3 text-slate-200 font-medium">{log.name || '—'}</td>
                    <td className="px-4 py-3 text-slate-400">{log.email}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-block bg-green-500/10 text-green-400 text-xs font-semibold px-2 py-0.5 rounded-full">
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
              <button disabled={page <= 1} onClick={() => fetchLogs(page - 1)} className="px-4 py-2 text-sm border border-white/10 text-slate-400 rounded-lg hover:bg-white/5 disabled:opacity-40">← Prev</button>
              <span className="px-4 py-2 text-sm text-slate-500">Page {page} of {pages}</span>
              <button disabled={page >= pages} onClick={() => fetchLogs(page + 1)} className="px-4 py-2 text-sm border border-white/10 text-slate-400 rounded-lg hover:bg-white/5 disabled:opacity-40">Next →</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
