import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import adminApi from '../services/adminApi';
import AdminNav from '../components/AdminNav';

// Phase 7 — the Upstream API Logs trace list + detail viewer. Bodies are
// only ever fetched when a single trace is opened (GET /admin/traces/:id) —
// the list view (GET /admin/traces) never returns compressed bodies at all.

const PROVIDERS = ['greenhouse', 'lever', 'ashby', 'adzuna'];
const LIMIT = 30;

const toIST = (iso) => iso
  ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  : '—';

const statusBadge = (success, statusCode) => {
  if (success) return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">{statusCode ?? 'OK'}</span>;
  return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">{statusCode ?? 'no response'}</span>;
};

const captureBadge = (status) => ({
  complete: <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">complete</span>,
  truncated: <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">truncated</span>,
  omitted: <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/5 text-slate-500">omitted</span>,
  none: <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/5 text-slate-600">none</span>,
}[status] || null);

const CopyButton = ({ text, label = 'Copy' }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-[11px] text-violet-400 hover:text-violet-300 font-medium"
    >
      {copied ? 'Copied!' : label}
    </button>
  );
};

const JsonBlock = ({ data, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  if (data == null) return <span className="text-slate-600 text-xs">—</span>;
  const json = JSON.stringify(data, null, 2);
  return (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <button onClick={() => setOpen((v) => !v)} className="text-xs text-violet-400 hover:text-violet-300 font-medium">{open ? 'Collapse' : 'Expand'}</button>
        {open && <CopyButton text={json} label="Copy JSON" />}
      </div>
      {open && (
        <pre className="bg-black/40 text-green-400 text-xs rounded-lg p-3 overflow-auto max-h-96 leading-relaxed border border-white/5">
          {json}
        </pre>
      )}
    </div>
  );
};

// ── Detail panel ──────────────────────────────────────────────────────────
const TraceDetail = ({ traceId, onClose }) => {
  const [trace, setTrace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [upstreamJobId, setUpstreamJobId] = useState('');
  const [rawJob, setRawJob] = useState(null);
  const [rawJobError, setRawJobError] = useState('');

  useEffect(() => {
    setLoading(true);
    setTrace(null);
    setRawJob(null);
    adminApi.get(`/admin/traces/${traceId}`)
      .then((r) => setTrace(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [traceId]);

  const extractJob = async () => {
    setRawJob(null);
    setRawJobError('');
    try {
      const { data } = await adminApi.get(`/admin/traces/${traceId}/jobs/${encodeURIComponent(upstreamJobId)}`);
      if (data.found) setRawJob(data);
      else setRawJobError(data.message || 'Not found');
    } catch (e) {
      setRawJobError(e.response?.data?.message || 'Failed to extract job');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div className="w-full max-w-2xl h-full bg-[#12121c] border-l border-white/10 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-[#12121c] border-b border-white/10 px-5 py-4 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-200">Trace detail</p>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-sm">Close ✕</button>
        </div>

        <div className="p-5 flex flex-col gap-5">
          {loading && <p className="text-slate-600 text-sm">Loading…</p>}
          {error && <p className="text-red-400 text-sm">Failed to load trace</p>}

          {trace && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-500">{trace.traceId}</span>
                <CopyButton text={trace.traceId} label="Copy ID" />
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-slate-500">Provider</p><p className="text-slate-200 capitalize">{trace.provider}</p></div>
                <div><p className="text-xs text-slate-500">Operation</p><p className="text-slate-200">{trace.operation}{trace.boardToken ? ` (${trace.boardToken})` : ''}</p></div>
                <div><p className="text-xs text-slate-500">Status</p><p>{statusBadge(trace.success, trace.statusCode)}</p></div>
                <div><p className="text-xs text-slate-500">Duration</p><p className="text-slate-200">{trace.durationMs}ms{trace.retries ? ` (${trace.retries} retr${trace.retries > 1 ? 'ies' : 'y'})` : ''}</p></div>
                <div><p className="text-xs text-slate-500">Requested at</p><p className="text-slate-200">{toIST(trace.requestedAt)}</p></div>
                <div><p className="text-xs text-slate-500">Responded at</p><p className="text-slate-200">{toIST(trace.respondedAt)}</p></div>
              </div>

              {!trace.success && (
                <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                  <p className="text-xs text-red-400 font-semibold">{trace.errorKind || 'error'}</p>
                  <p className="text-xs text-red-300/80 mt-1">{trace.errorMessage}</p>
                </div>
              )}

              <div>
                <p className="text-xs text-slate-500 mb-1">Request URL</p>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-mono text-slate-300 break-all bg-black/30 rounded px-2 py-1.5 flex-1">{trace.url}</p>
                  <CopyButton text={trace.url} />
                </div>
              </div>

              <div>
                <p className="text-xs text-slate-500 mb-1">Request headers (sanitized)</p>
                <JsonBlock data={trace.requestHeaders} />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Response headers (sanitized)</p>
                <JsonBlock data={trace.responseHeaders} />
              </div>

              <div>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-xs text-slate-500">Response body</p>
                  {captureBadge(trace.bodyCaptureStatus)}
                  {trace.bodyOriginalSize != null && (
                    <span className="text-[11px] text-slate-600">{(trace.bodyOriginalSize / 1024).toFixed(1)}KB original → {((trace.bodyStoredSize || 0) / 1024).toFixed(1)}KB stored</span>
                  )}
                </div>
                {trace.bodyNotice && <p className="text-xs text-amber-400 mb-2">⚠ {trace.bodyNotice}</p>}
                <JsonBlock data={trace.body} defaultOpen={trace.bodyCaptureStatus === 'complete'} />
              </div>

              {(trace.observedSourceJobIds?.length > 0 || trace.resultingJobIds?.length > 0) && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">Correlated jobs</p>
                  <p className="text-xs text-slate-400">{trace.observedSourceJobIds?.length || 0} upstream job ID(s) observed, {trace.resultingJobIds?.length || 0} resolved to internal Job document(s).</p>
                </div>
              )}

              {(trace.bodyCaptureStatus === 'complete' || trace.bodyCaptureStatus === 'truncated') && (
                <div className="border-t border-white/10 pt-4">
                  <p className="text-xs font-semibold text-slate-300 mb-2">Extract a raw job object from this response</p>
                  <div className="flex items-center gap-2">
                    <input
                      value={upstreamJobId}
                      onChange={(e) => setUpstreamJobId(e.target.value)}
                      placeholder="Upstream job ID, e.g. 7882676"
                      className="text-sm bg-[#1a1a28] border border-white/10 text-slate-300 rounded-lg px-2.5 py-1.5 flex-1 focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder:text-slate-600"
                    />
                    <button onClick={extractJob} disabled={!upstreamJobId} className="text-xs bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-medium">Extract</button>
                  </div>
                  {rawJobError && <p className="text-xs text-red-400 mt-2">{rawJobError}</p>}
                  {rawJob && (
                    <div className="mt-3">
                      <p className="text-xs text-emerald-400 mb-1">{rawJob.provenance}</p>
                      <JsonBlock data={rawJob.job} defaultOpen />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ── List page ────────────────────────────────────────────────────────────
const AdminTraces = () => {
  const navigate = useNavigate();
  const { traceId: routeTraceId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const [traces, setTraces] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [provider, setProvider] = useState(searchParams.get('provider') || 'all');
  const [success, setSuccess] = useState(searchParams.get('success') || 'all');
  const [traceIdSearch, setTraceIdSearch] = useState('');
  const [jobIdSearch, setJobIdSearch] = useState('');

  const fetchTraces = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params = { page: p, limit: LIMIT };
      if (provider !== 'all') params.provider = provider;
      if (success !== 'all') params.success = success;
      if (traceIdSearch) params.traceId = traceIdSearch;
      if (jobIdSearch) params.jobId = jobIdSearch;
      const { data } = await adminApi.get('/admin/traces', { params });
      setTraces(data.traces);
      setTotal(data.total);
      setPage(data.page);
      setPages(data.pages);
    } catch {} finally { setLoading(false); }
  }, [provider, success, traceIdSearch, jobIdSearch]);

  useEffect(() => { fetchTraces(1); }, [fetchTraces]);

  const selectCls = 'text-sm bg-[#1a1a28] border border-white/10 text-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500';
  const inputCls = 'text-sm bg-[#1a1a28] border border-white/10 text-slate-300 rounded-lg px-2.5 py-1.5 w-44 focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder:text-slate-600';

  return (
    <div className="min-h-screen bg-[#0a0a12]">
      <AdminNav
        active="traces"
        right={<button onClick={() => { localStorage.removeItem('adminToken'); navigate('/admin'); }} className="text-sm text-red-400 hover:text-red-300 font-medium">Exit admin</button>}
      />

      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-5">
          <h1 className="text-xl font-bold text-slate-100">Upstream API Logs</h1>
          <p className="text-sm text-slate-500 mt-0.5">{total} captured request(s) — Greenhouse, Lever, Ashby, Adzuna</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-5">
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setSearchParams((p) => {
                const n = new URLSearchParams(p);
                if (e.target.value === 'all') n.delete('provider');
                else n.set('provider', e.target.value);
                return n;
              });
            }}
            className={selectCls}
          >
            <option value="all">All providers</option>
            {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={success} onChange={(e) => setSuccess(e.target.value)} className={selectCls}>
            <option value="all">All outcomes</option>
            <option value="true">Success only</option>
            <option value="false">Failures only</option>
          </select>
          <input value={traceIdSearch} onChange={(e) => setTraceIdSearch(e.target.value)} placeholder="Trace ID" className={inputCls} />
          <input value={jobIdSearch} onChange={(e) => setJobIdSearch(e.target.value)} placeholder="Job ID (internal or upstream)" className={inputCls} />
        </div>

        {loading ? (
          <div className="text-center text-slate-600 py-20">Loading…</div>
        ) : (
          <div className="bg-[#12121c] border border-white/10 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-white/10">
                <tr>
                  {['Time', 'Provider', 'Operation', 'Status', 'Duration', 'Body', 'Jobs', ''].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {traces.map((t) => (
                  <tr key={t.traceId} className="hover:bg-white/[0.03] transition-colors cursor-pointer" onClick={() => navigate(`/admin/traces/${t.traceId}`)}>
                    <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{toIST(t.requestedAt)}</td>
                    <td className="px-4 py-3 text-slate-200 capitalize whitespace-nowrap">{t.provider}</td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{t.operation}{t.boardToken ? ` (${t.boardToken})` : ''}</td>
                    <td className="px-4 py-3">{statusBadge(t.success, t.statusCode)}</td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{t.durationMs}ms</td>
                    <td className="px-4 py-3">{captureBadge(t.bodyCaptureStatus)}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{t.resultingJobIds?.length || 0}</td>
                    <td className="px-4 py-3 text-violet-400 text-xs font-medium whitespace-nowrap">View →</td>
                  </tr>
                ))}
                {traces.length === 0 && (
                  <tr><td colSpan={8} className="text-center text-slate-600 py-10">No traces match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-5">
            <button onClick={() => fetchTraces(page - 1)} disabled={page <= 1} className="text-sm text-slate-400 hover:text-slate-200 disabled:opacity-30">← Prev</button>
            <span className="text-sm text-slate-500">Page {page} of {pages}</span>
            <button onClick={() => fetchTraces(page + 1)} disabled={page >= pages} className="text-sm text-slate-400 hover:text-slate-200 disabled:opacity-30">Next →</button>
          </div>
        )}
      </div>

      {routeTraceId && <TraceDetail traceId={routeTraceId} onClose={() => navigate('/admin/traces')} />}
    </div>
  );
};

export default AdminTraces;
