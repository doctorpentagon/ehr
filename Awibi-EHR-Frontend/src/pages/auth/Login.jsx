import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, PlayCircle } from 'lucide-react';
import { toast } from 'sonner';
import { demoLogin, login } from '@/store/authSlice';
import api from '@/lib/api';
import { roleLabel } from '@/lib/permissions';
import useAuthStore from '@/stores/authStore';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const emailSchema = z.object({
  email: z.string().email({ message: 'Enter a valid email address' }),
  password: z.string().min(8, { message: 'Password must be at least 8 characters' }),
});

const staffSchema = z.object({
  staffEmail: z.string().email({ message: 'Enter a valid email address' }),
  staffPassword: z.string().min(8, { message: 'Password must be at least 8 characters' }),
});

function FieldError({ message }) {
  if (!message) return null;
  return <p className="text-sm text-destructive mt-1">{message}</p>;
}

export default function Login() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { loading } = useSelector((s) => s.auth);
  const [demoAccounts, setDemoAccounts] = useState([]);
  const [demoAccountId, setDemoAccountId] = useState('');
  const [demoMeta, setDemoMeta] = useState({ requiresAccessCode: false, hostedDemo: false });
  const [accessCode, setAccessCode] = useState('');
  // loading → waking → ready | none | unreachable. Anything other than an
  // instant answer needs to be visible, or the page just looks broken.
  const [demoState, setDemoState] = useState('loading');

  /**
   * Fetch the demo accounts, allowing for a sleeping server.
   *
   * This used to give up after four seconds and silently render nothing. On a
   * host that idles its free instances — which is most of them — the first
   * visitor of the hour waits thirty to sixty seconds for the service to wake,
   * so the request was guaranteed to fail and the picker simply vanished. No
   * error, no explanation, and the page looked broken to the one person most
   * likely to be evaluating it.
   *
   * Now it waits long enough to succeed, says what is happening while it does,
   * and retries once rather than giving up on a single cold start.
   */
  useEffect(() => {
    let active = true;
    let attempt = 0;

    // Only claim the server is waking if the wait is long enough to notice.
    const slowTimer = setTimeout(() => { if (active) setDemoState('waking'); }, 2500);

    const fetchAccounts = async () => {
      attempt += 1;
      try {
        const { data } = await api.get('/auth/local-demo-accounts', { timeout: 60000 });
        if (!active) return;
        const accounts = data?.accounts || [];
        setDemoAccounts(accounts);
        setDemoAccountId(accounts[0]?.id || '');
        setDemoMeta({
          requiresAccessCode: Boolean(data?.requiresAccessCode),
          hostedDemo: Boolean(data?.hostedDemo),
        });
        setDemoState(accounts.length ? 'ready' : 'none');
      } catch (err) {
        if (!active) return;
        // A 404 is a definite answer: this deployment has no demo access.
        // Anything else is worth one more try — a cold start often refuses the
        // first connection outright rather than holding it open.
        if (err?.response?.status === 404) { setDemoState('none'); return; }
        if (attempt < 2) { setTimeout(fetchAccounts, 3000); return; }
        setDemoAccounts([]);
        setDemoState('unreachable');
      }
    };

    fetchAccounts();
    return () => { active = false; clearTimeout(slowTimer); };
  }, []);

  const demoFacilities = useMemo(() => {
    const names = new Set(demoAccounts.map((account) => account.facility?.name).filter(Boolean));
    return names.size;
  }, [demoAccounts]);

  const {
    register: regEmail,
    handleSubmit: handleEmail,
    formState: { errors: emailErrors },
  } = useForm({ resolver: zodResolver(emailSchema), defaultValues: { email: '', password: '' } });

  const {
    register: regStaff,
    handleSubmit: handleStaff,
    formState: { errors: staffErrors },
  } = useForm({ resolver: zodResolver(staffSchema), defaultValues: { staffEmail: '', staffPassword: '' } });

  const setAuth = useAuthStore((s) => s.setAuth);

  const doLogin = async ({ email, password }) => {
    try {
      const result = await dispatch(login({ email, password })).unwrap();
      setAuth({ user: result.user, facility: result.facility });
      navigate(result.user?.mustChangePassword ? '/dashboard/settings?passwordChange=required' : '/dashboard', { replace: true });
    } catch (err) {
      // Backend returns { requiresOtp: true } when email isn't verified yet
      if (err?.requiresOtp) {
        navigate('/verify-otp', { state: { email } });
        return;
      }
      const msg = err?.error || '';
      if (msg.includes('timeout') || msg.includes('Network Error') || msg.includes('ECONNREFUSED')) {
        toast.error('Cannot reach the local EHR API. Run the local project launcher, then try again.', { duration: 8000 });
      } else {
        toast.error(msg || 'Invalid credentials');
      }
    }
  };

  const enterDemo = async () => {
    if (!demoAccountId) return;
    try {
      const result = await dispatch(demoLogin({
        userId: demoAccountId,
        ...(demoMeta.requiresAccessCode ? { accessCode } : {}),
      })).unwrap();
      setAuth({ user: result.user, facility: result.facility });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      // Name which of the two things went wrong rather than one vague message.
      if (err?.code === 'DEMO_CODE_REQUIRED') {
        toast.error('That access code is not right. Ask whoever shared this link.');
        return;
      }
      toast.error(err?.error || 'Could not enter the demo');
    }
  };

  const onEmailSubmit = (v) => doLogin({ email: v.email, password: v.password });
  const onStaffSubmit = (v) => doLogin({ email: v.staffEmail, password: v.staffPassword });

  const handleGoogleLogin = () => {
    window.location.href = `${API_URL}/v1/auth/google`;
  };

  const [searchParams] = useSearchParams();
  const googleError = searchParams.get('error');
  const idleLogout = searchParams.get('reason') === 'idle';

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* Header */}
      <div className="flex flex-col items-start gap-3">
        <img src="/logo.png" alt="AwibiEHR" className="h-10 w-auto" />
        <p className="text-muted-foreground text-lg leading-snug">
          Optimize your healthcare operations with{' '}
          <span className="text-[#2D5BFF] font-semibold">Awibi EHR</span>
        </p>
      </div>

      {idleLogout && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          You were signed out after 30 minutes of inactivity.
        </div>
      )}
      {googleError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          Google sign-in failed. Please try again or use email/password.
        </div>
      )}

      {/* Free hosting tiers idle their instances, so the first visitor of the
          hour waits for the service to wake. Saying so turns a page that looks
          broken into one that is merely slow. */}
      {demoState === 'waking' && (
        <section className="rounded-xl border border-[#2D5BFF]/20 bg-[#2D5BFF]/5 p-4">
          <div className="flex items-center gap-3">
            <Loader2 className="animate-spin size-4 text-[#2D5BFF] shrink-0" />
            <div>
              <p className="font-semibold text-sm text-slate-900">Waking the demo server</p>
              <p className="text-xs text-slate-600 mt-0.5">
                It sleeps when unused and takes up to a minute to start. This only
                happens on the first visit.
              </p>
            </div>
          </div>
        </section>
      )}

      {demoState === 'unreachable' && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="font-semibold text-sm text-amber-900">Could not reach the demo server</p>
          <p className="text-xs text-amber-800 mt-0.5">
            It may still be starting. Reload the page in a moment, or sign in with
            an email and password below.
          </p>
        </section>
      )}

      {demoAccounts.length > 0 && (
        <section className="rounded-xl border border-[#2D5BFF]/20 bg-[#2D5BFF]/5 p-4 space-y-3">
          <div>
            <p className="font-semibold text-sm text-slate-900">
              {demoMeta.hostedDemo ? 'Demonstration system' : 'Local demo access'}
            </p>
            <p className="text-xs text-slate-600 mt-1">
              Choose a facility and role — no password required
              {demoFacilities > 1 ? `, across ${demoFacilities} demo facilities.` : '.'}
            </p>
            {/* On a hosted instance, say plainly that this is not a real system.
                Someone arriving from a forwarded link has no other way to know,
                and might otherwise enter a real patient's details. */}
            {demoMeta.hostedDemo && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2 mt-2">
                This is a demonstration with invented patients. Please do not enter real patient
                information — anyone else evaluating the system can see it.
              </p>
            )}
          </div>

          {demoMeta.requiresAccessCode && (
            <label className="grid gap-1.5 text-xs font-medium text-slate-700" htmlFor="demoAccessCode">
              Access code
              <input
                id="demoAccessCode"
                type="password"
                value={accessCode}
                onChange={(event) => setAccessCode(event.target.value)}
                placeholder="Provided with your invitation"
                autoComplete="off"
                className="h-10 w-full min-w-0 rounded-md border border-input bg-white px-3 text-sm font-normal text-slate-900"
              />
            </label>
          )}
          <label className="grid gap-1.5 text-xs font-medium text-slate-700" htmlFor="demoAccount">
            Demo facility and role
            <select
              id="demoAccount"
              value={demoAccountId}
              onChange={(event) => setDemoAccountId(event.target.value)}
              className="h-10 w-full min-w-0 rounded-md border border-input bg-white px-3 text-sm font-normal text-slate-900"
            >
              {/* Grouped by facility rather than repeating the facility name in
                  every option — three segments on one line overflowed the box
                  and the end of the label was unreadable. */}
              {Object.entries(
                demoAccounts.reduce((groups, account) => {
                  const facility = account.facility?.name || 'No facility';
                  (groups[facility] ||= []).push(account);
                  return groups;
                }, {}),
              ).map(([facility, accounts]) => (
                <optgroup label={facility} key={facility}>
                  {accounts.map((account) => (
                    <option value={account.id} key={account.id}>
                      {roleLabel(account.role, account.subRole)} — {account.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <Button type="button" onClick={enterDemo} disabled={loading || !demoAccountId} className="w-full bg-[#2D5BFF] hover:bg-[#1a45e0]">
            {loading ? <Loader2 className="animate-spin size-4" /> : <PlayCircle className="size-4" />}
            Enter selected demo
          </Button>
          <p className="text-[11px] text-slate-500">Production authentication, authorization, and sessions remain unchanged.</p>
        </section>
      )}

      {/* Google Sign-In */}
      <button
        onClick={handleGoogleLogin}
        type="button"
        className="w-full flex items-center justify-center gap-3 border border-gray-300 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors shadow-xs"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
          <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
          <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
          <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
        </svg>
        Continue with Google
      </button>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="flex-1 h-px bg-border" />
        or sign in with email
        <div className="flex-1 h-px bg-border" />
      </div>

      <Tabs defaultValue="account" className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-4">
          <TabsTrigger value="account">Account login</TabsTrigger>
          <TabsTrigger value="staff">Staff ID login</TabsTrigger>
        </TabsList>

        {/* Account login */}
        <TabsContent value="account">
          <form className="grid gap-4" onSubmit={handleEmail(onEmailSubmit)}>
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email address</Label>
              <Input id="email" type="email" placeholder="admin@myclinic.com" {...regEmail('email')} />
              <FieldError message={emailErrors.email?.message} />
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  to="/forgot-password"
                  className="text-xs text-[#2D5BFF] underline-offset-4 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <PasswordInput id="password" placeholder="••••••••" autoComplete="current-password" {...regEmail('password')} />
              <FieldError message={emailErrors.password?.message} />
            </div>
            <Button type="submit" className="w-full bg-[#2D5BFF] hover:bg-[#1a45e0]" disabled={loading}>
              {loading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="animate-spin size-4" /> Logging in...
                </span>
              ) : 'Login'}
            </Button>
          </form>
        </TabsContent>

        {/* Staff login */}
        <TabsContent value="staff">
          <div className="mb-4 rounded-lg bg-[#2D5BFF]/5 border border-[#2D5BFF]/10 p-3">
            <p className="text-xs text-[#2D5BFF]">
              Staff members log in with the email and password set by your facility admin.
              Contact your admin if you cannot log in.
            </p>
          </div>

          <form className="grid gap-4" onSubmit={handleStaff(onStaffSubmit)}>
            <div className="grid gap-1.5">
              <Label htmlFor="staffEmail">Staff email</Label>
              <Input id="staffEmail" type="email" placeholder="nurse@myclinic.com" {...regStaff('staffEmail')} />
              <FieldError message={staffErrors.staffEmail?.message} />
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="staffPassword">Password</Label>
                <Link
                  to="/forgot-password"
                  className="text-xs text-[#2D5BFF] underline-offset-4 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <PasswordInput id="staffPassword" placeholder="••••••••" autoComplete="current-password" {...regStaff('staffPassword')} />
              <FieldError message={staffErrors.staffPassword?.message} />
            </div>
            <Button type="submit" className="w-full bg-[#2D5BFF] hover:bg-[#1a45e0]" disabled={loading}>
              {loading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="animate-spin size-4" /> Logging in...
                </span>
              ) : 'Login as staff'}
            </Button>
          </form>
        </TabsContent>
      </Tabs>

      <div className="text-center text-sm text-muted-foreground">
        Don't have an account?{' '}
        <Link to="/register" className="text-[#2D5BFF] underline underline-offset-4 hover:opacity-80">
          Register your facility
        </Link>
      </div>
    </div>
  );
}
