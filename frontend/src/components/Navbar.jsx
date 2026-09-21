import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const navLinkCls = ({ isActive }) =>
  `text-sm font-medium transition-colors ${isActive ? 'text-white' : 'text-slate-400 hover:text-white'}`;

const Navbar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <header className="bg-[#0a0a12] border-b border-white/[0.07] sticky top-0 z-10">
      <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link to="/dashboard" className="font-bold text-white tracking-tight text-base">
          Job<span className="text-violet-400">Find</span>
        </Link>

        <nav className="flex items-center gap-5">
          <NavLink to="/dashboard" className={navLinkCls}>
            Home
          </NavLink>
          <NavLink to="/profile" className={navLinkCls}>
            Profile
          </NavLink>
          <NavLink to="/resume" className={navLinkCls}>
            Resume
          </NavLink>
          <div className="h-3.5 w-px bg-white/10" />
          <span className="text-sm text-slate-600 hidden sm:block">{user?.name || user?.email}</span>
          <button
            onClick={handleLogout}
            className="text-sm text-slate-400 hover:text-white transition-colors"
          >
            Sign out
          </button>
        </nav>
      </div>
    </header>
  );
};

export default Navbar;
