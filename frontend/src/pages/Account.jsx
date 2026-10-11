import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import api from '../services/api';
import { PageContainer } from '../components/ui';
import { AccountInfoSection, ChangePasswordSection, DeleteAccountSection } from '../components/AccountSections';

// Standalone /account page — kept available for backward compatibility and
// direct links (see AccountSettingsModal.jsx, which the navbar's "Account
// settings" action now opens instead, without navigating here). Reuses the
// exact same section components as the modal rather than its own copy.
const Account = () => {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/user/profile').then(r => setProfile(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading || !location.hash) return;
    const el = document.querySelector(location.hash);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [loading, location.hash]);

  if (loading) return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <div className="flex justify-center pt-24 text-slate-600 text-sm">Loading...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <PageContainer className="py-10">
        <div className="max-w-2xl mx-auto flex flex-col gap-6">
          <div>
            <h1 className="text-xl font-bold text-white">Account settings</h1>
            <p className="text-sm text-slate-500 mt-0.5">Manage your sign-in and account details</p>
          </div>

          <AccountInfoSection profile={profile} />
          <ChangePasswordSection hasPassword={!!profile?.hasPassword} idAnchor="change-password" />
          <DeleteAccountSection idAnchor="delete-account" onDeleted={() => { logout(); navigate('/', { state: { accountDeleted: true } }); }} />
        </div>
      </PageContainer>
    </div>
  );
};

export default Account;
