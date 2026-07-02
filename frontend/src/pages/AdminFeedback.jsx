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

  const counts = { pending: 0, approved: 0, declined: 0 };
  if (tab === 'pending')  counts.pending  = feedbacks.length;
  if (tab === 'approved') counts.approved = feedbacks.length;
  if (tab === 'declined') counts.declined = feedbacks.length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-xl font-bold text-blue-600">JobFind</span>
          <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">Admin</span>
          <nav className="flex items-center gap-1 ml-4">
            <button onClick={() => navigate('/admin')} className="text-sm text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">Users</button>
            <button onClick={() => navigate('/admin/logs')} className="text-sm text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">API Logs</button>
            <button onClick={() => navigate('/admin/email-logs')} className="text-sm text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">Email Logs</button>
            <button className="text-sm font-semibold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg">Feedback</button>
          </nav>
        </div>
        <button
          onClick={() => { localStorage.removeItem('adminToken'); window.location.href = '/admin'; }}
          className="text-sm text-red-500 hover:text-red-700"
        >
          Exit admin
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">User Feedback</h1>
          <p className="text-sm text-gray-500 mt-0.5">Review pending submissions before they go public.</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-lg w-fit">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${
                tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div className="text-center text-gray-400 py-20">Loading...</div>
        ) : feedbacks.length === 0 ? (
          <div className="text-center text-gray-400 py-20">No {tab} feedback.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {feedbacks.map(fb => (
              <div key={fb._id} className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-sm font-semibold text-gray-800">{fb.name || 'Anonymous'}</span>
                      <span className="text-xs text-gray-400">{toIST(fb.timestamp)}</span>
                      {(fb.likes?.length > 0 || fb.dislikes?.length > 0) && (
                        <span className="text-xs text-gray-400">
                          · ♥ {fb.likes?.length || 0} &nbsp; 👎 {fb.dislikes?.length || 0}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed">{fb.message}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {tab === 'pending' && (
                      <>
                        <button
                          onClick={() => act(fb._id, 'approve')}
                          disabled={!!acting[fb._id]}
                          className="text-xs bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-40"
                        >
                          {acting[fb._id] === 'approve' ? '...' : 'Approve'}
                        </button>
                        <button
                          onClick={() => act(fb._id, 'decline')}
                          disabled={!!acting[fb._id]}
                          className="text-xs bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-40"
                        >
                          {acting[fb._id] === 'decline' ? '...' : 'Decline'}
                        </button>
                      </>
                    )}
                    {tab === 'approved' && (
                      <button
                        onClick={() => act(fb._id, 'decline')}
                        disabled={!!acting[fb._id]}
                        className="text-xs text-gray-400 hover:text-red-500 font-medium transition-colors disabled:opacity-40"
                      >
                        {acting[fb._id] ? '...' : 'Revoke'}
                      </button>
                    )}
                    {tab === 'declined' && (
                      <>
                        <button
                          onClick={() => act(fb._id, 'approve')}
                          disabled={!!acting[fb._id]}
                          className="text-xs text-gray-400 hover:text-emerald-600 font-medium transition-colors disabled:opacity-40"
                        >
                          {acting[fb._id] === 'approve' ? '...' : 'Approve'}
                        </button>
                        <button
                          onClick={() => act(fb._id, 'delete')}
                          disabled={!!acting[fb._id]}
                          className="text-xs text-red-400 hover:text-red-600 font-medium transition-colors disabled:opacity-40"
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
