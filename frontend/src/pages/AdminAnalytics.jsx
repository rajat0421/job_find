import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import adminApi from '../services/adminApi';

const toIST = (iso) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });

const Card = ({ label, value, sub, accent = 'text-slate-100' }) => (
  <div className="bg-[#12121c] border border-white/10 rounded-xl p-5">
    <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</p>
    <p className={`text-3xl font-bold mt-1 ${accent}`}>{value}</p>
    {sub && <p className="text-xs text-slate-600 mt-1">{sub}</p>}
  </div>
);

export default function AdminAnalytics() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.get('/admin/analytics').then((r) => setData(r.data)).finally(() => setLoading(false));
  }, []);

  const navBtn = (label, active, onClick) => (
    <button onClick={onClick} className={`text-sm px-3 py-1.5 rounded-lg transition-colors font-medium ${active ? 'text-violet-400 bg-violet-500/10' : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'}`}>
      {label}
    </button>
  );

  const bar = () => (
    <div className="bg-[#12121c] border-b border-white/10 px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <span className="text-xl font-bold text-violet-400">JobFind</span>
        <span className="text-xs bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full font-medium">Admin</span>
        <nav className="flex items-center gap-1 ml-4">
          {navBtn('Users', false, () => navigate('/admin'))}
          {navBtn('Analytics', true, null)}
          {navBtn('Jobs', false, () => navigate('/admin/jobs'))}
          {navBtn('Companies', false, () => navigate('/admin/companies'))}
          {navBtn('Email Logs', false, () => navigate('/admin/email-logs'))}
        </nav>
      </div>
      <button onClick={() => { localStorage.removeItem('adminToken'); navigate('/admin'); }} className="text-sm text-red-400 hover:text-red-300 font-medium">Exit admin</button>
    </div>
  );

  if (loading) return <div className="min-h-screen bg-[#0a0a12]">{bar()}<div className="text-center pt-24 text-slate-600">Loading…</div></div>;
  if (!data) return <div className="min-h-screen bg-[#0a0a12]">{bar()}<div className="text-center pt-24 text-slate-600">Failed to load</div></div>;

  const { jobs, matches, companies, emails, users, fetch } = data;
  const em = (m) => `${m.sent || 0} sent · ${m.skipped || 0} skipped · ${m.failed || 0} failed`;
  const dist = matches.distribution;
  const distTotal = (dist.below40 + dist.mid + dist.good + dist.strong) || 1;
  const pct = (n) => `${Math.round((n / distTotal) * 100)}%`;

  return (
    <div className="min-h-screen bg-[#0a0a12]">
      {bar()}
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">

        {/* Jobs */}
        <section>
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Jobs</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card label="Total in DB" value={jobs.total.toLocaleString()} accent="text-violet-300" />
            <Card label="New today" value={jobs.newToday} accent="text-green-400" sub="stored since IST midnight" />
            <Card label="New yesterday" value={jobs.newYesterday} />
            <Card label="Sources" value={Object.keys(jobs.bySource).length} sub={Object.entries(jobs.bySource).map(([k, v]) => `${k} ${v}`).join(' · ')} />
          </div>
        </section>

        {/* Fetch runs */}
        <section>
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Fetch cycles</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <Card label="Fetched today" value={fetch.today.fetched.toLocaleString()} sub={`${fetch.today.runs} run(s)`} />
            <Card label="Stored today" value={fetch.today.added} accent="text-green-400" sub={`${fetch.today.fetched - fetch.today.added} dupes skipped`} />
            <Card label="Fetched yesterday" value={fetch.yesterday.fetched.toLocaleString()} sub={`${fetch.yesterday.runs} run(s)`} />
            <Card label="Stored yesterday" value={fetch.yesterday.added} />
          </div>
          {fetch.recentRuns.length > 0 && (
            <div className="bg-[#12121c] border border-white/10 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[520px]">
                  <thead className="border-b border-white/10">
                    <tr>
                      {['Run (IST)', 'Fetched', 'Stored', 'By source'].map((h) => <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {fetch.recentRuns.map((r) => (
                      <tr key={r._id} className="hover:bg-white/[0.03]">
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-500 whitespace-nowrap">{toIST(r.createdAt)}</td>
                        <td className="px-4 py-2.5 text-slate-400">{r.totalFetched}</td>
                        <td className="px-4 py-2.5 text-green-400 font-medium">{r.totalAdded}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">{(r.sources || []).map((s) => `${s.name} ${s.added}/${s.fetched}`).join('  ·  ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {/* Match quality */}
        <section>
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Match quality</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
            <Card label="Total matches" value={matches.total.toLocaleString()} />
            <Card label="Average score" value={`${matches.avgScore}%`} accent={matches.avgScore >= 50 ? 'text-green-400' : 'text-yellow-400'} />
            <Card label="Users w/ sendable job" value={`${users.withSendableJobs}/${users.active}`} sub={`score ≥ ${users.threshold}`} accent="text-violet-300" />
          </div>
          <div className="bg-[#12121c] border border-white/10 rounded-xl p-5">
            <p className="text-xs text-slate-500 mb-3">Score distribution (the "just under the bar" view)</p>
            {[
              { label: 'Strong (75-100)', n: dist.strong, color: 'bg-green-400' },
              { label: `Good (50-74) — emailed at ≥${users.threshold}`, n: dist.good, color: 'bg-emerald-500' },
              { label: 'Mid (40-49) — just below', n: dist.mid, color: 'bg-yellow-400' },
              { label: 'Low (0-39)', n: dist.below40, color: 'bg-red-500/60' },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-3 mb-2">
                <span className="text-xs text-slate-500 w-56 shrink-0">{row.label}</span>
                <div className="flex-1 bg-white/5 rounded-full h-2.5 max-w-md">
                  <div className={`h-2.5 rounded-full ${row.color}`} style={{ width: pct(row.n) }} />
                </div>
                <span className="text-xs text-slate-400 w-20 shrink-0">{row.n.toLocaleString()} ({pct(row.n)})</span>
              </div>
            ))}
          </div>
        </section>

        {/* Emails + companies */}
        <section className="grid md:grid-cols-2 gap-4">
          <div className="bg-[#12121c] border border-white/10 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-300 mb-3">Emails</h2>
            <p className="text-sm text-slate-400 mb-1">Last 24h: <span className="text-slate-200">{em(emails.last24h)}</span></p>
            <p className="text-sm text-slate-400">Last 7d: <span className="text-slate-200">{em(emails.last7d)}</span></p>
          </div>
          <div className="bg-[#12121c] border border-white/10 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-300 mb-3">Companies</h2>
            <p className="text-sm text-slate-400 mb-1">Enabled: <span className="text-slate-200">{companies.enabled}/{companies.total}</span></p>
            <p className="text-sm text-slate-400">Returned 0 last fetch: <span className={companies.dead > 0 ? 'text-red-400' : 'text-slate-200'}>{companies.dead}</span>
              {companies.dead > 0 && <button onClick={() => navigate('/admin/companies')} className="text-violet-400 hover:text-violet-300 ml-2 text-xs">review →</button>}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
