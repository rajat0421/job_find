import api from '../services/api';

const scoreColor = (score) => {
  if (score >= 75) return 'bg-green-100 text-green-700';
  if (score >= 50) return 'bg-yellow-100 text-yellow-700';
  return 'bg-gray-100 text-gray-600';
};

const JobCard = ({ job, onSaveToggle, onApplied }) => {
  const handleSave = async () => {
    try {
      const res = await api.patch(`/jobs/${job._id}/save`);
      onSaveToggle?.(job._id, res.data.saved);
    } catch {}
  };

  const handleApplied = async () => {
    try {
      await api.patch(`/jobs/${job._id}/applied`);
      onApplied?.(job._id);
    } catch {}
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-gray-900 text-base leading-tight">{job.title}</h3>
          <p className="text-sm text-gray-500 mt-0.5">{job.company || '—'}</p>
        </div>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${scoreColor(job.score)}`}>
          {job.score}% match
        </span>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-gray-500">
        {job.location && (
          <span className="flex items-center gap-1">📍 {job.location}</span>
        )}
        {job.salaryMin && (
          <span className="flex items-center gap-1">
            💰 ₹{(job.salaryMin / 100000).toFixed(1)}–{(job.salaryMax / 100000).toFixed(1)} LPA
          </span>
        )}
        {job.source && (
          <span className="flex items-center gap-1 capitalize">🔗 {job.source}</span>
        )}
      </div>

      {job.description && (
        <p className="text-xs text-gray-500 line-clamp-2">{job.description}</p>
      )}

      <div className="flex items-center gap-2 mt-auto pt-2 border-t border-gray-100">
        <a
          href={job.applyLink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 text-center text-sm bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Apply Now
        </a>
        <button
          onClick={handleSave}
          className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
            job.saved
              ? 'bg-blue-50 border-blue-200 text-blue-600'
              : 'border-gray-200 text-gray-500 hover:border-gray-300'
          }`}
        >
          {job.saved ? '★ Saved' : '☆ Save'}
        </button>
        {!job.applied && (
          <button
            onClick={handleApplied}
            className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-500 hover:border-gray-300 transition-colors"
          >
            ✓
          </button>
        )}
        {job.applied && (
          <span className="px-3 py-2 text-sm text-green-600">✓ Applied</span>
        )}
      </div>
    </div>
  );
};

export default JobCard;
