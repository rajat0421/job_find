import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import FeedbackSection from '../components/FeedbackSection';
import api from '../services/api';
import { PageContainer, FOCUS_RING } from '../components/ui';

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
    <div className="min-h-screen bg-surface">
      <Navbar />

      <PageContainer className="py-10 sm:py-12">
        {/* Same centering fix as Profile.jsx — this inner max-width needs its
            own mx-auto or it sits flush-left inside PageContainer. */}
        <div className="max-w-2xl mx-auto">
          <Link
            to="/dashboard"
            className={`inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors mb-5 rounded ${FOCUS_RING}`}
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
      </PageContainer>
    </div>
  );
};

export default Feedback;
