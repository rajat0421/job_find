import { useState, useRef, useEffect } from 'react';

const SKILLS = [
  // Languages
  'JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Rust', 'Ruby', 'PHP', 'Swift', 'Kotlin', 'C', 'C++', 'C#', 'Scala', 'R',
  // Frontend
  'React', 'Next.js', 'Vue.js', 'Nuxt.js', 'Angular', 'Svelte', 'HTML', 'CSS', 'Tailwind CSS', 'SASS', 'Redux', 'Zustand', 'Webpack', 'Vite',
  // Backend
  'Node.js', 'Express.js', 'NestJS', 'Django', 'FastAPI', 'Flask', 'Spring Boot', 'Laravel', 'Ruby on Rails', 'GraphQL', 'REST API', 'gRPC',
  // Mobile
  'React Native', 'Flutter', 'Android', 'iOS', 'Expo',
  // Database
  'MongoDB', 'PostgreSQL', 'MySQL', 'SQLite', 'Redis', 'Elasticsearch', 'DynamoDB', 'Cassandra', 'Supabase', 'Firebase', 'Prisma', 'Mongoose',
  // Cloud & DevOps
  'AWS', 'GCP', 'Azure', 'Docker', 'Kubernetes', 'Terraform', 'CI/CD', 'GitHub Actions', 'Jenkins', 'Linux', 'Nginx',
  // Other
  'Git', 'GraphQL', 'WebSockets', 'Microservices', 'System Design', 'Data Structures', 'Machine Learning', 'TensorFlow', 'PyTorch', 'OpenAI API',
];

const SkillTagInput = ({ label, tags, onChange }) => {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [focused, setFocused] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const q = input.trim().toLowerCase();
    if (!q) { setSuggestions([]); return; }

    const matches = SKILLS.filter(
      s => s.toLowerCase().includes(q) && !tags.includes(s)
    ).slice(0, 7);
    setSuggestions(matches);
    setHighlighted(-1);
  }, [input, tags]);

  const add = (skill) => {
    const val = skill.trim();
    if (!val || tags.includes(val)) return;
    onChange([...tags, val]);
    setInput('');
    setSuggestions([]);
    inputRef.current?.focus();
  };

  const remove = (tag) => onChange(tags.filter(t => t !== tag));

  const handleKeyDown = (e) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, suggestions.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted(h => Math.max(h - 1, -1)); return; }
      if (e.key === 'Enter' && highlighted >= 0) { e.preventDefault(); add(suggestions[highlighted]); return; }
    }
    if (e.key === 'Enter') { e.preventDefault(); if (input.trim()) add(input); }
    if (e.key === 'Escape') setSuggestions([]);
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (!dropdownRef.current?.contains(e.target) && e.target !== inputRef.current) {
        setSuggestions([]);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      <p className="text-xs text-slate-400 mb-2">Type to search from suggestions, or press Enter to add a custom skill</p>

      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
          placeholder="e.g. Node.js, React, Python..."
          autoComplete="off"
        />

        {/* Dropdown */}
        {suggestions.length > 0 && (
          <ul
            ref={dropdownRef}
            className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-md overflow-hidden"
          >
            {suggestions.map((s, i) => (
              <li key={s}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); add(s); }}
                  className={`w-full text-left px-3.5 py-2.5 text-sm transition-colors ${
                    i === highlighted
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {s}
                  {/* Highlight matching part */}
                </button>
              </li>
            ))}
            {input.trim() && !SKILLS.some(s => s.toLowerCase() === input.trim().toLowerCase()) && (
              <li>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); add(input.trim()); }}
                  className="w-full text-left px-3.5 py-2.5 text-sm text-slate-400 hover:bg-slate-50 border-t border-slate-100 transition-colors"
                >
                  Add "<span className="text-slate-600 font-medium">{input.trim()}</span>"
                </button>
              </li>
            )}
          </ul>
        )}
      </div>

      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {tags.map(tag => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs font-medium px-2.5 py-1 rounded-md"
            >
              {tag}
              <button
                type="button"
                onClick={() => remove(tag)}
                className="hover:text-indigo-900 leading-none ml-0.5"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default SkillTagInput;
