import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import adminApi from '../services/adminApi';

const scoreColor = (s) => s >= 75 ? 'bg-green-100 text-green-700' : s >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500';

const JsonBlock = ({ data }) => (
  <pre className="bg-gray-900 text-green-400 text-xs rounded-lg p-4 overflow-auto max-h-80 leading-relaxed">
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
  const [activeTab, setActiveTab] = useState('profile');
  const [schedule, setSchedule] = useState({ emailIntervalHours: 24, emailSendHourIST: 10 });
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleSaved, setScheduleSaved] = useState(false);

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
    } catch {}
    finally { setScheduleSaving(false); }
  };

  const runApi = async () => {
    setRunning(true);
    setActiveTab('api');
    try {
      const res = await adminApi.post(`/admin/users/${id}/run-api`);
      setApiResult(res.data);
    } catch (err) {
      setApiResult({ error: err.response?.data?.message || 'Failed' });
    } finally {
      setRunning(false);
    }
  };

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400">Loading...</div>;
  if (!detail) return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400">User not found</div>;

  const { user, jobs } = detail;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/admin')} className="text-sm text-gray-500 hover:text-gray-800">← Back</button>
          <span className="text-gray-300">|</span>
          <span className="text-xl font-bold text-blue-600">JobFind</span>
          <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">Admin</span>
        </div>
        <button
          onClick={runApi}
          disabled={running}
          className="flex items-center gap-2 bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
        >
          {running ? (
            <><span className="animate-spin">⟳</span> Running API...</>
          ) : (
            <>⚡ Run API for this user</>
          )}
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* User header */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">{user.name || 'No name'}</h1>
            <p className="text-sm text-gray-500">{user.email}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <span className={`text-xs px-3 py-1 rounded-full font-medium ${user.isEmailVerified ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
              {user.isEmailVerified ? '✓ Email verified' : '✗ Unverified'}
            </span>
            <span className={`text-xs px-3 py-1 rounded-full font-medium ${user.isOnboarded ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
              {user.isOnboarded ? '✓ Onboarded' : '✗ Not onboarded'}
            </span>
            {user.isAdmin && <span className="text-xs px-3 py-1 rounded-full font-medium bg-purple-100 text-purple-700">Admin</span>}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-lg w-fit">
          {['profile', 'jobs', 'api'].map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-2 text-sm rounded-md capitalize transition-colors font-medium ${activeTab === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {t === 'jobs' ? `Jobs (${jobs.length})` : t === 'api' ? 'API Test' : 'Profile'}
            </button>
          ))}
        </div>

        {/* Profile tab */}
        {activeTab === 'profile' && (
          <div className="flex flex-col gap-5">
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <div className="grid grid-cols-2 gap-6">
                <Field label="Email" value={user.email} />
                <Field label="Name" value={user.name || '—'} />
                <Field label="Experience" value={user.experience != null ? `${user.experience} years` : '—'} />
                <Field label="Salary expectation" value={user.salary ? `₹${(user.salary / 100000).toFixed(1)} LPA` : '—'} />
                <Field label="Remote preference" value={user.remotePreference || '—'} />
                <Field label="Joined" value={new Date(user.createdAt).toLocaleString()} />
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Skills</p>
                  <div className="flex flex-wrap gap-2">
                    {user.skills?.length ? user.skills.map((s) => (
                      <span key={s} className="bg-blue-50 text-blue-700 text-xs px-2.5 py-1 rounded-full">{s}</span>
                    )) : <span className="text-gray-400 text-sm">—</span>}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Preferred locations</p>
                  <div className="flex flex-wrap gap-2">
                    {user.locations?.length ? user.locations.map((l) => (
                      <span key={l} className="bg-gray-100 text-gray-700 text-xs px-2.5 py-1 rounded-full">{l}</span>
                    )) : <span className="text-gray-400 text-sm">—</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Email schedule */}
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <p className="text-sm font-semibold text-gray-900 mb-1">Email digest schedule</p>
              <p className="text-xs text-gray-400 mb-4">
                Last sent: {user.lastEmailedAt ? new Date(user.lastEmailedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' : 'Never'}
              </p>

              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">Frequency</p>
                  <div className="flex gap-2">
                    {INTERVAL_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setSchedule((s) => ({ ...s, emailIntervalHours: opt.value }))}
                        className={`px-4 py-2 text-sm rounded-lg border font-medium transition-colors ${
                          schedule.emailIntervalHours === opt.value
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'border-gray-300 text-gray-600 hover:border-gray-400'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {schedule.emailIntervalHours === 24 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2">Send at (IST)</p>
                    <select
                      value={schedule.emailSendHourIST}
                      onChange={(e) => setSchedule((s) => ({ ...s, emailSendHourIST: Number(e.target.value) }))}
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {IST_HOURS.map((h) => (
                        <option key={h.value} value={h.value}>{h.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <button
                    onClick={saveSchedule}
                    disabled={scheduleSaving}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
                  >
                    {scheduleSaving ? 'Saving...' : 'Save schedule'}
                  </button>
                  {scheduleSaved && <span className="text-sm text-green-600">Saved</span>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Jobs tab */}
        {activeTab === 'jobs' && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {jobs.length === 0 ? (
              <div className="text-center py-16 text-gray-400">No jobs matched yet</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {['Score', 'Title', 'Company', 'Location', 'Salary', 'Emailed', 'Saved', 'Applied', 'Matched at'].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {jobs.map((uj, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-1 rounded-full ${scoreColor(uj.score)}`}>{uj.score}%</span>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">{uj.job?.title || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{uj.job?.company || '—'}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{uj.job?.location || '—'}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {uj.job?.salaryMin ? `₹${(uj.job.salaryMin / 100000).toFixed(1)}L` : '—'}
                      </td>
                      <td className="px-4 py-3">{uj.emailed ? <span className="text-green-600">✓</span> : <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3">{uj.saved ? <span className="text-blue-600">★</span> : <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3">{uj.applied ? <span className="text-green-600">✓</span> : <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{new Date(uj.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* API Test tab */}
        {activeTab === 'api' && (
          <div className="flex flex-col gap-5">
            {!apiResult && !running && (
              <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400">
                <div className="text-4xl mb-3">⚡</div>
                <p className="font-medium text-gray-600">Click "Run API for this user" above</p>
                <p className="text-sm mt-1">It will call Adzuna live and show raw request, raw response, and what this user would receive.</p>
              </div>
            )}

            {running && (
              <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400">
                <div className="text-3xl mb-3 animate-spin">⟳</div>
                <p>Calling Adzuna API...</p>
              </div>
            )}

            {apiResult && !running && (
              <>
                {/* Summary bar */}
                <div className="grid grid-cols-3 gap-4">
                  <StatCard label="Total jobs fetched" value={apiResult.summary?.totalFetched ?? '—'} />
                  <StatCard label="Matched for user" value={apiResult.summary?.totalMatched ?? '—'} color="text-green-600" />
                  <StatCard label="Filtered out" value={apiResult.summary?.totalFiltered ?? '—'} color="text-red-500" />
                </div>

                {/* Per-platform sections */}
                {apiResult.platforms?.map((platform, pi) => (
                  <div key={pi} className="flex flex-col gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-widest text-gray-400">{platform.platform}</span>
                      {platform.error && <span className="text-xs text-red-400">Error: {platform.error}</span>}
                    </div>

                    {!platform.error && (
                      <>
                        {/* Adzuna-specific: show raw request + response */}
                        {platform.request && (
                          <Section title="📤 Request">
                            <div className="mb-2 flex gap-3 text-xs text-gray-500">
                              <span className="font-mono bg-gray-100 px-2 py-1 rounded">{platform.request.method}</span>
                              <span className="font-mono bg-gray-100 px-2 py-1 rounded break-all">{platform.request.url}</span>
                            </div>
                            <JsonBlock data={platform.request.params} />
                          </Section>
                        )}

                        {platform.raw_results && (
                          <Section title={`📥 Raw Response — ${platform.total_fetched} jobs`} collapsed>
                            <JsonBlock data={platform.raw_results} />
                          </Section>
                        )}

                        {/* Greenhouse-specific: show board breakdown */}
                        {platform.boards && (
                          <Section title={`🏢 Boards checked — ${platform.boards.length} companies, ${platform.total_fetched} jobs`} collapsed>
                            <div className="flex flex-wrap gap-2">
                              {platform.boards.map((b) => (
                                <span key={b.board} className={`text-xs px-2.5 py-1 rounded-full font-medium ${b.error ? 'bg-red-50 text-red-400' : 'bg-gray-100 text-gray-600'}`}>
                                  {b.board} {!b.error && `(${b.count})`}
                                </span>
                              ))}
                            </div>
                          </Section>
                        )}

                        {/* Matched jobs */}
                        <Section title={`✅ Matched (score ≥ 40) — ${platform.matched?.length ?? 0} jobs`}>
                          {platform.matched?.length === 0 ? (
                            <p className="text-sm text-gray-400">No jobs matched this user's profile from this batch.</p>
                          ) : (
                            <div className="flex flex-col gap-3">
                              {platform.matched?.map((item, i) => (
                                <div key={i} className="border border-gray-200 rounded-lg p-4">
                                  <div className="flex items-start justify-between gap-2 mb-1">
                                    <div>
                                      <p className="font-semibold text-gray-900 text-sm">{item.job.title}</p>
                                      <p className="text-xs text-gray-500">{item.job.company} · {item.job.location}</p>
                                    </div>
                                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${scoreColor(item.score)}`}>
                                      {item.score}% match
                                    </span>
                                  </div>
                                  {item.job.salaryMin && (
                                    <p className="text-xs text-gray-500 mt-1">₹{(item.job.salaryMin / 100000).toFixed(1)}–{(item.job.salaryMax / 100000).toFixed(1)} LPA</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </Section>

                        {/* Filtered out */}
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
    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</p>
    <p className="text-sm text-gray-900">{value}</p>
  </div>
);

const StatCard = ({ label, value, color = 'text-gray-900' }) => (
  <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
    <p className={`text-3xl font-bold ${color}`}>{value}</p>
    <p className="text-xs text-gray-500 mt-1">{label}</p>
  </div>
);

const Section = ({ title, children, collapsed = false }) => {
  const [open, setOpen] = useState(!collapsed);
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="font-semibold text-gray-900 text-sm">{title}</span>
        <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
};

export default AdminUserDetail;
