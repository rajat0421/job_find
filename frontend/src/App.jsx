import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { AccountModalProvider } from './context/AccountModalContext';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import AccountSettingsModal from './components/AccountSettingsModal';

import Register from './pages/Register';
import VerifyEmail from './pages/VerifyEmail';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import Profile from './pages/Profile';
import Resume from './pages/Resume';
import Feedback from './pages/Feedback';
import Account from './pages/Account';
import AdminUsers from './pages/AdminUsers';
import AdminUserDetail from './pages/AdminUserDetail';
import AdminLogs from './pages/AdminLogs';
import AdminEmailLogs from './pages/AdminEmailLogs';
import AdminFeedback from './pages/AdminFeedback';
import AdminCompanies from './pages/AdminCompanies';
import AdminJobs from './pages/AdminJobs';
import AdminAnalytics from './pages/AdminAnalytics';
import Landing from './pages/Landing';

const App = () => (
  <AuthProvider>
    {/* AccountModalProvider wraps the router (not a Route) so the same modal
        instance below persists across navigation and can be opened from any
        page — the whole point is that it never depends on which route is
        active. */}
    <AccountModalProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/register" element={<Register />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="/resume" element={<ProtectedRoute><Resume /></ProtectedRoute>} />
          <Route path="/feedback" element={<ProtectedRoute><Feedback /></ProtectedRoute>} />
          {/* Kept available for backward-compat/direct links — the navbar's
              "Account settings" action no longer routes here, it opens
              <AccountSettingsModal /> below instead. */}
          <Route path="/account" element={<ProtectedRoute><Account /></ProtectedRoute>} />
          <Route path="/admin" element={<AdminRoute><AdminUsers /></AdminRoute>} />
          <Route path="/admin/users/:id" element={<AdminRoute><AdminUserDetail /></AdminRoute>} />
          <Route path="/admin/logs" element={<AdminRoute><AdminLogs /></AdminRoute>} />
          <Route path="/admin/email-logs" element={<AdminRoute><AdminEmailLogs /></AdminRoute>} />
          <Route path="/admin/feedback" element={<AdminRoute><AdminFeedback /></AdminRoute>} />
          <Route path="/admin/companies" element={<AdminRoute><AdminCompanies /></AdminRoute>} />
          <Route path="/admin/jobs" element={<AdminRoute><AdminJobs /></AdminRoute>} />
          <Route path="/admin/analytics" element={<AdminRoute><AdminAnalytics /></AdminRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        {/* Rendered once, globally — overlays whatever route is active above
            whenever AccountModalContext's isOpen is true. Not duplicated per
            page, and mounting it here (inside BrowserRouter, for useNavigate)
            never itself changes the URL. */}
        <AccountSettingsModal />
      </BrowserRouter>
    </AccountModalProvider>
  </AuthProvider>
);

export default App;
