import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { FOCUS_RING, PageContainer } from './ui';

const navLinkCls = ({ isActive }) =>
  `text-sm font-medium transition-colors rounded ${FOCUS_RING} ${isActive ? 'text-white' : 'text-slate-400 hover:text-white'}`;

const Navbar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <header className="bg-surface/90 backdrop-blur border-b border-white/[0.07] sticky top-0 z-10">
      <PageContainer className="h-14 flex items-center justify-between gap-3">
        <Link to="/dashboard" className={`shrink-0 font-bold text-white tracking-tight text-base rounded ${FOCUS_RING}`}>
          Job<span className="text-violet-400">Find</span>
        </Link>

        <nav className="flex items-center gap-3 sm:gap-5 min-w-0">
          <NavLink to="/dashboard" className={navLinkCls}>
            Home
          </NavLink>
          <NavLink to="/profile" className={navLinkCls}>
            Profile
          </NavLink>
          <NavLink to="/resume" className={navLinkCls}>
            Resume
          </NavLink>
          <div className="h-3.5 w-px bg-white/10 shrink-0" />
          <span className="text-sm text-slate-600 hidden md:block truncate max-w-[160px]">{user?.name || user?.email}</span>
          <button
            onClick={handleLogout}
            className={`shrink-0 text-sm text-slate-400 hover:text-white transition-colors rounded ${FOCUS_RING}`}
          >
            Sign out
          </button>
        </nav>
      </PageContainer>
    </header>
  );
};

export default Navbar;
