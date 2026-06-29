import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Navbar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const handleLogout = () => { logout(); navigate('/login'); };

  const navLink = (to, label) => (
    <Link
      to={to}
      className={`text-sm font-medium transition-colors ${
        pathname === to ? 'text-slate-900' : 'text-slate-500 hover:text-slate-900'
      }`}
    >
      {label}
    </Link>
  );

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link to="/dashboard" className="font-bold text-slate-900 tracking-tight text-lg">
          Job<span className="text-indigo-600">Find</span>
        </Link>

        <nav className="flex items-center gap-6">
          {navLink('/dashboard', 'Jobs')}
          {navLink('/profile', 'Profile')}
          <div className="h-4 w-px bg-slate-200" />
          <span className="text-sm text-slate-500">{user?.name || user?.email}</span>
          <button
            onClick={handleLogout}
            className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors"
          >
            Sign out
          </button>
        </nav>
      </div>
    </header>
  );
};

export default Navbar;
