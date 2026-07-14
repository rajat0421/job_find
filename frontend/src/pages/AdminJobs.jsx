import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import adminApi from '../services/adminApi';

const SOURCES = ['all', 'adzuna', 'greenhouse', 'lever', 'ashby'];

const sourceBadge = (s) => ({
  adzuna: 'bg-orange-500/10 text-orange-400',
  greenhouse: 'bg-green-500/10 text-green-400',
  lever: 'bg-blue-500/10 text-blue-400',
  ashby: 'bg-violet-500/10 text-violet-400',
}[s] || 'bg-white/5 text-slate-400');

const lpa = (min, max) => {
  if (!min && !max) return '—';
  const f = (v) => `₹${(v / 100000).toFixed(1)}L`;
  if (min && max) return `${f(min)}–${f(max)}`;
  return f(min || max);
};

const fmtDate = (iso) => iso
  ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
  : '—';

export default function AdminJobs() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [bySource, setBySource] = useState({});
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('all');
  const [sort, setSort] = useState('createdAt');
  const [loading, setLoading] = useState(true);

  const fetchJobs = async (p = 1, s = search, src = source, srt = sort) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: p, limit: 50, sort: srt });
      if (s) params.set('search', s);
      if (src !== 'all') params.set('source', src);
      const { data } = await adminApi.get(`/admin/jobs?${params}`);
      setJobs(data.jobs); setTotal(data.total); setPage(data.page); setPages(data.pages); setBySource(data.bySource);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchJobs(1); }, []);

  const navBtn = (label, active, onClick) => (
    <button onClick={onClick} className={`text-sm px-3 py-1.5 rounded-lg transition-colors font-medium ${active ? 'text-violet-400 bg-violet-500/10' : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'}`}>
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
            {navBtn('Analytics', false, () => navigate('/admin/analytics'))}
            {navBtn('Jobs', true, null)}
            {navBtn('Companies', false, () => navigate('/admin/companies'))}
            {navBtn('Email Logs', false, () => navigate('/admin/email-logs'))}
          </nav>
        </div>
        <button onClick={() => { localStorage.removeItem('adminToken'); navigate('/admin'); }} className="text-sm text-red-400 hover:text-red-300 font-medium">
          Exit admin
        </button>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <form onSubmit={(e) => { e.preventDefault(); fetchJobs(1); }} className="flex gap-3 flex-wrap items-center">
          <input type="text" placeholder="Search title or company…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="bg-[#1a1a28] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 w-64 focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder:text-slate-600" />
          <select value={source} onChange={(e) => { setSource(e.target.value); fetchJobs(1, search, e.target.value); }}
            className="bg-[#1a1a28] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500">
            {SOURCES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All sources' : s}{s !== 'all' && bySource[s] ? ` (${bySource[s]})` : ''}</option>)}
          </select>
          <select value={sort} onChange={(e) => { setSort(e.target.value); fetchJobs(1, search, source, e.target.value); }}
            className="bg-[#1a1a28] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500">
            <option value="createdAt">Newest fetched</option>
            <option value="postedAt">Newest posted</option>
            <option value="salaryMax">Highest salary</option>
          </select>
          <button type="submit" className="bg-violet-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-violet-700 transition-colors">Search</button>
          <span className="ml-auto text-sm text-slate-500">{total.toLocaleString()} jobs</span>
        </form>

        <div className="bg-[#12121c] border border-white/10 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead className="border-b border-white/10">
                <tr>
                  {['Title', 'Company', 'Location', 'LPA', 'Type', 'Source', 'Posted', 'Fetched'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-12 text-slate-600">Loading…</td></tr>
                ) : jobs.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-12 text-slate-600">No jobs</td></tr>
                ) : jobs.map((j) => (
                  <tr key={j._id} className="hover:bg-white/[0.03] transition-colors">
                    <td className="px-4 py-3 text-slate-200 font-medium max-w-xs truncate">
                      {j.applyLink ? <a href={j.applyLink} target="_blank" rel="noreferrer" className="hover:text-violet-400 transition-colors">{j.title}</a> : j.title}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{j.company || '—'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs max-w-[160px] truncate">{j.location || '—'}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{lpa(j.salaryMin, j.salaryMax)}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{j.workplaceType || '—'}</td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sourceBadge(j.source)}`}>{j.source}</span></td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{fmtDate(j.postedAt)}</td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{fmtDate(j.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {pages > 1 && (
          <div className="flex justify-center gap-2">
            <button disabled={page <= 1} onClick={() => fetchJobs(page - 1)} className="px-4 py-2 text-sm border border-white/10 text-slate-400 rounded-lg hover:bg-white/5 disabled:opacity-40">← Prev</button>
            <span className="px-4 py-2 text-sm text-slate-500">Page {page} of {pages}</span>
            <button disabled={page >= pages} onClick={() => fetchJobs(page + 1)} className="px-4 py-2 text-sm border border-white/10 text-slate-400 rounded-lg hover:bg-white/5 disabled:opacity-40">Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}
