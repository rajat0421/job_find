import { useState, useEffect } from 'react';
import api from '../services/api';
import { IconChat, IconThumbUp, IconThumbDown } from './icons';

// Extracted from Dashboard.jsx (pre-launch polish) so the feedback form/list
// has its own page instead of taking up space on the main dashboard, while
// still being a single reusable component — not duplicated — for whichever
// page wants to render it.
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a12]';

const timeAgo = (date) => {
  const secs = Math.floor((Date.now() - new Date(date)) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const FeedbackCard = ({ fb, currentUserId }) => {
  const [likes, setLikes] = useState(fb.likes || []);
  const [dislikes, setDislikes] = useState(fb.dislikes || []);
  const [acting, setActing] = useState(false);

  const liked    = currentUserId && likes.some(id => id.toString() === currentUserId);
  const disliked = currentUserId && dislikes.some(id => id.toString() === currentUserId);

  const handleLike = async () => {
    if (acting) return;
    setActing(true);
    try {
      const r = await api.post(`/feedback/${fb._id}/like`);
      setLikes(r.data.likes);
      setDislikes(r.data.dislikes);
    } catch {}
    finally { setActing(false); }
  };

  const handleDislike = async () => {
    if (acting) return;
    setActing(true);
    try {
      const r = await api.post(`/feedback/${fb._id}/dislike`);
      setLikes(r.data.likes);
      setDislikes(r.data.dislikes);
    } catch {}
    finally { setActing(false); }
  };

  return (
    <div className="border border-white/[0.07] rounded-xl p-3.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-slate-400">
          {fb.name?.split(' ')[0] || 'Anonymous'}
        </span>
        <span className="text-[11px] text-slate-700">{timeAgo(fb.timestamp)}</span>
      </div>

      <p className="text-sm text-slate-300 leading-relaxed break-words">{fb.message}</p>

      <div className="flex items-center gap-4 mt-2.5">
        <button
          onClick={handleLike}
          disabled={acting}
          className={`flex items-center gap-1.5 text-xs transition-colors disabled:opacity-50 rounded ${FOCUS_RING} ${
            liked ? 'text-violet-400' : 'text-slate-600 hover:text-slate-400'
          }`}
        >
          <IconThumbUp className="w-3.5 h-3.5" />
          {likes.length > 0 && <span>{likes.length}</span>}
        </button>
        <button
          onClick={handleDislike}
          disabled={acting}
          className={`flex items-center gap-1.5 text-xs transition-colors disabled:opacity-50 rounded ${FOCUS_RING} ${
            disliked ? 'text-red-400' : 'text-slate-600 hover:text-slate-400'
          }`}
        >
          <IconThumbDown className="w-3.5 h-3.5" />
          {dislikes.length > 0 && <span>{dislikes.length}</span>}
        </button>
      </div>
    </div>
  );
};

const FEEDBACK_PAGE = 6;

const FeedbackSection = ({ currentUserId }) => {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [feedbacks, setFeedbacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(FEEDBACK_PAGE);

  useEffect(() => {
    api.get('/feedback')
      .then(r => setFeedbacks(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await api.post('/feedback', { message: message.trim() });
      setMessage('');
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 5000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send feedback');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-[#12121c]/70 border border-white/[0.07] rounded-2xl p-6 mb-4">
      <div className="flex items-center gap-1.5 mb-1">
        <IconChat className="w-3.5 h-3.5 text-slate-500" />
        <p className="text-xs font-medium text-slate-500">Feedback</p>
      </div>
      <p className="text-xs text-slate-600 mb-5">Your feedback helps us improve JobFind for everyone.</p>

      {/* Submit form */}
      <form onSubmit={handleSubmit} className="mb-6">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What's working? What should we improve? Anything you'd like to see?"
          maxLength={500}
          rows={3}
          className="w-full bg-[#1a1a28] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition resize-none"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-slate-700">{message.length}/500</span>
          <button
            type="submit"
            disabled={submitting || !message.trim()}
            className={`bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50 ${FOCUS_RING}`}
          >
            {submitting ? 'Sending...' : 'Send feedback'}
          </button>
        </div>
        {submitted && <p className="text-xs text-emerald-400 mt-2">Thanks! Your feedback is pending review and will appear here once approved.</p>}
        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      </form>

      {/* Feedback list */}
      <div>
        <p className="text-[11px] text-slate-600 font-medium mb-3">What users are saying</p>
        {loading ? (
          <p className="text-sm text-slate-700 py-4">Loading...</p>
        ) : feedbacks.length === 0 ? (
          <p className="text-sm text-slate-700 text-center py-6">No feedback yet. Be the first to share!</p>
        ) : (
          <>
            <div className="columns-1 sm:columns-2 gap-3">
              {feedbacks.slice(0, visible).map((fb) => (
                <div key={fb._id} className="break-inside-avoid mb-3">
                  <FeedbackCard fb={fb} currentUserId={currentUserId} />
                </div>
              ))}
            </div>
            {visible < feedbacks.length && (
              <button
                onClick={() => setVisible(v => v + FEEDBACK_PAGE)}
                className={`w-full mt-1 text-xs text-slate-600 hover:text-slate-400 py-2 transition-colors rounded ${FOCUS_RING}`}
              >
                Show more ({feedbacks.length - visible} remaining)
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default FeedbackSection;
