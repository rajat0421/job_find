import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Navbar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
      <Link to="/dashboard" className="text-xl font-bold text-blue-600">
        JobFind
      </Link>
      <div className="flex items-center gap-4">
        <Link to="/dashboard" className="text-sm text-gray-600 hover:text-gray-900">
          Jobs
        </Link>
        <Link to="/profile" className="text-sm text-gray-600 hover:text-gray-900">
          Profile
        </Link>
        <span className="text-sm text-gray-400">|</span>
        <span className="text-sm text-gray-700">{user?.name || user?.email}</span>
        <button
          onClick={handleLogout}
          className="text-sm text-red-500 hover:text-red-700"
        >
          Logout
        </button>
      </div>
    </nav>
  );
};

export default Navbar;
