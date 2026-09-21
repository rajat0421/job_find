import { GoogleLogin } from '@react-oauth/google';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const GoogleAuthButton = ({ onError }) => {
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSuccess = async (credentialResponse) => {
    try {
      const res = await api.post('/auth/google', { credential: credentialResponse.credential });
      login(res.data.token, { email: res.data.email, name: res.data.name, isOnboarded: res.data.isOnboarded });
      navigate(res.data.isOnboarded ? '/dashboard' : '/onboarding');
    } catch (err) {
      onError?.(err.response?.data?.message || 'Google sign-in failed');
    }
  };

  return (
    <GoogleLogin
      onSuccess={handleSuccess}
      onError={() => onError?.('Google sign-in failed')}
      theme="filled_black"
      shape="pill"
      width="304"
    />
  );
};

export default GoogleAuthButton;
