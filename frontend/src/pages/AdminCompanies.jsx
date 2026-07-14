import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import adminApi from '../services/adminApi';

const PROVIDERS = ['greenhouse', 'lever', 'ashby'];

const providerBadge = (p) => ({
  greenhouse: 'bg-green-500/10 text-green-400',
  lever: 'bg-blue-500/10 text-blue-400',
  ashby: 'bg-violet-500/10 text-violet-400',
}[p] || 'bg-white/5 text-slate-400');

const toIST = (iso) => iso
  ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
  : 'Never';

export default function AdminCompanies() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  // Add form
  const [form, setForm] = useState({ provider: 'greenhouse', name: '', token: '', region: 'global' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const fetchCompanies = async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.get('/admin/companies');
      setCompanies(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCompanies(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    setSaving(true); setMsg(null);
    try {
      const { data } = await adminApi.post('/admin/companies', form);
      setMsg({ ok: true, text: data.message });
      setForm({ ...form, name: '', token: '' });
      fetchCompanies();
    } catch (err) {
      setMsg({ ok: false, text: err.response?.data?.message || 'Failed to add' });
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 5000);
    }
  };

  const toggleEnabled = async (c) => {
    await adminApi.patch(`/admin/companies/${c._id}`, { enabled: !c.enabled });
    setCompanies((prev) => prev.map((x) => (x._id === c._id ? { ...x, enabled: !x.enabled } : x)));
  };

  const remove = async (c) => {
    if (!window.confirm(`Remove ${c.name} (${c.provider})?`)) return;
    await adminApi.delete(`/admin/companies/${c._id}`);
    setCompanies((prev) => prev.filter((x) => x._id !== c._id));
  };

  const navBtn = (label, active, onClick) => (
    <button onClick={onClick} className={`text-sm px-3 py-1.5 rounded-lg transition-colors font-medium ${active ? 'text-violet-400 bg-violet-500/10' : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'}`}>
      {label}
    </button>
  );

  const shown = filter === 'all' ? companies : companies.filter((c) => c.provider === filter);
  const counts = PROVIDERS.reduce((acc, p) => ({ ...acc, [p]: companies.filter((c) => c.provider === p).length }), {});
  const enabledCount = companies.filter((c) => c.enabled).length;

  return (
    <div className="min-h-screen bg-[#0a0a12]">
      <div className="bg-[#12121c] border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-xl font-bold text-violet-400">JobFind</span>
          <span className="text-xs bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full font-medium">Admin</span>
          <nav className="flex items-center gap-1 ml-4">
            {navBtn('Users', false, () => navigate('/admin'))}
            {navBtn('Analytics', false, () => navigate('/admin/analytics'))}
            {navBtn('Jobs', false, () => navigate('/admin/jobs'))}
            {navBtn('Companies', true, null)}
            {navBtn('Email Logs', false, () => navigate('/admin/email-logs'))}
          </nav>
        </div>
        <button onClick={() => { localStorage.removeItem('adminToken'); navigate('/admin'); }} className="text-sm text-red-400 hover:text-red-300 font-medium">
          Exit admin
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">

        {/* Add company */}
        <div className="bg-[#12121c] border border-white/10 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-slate-200 mb-1">Add a company</h2>
          <p className="text-xs text-slate-600 mb-4">
            The token is the slug from the careers URL — e.g. <span className="text-slate-400">jobs.lever.co/<b className="text-violet-400">meesho</b></span> or
            <span className="text-slate-400"> jobs.ashbyhq.com/<b className="text-violet-400">OpenAI</b></span>. We verify it returns jobs before saving.
          </p>
          <form onSubmit={handleAdd} className="flex gap-3 items-end flex-wrap">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-500">Provider</label>
              <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}
                className="bg-[#1a1a28] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500">
                {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-500">Display name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Meesho" required
                className="bg-[#1a1a28] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 w-40 focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder:text-slate-600" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-500">Token / board</label>
              <input value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} placeholder="e.g. meesho" required
                className="bg-[#1a1a28] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 w-40 focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder:text-slate-600" />
            </div>
            {form.provider === 'lever' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-500">Region</label>
                <select value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}
                  className="bg-[#1a1a28] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500">
                  <option value="global">global</option>
                  <option value="eu">eu</option>
                </select>
              </div>
            )}
            <button type="submit" disabled={saving}
              className="bg-violet-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-60 font-semibold">
              {saving ? 'Verifying…' : 'Add & verify'}
            </button>
            {msg && <span className={`text-sm font-medium ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</span>}
          </form>
        </div>

        {/* Filters */}
        <div className="flex gap-4 flex-wrap items-center">
          <div className="flex gap-2">
            {['all', ...PROVIDERS].map((p) => (
              <button key={p} onClick={() => setFilter(p)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${filter === p ? 'bg-violet-600 text-white border-violet-600' : 'border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200'}`}>
                {p === 'all' ? `All (${companies.length})` : `${p} (${counts[p] || 0})`}
              </button>
            ))}
          </div>
          <span className="ml-auto text-sm text-slate-500">{enabledCount} enabled / {companies.length} total</span>
        </div>

        {/* Table */}
        <div className="bg-[#12121c] border border-white/10 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="border-b border-white/10">
                <tr>
                  {['Company', 'Provider', 'Token', 'Region', 'Last fetch', 'Jobs', 'Enabled', ''].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-12 text-slate-600">Loading…</td></tr>
                ) : shown.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-12 text-slate-600">No companies</td></tr>
                ) : shown.map((c) => (
                  <tr key={c._id} className={`hover:bg-white/[0.03] transition-colors ${!c.enabled ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 text-slate-200 font-medium">{c.name}</td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${providerBadge(c.provider)}`}>{c.provider}</span></td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">{c.token}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{c.region}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{toIST(c.lastFetchedAt)}</td>
                    <td className="px-4 py-3 text-slate-400">{c.lastJobCount ?? '—'}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => toggleEnabled(c)}
                        className={`text-xs font-semibold px-2.5 py-1 rounded-full transition-colors ${c.enabled ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20' : 'bg-white/5 text-slate-500 hover:bg-white/10'}`}>
                        {c.enabled ? 'On' : 'Off'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => remove(c)} className="text-xs text-slate-600 hover:text-red-400 transition-colors">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
