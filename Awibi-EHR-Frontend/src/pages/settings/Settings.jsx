import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, User, Shield, Eye, EyeOff, Loader2, CheckCircle, Hash } from 'lucide-react';
import Spinner from '@/components/ui/Spinner';
import { useSelector, useDispatch } from 'react-redux';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useNavigate } from 'react-router-dom';
import { fetchMe } from '@/store/authSlice';
import { roleLabel } from '@/lib/permissions';

const TABS = [
  { key: 'facility', label: 'Facility Profile', Icon: Building2 },
  { key: 'hospno',   label: 'Hospital Number', Icon: Hash, adminOnly: true },
  { key: 'profile',  label: 'My Profile',       Icon: User },
  { key: 'security', label: 'Security',          Icon: Shield },
];

export default function Settings() {
  const { user } = useSelector((s) => s.auth);
  const canEditFacility = ['SUPER_ADMIN','ADMIN'].includes(user?.role);
  const passwordChangeRequired = Boolean(user?.mustChangePassword);
  const [tab, setTab] = useState(passwordChangeRequired ? 'security' : (canEditFacility ? 'facility' : 'profile'));

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500">Manage your account and facility settings</p>
      </div>

      {passwordChangeRequired && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Change your temporary password before accessing patient or facility data.
        </div>
      )}

      {/* Tab selector */}
      <div className="bg-white rounded-xl border border-gray-200 p-1 flex gap-1">
        {TABS.filter((t) => !t.adminOnly || canEditFacility).map(({ key, label, Icon }) => {
          if (passwordChangeRequired && key !== 'security') return null;
          if (key === 'facility' && !canEditFacility) return null;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${tab === key ? 'bg-[#2D5BFF] text-white' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'}`}
            >
              <Icon size={15} />
              <span className="hidden sm:inline">{label}</span>
            </button>
          );
        })}
      </div>

      {tab === 'facility' && canEditFacility && <FacilitySettings />}
      {tab === 'hospno' && canEditFacility && <HospitalNumberSettings />}
      {tab === 'profile' && <ProfileSettings />}
      {tab === 'security' && <SecuritySettings passwordChangeRequired={passwordChangeRequired} />}
    </div>
  );
}

function FacilitySettings() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['settings-facility'],
    queryFn: () => api.get('/settings/facility').then(r => r.data),
  });

  const [form, setForm] = useState(null);
  React.useEffect(() => { if (data) setForm(data); }, [data]);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.put('/settings/facility', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings-facility'] }); toast.success('Facility profile updated'); },
    onError: () => toast.error('Failed to update'),
  });

  if (isLoading || !form) return <div className="py-8 flex justify-center"><Spinner /></div>;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <h2 className="text-base font-semibold text-gray-900">Facility Profile</h2>
      {[
        ['Facility name', 'name', 'text'],
        ['Email', 'email', 'email'],
        ['Phone', 'phone', 'tel'],
        ['Address', 'address', 'text'],
        ['State', 'state', 'text'],
        ['LGA', 'lga', 'text'],
        ['License number', 'licenseNumber', 'text'],
        ['Website', 'website', 'url'],
      ].map(([label, key, type]) => (
        <div key={key}>
          <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
          <input type={type} value={form[key] || ''} onChange={set(key)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
        </div>
      ))}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Facility type</label>
        <select value={form.type || ''} onChange={set('type')} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 bg-white">
          {['HOSPITAL','CLINIC','LAB','PROFESSIONAL'].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <button onClick={() => mutate()} disabled={isPending} className="w-full py-2.5 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50 flex items-center justify-center gap-2">
        {isPending && <Loader2 size={15} className="animate-spin" />}
        {isPending ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  );
}

function ProfileSettings() {
  const dispatch = useDispatch();
  const { user } = useSelector((s) => s.auth);
  const [form, setForm] = useState({ firstName: user?.firstName || '', lastName: user?.lastName || '', phone: user?.phone || '', specialty: user?.specialty || '' });
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.put('/settings/profile', form),
    onSuccess: () => { toast.success('Profile updated'); },
    onError: () => toast.error('Failed to update profile'),
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <h2 className="text-base font-semibold text-gray-900">My Profile</h2>
      <div className="bg-gray-50 rounded-xl p-3 text-sm">
        <div className="font-medium text-gray-900">{user?.email}</div>
        {/* The same wording the sign-in screen used, not the raw enum. Staff
            should never have to work out that "CLINICIAN (LAB)" is them. */}
        <div className="text-gray-500">{user?.staffId} · {roleLabel(user?.role, user?.subRole)}</div>
      </div>
      {[
        ['First name', 'firstName'],
        ['Last name', 'lastName'],
        ['Phone', 'phone'],
        ['Specialty', 'specialty'],
      ].map(([label, key]) => (
        <div key={key}>
          <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
          <input value={form[key]} onChange={set(key)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
        </div>
      ))}
      <button onClick={() => mutate()} disabled={isPending} className="w-full py-2.5 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50 flex items-center justify-center gap-2">
        {isPending && <Loader2 size={15} className="animate-spin" />}
        {isPending ? 'Saving…' : 'Save Profile'}
      </button>
    </div>
  );
}

function SecuritySettings({ passwordChangeRequired }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const { mutate, isPending, isSuccess } = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword }),
    onSuccess: async () => {
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      await dispatch(fetchMe());
      toast.success('Password changed successfully');
      if (passwordChangeRequired) navigate('/dashboard', { replace: true });
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed to change password'),
  });

  const submit = e => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) { toast.error('Passwords do not match'); return; }
    if (form.newPassword.length < 12 || !/[a-z]/.test(form.newPassword) || !/[A-Z]/.test(form.newPassword) || !/\d/.test(form.newPassword) || !/[^A-Za-z0-9]/.test(form.newPassword)) {
      toast.error('Use at least 12 characters with upper, lower, number, and symbol'); return;
    }
    mutate();
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-base font-semibold text-gray-900 mb-4">Change Password</h2>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Current password</label>
          <div className="relative">
            <input type={showCurrent ? 'text' : 'password'} required value={form.currentPassword} onChange={set('currentPassword')} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 pr-10" />
            <button type="button" onClick={() => setShowCurrent(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">{showCurrent ? <EyeOff size={16}/> : <Eye size={16}/>}</button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
          <div className="relative">
            <input type={showNew ? 'text' : 'password'} required value={form.newPassword} onChange={set('newPassword')} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 pr-10" placeholder="12+ characters: upper, lower, number, symbol" />
            <button type="button" onClick={() => setShowNew(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">{showNew ? <EyeOff size={16}/> : <Eye size={16}/>}</button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Confirm new password</label>
          <input type="password" required value={form.confirm} onChange={set('confirm')} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
        </div>
        <button type="submit" disabled={isPending} className="w-full py-2.5 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50 flex items-center justify-center gap-2">
          {isPending && <Loader2 size={15} className="animate-spin" />}
          {isPending ? 'Changing…' : 'Change Password'}
        </button>
      </form>

      <div className="mt-6 border-t border-gray-100 pt-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">NDPA 2023 Compliance</h3>
        <div className="space-y-2 text-xs text-gray-600">
          <div className="flex items-center gap-2"><CheckCircle size={14} className="text-green-600" /> All PHI access is logged with timestamp and user ID</div>
          <div className="flex items-center gap-2"><CheckCircle size={14} className="text-green-600" /> No PHI stored in URLs or logs</div>
          <div className="flex items-center gap-2"><CheckCircle size={14} className="text-green-600" /> Data encrypted in transit (TLS)</div>
          <div className="flex items-center gap-2"><CheckCircle size={14} className="text-green-600" /> Consent recorded at patient registration</div>
          <div className="flex items-center gap-2"><CheckCircle size={14} className="text-green-600" /> NDPA 2023 provisions complied with</div>
        </div>
      </div>
    </div>
  );
}

/**
 * How this facility numbers its charts.
 *
 * The number staff quote at the desk. Every hospital has a house style, and one
 * that does not match the paper folder will not be trusted or used — so the
 * form shows the resulting number live rather than making an administrator
 * work it out from four separate fields.
 */
function HospitalNumberSettings() {
  const qc = useQueryClient();
  const [form, setForm] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['hospital-number'],
    queryFn: () => api.get('/settings/hospital-number').then((r) => r.data),
  });

  React.useEffect(() => {
    if (data && !form) {
      const { prefix, includeYear, padding, start, separator } = data;
      setForm({ prefix, includeYear, padding, start, separator });
    }
  }, [data, form]);

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.put('/settings/hospital-number', form).then((r) => r.data),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['hospital-number'] });
      toast.success(`Saved — next number will be ${saved.preview}`);
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not save the format'),
  });

  if (isLoading || !form) return <div className="py-10 flex justify-center"><Spinner /></div>;

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked
      : e.target.type === 'number' ? Number(e.target.value)
        : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  // Rendered here rather than fetched, so the effect of a change is visible
  // before it is committed.
  const year = String(new Date().getFullYear()).slice(-2);
  const sequence = String(Math.max(form.start || 0, 1)).padStart(Math.min(Math.max(form.padding || 1, 1), 10), '0');
  const preview = form.includeYear
    ? `${(form.prefix || 'PAT').toUpperCase()}${form.separator}${year}${form.separator}${sequence}`
    : `${(form.prefix || 'PAT').toUpperCase()}${form.separator}${sequence}`;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Hospital number</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          The number staff quote to pull a chart. Set it to match the folders already in your records room.
        </p>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
        <div className="text-xs text-gray-500 uppercase tracking-wide">Next number will be</div>
        <div className="text-2xl font-mono font-semibold text-gray-900 mt-1 break-all">{preview}</div>
        {data?.issuedUnderCurrentFormat > 0 && (
          <div className="text-xs text-gray-500 mt-1">
            {data.issuedUnderCurrentFormat} already issued in this format
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Facility code</label>
          <input value={form.prefix} onChange={set('prefix')} maxLength={10} placeholder="LUTH"
            className="w-full min-h-11 px-3 border border-gray-300 rounded-lg text-sm uppercase" />
          <p className="text-xs text-gray-500 mt-1">Letters and digits only</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Separator</label>
          <select value={form.separator} onChange={set('separator')}
            className="w-full min-h-11 px-3 border border-gray-300 rounded-lg text-sm">
            <option value="-">Hyphen — LUTH-001</option>
            <option value="/">Slash — LUTH/001</option>
            <option value=".">Dot — LUTH.001</option>
            <option value="">None — LUTH001</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Digits</label>
          <input type="number" min="1" max="10" value={form.padding} onChange={set('padding')}
            className="w-full min-h-11 px-3 border border-gray-300 rounded-lg text-sm" />
          <p className="text-xs text-gray-500 mt-1">6 gives 001234</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Start from</label>
          <input type="number" min="0" value={form.start} onChange={set('start')}
            className="w-full min-h-11 px-3 border border-gray-300 rounded-lg text-sm" />
          <p className="text-xs text-gray-500 mt-1">Continue from your existing paper series</p>
        </div>
      </div>

      <label className="flex items-start gap-2.5 cursor-pointer">
        <input type="checkbox" checked={form.includeYear} onChange={set('includeYear')} className="mt-1" />
        <span className="text-sm text-gray-800">
          Include the year
          <span className="block text-xs text-gray-500">
            The sequence restarts each January, which is what most records rooms expect
          </span>
        </span>
      </label>

      <div className="border-t border-gray-100 pt-4">
        <p className="text-xs text-gray-500 mb-3">
          Numbers already issued keep their current form. They are printed on folders, cards and invoices,
          so changing them would strand every patient holding the old one.
        </p>
        <button onClick={() => mutate()} disabled={isPending}
          className="min-h-11 px-5 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium disabled:opacity-50">
          {isPending ? 'Saving…' : 'Save format'}
        </button>
      </div>
    </div>
  );
}
