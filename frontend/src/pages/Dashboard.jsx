import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import JobCard from '../components/JobCard';
import api from '../services/api';

const FILTERS = [
  { label: 'All matches', value: 40 },
  { label: 'Good (60%+)', value: 60 },
  { label: 'Strong (75%+)', value: 75 },
];

const SkeletonCard = () => (
  <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4 animate-pulse">
    <div className="flex justify-between gap-3">
      <div className="flex-1">
        <div className="h-4 bg-slate-100 rounded w-3/4 mb-2" />
        <div className="h-3 bg-slate-100 rounded w-1/2" />
      </div>
      <div className="h-5 w-10 bg-slate-100 rounded-md shrink-0" />
    </div>
    <div className="h-3 bg-slate-100 rounded w-2/3" />
    <div className="h-3 bg-slate-100 rounded w-full" />
    <div className="h-3 bg-slate-100 rounded w-4/5" />
    <div className="flex gap-2 pt-1 border-t border-slate-100 mt-auto">
      <div className="flex-1 h-8 bg-slate-100 rounded-lg" />
      <div className="w-14 h-8 bg-slate-100 rounded-lg" />
      <div className="w-16 h-8 bg-slate-100 rounded-lg" />
    </div>
  </div>
);

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

  const handleSaveToggle = (jobId, saved) =>
    setJobs(prev => prev.map(j => j._id === jobId ? { ...j, saved } : j));

  const handleApplied = (jobId) =>
    setJobs(prev => prev.map(j => j._id === jobId ? { ...j, applied: true } : j));

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">

        {/* Page header */}
        <div className="flex items-end justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              {user?.name ? `${user.name}'s jobs` : 'Matched jobs'}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {loading ? 'Loading...' : total > 0 ? `${total} jobs matched your profile` : 'No jobs matched yet — check back soon'}
            </p>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 bg-white border border-slate-200 rounded-lg p-1">
            {FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => { setMinScore(f.value); setPage(1); }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  minScore === f.value
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : jobs.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl py-20 text-center">
            <p className="text-slate-400 text-sm font-medium">No jobs found</p>
            <p className="text-slate-400 text-xs mt-1">Jobs are fetched every hour. Check back soon.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {jobs.map(job => (
              <JobCard
                key={job._id}
                job={job}
                onSaveToggle={handleSaveToggle}
                onApplied={handleApplied}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex justify-center items-center gap-3 mt-8">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50 transition-colors"
            >
              Previous
            </button>
            <span className="text-sm text-slate-500">Page {page} of {pages}</span>
            <button
              onClick={() => setPage(p => Math.min(pages, p + 1))}
              disabled={page === pages}
              className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50 transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
