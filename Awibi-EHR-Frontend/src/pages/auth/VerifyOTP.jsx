import React, { useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { setCredentials } from '@/store/authSlice';
import useAuthStore from '@/stores/authStore';
import { Button } from '@/components/ui/button';

export default function VerifyOTP() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const email = state?.email || '';
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const refs = useRef([]);
  const setAuth = useAuthStore((s) => s.setAuth);

  const handleChange = (i, v) => {
    if (!/^\d*$/.test(v)) return;
    const next = [...otp];
    next[i] = v.slice(-1);
    setOtp(next);
    if (v && i < 5) refs.current[i + 1]?.focus();
  };

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !otp[i] && i > 0) refs.current[i - 1]?.focus();
  };

  const submit = async (e) => {
    e.preventDefault();
    const code = otp.join('');
    if (code.length < 6) { toast.error('Enter the 6-digit code'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/verify-otp', { email, otp: code });
      if (data.accessToken) localStorage.setItem('accessToken', data.accessToken);
      dispatch(setCredentials({ user: data.user, facility: data.facility ?? null, subscription: data.subscription ?? null }));
      setAuth({ user: data.user, facility: data.facility ?? null, subscription: data.subscription ?? null });
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Invalid or expired OTP');
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    try {
      await api.post('/auth/resend-otp', { email });
      toast.success('New OTP sent');
    } catch (_) {
      toast.error('Failed to resend');
    }
  };

  return (
    <div className="flex flex-col items-center gap-6 w-full">
      <img src="/logo.png" alt="AwibiEHR" className="h-10 w-auto self-start" />
      <div className="size-16 bg-[#2D5BFF]/10 rounded-2xl flex items-center justify-center">
        <span className="text-3xl">📬</span>
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-bold text-foreground">Check your email</h1>
        <p className="text-sm text-muted-foreground mt-1">
          We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>
        </p>
      </div>

      <form onSubmit={submit} className="w-full">
        <div className="flex gap-2 justify-center mb-6">
          {otp.map((digit, i) => (
            <input
              key={i}
              ref={(el) => { refs.current[i] = el; }}
              type="text" inputMode="numeric" maxLength={1}
              value={digit}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              className="w-12 h-14 text-center text-lg font-semibold border-2 border-input rounded-xl focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          ))}
        </div>
        <Button type="submit" disabled={loading} className="w-full bg-[#2D5BFF] hover:bg-[#1a45e0]">
          {loading && <Loader2 className="animate-spin size-4" />}
          Verify code
        </Button>
      </form>

      <p className="text-sm text-muted-foreground">
        Didn't receive it?{' '}
        <button onClick={resend} className="text-[#2D5BFF] font-medium hover:underline">Resend code</button>
      </p>

      <div className="w-full bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
        In development mode, the OTP is printed to the backend console (no email needed).
      </div>
    </div>
  );
}
