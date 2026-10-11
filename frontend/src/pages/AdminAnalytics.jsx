import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import adminApi from '../services/adminApi';
import AdminNav from '../components/AdminNav';

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
  // Diagnostics is fetched independently of the main analytics payload
  // (Improvement 9 audit fix — it previously existed on the backend but was
  // never called from this page at all). Its own failure must never block or
  // blank out the rest of the page, which already loaded fine from
  // /admin/analytics — hence a separate state/request rather than bundling it
  // into the main `data` fetch.
  const [diagnostics, setDiagnostics] = useState(null);
  const [diagnosticsFailed, setDiagnosticsFailed] = useState(false);

  useEffect(() => {
    adminApi.get('/admin/analytics').then((r) => setData(r.data)).finally(() => setLoading(false));
    adminApi.get('/admin/diagnostics').then((r) => setDiagnostics(r.data)).catch(() => setDiagnosticsFailed(true));
  }, []);

  const bar = () => (
    <AdminNav
      active="analytics"
      right={<button onClick={() => { localStorage.removeItem('adminToken'); navigate('/admin'); }} className="text-sm text-red-400 hover:text-red-300 font-medium">Exit admin</button>}
    />
  );

  if (loading) return <div className="min-h-screen bg-[#0a0a12]">{bar()}<div className="text-center pt-24 text-slate-600">Loading…</div></div>;
  if (!data) return <div className="min-h-screen bg-[#0a0a12]">{bar()}<div className="text-center pt-24 text-slate-600">Failed to load</div></div>;

  const { jobs, matches, companies, emails, users, fetch, ops } = data;
  const em = (m) => `${m.sent || 0} sent · ${m.skipped || 0} skipped · ${m.failed || 0} failed`;
  const dist = matches.distribution;
  const distTotal = (dist.below40 + dist.mid + dist.good + dist.strong) || 1;
  const pct = (n) => `${Math.round((n / distTotal) * 100)}%`;

  const INDICATOR_STYLE = {
    ok:      { dot: 'bg-green-400',  text: 'text-green-400',  label: 'Healthy' },
    warning: { dot: 'bg-yellow-400', text: 'text-yellow-400', label: 'Warning' },
    error:   { dot: 'bg-red-500',    text: 'text-red-400',    label: 'Error' },
  };
  const indicatorStyle = (i) => INDICATOR_STYLE[i] || { dot: 'bg-slate-500', text: 'text-slate-500', label: 'Unknown' };

  const relativeAge = (iso) => {
    if (!iso) return 'never';
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 48) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  };

  const OpsCard = ({ label, indicator, status, lastAt, stale, children }) => {
    const style = indicatorStyle(indicator);
    return (
      <div className="bg-[#12121c] border border-white/10 rounded-xl p-5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</p>
          <span className={`flex items-center gap-1.5 text-xs font-medium ${style.text}`}>
            <span className={`w-2 h-2 rounded-full ${style.dot}`} />
            {style.label}
          </span>
        </div>
        <p className="text-lg font-bold text-slate-100 capitalize">{status || 'unknown'}</p>
        <p className="text-xs text-slate-600 mt-1">
          {lastAt ? `Last: ${relativeAge(lastAt)}` : 'No runs recorded yet'}
          {/* A run can report a healthy outcome and still be stale (Improvement 9) —
              the pipeline may simply have stopped executing since then. */}
          {stale && <span className="text-yellow-400 ml-2">⚠ stale</span>}
        </p>
        {children}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#0a0a12]">
      {bar()}
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">

        {/* Operational overview */}
        {ops && (
          <section>
            <h2 className="text-sm font-semibold text-slate-300 mb-3">Operational overview</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <OpsCard label="Fetch" indicator={ops.fetch.indicator} status={ops.fetch.status} lastAt={ops.fetch.lastRunAt} stale={ops.fetch.stale}>
                <p className="text-xs text-slate-500 mt-2">{ops.fetch.totalAdded ?? 0} added · {ops.fetch.totalUpdated ?? 0} updated this run</p>
              </OpsCard>
              <OpsCard label="Matching" indicator={ops.match.indicator} status={ops.match.status} lastAt={ops.match.lastRunAt} stale={ops.match.stale}>
                <p className="text-xs text-slate-500 mt-2">{ops.jobs.needsMatching} job(s) pending · {ops.jobs.matcherVersionBacklog} on old version</p>
              </OpsCard>
              <OpsCard label="Email" indicator={ops.email.indicator} status={ops.email.status} lastAt={ops.email.lastSuccessAt}>
                <p className="text-xs text-slate-500 mt-2">{em(ops.email.last24h)} (24h)</p>
              </OpsCard>
              <OpsCard label="Jobs" indicator="ok" status={`${ops.jobs.active} active`} lastAt={null}>
                <p className="text-xs text-slate-500 mt-2">{ops.jobs.closed} closed · {ops.jobs.expired} expired</p>
              </OpsCard>
            </div>
            {ops.warnings.length > 0 && (
              <div className="bg-[#12121c] border border-yellow-500/20 rounded-xl p-4 space-y-1.5">
                <p className="text-xs text-yellow-400 font-medium uppercase tracking-wide mb-2">Warnings</p>
                {ops.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-slate-400">• {w.message}</p>
                ))}
              </div>
            )}
            {(ops.fetch.failingBoards?.length > 0) && (
              <div className="bg-[#12121c] border border-white/10 rounded-xl p-4 mt-4">
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-2">Boards failing repeatedly</p>
                {ops.fetch.failingBoards.map((b) => (
                  <p key={b.name} className="text-xs text-slate-400">
                    {b.name} — {b.consecutiveFailures} run(s) in a row{b.lastReason ? ` (${b.lastReason})` : ''}
                  </p>
                ))}
              </div>
            )}

            {/* System diagnostics — fetched separately from /admin/diagnostics
                (Improvement 9 audit fix: this endpoint existed and was tested,
                but was never actually surfaced on this page). Its own failure
                is isolated here and never blanks out the rest of the page. */}
            <div className="bg-[#12121c] border border-white/10 rounded-xl p-4 mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
              <span className="text-slate-500 font-medium uppercase tracking-wide">System</span>
              {diagnosticsFailed ? (
                <span className="text-yellow-400">Diagnostics unavailable right now — rest of this page is unaffected</span>
              ) : !diagnostics ? (
                <span className="text-slate-600">Loading…</span>
              ) : (
                <>
                  <span className="text-slate-400">Role: <span className="text-slate-200">{diagnostics.processRole}</span></span>
                  <span className="text-slate-400">Mongo: <span className={diagnostics.mongoConnected ? 'text-green-400' : 'text-red-400'}>{diagnostics.mongoConnected ? 'connected' : 'disconnected'}</span></span>
                  <span className="text-slate-400">
                    Scheduler: <span className={diagnostics.schedulerRegistered ? 'text-green-400' : 'text-slate-500'}>
                      {diagnostics.schedulerExpectedInThisProcess ? (diagnostics.schedulerRegistered ? 'registered' : 'not registered') : 'n/a (api-only process)'}
                    </span>
                  </span>
                </>
              )}
            </div>
          </section>
        )}

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
