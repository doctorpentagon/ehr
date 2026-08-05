import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Edit2, Shield, ShieldOff, Eye, EyeOff, CreditCard, Printer } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import Avatar from '@/components/ui/Avatar';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import useAuthStore from '@/stores/authStore';

const ROLES = ['ADMIN', 'CLINICIAN', 'RECORDS'];
const SUB_ROLES = ['DOCTOR', 'NURSE', 'LAB', 'PHARMACIST'];
const ROLE_COLOR = {
  ADMIN:      'bg-blue-100 text-blue-800',
  CLINICIAN:  'bg-green-100 text-green-800',
  RECORDS:    'bg-purple-100 text-purple-800',
  SUPER_ADMIN:'bg-red-100 text-red-800',
};

export default function Staff() {
  const qc = useQueryClient();
  const facility = useAuthStore(s => s.facility);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);   // null | 'add' | staff object (edit)
  const [cardStaff, setCardStaff] = useState(null); // staff object for ID card

  const { data, isLoading } = useQuery({
    queryKey: ['staff', search],
    queryFn: () => api.get('/staff', { params: { search, limit: 50 } }).then(r => r.data),
  });

  const staff = data?.staff || data || [];

  const { mutate: toggleActive } = useMutation({
    mutationFn: ({ id, isActive }) => api.put(`/staff/${id}`, { isActive }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['staff'] }); toast.success('Staff status updated'); },
    onError: () => toast.error('Failed to update'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Staff Management</h1>
          <p className="text-sm text-gray-500">{staff.length} staff members</p>
        </div>
        <button onClick={() => setModal('add')}
          className="flex items-center gap-2 px-4 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]">
          <Plus size={16} /> Add Staff
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, email, or Staff ID…"
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 focus:border-[#2D5BFF] bg-gray-50" />
      </div>

      {isLoading ? (
        <div className="py-16 flex justify-center"><Spinner /></div>
      ) : staff.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-sm text-gray-400">No staff found</p>
          <button onClick={() => setModal('add')} className="mt-3 text-sm text-[#2D5BFF] hover:underline">Add first staff member</button>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Staff Member', 'Staff ID', 'Role', 'Specialty', 'Phone', 'Status', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {staff.map(s => (
                <tr key={s.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={`${s.firstName} ${s.lastName}`} size="sm" src={s.avatar} />
                      <div>
                        <div className="font-medium text-gray-900">{s.firstName} {s.lastName}</div>
                        <div className="text-xs text-gray-400">{s.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{s.staffId || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium w-fit ${ROLE_COLOR[s.role] || 'bg-gray-100 text-gray-600'}`}>
                        {s.role}
                      </span>
                      {s.subRole && <span className="text-xs text-gray-500">{s.subRole}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{s.specialty || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{s.phone || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {s.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setModal(s)} title="Edit"
                        className="p-1.5 text-gray-400 hover:text-[#2D5BFF] hover:bg-[#2D5BFF]/10 rounded-lg">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => setCardStaff(s)} title="Print ID Card"
                        className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg">
                        <CreditCard size={14} />
                      </button>
                      <button onClick={() => toggleActive({ id: s.id, isActive: !s.isActive })} title={s.isActive ? 'Deactivate' : 'Activate'}
                        className={`p-1.5 rounded-lg ${s.isActive ? 'text-gray-400 hover:text-red-600 hover:bg-red-50' : 'text-gray-400 hover:text-green-600 hover:bg-green-50'}`}>
                        {s.isActive ? <ShieldOff size={14} /> : <Shield size={14} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <StaffModal open={!!modal} onClose={() => setModal(null)} staff={modal !== 'add' ? modal : null} />
      <StaffIdCardModal open={!!cardStaff} onClose={() => setCardStaff(null)} staff={cardStaff} facility={facility} />
    </div>
  );
}

// ── Staff Add/Edit Modal ────────────────────────────────────────────────────────

function StaffModal({ open, onClose, staff }) {
  const qc = useQueryClient();
  const isEdit = !!staff;
  const [form, setForm] = useState(staff || {
    firstName: '', lastName: '', email: '', role: 'CLINICIAN', subRole: 'DOCTOR',
    specialty: '', phone: '', password: '',
  });
  const [showPw, setShowPw] = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  React.useEffect(() => {
    setForm(staff || { firstName: '', lastName: '', email: '', role: 'CLINICIAN', subRole: 'DOCTOR', specialty: '', phone: '', password: '' });
  }, [staff, open]);

  const { mutate, isPending } = useMutation({
    mutationFn: () => isEdit
      ? api.put(`/staff/${staff.id}`, { firstName: form.firstName, lastName: form.lastName, role: form.role, subRole: form.subRole, specialty: form.specialty, phone: form.phone })
      : api.post('/staff', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff'] });
      toast.success(isEdit ? 'Staff updated' : 'Staff added — login credentials sent by email');
      onClose();
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed to save'),
  });

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Staff Member' : 'Add Staff Member'} size="sm">
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">First Name <span className="text-red-500">*</span></label>
            <input value={form.firstName} onChange={set('firstName')}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Last Name <span className="text-red-500">*</span></label>
            <input value={form.lastName} onChange={set('lastName')}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
          </div>
        </div>

        {!isEdit && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email <span className="text-red-500">*</span></label>
            <input value={form.email} onChange={set('email')} type="email"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
            <select value={form.role} onChange={set('role')}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30">
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Sub-Role</label>
            <select value={form.subRole || ''} onChange={set('subRole')}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30">
              <option value="">None</option>
              {SUB_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Specialty</label>
            <input value={form.specialty || ''} onChange={set('specialty')} placeholder="e.g. Cardiology"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
            <input value={form.phone || ''} onChange={set('phone')} type="tel"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
          </div>
        </div>

        {!isEdit && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Temporary Password <span className="text-red-500">*</span></label>
            <div className="relative">
              <input type={showPw ? 'text' : 'password'} value={form.password} onChange={set('password')}
                placeholder="Min 8 characters"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
              <button type="button" onClick={() => setShowPw(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">Staff will use their email + this password to log in</p>
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutate()}
            disabled={isPending || !form.firstName || !form.lastName || (!isEdit && (!form.email || !form.password))}
            className="flex-1 py-2.5 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50">
            {isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Staff'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Staff ID Card Modal ─────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function StaffIdCardModal({ open, onClose, staff, facility }) {
  const cardRef = useRef(null);

  function handlePrint() {
    if (!staff) return;
    const facilityName = escHtml(facility?.name || 'Awibi Health Facility');
    const issueDate = new Date().toLocaleDateString('en-GB');
    const initials = escHtml(`${staff.firstName?.[0] || ''}${staff.lastName?.[0] || ''}`.toUpperCase());
    const roleText = escHtml(roleLabel(staff.role, staff.subRole));
    const specialty = staff.specialty ? `<p style="font-size:11px;color:#6b7280;margin:2px 0">${escHtml(staff.specialty)}</p>` : '';

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Staff ID Card — ${staff.firstName} ${staff.lastName}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #f3f4f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { width: 340px; border-radius: 16px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.18); background: #fff; }
  .card-header { background: linear-gradient(135deg, #0B1F66 0%, #2D5BFF 100%); padding: 20px; display: flex; align-items: center; gap: 12px; }
  .logo-circle { width: 36px; height: 36px; background: rgba(255,255,255,0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center; }
  .logo-text { font-size: 13px; font-weight: 800; color: #fff; letter-spacing: 0.05em; }
  .logo-sub { font-size: 10px; color: rgba(255,255,255,0.7); font-weight: 400; }
  .card-body { padding: 20px; display: flex; gap: 16px; align-items: flex-start; }
  .avatar { width: 64px; height: 64px; border-radius: 50%; background: #dbeafe; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 700; color: #2D5BFF; flex-shrink: 0; border: 3px solid #e0e7ff; }
  .info { flex: 1; min-width: 0; }
  .name { font-size: 16px; font-weight: 700; color: #111827; margin-bottom: 2px; }
  .role { font-size: 11px; font-weight: 600; color: #2D5BFF; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  .facility-name { font-size: 11px; color: #6b7280; margin-bottom: 8px; }
  .id-box { background: #f0f4ff; border: 1.5px solid #c7d7ff; border-radius: 8px; padding: 8px 12px; margin-top: 4px; }
  .id-label { font-size: 9px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.08em; }
  .id-value { font-size: 15px; font-weight: 800; color: #0B1F66; font-family: 'Courier New', monospace; letter-spacing: 0.1em; margin-top: 1px; }
  .card-footer { border-top: 1px solid #f3f4f6; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; background: #fafafa; }
  .footer-label { font-size: 9px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.06em; }
  .footer-value { font-size: 10px; color: #374151; font-weight: 600; margin-top: 1px; }
  .barcode { display: flex; gap: 1.5px; align-items: flex-end; }
  .bar { background: #0B1F66; border-radius: 1px; }
  @media print {
    body { background: #fff; }
    .card { box-shadow: none; border: 1px solid #e5e7eb; }
  }
</style>
</head>
<body>
<div class="card">
  <div class="card-header">
    <div class="logo-circle">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7L12 2z" fill="white" fill-opacity="0.9"/></svg>
    </div>
    <div>
      <div class="logo-text">AWIBI EHR</div>
      <div class="logo-sub">${facilityName}</div>
    </div>
  </div>
  <div class="card-body">
    <div class="avatar">${initials}</div>
    <div class="info">
      <div class="name">${escHtml(staff.firstName)} ${escHtml(staff.lastName)}</div>
      <div class="role">${roleText}</div>
      ${specialty}
      <div class="id-box">
        <div class="id-label">Staff ID</div>
        <div class="id-value">${escHtml(staff.staffId || 'PENDING')}</div>
      </div>
    </div>
  </div>
  <div class="card-footer">
    <div>
      <div class="footer-label">Issued</div>
      <div class="footer-value">${issueDate}</div>
    </div>
    <div class="barcode">
      ${Array.from({ length: 18 }, (_, i) => {
        const h = 6 + (i % 4) * 4 + (i % 3) * 2;
        const w = i % 3 === 0 ? 3 : 1.5;
        return `<div class="bar" style="width:${w}px;height:${h}px"></div>`;
      }).join('')}
    </div>
    <div style="text-align:right">
      <div class="footer-label">Status</div>
      <div class="footer-value" style="color:${staff.isActive ? '#16a34a' : '#dc2626'}">${staff.isActive ? 'ACTIVE' : 'INACTIVE'}</div>
    </div>
  </div>
</div>
<script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=480,height=400');
    if (!win) { toast.error('Pop-up blocked — please allow pop-ups for this site'); return; }
    win.document.write(html);
    win.document.close();
  }

  if (!staff) return null;

  const facilityName = facility?.name || 'Awibi Health Facility';
  const roleText = roleLabel(staff.role, staff.subRole);
  const initials = `${staff.firstName?.[0] || ''}${staff.lastName?.[0] || ''}`.toUpperCase();

  return (
    <Modal open={open} onClose={onClose} title="Staff ID Card" size="sm">
      <div className="p-6 flex flex-col items-center gap-6">
        {/* Preview card */}
        <div ref={cardRef} className="w-[320px] rounded-2xl overflow-hidden shadow-lg border border-gray-200">
          {/* Header */}
          <div className="bg-linear-to-br from-[#0B1F66] to-[#2D5BFF] px-5 py-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7L12 2z" fill="white" fillOpacity="0.9"/></svg>
            </div>
            <div>
              <div className="text-white font-bold text-sm tracking-wide">AWIBI EHR</div>
              <div className="text-white/70 text-xs">{facilityName}</div>
            </div>
          </div>

          {/* Body */}
          <div className="bg-white px-5 py-4 flex gap-4 items-start">
            <div className="w-14 h-14 rounded-full bg-blue-100 border-2 border-blue-200 flex items-center justify-center shrink-0 text-lg font-bold text-[#2D5BFF]">
              {initials}
            </div>
            <div className="min-w-0">
              <div className="font-bold text-gray-900 text-sm">{staff.firstName} {staff.lastName}</div>
              <div className="text-[10px] font-semibold text-[#2D5BFF] uppercase tracking-wider mt-0.5">{roleText}</div>
              {staff.specialty && <div className="text-xs text-gray-500 mt-0.5">{staff.specialty}</div>}
              <div className="mt-2 bg-[#f0f4ff] border border-[#c7d7ff] rounded-lg px-3 py-1.5">
                <div className="text-[8px] font-semibold text-gray-500 uppercase tracking-widest">Staff ID</div>
                <div className="font-mono font-black text-[#0B1F66] text-sm tracking-widest">{staff.staffId || 'PENDING'}</div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="bg-gray-50 border-t border-gray-100 px-5 py-3 flex items-center justify-between">
            <div>
              <div className="text-[8px] font-semibold text-gray-400 uppercase tracking-widest">Issued</div>
              <div className="text-xs font-semibold text-gray-700">{new Date().toLocaleDateString('en-GB')}</div>
            </div>
            <div className="flex gap-0.5 items-end">
              {Array.from({ length: 14 }, (_, i) => (
                <div key={i} className="bg-[#0B1F66] rounded-sm"
                  style={{ width: i % 3 === 0 ? 2.5 : 1, height: 6 + (i % 4) * 3 }} />
              ))}
            </div>
            <div className="text-right">
              <div className="text-[8px] font-semibold text-gray-400 uppercase tracking-widest">Status</div>
              <div className={`text-xs font-bold ${staff.isActive ? 'text-green-600' : 'text-red-600'}`}>
                {staff.isActive ? 'ACTIVE' : 'INACTIVE'}
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 w-full">
          <button onClick={onClose}
            className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
            Close
          </button>
          <button onClick={handlePrint}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]">
            <Printer size={15} /> Print ID Card
          </button>
        </div>
        <p className="text-xs text-gray-400 -mt-2 text-center">Opens a print-ready version in a new window</p>
      </div>
    </Modal>
  );
}
