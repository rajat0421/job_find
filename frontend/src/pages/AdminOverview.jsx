import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import adminApi from '../services/adminApi';
import AdminNav from '../components/AdminNav';

// The new, focused landing page for operational health (Phase 2) — built
// entirely from the existing getOperationalOverview() aggregate (already
// used by AdminAnalytics) plus the new upstream-trace collection's recent
// failures and storage footprint. Deliberately does NOT re-derive anything
// AdminAnalytics already computes — see /api/admin/overview.

const fmtBytes = (n) => {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};

const toIST = (iso) => iso
  ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
  : 'Never';

const statusColor = (status) => ({
  success: 'bg-green-500/10 text-green-400 ring-green-500/20',
  partial: 'bg-amber-500/10 text-amber-400 ring-amber-500/20',
  failed: 'bg-red-500/10 text-red-400 ring-red-500/20',
  unknown: 'bg-white/5 text-slate-400 ring-white/10',
  // Distinct from 'success' on purpose — see monitoring.service.js's
  // getEmailHealth: this means zero EmailLog events in the last 24h, which
  // previously defaulted to the 'success' badge and looked identical to an
  // actually-healthy, actively-sending pipeline.
  no_activity: 'bg-white/5 text-slate-400 ring-white/10',
}[status] || 'bg-white/5 text-slate-400 ring-white/10');

// "24 consecutive failures" is a floor, not an exact count, whenever it
// equals the full inspected window — see monitoring.service.js's
// consecutiveFailuresCapped. lastSuccessAt:null is similarly ambiguous: it
// either means "never, in all recorded history" (window not capped — there
// simply isn't more history to miss) or "not within the visible window,
// older history unexamined" (window capped).
const describeProviderStreak = (p) => {
  if (p.consecutiveFailuresCapped) return '24+ (all recent runs lacked a clean result)';
  return `${p.consecutiveFailures} consecutive failure${p.consecutiveFailures === 1 ? '' : 's'}`;
};
const describeLastSuccess = (p) => {
  if (p.lastSuccessAt) return toIST(p.lastSuccessAt);
  return p.consecutiveFailuresCapped ? 'None in the last 24 runs (earlier history unchecked)' : 'Never recorded';
};

const HealthCard = ({ title, health }) => {
  if (!health) return null;
  const label = health.status === 'no_activity' ? 'no activity (24h)' : health.status;
  return (
    <div className="bg-[#12121c] border border-white/10 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-slate-200">{title}</p>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ring-1 ${statusColor(health.status)}`}>
          {label}{health.stale ? ' (stale)' : ''}
        </span>
      </div>
      <p className="text-xs text-slate-500">Last run: {toIST(health.lastRunAt)}</p>
      {health.warnings?.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {health.warnings.map((w) => (
            <li key={w.code} className={`text-xs ${w.severity === 'error' ? 'text-red-400' : 'text-amber-400'}`}>⚠ {w.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
};

const AdminOverview = () => {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Relocated here from the Users page (audit finding: these are pipeline-
  // wide maintenance operations, not user-lookup actions — they don't belong
  // on a page for finding and inspecting one user). Result handling now only
  // reads fields the backend actually returns (jobsFixed/rescored/
  // skippedOrphaned) — the previous UI referenced a `removed` field neither
  // endpoint has returned since they were changed to never delete UserJob
  // records, so every past run of these buttons silently showed "undefined".
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState(null);
  const [rescoring, setRescoring] = useState(false);
  const [rescoreResult, setRescoreResult] = useState(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState(null);

  useEffect(() => {
    adminApi.get('/admin/overview')
      .then((r) => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const handleFixGreenhouse = async () => {
    if (!window.confirm(
      'Processes the next bounded batch (up to 200) of Greenhouse jobs, resuming from where the last batch left off.\n\n' +
      'Live Greenhouse boards already self-heal their descriptions automatically on their next normal hourly fetch — this mainly helps closed/expired postings that will never be fetched again. Continue?'
    )) return;
    setFixing(true); setFixResult(null);
    try {
      const r = await adminApi.post('/admin/fix-greenhouse');
      setFixResult(r.data);
    } catch (e) {
      setFixResult({ error: e.response?.data?.message || e.message });
    } finally { setFixing(false); }
  };

  const handleRescoreAll = async () => {
    if (!window.confirm(
      'Runs one bounded batch of the SAME automatic background version sweep that already runs every hour — not a separate operation.\n\n' +
      'Use this to speed through a backlog faster than waiting for the next automatic run. Continue?'
    )) return;
    setRescoring(true); setRescoreResult(null);
    try {
      const r = await adminApi.post('/admin/rescore-all');
      setRescoreResult(r.data);
    } catch (e) {
      setRescoreResult({ error: e.response?.data?.message || e.message });
    } finally { setRescoring(false); }
  };

  const handleBackfill = async () => {
    if (!window.confirm('Run the same matching pass the hourly cron already runs, right now, instead of waiting? This is bounded the same way the scheduled run is. Continue?')) return;
    setBackfilling(true); setBackfillResult(null);
    try {
      const r = await adminApi.post('/admin/backfill-matches');
      setBackfillResult(r.data);
    } catch (e) {
      setBackfillResult({ error: e.response?.data?.message || e.message });
    } finally { setBackfilling(false); }
  };

  return (
    <div className="min-h-screen bg-[#0a0a12]">
      <AdminNav
        active="overview"
        right={<button onClick={() => { localStorage.removeItem('adminToken'); navigate('/admin'); }} className="text-sm text-red-400 hover:text-red-300 font-medium">Exit admin</button>}
      />

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Overview</h1>
          <p className="text-sm text-slate-500 mt-0.5">Fetch, matching, and email pipeline health at a glance.</p>
        </div>

        {loading && <p className="text-center text-slate-600 py-20">Loading…</p>}
        {error && <p className="text-center text-red-400 py-20">Failed to load overview</p>}

        {data && (
          <>
            <div className="grid sm:grid-cols-3 gap-4">
              <HealthCard title="Fetch" health={data.fetch} />
              <HealthCard title="Matching" health={data.match} />
              <HealthCard title="Email" health={data.email} />
            </div>

            {/* Per-provider fetch status, with last success/failure */}
            {data.fetch?.providers?.length > 0 && (
              <div className="bg-[#12121c] border border-white/10 rounded-xl p-5">
                <p className="text-sm font-semibold text-slate-200 mb-3">Provider health</p>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {data.fetch.providers.map((p) => (
                    <div key={p.name} className="bg-white/[0.03] border border-white/5 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-200">{p.name}</span>
                        <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${statusColor(p.latestOutcome)}`}>{p.latestOutcome}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">Last success: {describeLastSuccess(p)}</p>
                      {p.consecutiveFailures > 0 && <p className="text-xs text-red-400 mt-0.5">{describeProviderStreak(p)}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Board-level failures — deliberately separate from the provider
                cards above: a provider card's streak is the whole provider's
                per-cycle outcome, which goes non-success the moment even ONE
                board/category fails that cycle. This section is the only
                place that shows WHICH specific board is actually broken, so
                "one bad token" is never mistaken for "the whole provider is
                down". */}
            {data.fetch?.failingBoards?.length > 0 && (
              <div className="bg-[#12121c] border border-white/10 rounded-xl p-5">
                <p className="text-sm font-semibold text-slate-200 mb-1">Failing boards</p>
                <p className="text-xs text-slate-500 mb-3">Individual companies/boards failing repeatedly — distinct from the provider-wide status above; one of these can taint its provider's streak without the whole provider being down.</p>
                <div className="flex flex-col divide-y divide-white/[0.06]">
                  {data.fetch.failingBoards.map((b) => (
                    <div key={b.name} className="py-2 flex items-center justify-between gap-3">
                      <span className="text-sm text-slate-300">{b.name}</span>
                      <span className="text-xs text-red-400">{b.consecutiveFailures} in a row · {b.lastReason || 'unknown reason'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Matching backlog */}
            <div className="bg-[#12121c] border border-white/10 rounded-xl p-5">
              <p className="text-sm font-semibold text-slate-200 mb-1">Matching backlog</p>
              <p className="text-xs text-slate-500 mb-3">Last successful match cycle: {toIST(data.match?.lastSuccessfulRunAt)}{data.match?.lastRunAt && data.match.lastSuccessfulRunAt !== data.match.lastRunAt ? ` (most recent attempt: ${toIST(data.match.lastRunAt)})` : ''}</p>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-2xl font-bold text-slate-100">{data.match?.pendingBacklog?.count ?? '—'}</p>
                  <p className="text-xs text-slate-500">Jobs awaiting matching{data.match?.pendingBacklog?.oldestPendingAgeMs ? `, oldest ${Math.round(data.match.pendingBacklog.oldestPendingAgeMs / 3600000)}h` : ''}</p>
                  {data.match?.idealDrainEstimate?.pendingBacklogHours > 0 && (
                    <p className="text-[11px] text-slate-600 mt-1">~{data.match.idealDrainEstimate.pendingBacklogHours}h ideal estimate to drain — assumes the hourly cron runs every tick with no new backlog; not a measurement of actual progress.</p>
                  )}
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-100">{data.match?.versionBacklog ?? '—'}</p>
                  <p className="text-xs text-slate-500">UserJob records on a stale matcher version</p>
                  {data.match?.idealDrainEstimate?.versionBacklogHours > 0 && (
                    <p className="text-[11px] text-slate-600 mt-1">~{data.match.idealDrainEstimate.versionBacklogHours}h ideal estimate to drain — same assumptions as above.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Recent actionable errors — from the new upstream-trace collection */}
            <div className="bg-[#12121c] border border-white/10 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-slate-200">Recent actionable errors</p>
                <button onClick={() => navigate('/admin/traces?success=false')} className="text-xs text-violet-400 hover:text-violet-300 font-medium">View all in Upstream Logs →</button>
              </div>
              {!data.recentErrors?.length ? (
                <p className="text-sm text-slate-600 py-4">No recent upstream request failures.</p>
              ) : (
                <div className="flex flex-col divide-y divide-white/[0.06]">
                  {data.recentErrors.map((e) => (
                    <div key={e.traceId} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-slate-300">
                          <span className="font-medium capitalize">{e.provider}</span> · {e.operation}{e.boardToken ? ` (${e.boardToken})` : ''}
                        </p>
                        <p className="text-xs text-slate-600">{toIST(e.requestedAt)} · {e.durationMs}ms{e.statusCode ? ` · HTTP ${e.statusCode}` : ''} · {e.errorKind || 'error'}</p>
                        {/* For budget_exceeded specifically, errorMessage carries which
                            deadline actually tripped ("(provider)" vs "(cycle)" vs
                            "(provider+cycle)") — a provider's own budget running out is
                            self-contained; the shared cycle budget running out means
                            every remaining provider that cycle was starved too. */}
                        {e.errorMessage && <p className="text-xs text-slate-700 mt-0.5">{e.errorMessage}</p>}
                      </div>
                      <button onClick={() => navigate(`/admin/traces/${e.traceId}`)} className="text-xs text-violet-400 hover:text-violet-300 font-medium whitespace-nowrap">View trace →</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Trace storage footprint */}
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>Upstream trace storage: {data.traceStorage?.totalRecords ?? 0} records, {fmtBytes(data.traceStorage?.totalStoredBytes)} compressed</span>
              <button onClick={() => navigate('/admin/traces')} className="text-violet-400 hover:text-violet-300 font-medium">Open Upstream Logs →</button>
            </div>

            {/* Maintenance actions — all three now run ONE bounded batch per
                click (not an unbounded, whole-database pass) and are safe to
                click repeatedly or interrupt; see each action's own note. */}
            <div className="bg-[#12121c] border border-white/10 rounded-xl p-5">
              <p className="text-sm font-semibold text-slate-200 mb-1">Maintenance actions</p>
              <p className="text-xs text-slate-500 mb-4">Each click runs one bounded batch and is safe to repeat — click again (or wait for the matching automatic background job) to make further progress.</p>
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={handleFixGreenhouse}
                    disabled={fixing}
                    className="text-xs bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-60"
                  >
                    {fixing ? 'Fixing batch...' : 'Fix Greenhouse HTML (next batch)'}
                  </button>
                  <span className="text-[11px] text-slate-600">Processes up to 200 Greenhouse jobs per click (resumable via a saved cursor). Live boards already self-heal automatically — this mainly helps closed/expired postings that will never be re-fetched.</span>
                  {fixResult && (
                    <span className={`text-xs ${fixResult.error ? 'text-red-400' : 'text-green-400'}`}>
                      {fixResult.error || `${fixResult.batchSize} job(s) checked, ${fixResult.jobsFixed} cleaned, ${fixResult.rescored} match(es) rescored, ${fixResult.skippedOrphaned} orphaned skipped, ${fixResult.remainingInPass} remaining in this pass`}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={handleRescoreAll}
                    disabled={rescoring}
                    className="text-xs bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 border border-indigo-500/20 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-60"
                  >
                    {rescoring ? 'Running batch...' : 'Run Version-Sweep Batch Now'}
                  </button>
                  <span className="text-[11px] text-slate-600">Runs one batch of the SAME automatic background sweep that already runs hourly — not a separate, unbounded operation. Use to speed through a backlog faster than waiting.</span>
                  {rescoreResult && (
                    <span className={`text-xs ${rescoreResult.error ? 'text-red-400' : 'text-green-400'}`}>
                      {rescoreResult.error || `${rescoreResult.rescored} record(s) rescored this batch, ${rescoreResult.remainingBacklog} still stale`}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={handleBackfill}
                    disabled={backfilling}
                    className="text-xs bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-60"
                  >
                    {backfilling ? 'Running...' : 'Run Match Cycle Now'}
                  </button>
                  <span className="text-[11px] text-slate-600">Runs the exact same full cycle the hourly match cron runs — expiry sweep, bounded matching, and version sweep — with the same tracking, right now instead of waiting.</span>
                  {backfillResult && (
                    <span className={`text-xs ${backfillResult.error ? 'text-red-400' : 'text-green-400'}`}>
                      {backfillResult.error || backfillResult.message}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AdminOverview;
