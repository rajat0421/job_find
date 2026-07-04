import api from '../services/api';

const scoreBadge = (score) => {
  if (score >= 75) return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200';
  if (score >= 50) return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200';
  return 'bg-slate-100 text-slate-500';
};

const JobCard = ({ job, onSaveToggle, onApplied }) => {
  const handleSave = async () => {
    try {
      const res = await api.patch(`/jobs/${job._id}/save`);
      onSaveToggle?.(job._id, res.data.saved);
    } catch {}
  };

  const handleApply = async () => {
    if (!job.applied) {
      try {
        await api.patch(`/jobs/${job._id}/applied`);
        onApplied?.(job._id);
      } catch {}
    }
    window.open(job.applyLink, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4 hover:border-slate-300 hover:shadow-sm transition-all duration-150">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-900 text-sm leading-snug truncate">{job.title}</h3>
          <p className="text-sm text-slate-500 mt-0.5">{job.company || 'Company not listed'}</p>
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-md shrink-0 ${scoreBadge(job.score)}`}>
          {job.score}%
        </span>
      </div>

      {/* Meta */}
      <div className="flex flex-col gap-1">
        {job.location && (
          <p className="text-xs text-slate-500">{job.location}</p>
        )}
        {job.salaryMin && (
          <p className="text-xs text-slate-500">
            ₹{(job.salaryMin / 100000).toFixed(1)}–{(job.salaryMax / 100000).toFixed(1)} LPA
          </p>
        )}
      </div>

      {/* Why it matched */}
      {job.reasons?.length > 0 && (
        <ul className="flex flex-col gap-1">
          {job.reasons.map((r, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600">
              <span className="text-emerald-500 mt-px">✓</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Description */}
      {job.description && (
        <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">{job.description}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 mt-auto border-t border-slate-100">
        <button
          onClick={handleApply}
          className={`flex-1 text-center text-xs font-semibold py-2 rounded-lg transition-colors ${
            job.applied
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-indigo-600 text-white hover:bg-indigo-700'
          }`}
        >
          {job.applied ? 'Applied — View again' : 'View & Apply'}
        </button>

        <button
          onClick={handleSave}
          className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
            job.saved
              ? 'bg-indigo-50 border-indigo-200 text-indigo-600'
              : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'
          }`}
        >
          {job.saved ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  );
};

export default JobCard;
