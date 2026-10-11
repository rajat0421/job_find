import { useNavigate } from 'react-router-dom';

// Single source of truth for the admin portal's top nav — previously each of
// 8 admin pages hardcoded its own copy of this bar with a slightly different
// (and drifted) set of links. "Upstream Logs" here is the new upstream
// provider request/response debugger (Phase 3) — deliberately a different
// label from the pre-existing "API Logs" (application/user-activity log,
// RequestLog-backed) so the two are never confused with each other.
const NAV_ITEMS = [
  { key: 'overview', label: 'Overview', path: '/admin/overview' },
  { key: 'users', label: 'Users', path: '/admin' },
  { key: 'jobs', label: 'Jobs', path: '/admin/jobs' },
  { key: 'companies', label: 'Companies', path: '/admin/companies' },
  { key: 'traces', label: 'Upstream Logs', path: '/admin/traces' },
  { key: 'logs', label: 'API Logs', path: '/admin/logs' },
  { key: 'emailLogs', label: 'Email Logs', path: '/admin/email-logs' },
  { key: 'feedback', label: 'Feedback', path: '/admin/feedback' },
  { key: 'analytics', label: 'Analytics', path: '/admin/analytics' },
];

const NavBtn = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`text-sm px-3 py-1.5 rounded-lg transition-colors font-medium whitespace-nowrap ${
      active ? 'text-violet-400 bg-violet-500/10' : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
    }`}
  >
    {children}
  </button>
);

// `active` is one of NAV_ITEMS' `key`s. `right` is optional page-specific
// content (action buttons, etc.) rendered on the right side of the header bar.
const AdminNav = ({ active, right }) => {
  const navigate = useNavigate();

  return (
    <div className="bg-[#12121c] border-b border-white/10 px-6 py-4 flex items-center justify-between flex-wrap gap-3">
      <div className="flex items-center gap-4 flex-wrap">
        <span className="text-xl font-bold text-violet-400">JobFind</span>
        <span className="text-xs bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full font-medium">Admin</span>
        <nav className="flex items-center gap-1 ml-4 flex-wrap">
          {NAV_ITEMS.map((item) => (
            <NavBtn key={item.key} active={active === item.key} onClick={active === item.key ? undefined : () => navigate(item.path)}>
              {item.label}
            </NavBtn>
          ))}
        </nav>
      </div>
      {right && <div className="flex items-center gap-3 flex-wrap">{right}</div>}
    </div>
  );
};

export default AdminNav;
