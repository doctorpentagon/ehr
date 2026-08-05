import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Bed, User, LogOut, AlertCircle } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { format } from 'date-fns';
import { toast } from 'sonner';
import api from '@/lib/api';
import StatusBadge from '@/components/ui/StatusBadge';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';

const BED_TYPE_COLOR = {
  GENERAL:   'bg-blue-50   border-blue-200   text-blue-800',
  PRIVATE:   'bg-purple-50 border-purple-200 text-purple-800',
  ICU:       'bg-red-50    border-red-200    text-red-800',
  HDU:       'bg-orange-50 border-orange-200 text-orange-800',
  MATERNITY: 'bg-pink-50   border-pink-200   text-pink-800',
};

const BED_STATUS_CARD = {
  AVAILABLE:   'border-green-300 bg-green-50',
  OCCUPIED:    'border-red-300   bg-red-50',
  MAINTENANCE: 'border-gray-300  bg-gray-50',
};

export default function Admissions() {
  const qc = useQueryClient();
  const [admitOpen, setAdmitOpen] = useState(false);
  const [dischargeId, setDischargeId] = useState(null);
  const [viewMode, setViewMode] = useState('grid');

  const { data: bedsData, isLoading: bedsLoading } = useQuery({
    queryKey: ['beds'],
    queryFn: () => api.get('/admissions/beds').then(r => r.data),
  });

  const { data: admissionsData, isLoading: admLoading } = useQuery({
    queryKey: ['admissions'],
    queryFn: () => api.get('/admissions').then(r => r.data),
  });

  const beds = bedsData?.beds || bedsData || [];
  const admissions = admissionsData?.admissions || admissionsData || [];

  const available  = beds.filter(b => b.status === 'AVAILABLE').length;
  const occupied   = beds.filter(b => b.status === 'OCCUPIED').length;
  const maintenance= beds.filter(b => b.status === 'MAINTENANCE').length;

  const { mutate: discharge, isPending: discharging } = useMutation({
    mutationFn: id => api.put(`/admissions/${id}/discharge`, { notes: 'Discharged' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admissions'] });
      qc.invalidateQueries({ queryKey: ['beds'] });
      toast.success('Patient discharged');
      setDischargeId(null);
    },
    onError: () => toast.error('Discharge failed'),
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Admissions & Beds</h1>
          <p className="text-sm text-gray-500">Ward management and inpatient admissions</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-gray-200 rounded-lg overflow-hidden text-xs">
            {['grid', 'list'].map(m => (
              <button key={m} onClick={() => setViewMode(m)}
                className={`px-3 py-1.5 font-medium transition-colors ${viewMode === m ? 'bg-[#2D5BFF] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                {m === 'grid' ? 'Bed Grid' : 'Admissions'}
              </button>
            ))}
          </div>
          <button onClick={() => setAdmitOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]">
            <Plus size={16} /> Admit Patient
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Beds', value: beds.length, bg: 'bg-gray-800' },
          { label: 'Available',  value: available,   bg: 'bg-green-600' },
          { label: 'Occupied',   value: occupied,    bg: 'bg-red-500'   },
          { label: 'Maintenance',value: maintenance, bg: 'bg-orange-400'},
        ].map(s => (
          <div key={s.label} className={`rounded-xl p-4 text-white ${s.bg}`}>
            <div className="text-2xl font-extrabold">{s.value}</div>
            <div className="text-sm opacity-80">{s.label}</div>
          </div>
        ))}
      </div>

      {viewMode === 'grid'
        ? <BedGrid beds={beds} loading={bedsLoading} />
        : <AdmissionsList admissions={admissions} loading={admLoading} onDischarge={setDischargeId} />
      }

      <AdmitModal open={admitOpen} onClose={() => setAdmitOpen(false)} beds={beds} />

      {dischargeId && (
        <Modal open title="Confirm Discharge" onClose={() => setDischargeId(null)} size="sm">
          <div className="p-6 space-y-4">
            <p className="text-sm text-gray-700">Discharge this patient and release the bed?</p>
            <div className="flex gap-3">
              <button onClick={() => setDischargeId(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700">Cancel</button>
              <button onClick={() => discharge(dischargeId)} disabled={discharging}
                className="flex-1 py-2.5 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50">
                {discharging ? 'Discharging…' : 'Confirm'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function BedGrid({ beds, loading }) {
  if (loading) return <div className="py-16 flex justify-center"><Spinner /></div>;

  const byWard = beds.reduce((acc, b) => {
    const w = b.ward || 'General Ward';
    (acc[w] = acc[w] || []).push(b);
    return acc;
  }, {});

  if (!beds.length) return (
    <EmptyState
      icon={Bed}
      title="No beds configured"
      description="Add beds via Departments to enable ward management and admissions."
    />
  );

  return (
    <div className="space-y-6">
      {Object.entries(byWard).map(([ward, wardBeds]) => (
        <div key={ward}>
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Bed size={15} className="text-[#2D5BFF]" /> {ward}
            <span className="text-xs font-normal text-gray-400">
              ({wardBeds.filter(b => b.status === 'AVAILABLE').length} free / {wardBeds.length} total)
            </span>
          </h3>
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 xl:grid-cols-10 gap-2">
            {wardBeds.map(bed => (
              <div key={bed.id}
                className={`border-2 rounded-xl p-2 text-center ${BED_STATUS_CARD[bed.status] || 'border-gray-200 bg-white'}`}>
                <Bed size={16} className="mx-auto mb-0.5 opacity-60" />
                <div className="font-bold text-xs leading-tight">{bed.bedNumber}</div>
                <div className={`text-[9px] px-1 py-0.5 rounded-full border mt-1 font-medium ${BED_TYPE_COLOR[bed.type] || 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                  {bed.type}
                </div>
                {bed.status === 'OCCUPIED' && bed.currentPatient && (
                  <div className="text-[8px] mt-0.5 text-red-700 font-semibold truncate leading-tight">
                    {bed.currentPatient.firstName?.[0]}.{bed.currentPatient.lastName}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AdmissionsList({ admissions, loading, onDischarge }) {
  if (loading) return <div className="py-16 flex justify-center"><Spinner /></div>;
  if (!admissions.length) return (
    <EmptyState
      icon={User}
      title="No active admissions"
      description="Admit a patient using the button above to track inpatients."
    />
  );

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-gray-50 border-b border-gray-100">
          <tr>
            {['Patient', 'Bed / Ward', 'Admitted', 'Diagnosis', 'Status', ''].map(h => (
              <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {admissions.map(a => (
            <tr key={a.id} className="hover:bg-gray-50/50">
              <td className="px-4 py-3">
                <div className="font-medium text-gray-900">{a.patient?.firstName} {a.patient?.lastName}</div>
                <div className="text-xs text-gray-400 font-mono">{a.patient?.universalPatientId}</div>
              </td>
              <td className="px-4 py-3">
                <div className="font-mono text-gray-700">{a.bed?.bedNumber || '—'}</div>
                <div className="text-xs text-gray-400">{a.bed?.ward || ''}</div>
              </td>
              <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                {a.admittedAt ? format(new Date(a.admittedAt), 'dd MMM yyyy') : '—'}
              </td>
              <td className="px-4 py-3 text-gray-600 max-w-40 truncate">{a.diagnosis || '—'}</td>
              <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
              <td className="px-4 py-3">
                {a.status === 'ADMITTED' && (
                  <button onClick={() => onDischarge(a.id)}
                    className="flex items-center gap-1 text-xs text-orange-600 hover:underline">
                    <LogOut size={12} /> Discharge
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdmitModal({ open, onClose, beds }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ patientUpid: '', bedId: '', diagnosis: '', notes: '' });
  const [patient, setPatient] = useState(null);
  const [resolving, setResolving] = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const availableBeds = beds.filter(b => b.status === 'AVAILABLE');

  const resolve = async () => {
    if (!form.patientUpid) return;
    setResolving(true);
    try {
      const { data } = await api.get(`/patients/resolve/${form.patientUpid.trim()}`);
      setPatient(data);
    } catch {
      toast.error('Patient not found');
      setPatient(null);
    } finally {
      setResolving(false);
    }
  };

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post('/admissions', {
      patientId: patient.id,
      bedId: form.bedId || undefined,
      diagnosis: form.diagnosis,
      notes: form.notes,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admissions'] });
      qc.invalidateQueries({ queryKey: ['beds'] });
      toast.success('Patient admitted');
      onClose();
      setForm({ patientUpid: '', bedId: '', diagnosis: '', notes: '' });
      setPatient(null);
    },
    onError: err => toast.error(err.response?.data?.error || 'Admission failed'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Admit Patient" size="sm">
      <div className="p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Patient ID / Hosp No / Phone <span className="text-red-500">*</span></label>
          <div className="flex gap-2">
            <input value={form.patientUpid} onChange={set('patientUpid')} placeholder="AWB-XXXXXXXX"
              className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 font-mono" />
            <button onClick={resolve} disabled={resolving || !form.patientUpid}
              className="px-3 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50">
              {resolving ? '…' : 'Find'}
            </button>
          </div>
          {patient && (
            <div className="mt-1.5 p-2 bg-green-50 border border-green-200 rounded-lg text-xs">
              <span className="font-semibold text-green-800">{patient.firstName} {patient.lastName}</span>
              <span className="text-green-600 ml-2 font-mono">{patient.universalPatientId}</span>
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Assign Bed</label>
          <select value={form.bedId} onChange={set('bedId')}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30">
            <option value="">Auto-assign / No preference</option>
            {availableBeds.map(b => (
              <option key={b.id} value={b.id}>{b.bedNumber} — {b.ward} ({b.type})</option>
            ))}
          </select>
          {!availableBeds.length && (
            <p className="text-xs text-orange-600 mt-1">No available beds</p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Admitting Diagnosis</label>
          <input value={form.diagnosis} onChange={set('diagnosis')} placeholder="e.g. Malaria with severe anaemia"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <textarea value={form.notes} onChange={set('notes')} rows={2}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none" />
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutate()} disabled={isPending || !patient}
            className="flex-1 py-2.5 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50">
            {isPending ? 'Admitting…' : 'Admit Patient'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
