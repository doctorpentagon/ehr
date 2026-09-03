import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { fetchMe } from '@/store/authSlice';
import { Loader2 } from 'lucide-react';

export default function GoogleCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const error = searchParams.get('error');

    if (error) {
      navigate('/login?error=google_failed', { replace: true });
      return;
    }

    // The backend set the httpOnly access + csrf cookies before redirecting
    // here — nothing to read from the URL. fetchMe rides the cookie via
    // withCredentials to hydrate the session.
    dispatch(fetchMe())
      .unwrap()
      .then(({ user }) => {
        navigate(user?.role === 'SUPER_ADMIN' ? '/dashboard/platform' : '/dashboard', { replace: true });
      })
      .catch(() => {
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
