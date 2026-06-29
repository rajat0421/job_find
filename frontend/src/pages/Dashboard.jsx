import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import JobCard from '../components/JobCard';
import api from '../services/api';

const Dashboard = () => {
  const { user } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [minScore, setMinScore] = useState(40);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/jobs', { params: { page, minScore } });
      setJobs(res.data.jobs);
      setPages(res.data.pages);
      setTotal(res.data.total);
    } catch {}
    finally { setLoading(false); }
  }, [page, minScore]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const handleSaveToggle = (jobId, saved) => {
    setJobs((prev) => prev.map((j) => j._id === jobId ? { ...j, saved } : j));
  };

  const handleApplied = (jobId) => {
    setJobs((prev) => prev.map((j) => j._id === jobId ? { ...j, applied: true } : j));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              Good morning, {user?.name || 'there'} 👋
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {total > 0 ? `${total} jobs matched your profile` : 'No jobs matched yet — check back soon'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Min match:</span>
            {[40, 60, 75].map((s) => (
              <button
                key={s}
                onClick={() => { setMinScore(s); setPage(1); }}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  minScore === s
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border border-gray-300 text-gray-600 hover:border-gray-400'
                }`}
              >
                {s}%+
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-5 h-48 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-1/2 mb-4" />
                <div className="h-3 bg-gray-100 rounded w-full mb-2" />
                <div className="h-3 bg-gray-100 rounded w-5/6" />
              </div>
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <div className="text-5xl mb-4">🔍</div>
            <p className="text-lg font-medium text-gray-600">No jobs found yet</p>
            <p className="text-sm mt-1">Jobs are fetched every hour. Come back soon!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {jobs.map((job) => (
              <JobCard
                key={job._id}
                job={job}
                onSaveToggle={handleSaveToggle}
                onApplied={handleApplied}
              />
            ))}
          </div>
        )}

        {pages > 1 && (
          <div className="flex justify-center items-center gap-2 mt-8">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
            >
              ← Prev
            </button>
            <span className="text-sm text-gray-600">Page {page} of {pages}</span>
            <button
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page === pages}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
