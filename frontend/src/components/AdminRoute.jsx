import { Navigate } from 'react-router-dom';

// Redirect to /admin (TokenGate) if no token in localStorage
const AdminRoute = ({ children }) => {
  const adminToken = localStorage.getItem('adminToken');
  if (!adminToken) return <Navigate to="/admin" replace />;
  return children;
};

export default AdminRoute;
