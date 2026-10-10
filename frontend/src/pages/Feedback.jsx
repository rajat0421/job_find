import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import FeedbackSection from '../components/FeedbackSection';
import api from '../services/api';

const Feedback = () => {
  // Only needed to highlight the current user's own like/dislike on each
  // card — AuthContext's `user` doesn't carry `_id` (see login() call sites),
  // so this mirrors Dashboard.jsx's existing pattern of fetching the profile
  // once to get it.
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    api.get('/user/profile').then(r => setProfile(r.data)).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a12]">
      <Navbar />

      <div className="max-w-2xl mx-auto px-4 py-10 sm:py-14">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors mb-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a12] rounded"
        >
          ← Back to dashboard
        </Link>

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white mb-2">Feedback</h1>
          <p className="text-sm text-slate-500">
            Tell us what's working and what should improve — your feedback helps shape JobFind.
          </p>
        </div>

        <FeedbackSection currentUserId={profile?._id} />
      </div>
    </div>
  );
};

export default Feedback;
