import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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
          <Link
            to="/profile"
            className="text-sm text-slate-400 hover:text-white transition-colors font-medium"
          >
            Profile
          </Link>
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
