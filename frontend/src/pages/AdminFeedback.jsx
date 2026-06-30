import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import adminApi from '../services/adminApi';

const toIST = (iso) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }) + ' IST';

const AdminFeedback = () => {
  const navigate = useNavigate();
  const [feedbacks, setFeedbacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [deleting, setDeleting] = useState({});

  useEffect(() => {
    adminApi.get('/admin/feedback')
      .then(r => setFeedbacks(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleDeleteFeedback = async (id) => {
    if (!window.confirm('Delete this feedback and all its replies?')) return;
    setDeleting(d => ({ ...d, [id]: true }));
    try {
      await adminApi.delete(`/admin/feedback/${id}`);
      setFeedbacks(prev => prev.filter(fb => fb._id !== id));
    } catch (e) {
      alert(e.response?.data?.message || 'Delete failed');
    } finally {
      setDeleting(d => ({ ...d, [id]: false }));
    }
  };

  const handleDeleteReply = async (feedbackId, replyId) => {
    if (!window.confirm('Delete this reply?')) return;
    const key = `${feedbackId}-${replyId}`;
    setDeleting(d => ({ ...d, [key]: true }));
    try {
      await adminApi.delete(`/admin/feedback/${feedbackId}/reply/${replyId}`);
      setFeedbacks(prev => prev.map(fb =>
        fb._id === feedbackId
          ? { ...fb, replies: fb.replies.filter(r => r._id !== replyId) }
          : fb
      ));
    } catch (e) {
      alert(e.response?.data?.message || 'Delete failed');
    } finally {
      setDeleting(d => ({ ...d, [key]: false }));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-xl font-bold text-blue-600">JobFind</span>
          <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">Admin</span>
          <nav className="flex items-center gap-1 ml-4">
            <button
              onClick={() => navigate('/admin')}
              className="text-sm text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Users
            </button>
            <button
              onClick={() => navigate('/admin/logs')}
              className="text-sm text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              API Logs
            </button>
            <button className="text-sm font-semibold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg">
              Feedback
            </button>
          </nav>
        </div>
        <button
          onClick={() => { localStorage.removeItem('adminToken'); window.location.href = '/admin'; }}
          className="text-sm text-red-500 hover:text-red-700"
        >
          Exit admin
        </button>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">User Feedback</h1>
          <p className="text-sm text-gray-500 mt-0.5">{feedbacks.length} entries · Delete spam or inappropriate content</p>
        </div>

        {loading ? (
          <div className="text-center text-gray-400 py-20">Loading...</div>
        ) : feedbacks.length === 0 ? (
          <div className="text-center text-gray-400 py-20">No feedback yet.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {feedbacks.map((fb) => (
              <div key={fb._id} className="bg-white border border-gray-200 rounded-xl p-5">
                {/* Feedback header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm font-medium text-gray-800">{fb.name || 'Anonymous'}</span>
                      <span className="text-xs text-gray-400">{toIST(fb.timestamp)}</span>
                      {fb.likes?.length > 0 && (
                        <span className="text-xs text-gray-400">· ♥ {fb.likes.length}</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed">{fb.message}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {fb.replies?.length > 0 && (
                      <button
                        onClick={() => setExpanded(e => ({ ...e, [fb._id]: !e[fb._id] }))}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        {expanded[fb._id] ? 'Hide' : `${fb.replies.length} repl${fb.replies.length === 1 ? 'y' : 'ies'}`}
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteFeedback(fb._id)}
                      disabled={deleting[fb._id]}
                      className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors disabled:opacity-40"
                    >
                      {deleting[fb._id] ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>

                {/* Replies */}
                {expanded[fb._id] && fb.replies?.length > 0 && (
                  <div className="mt-4 pl-4 border-l-2 border-gray-100 flex flex-col gap-3">
                    {fb.replies.map((reply) => {
                      const key = `${fb._id}-${reply._id}`;
                      return (
                        <div key={reply._id} className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-xs font-medium text-gray-600">{reply.name || 'Anonymous'}</span>
                              <span className="text-xs text-gray-400">{toIST(reply.timestamp)}</span>
                            </div>
                            <p className="text-xs text-gray-600 leading-relaxed">{reply.message}</p>
                          </div>
                          <button
                            onClick={() => handleDeleteReply(fb._id, reply._id)}
                            disabled={deleting[key]}
                            className="text-xs text-red-400 hover:text-red-600 font-medium transition-colors disabled:opacity-40 shrink-0"
                          >
                            {deleting[key] ? '...' : 'Delete'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminFeedback;
