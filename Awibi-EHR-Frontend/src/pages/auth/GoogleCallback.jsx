import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { fetchMe } from '@/store/authSlice';
import useAuthStore from '@/stores/authStore';
import { Loader2 } from 'lucide-react';

export default function GoogleCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const setAuth = useAuthStore((s) => s.setAuth);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const token = searchParams.get('token');
    const error = searchParams.get('error');

    if (error || !token) {
      navigate('/login?error=google_failed', { replace: true });
      return;
    }

    localStorage.setItem('accessToken', token);

    dispatch(fetchMe())
      .unwrap()
      .then(({ user, facility, subscription }) => {
        setAuth({ user, facility, subscription });
        navigate('/dashboard', { replace: true });
      })
      .catch(() => {
        localStorage.removeItem('accessToken');
        navigate('/login?error=google_failed', { replace: true });
      });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8faff]">
      <div className="text-center">
        <Loader2 className="w-10 h-10 text-[#2D5BFF] animate-spin mx-auto mb-4" />
        <p className="text-gray-600 text-sm">Signing you in with Google...</p>
      </div>
    </div>
  );
}
