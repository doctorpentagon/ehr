import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { setCredentials } from '@/store/authSlice';
import useAuthStore from '@/stores/authStore';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';

const FACILITY_TYPES = ['HOSPITAL', 'CLINIC', 'LAB', 'PROFESSIONAL'];

const TYPE_MAP = {
  hospital: 'HOSPITAL',
  laboratory: 'LAB',
  professional: 'PROFESSIONAL',
  clinic: 'CLINIC',
};

export default function Register() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const planParam = searchParams.get('plan') || '';
  const typeParam = searchParams.get('type') || '';
  const refParam = searchParams.get('ref') || '';
  const derivedType = TYPE_MAP[typeParam?.toLowerCase()] || 'CLINIC';

  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', password: '',
    orgName: '', facilityType: derivedType, phone: '',
  });
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (form.password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', {
        firstName: form.firstName, lastName: form.lastName,
        email: form.email, password: form.password,
        orgName: form.orgName, facilityType: form.facilityType, phone: form.phone,
        ...(planParam && { plan: planParam }),
        ...(refParam && { paystackRef: refParam }),
      });
      if (data.requiresOtp) {
        navigate('/verify-otp', { state: { email: form.email } });
      } else {
        if (data.accessToken) localStorage.setItem('accessToken', data.accessToken);
        dispatch(setCredentials({ user: data.user, facility: data.facility }));
        setAuth({ user: data.user, facility: data.facility });
        navigate('/dashboard');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full">
      <div>
        <img src="/logo.png" alt="AwibiEHR" className="h-10 w-auto mb-4" />
        <h1 className="text-2xl font-bold text-foreground">Register your facility</h1>
        <p className="text-sm text-muted-foreground">Set up AwibiEHR for your facility — free to start</p>
      </div>

      {planParam && (
        <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${refParam ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-blue-50 border border-blue-200 text-blue-800'}`}>
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>
            {refParam
              ? <>Payment confirmed · <strong>{planParam}</strong> plan activated</>
              : <>Setting up your <strong>{planParam === 'free' ? 'Free Trial' : planParam}</strong> plan</>
            }
          </span>
        </div>
      )}

      <form onSubmit={submit} className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label>First name</Label>
            <Input required placeholder="Idris" value={form.firstName} onChange={set('firstName')} />
          </div>
          <div className="grid gap-1.5">
            <Label>Last name</Label>
            <Input required placeholder="Wahab" value={form.lastName} onChange={set('lastName')} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label>Work email</Label>
          <Input type="email" required placeholder="you@hospital.ng" value={form.email} onChange={set('email')} />
        </div>
        <div className="grid gap-1.5">
          <Label>Facility / Organisation name</Label>
          <Input required placeholder="General Hospital Kwara" value={form.orgName} onChange={set('orgName')} />
        </div>
        <div className="grid gap-1.5">
          <Label>Facility type</Label>
          <select
            value={form.facilityType}
            onChange={set('facilityType')}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus:outline-none focus:border-ring focus:ring-ring/50 focus:ring-[3px]"
          >
            {FACILITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label>Phone number</Label>
          <Input type="tel" placeholder="+234 80 0000 0000" value={form.phone} onChange={set('phone')} />
        </div>
        <div className="grid gap-1.5">
          <Label>Password</Label>
          <PasswordInput required placeholder="Min 8 characters" value={form.password} onChange={set('password')} />
        </div>
        <Button type="submit" disabled={loading} className="w-full bg-[#2D5BFF] hover:bg-[#1a45e0]">
          {loading && <Loader2 className="animate-spin size-4" />}
          {loading ? 'Creating account...' : 'Create account — Free'}
        </Button>
      </form>

      <p className="text-xs text-muted-foreground text-center">
        By creating an account you agree to our Terms of Service (NDPA 2023 compliant).
      </p>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link to="/login" className="text-[#2D5BFF] underline underline-offset-4 hover:opacity-80">Sign in</Link>
      </p>
    </div>
  );
}
