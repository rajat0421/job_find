import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import adminApi from '../services/adminApi';

const toIST = (iso) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }) + ' IST';

const TABS = ['pending', 'approved', 'declined'];

const NavBtn = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`text-sm px-3 py-1.5 rounded-lg transition-colors font-medium ${
      active ? 'text-violet-400 bg-violet-500/10' : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
    }`}
  >
    {children}
  </button>
);

const AdminFeedback = () => {
  const navigate = useNavigate();
  const [feedbacks, setFeedbacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pending');
  const [acting, setActing] = useState({});

  const fetchFeedbacks = (status) => {
    setLoading(true);
    adminApi.get(`/admin/feedback?status=${status}`)
      .then(r => setFeedbacks(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchFeedbacks(tab); }, [tab]);

  const act = async (id, action) => {
    setActing(a => ({ ...a, [id]: action }));
    try {
      if (action === 'delete') {
        await adminApi.delete(`/admin/feedback/${id}`);
      } else {
        await adminApi.patch(`/admin/feedback/${id}/${action}`);
      }
      setFeedbacks(prev => prev.filter(fb => fb._id !== id));
    } catch (e) {
      alert(e.response?.data?.message || 'Action failed');
    } finally {
      setActing(a => ({ ...a, [id]: null }));
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a12]">
      <div className="bg-[#12121c] border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-xl font-bold text-violet-400">JobFind</span>
          <span className="text-xs bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full font-medium">Admin</span>
          <nav className="flex items-center gap-1 ml-4">
            <NavBtn onClick={() => navigate('/admin')}>Users</NavBtn>
            <NavBtn onClick={() => navigate('/admin/logs')}>API Logs</NavBtn>
            <NavBtn onClick={() => navigate('/admin/email-logs')}>Email Logs</NavBtn>
            <NavBtn active>Feedback</NavBtn>
          </nav>
        </div>
        <button
          onClick={() => { localStorage.removeItem('adminToken'); window.location.href = '/admin'; }}
          className="text-sm text-red-400 hover:text-red-300 font-medium"
        >
          Exit admin
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-100">User Feedback</h1>
          <p className="text-sm text-slate-500 mt-0.5">Review pending submissions before they go public.</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 bg-white/5 p-1 rounded-lg w-fit">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${
                tab === t ? 'bg-[#12121c] text-slate-100 shadow-sm border border-white/10' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center text-slate-600 py-20">Loading...</div>
        ) : feedbacks.length === 0 ? (
          <div className="text-center text-slate-600 py-20">No {tab} feedback.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {feedbacks.map(fb => (
              <div key={fb._id} className="bg-[#12121c] border border-white/10 rounded-xl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-sm font-semibold text-slate-200">{fb.name || 'Anonymous'}</span>
                      <span className="text-xs text-slate-600">{toIST(fb.timestamp)}</span>
                      {(fb.likes?.length > 0 || fb.dislikes?.length > 0) && (
                        <span className="text-xs text-slate-600">
                          · ♥ {fb.likes?.length || 0} &nbsp; 👎 {fb.dislikes?.length || 0}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed">{fb.message}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {tab === 'pending' && (
                      <>
                        <button
                          onClick={() => act(fb._id, 'approve')}
                          disabled={!!acting[fb._id]}
                          className="text-xs bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-40"
                        >
                          {acting[fb._id] === 'approve' ? '...' : 'Approve'}
                        </button>
                        <button
                          onClick={() => act(fb._id, 'decline')}
                          disabled={!!acting[fb._id]}
                          className="text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-40"
                        >
                          {acting[fb._id] === 'decline' ? '...' : 'Decline'}
                        </button>
                      </>
                    )}
                    {tab === 'approved' && (
                      <button
                        onClick={() => act(fb._id, 'decline')}
                        disabled={!!acting[fb._id]}
                        className="text-xs text-slate-500 hover:text-red-400 font-medium transition-colors disabled:opacity-40"
                      >
                        {acting[fb._id] ? '...' : 'Revoke'}
                      </button>
                    )}
                    {tab === 'declined' && (
                      <>
                        <button
                          onClick={() => act(fb._id, 'approve')}
                          disabled={!!acting[fb._id]}
                          className="text-xs text-slate-500 hover:text-emerald-400 font-medium transition-colors disabled:opacity-40"
                        >
                          {acting[fb._id] === 'approve' ? '...' : 'Approve'}
                        </button>
                        <button
                          onClick={() => act(fb._id, 'delete')}
                          disabled={!!acting[fb._id]}
                          className="text-xs text-red-500 hover:text-red-400 font-medium transition-colors disabled:opacity-40"
                        >
                          {acting[fb._id] === 'delete' ? '...' : 'Delete'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminFeedback;
