import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import adminApi from '../services/adminApi';

const scoreColor = (s) =>
  s >= 75 ? 'bg-green-500/10 text-green-400' :
  s >= 50 ? 'bg-yellow-500/10 text-yellow-400' :
  'bg-white/5 text-slate-500';

const barColor = (s, max) => {
  const pct = s / max;
  return pct >= 0.8 ? 'bg-green-400' : pct >= 0.4 ? 'bg-yellow-400' : s === 0 ? 'bg-red-500/60' : 'bg-violet-400';
};

const BreakdownRow = ({ userId, jobId }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.get(`/admin/users/${userId}/jobs/${jobId}/breakdown`)
      .then(r => setData(r.data))
      .catch(() => setData({ error: true }))
      .finally(() => setLoading(false));
  }, [userId, jobId]);

  if (loading) return (
    <tr><td colSpan={9} className="px-6 py-4 bg-white/[0.02] text-xs text-slate-500">Loading breakdown...</td></tr>
  );
  if (!data || data.error) return (
    <tr><td colSpan={9} className="px-6 py-4 bg-white/[0.02] text-xs text-red-400">Failed to load breakdown</td></tr>
  );

  const { breakdown } = data;
  const DIMS = [
    { key: 'role',       label: 'Role',       max: 40 },
    { key: 'skills',     label: 'Skills',     max: 30 },
    { key: 'location',   label: 'Location',   max: 10 },
    { key: 'salary',     label: 'Salary',     max: 5  },
    { key: 'experience', label: 'Experience', max: 15 },
  ];

  return (
    <tr>
      <td colSpan={9} className="px-6 py-4 bg-white/[0.02] border-b border-white/[0.06]">
        <div className="flex flex-col gap-2">
          {breakdown.cap && <p className="text-xs text-orange-400 font-medium mb-1">⚠ {breakdown.cap}</p>}
          {DIMS.map(({ key, label, max }) => {
            const dim = breakdown[key];
            if (!dim) return null;
            const pct = Math.round((dim.score / max) * 100);
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="text-xs font-medium text-slate-500 w-20 shrink-0">{label}</span>
                <div className="flex-1 bg-white/10 rounded-full h-1.5 max-w-[200px]">
                  <div className={`h-1.5 rounded-full ${barColor(dim.score, max)}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs font-semibold text-slate-300 w-12 shrink-0">{dim.score}/{max}</span>
                <span className="text-xs text-slate-500 truncate">{dim.detail}</span>
              </div>
            );
          })}
          {breakdown.skills?.matched?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1 ml-[92px]">
              {breakdown.skills.matched.map(s => (
                <span key={s} className="text-xs bg-violet-500/10 text-violet-400 px-2 py-0.5 rounded-full">{s}</span>
              ))}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
};

const JsonBlock = ({ data }) => (
  <pre className="bg-black/40 border border-white/5 text-green-400 text-xs rounded-lg p-4 overflow-auto max-h-80 leading-relaxed">
    {JSON.stringify(data, null, 2)}
  </pre>
);

const INTERVAL_OPTIONS = [
  { label: 'Every hour', value: 1 },
  { label: 'Every 5 hours', value: 5 },
  { label: 'Daily', value: 24 },
];

const IST_HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${String(i).padStart(2, '0')}:00 IST`,
}));

const AdminUserDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [apiResult, setApiResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState('');
  const [activeTab, setActiveTab] = useState('profile');
  const [schedule, setSchedule] = useState({ emailIntervalHours: 24, emailSendHourIST: 10 });
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleSaved, setScheduleSaved] = useState(false);
  const [expandedJob, setExpandedJob] = useState(null);

  useEffect(() => {
    adminApi.get(`/admin/users/${id}`)
      .then((r) => {
        setDetail(r.data);
        setSchedule({
          emailIntervalHours: r.data.user.emailIntervalHours ?? 24,
          emailSendHourIST:   r.data.user.emailSendHourIST   ?? 10,
        });
      })
      .finally(() => setLoading(false));
  }, [id]);

  const saveSchedule = async () => {
    setScheduleSaving(true);
    try {
      await adminApi.patch(`/admin/users/${id}/email-schedule`, schedule);
      setScheduleSaved(true);
      setTimeout(() => setScheduleSaved(false), 2500);
    } catch {} finally { setScheduleSaving(false); }
  };

  const sendEmail = async () => {
    setSending(true); setSendMsg('');
    try {
      const res = await adminApi.post(`/admin/users/${id}/send-digest`);
      setSendMsg(`✓ ${res.data.message}`);
    } catch (err) {
      setSendMsg(err.response?.data?.message || 'Failed');
    } finally {
      setSending(false);
      setTimeout(() => setSendMsg(''), 4000);
    }
  };

  const runApi = async () => {
    setRunning(true); setActiveTab('api');
    try {
      const res = await adminApi.post(`/admin/users/${id}/run-api`);
      setApiResult(res.data);
    } catch (err) {
      setApiResult({ error: err.response?.data?.message || 'Failed' });
    } finally { setRunning(false); }
  };

  if (loading) return <div className="min-h-screen bg-[#0a0a12] flex items-center justify-center text-slate-500">Loading...</div>;
  if (!detail) return <div className="min-h-screen bg-[#0a0a12] flex items-center justify-center text-slate-500">User not found</div>;

  const { user, jobs } = detail;

  return (
    <div className="min-h-screen bg-[#0a0a12]">
      {/* Top bar */}
      <div className="bg-[#12121c] border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/admin')} className="text-sm text-slate-500 hover:text-slate-200">← Back</button>
          <span className="text-white/20">|</span>
          <span className="text-xl font-bold text-violet-400">JobFind</span>
          <span className="text-xs bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full font-medium">Admin</span>
        </div>
        <div className="flex items-center gap-3">
          {sendMsg && (
            <span className={`text-sm font-medium ${sendMsg.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>
              {sendMsg}
            </span>
          )}
          <button
            onClick={sendEmail}
            disabled={sending}
            className="flex items-center gap-2 bg-green-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors"
          >
            {sending ? <><span className="animate-spin">⟳</span> Sending...</> : <>✉ Send email now</>}
          </button>
          <button
            onClick={runApi}
            disabled={running}
            className="flex items-center gap-2 bg-violet-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-violet-700 disabled:opacity-60 transition-colors"
          >
            {running ? <><span className="animate-spin">⟳</span> Running API...</> : <>⚡ Run API for this user</>}
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* User header */}
        <div className="bg-[#12121c] border border-white/10 rounded-xl p-5 mb-6 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-100">{user.name || 'No name'}</h1>
            <p className="text-sm text-slate-500">{user.email}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <span className={`text-xs px-3 py-1 rounded-full font-medium ${user.isEmailVerified ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
              {user.isEmailVerified ? '✓ Email verified' : '✗ Unverified'}
            </span>
            <span className={`text-xs px-3 py-1 rounded-full font-medium ${user.isOnboarded ? 'bg-blue-500/10 text-blue-400' : 'bg-white/5 text-slate-500'}`}>
              {user.isOnboarded ? '✓ Onboarded' : '✗ Not onboarded'}
            </span>
            {user.isAdmin && <span className="text-xs px-3 py-1 rounded-full font-medium bg-purple-500/10 text-purple-400">Admin</span>}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 bg-white/5 p-1 rounded-lg w-fit">
          {['profile', 'jobs', 'api'].map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-2 text-sm rounded-md capitalize transition-colors font-medium ${
                activeTab === t
                  ? 'bg-[#12121c] border border-white/10 text-slate-100 shadow-sm'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {t === 'jobs' ? `Jobs (${jobs.length})` : t === 'api' ? 'API Test' : 'Profile'}
            </button>
          ))}
        </div>

        {/* Profile tab */}
        {activeTab === 'profile' && (
          <div className="flex flex-col gap-5">
            <div className="bg-[#12121c] border border-white/10 rounded-xl p-6">
              <div className="grid grid-cols-2 gap-6">
                <Field label="Email" value={user.email} />
                <Field label="Name" value={user.name || '—'} />
                <Field label="Experience" value={user.experience === 0 ? 'Fresher' : user.experience != null ? `${user.experience === 10 ? '10+' : user.experience} year${user.experience !== 1 ? 's' : ''}` : '—'} />
                <Field label="Qualification" value={user.qualification || '—'} />
                <Field label="Salary expectation" value={user.salary ? `₹${(user.salary / 100000).toFixed(1)} LPA` : '—'} />
                <Field label="Remote preference" value={user.remotePreference || '—'} />
                <Field label="Joined" value={new Date(user.createdAt).toLocaleString()} />
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Roles</p>
                  <div className="flex flex-wrap gap-2">
                    {user.desiredRoles?.length ? user.desiredRoles.map((r) => (
                      <span key={r} className="bg-purple-500/10 text-purple-400 text-xs px-2.5 py-1 rounded-full">{r}</span>
                    )) : <span className="text-slate-600 text-sm">—</span>}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Skills</p>
                  <div className="flex flex-wrap gap-2">
                    {user.skills?.length ? user.skills.map((s) => (
                      <span key={s} className="bg-blue-500/10 text-blue-400 text-xs px-2.5 py-1 rounded-full">{s}</span>
                    )) : <span className="text-slate-600 text-sm">—</span>}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Preferred locations</p>
                  <div className="flex flex-wrap gap-2">
                    {user.locations?.length ? user.locations.map((l) => (
                      <span key={l} className="bg-white/5 text-slate-400 text-xs px-2.5 py-1 rounded-full">{l}</span>
                    )) : <span className="text-slate-600 text-sm">—</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Email schedule */}
            <div className="bg-[#12121c] border border-white/10 rounded-xl p-6">
              <p className="text-sm font-semibold text-slate-200 mb-1">Email schedule</p>
              <p className="text-xs text-slate-600 mb-4">
                Last sent: {user.lastEmailedAt ? new Date(user.lastEmailedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' : 'Never'}
              </p>
              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-2">Frequency</p>
                  <div className="flex gap-2">
                    {INTERVAL_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setSchedule((s) => ({ ...s, emailIntervalHours: opt.value }))}
                        className={`px-4 py-2 text-sm rounded-lg border font-medium transition-colors ${
                          schedule.emailIntervalHours === opt.value
                            ? 'bg-violet-600 text-white border-violet-600'
                            : 'border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                {schedule.emailIntervalHours === 24 && (
                  <div>
                    <p className="text-xs font-medium text-slate-500 mb-2">Send at (IST)</p>
                    <select
                      value={schedule.emailSendHourIST}
                      onChange={(e) => setSchedule((s) => ({ ...s, emailSendHourIST: Number(e.target.value) }))}
                      className="bg-[#1a1a28] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500"
                    >
                      {IST_HOURS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
                    </select>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <button
                    onClick={saveSchedule}
                    disabled={scheduleSaving}
                    className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-60 transition-colors"
                  >
                    {scheduleSaving ? 'Saving...' : 'Save schedule'}
                  </button>
                  {scheduleSaved && <span className="text-sm text-green-400">Saved</span>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Jobs tab */}
        {activeTab === 'jobs' && (
          <div className="bg-[#12121c] border border-white/10 rounded-xl">
            {jobs.length === 0 ? (
              <div className="text-center py-16 text-slate-600">No jobs matched yet</div>
            ) : (
              <div className="overflow-x-auto rounded-xl">
              <table className="w-full text-sm min-w-[900px]">
                <thead className="border-b border-white/10">
                  <tr>
                    {['Score', 'Title', 'Company', 'Location', 'Salary', 'Emailed', 'Saved', 'Applied', 'Matched at', ''].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((uj, i) => {
                    const jobId = uj.job?._id;
                    const isOpen = expandedJob === jobId;
                    return (
                      <>
                        <tr key={i} className={`border-t border-white/[0.06] transition-colors ${isOpen ? 'bg-white/[0.03]' : 'hover:bg-white/[0.02]'}`}>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-bold px-2 py-1 rounded-full ${scoreColor(uj.score)}`}>{uj.score}%</span>
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-200 max-w-xs truncate">
                            {uj.job?.applyLink
                              ? <a href={uj.job.applyLink} target="_blank" rel="noreferrer" className="hover:text-violet-400 transition-colors">{uj.job.title}</a>
                              : uj.job?.title || '—'
                            }
                          </td>
                          <td className="px-4 py-3 text-slate-400">{uj.job?.company || '—'}</td>
                          <td className="px-4 py-3 text-slate-400 text-xs">{uj.job?.location || '—'}</td>
                          <td className="px-4 py-3 text-slate-400 text-xs">
                            {uj.job?.salaryMin ? `₹${(uj.job.salaryMin / 100000).toFixed(1)}L` : '—'}
                          </td>
                          <td className="px-4 py-3">{uj.emailed ? <span className="text-green-400">✓</span> : <span className="text-white/20">—</span>}</td>
                          <td className="px-4 py-3">{uj.saved ? <span className="text-violet-400">★</span> : <span className="text-white/20">—</span>}</td>
                          <td className="px-4 py-3">{uj.applied ? <span className="text-green-400">✓</span> : <span className="text-white/20">—</span>}</td>
                          <td className="px-4 py-3 text-slate-600 text-xs">{new Date(uj.createdAt).toLocaleDateString()}</td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => setExpandedJob(isOpen ? null : jobId)}
                              className="text-xs text-violet-400 hover:text-violet-300 font-medium whitespace-nowrap"
                            >
                              {isOpen ? '▲ Hide' : '▼ Why?'}
                            </button>
                          </td>
                        </tr>
                        {isOpen && <BreakdownRow userId={id} jobId={jobId} />}
                      </>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
          </div>
        )}

        {/* API Test tab */}
        {activeTab === 'api' && (
          <div className="flex flex-col gap-5">
            {!apiResult && !running && (
              <div className="bg-[#12121c] border border-white/10 rounded-xl p-10 text-center text-slate-600">
                <div className="text-4xl mb-3">⚡</div>
                <p className="font-medium text-slate-400">Click "Run API for this user" above</p>
                <p className="text-sm mt-1">Calls Adzuna live and shows raw request, response, and what this user would receive.</p>
              </div>
            )}

            {running && (
              <div className="bg-[#12121c] border border-white/10 rounded-xl p-10 text-center text-slate-600">
                <div className="text-3xl mb-3 animate-spin">⟳</div>
                <p>Calling Adzuna API...</p>
              </div>
            )}

            {apiResult && !running && (
              <>
                <div className="grid grid-cols-3 gap-4">
                  <StatCard label="Total jobs fetched" value={apiResult.summary?.totalFetched ?? '—'} />
                  <StatCard label="Matched for user" value={apiResult.summary?.totalMatched ?? '—'} color="text-green-400" />
                  <StatCard label="Filtered out" value={apiResult.summary?.totalFiltered ?? '—'} color="text-red-400" />
                </div>

                {apiResult.platforms?.map((platform, pi) => (
                  <div key={pi} className="flex flex-col gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-widest text-slate-500">{platform.platform}</span>
                      {platform.error && <span className="text-xs text-red-400">Error: {platform.error}</span>}
                    </div>

                    {!platform.error && (
                      <>
                        {platform.requests?.length > 0 && (
                          <Section title={`📤 Requests (${platform.requests.length})`} collapsed={platform.requests.length > 5}>
                            <div className="flex flex-col gap-3">
                              {platform.requests.map((req, ri) => (
                                <div key={ri}>
                                  <p className="text-xs text-slate-500 mb-1 font-medium uppercase tracking-wide">Query {ri + 1} — {req.label}</p>
                                  {req.url && (
                                    <div className="mb-1 flex gap-2 text-xs text-slate-500 flex-wrap">
                                      <span className="font-mono bg-white/5 px-2 py-1 rounded">{req.method || 'GET'}</span>
                                      <span className="font-mono bg-white/5 px-2 py-1 rounded break-all">{req.url}</span>
                                    </div>
                                  )}
                                  <JsonBlock data={req.params} />
                                </div>
                              ))}
                            </div>
                          </Section>
                        )}

                        {platform.raw_results && (
                          <Section title={`📥 Raw Response — ${platform.total_fetched} jobs`} collapsed>
                            <JsonBlock data={platform.raw_results} />
                          </Section>
                        )}

                        {platform.boards && (
                          <Section title={`🏢 Sources checked — ${platform.boards.length} companies, ${platform.total_fetched} jobs`} collapsed>
                            <div className="flex flex-wrap gap-2">
                              {platform.boards.map((b, bi) => (
                                <span key={b.board || b.company || bi} className={`text-xs px-2.5 py-1 rounded-full font-medium ${b.error ? 'bg-red-500/10 text-red-400' : 'bg-white/5 text-slate-400'}`}>
                                  {b.board || b.company} {!b.error && `(${b.count})`}
                                </span>
                              ))}
                            </div>
                          </Section>
                        )}

                        <Section title={`✅ Matched (score ≥ 40) — ${platform.matched?.length ?? 0} jobs`}>
                          {platform.matched?.length === 0 ? (
                            <p className="text-sm text-slate-500">No jobs matched this user's profile from this batch.</p>
                          ) : (
                            <div className="flex flex-col gap-3">
                              {platform.matched?.map((item, i) => (
                                <div key={i} className="border border-white/10 rounded-lg p-4 bg-white/[0.02]">
                                  <div className="flex items-start justify-between gap-2 mb-1">
                                    <div>
                                      <p className="font-semibold text-slate-200 text-sm">{item.job.title}</p>
                                      <p className="text-xs text-slate-500">{item.job.company} · {item.job.location}</p>
                                    </div>
                                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${scoreColor(item.score)}`}>
                                      {item.score}% match
                                    </span>
                                  </div>
                                  {item.job.salaryMin && (
                                    <p className="text-xs text-slate-500 mt-1">₹{(item.job.salaryMin / 100000).toFixed(1)}–{(item.job.salaryMax / 100000).toFixed(1)} LPA</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </Section>

                        <Section title={`❌ Filtered out (score < 40) — ${platform.filtered_out?.length ?? 0} jobs`} collapsed>
                          <JsonBlock data={platform.filtered_out?.map(j => ({ score: j.score, title: j.job.title, company: j.job.company }))} />
                        </Section>
                      </>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const Field = ({ label, value }) => (
  <div>
    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</p>
    <p className="text-sm text-slate-200">{value}</p>
  </div>
);

const StatCard = ({ label, value, color = 'text-slate-100' }) => (
  <div className="bg-[#12121c] border border-white/10 rounded-xl p-4 text-center">
    <p className={`text-3xl font-bold ${color}`}>{value}</p>
    <p className="text-xs text-slate-500 mt-1">{label}</p>
  </div>
);

const Section = ({ title, children, collapsed = false }) => {
  const [open, setOpen] = useState(!collapsed);
  return (
    <div className="bg-[#12121c] border border-white/10 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.03] transition-colors"
      >
        <span className="font-semibold text-slate-200 text-sm">{title}</span>
        <span className="text-slate-500 text-sm">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
};

export default AdminUserDetail;
