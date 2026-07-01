import { useState, useRef, useEffect } from 'react';

export const ROLES = [
  'Backend Developer',
  'Frontend Developer',
  'Full Stack Developer',
  'Software Engineer',
  'DevOps Engineer',
  'Data Engineer',
  'Data Scientist',
  'ML Engineer',
  'AI Engineer',
  'Mobile Developer',
  'QA Engineer',
  'Cloud Architect',
  'Cybersecurity',
  'Blockchain Developer',
  'Embedded Engineer',
  'Tech Lead',
  'Engineering Manager',
  'Product Manager',
];

const MAX_ROLES = 3;

const inputCls = 'w-full bg-[#1a1a28] border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition';
const labelCls = 'block text-sm font-medium text-slate-300 mb-1.5';

const RoleSelector = ({ selected, onChange }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  const atMax = selected.length >= MAX_ROLES;

  const suggestions = query.trim()
    ? ROLES.filter(r => r.toLowerCase().includes(query.toLowerCase()) && !selected.includes(r))
    : ROLES.filter(r => !selected.includes(r));

  const add = (role) => {
    if (atMax || selected.includes(role)) return;
    onChange([...selected, role]);
    setQuery('');
    setOpen(false);
  };

  const addCustom = () => {
    const val = query.trim();
    if (!val || atMax || selected.includes(val)) return;
    onChange([...selected, val]);
    setQuery('');
    setOpen(false);
  };

  const remove = (role) => onChange(selected.filter(r => r !== role));

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestions.length === 1) {
        add(suggestions[0]);
      } else if (query.trim() && !ROLES.includes(query.trim())) {
        addCustom();
      } else if (suggestions[0]) {
        add(suggestions[0]);
      }
    }
    if (e.key === 'Escape') setOpen(false);
  };

  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={wrapperRef}>
      <label className={labelCls}>What job titles are you interested in?</label>
      <p className="text-xs text-slate-600 mb-2">Search or type a role - pick up to {MAX_ROLES}</p>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map(role => (
            <span key={role} className="inline-flex items-center gap-1 bg-violet-600/20 text-violet-300 border border-violet-500/30 text-xs font-medium px-2.5 py-1 rounded-full">
              {role}
              <button type="button" onClick={() => remove(role)} className="hover:text-white leading-none ml-0.5">&times;</button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <input
          type="text"
          value={query}
          disabled={atMax}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={atMax ? `Max ${MAX_ROLES} selected` : 'Search or type a role…'}
          className={`${inputCls} ${atMax ? 'opacity-40 cursor-not-allowed' : ''}`}
        />

        {open && !atMax && (
          <div className="absolute z-10 mt-1 w-full bg-[#1a1a28] border border-white/10 rounded-lg shadow-xl max-h-52 overflow-y-auto">
            {suggestions.map(role => (
              <button
                key={role}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); add(role); }}
                className="w-full text-left px-3.5 py-2.5 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
              >
                {role}
              </button>
            ))}
            {query.trim() && !ROLES.map(r => r.toLowerCase()).includes(query.trim().toLowerCase()) && (
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); addCustom(); }}
                className="w-full text-left px-3.5 py-2.5 text-sm text-violet-400 hover:bg-white/5 transition-colors border-t border-white/5"
              >
                Add "{query.trim()}"
              </button>
            )}
            {suggestions.length === 0 && !query.trim() && (
              <p className="px-3.5 py-3 text-xs text-slate-600">All roles selected</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default RoleSelector;
