import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus, X, Check } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useSelector } from 'react-redux';
import api from '../../lib/api';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import { can } from '../../lib/permissions';
import PatientPicker from '../../components/clinical/PatientPicker';

const SHIFTS = ['MORNING', 'AFTERNOON', 'NIGHT'];

// SBAR is the standard structure for handing over between shifts.
const SBAR = [
  { key: 'situation',      label: 'Situation',      hint: 'What is happening right now?' },
  { key: 'background',     label: 'Background',     hint: 'Relevant history and context' },
  { key: 'assessment',     label: 'Assessment',     hint: 'What you think is going on' },
  { key: 'recommendation', label: 'Recommendation', hint: 'What the next shift should do' },
];

function NewHandoverModal({ open, onClose }) {
  const qc = useQueryClient();
  const [patientId, setPatientId] = useState('');
  const [shift, setShift] = useState('MORNING');
  const [form, setForm] = useState({ situation: '', background: '', assessment: '', recommendation: '' });
  const [tasks, setTasks] = useState(['']);

  const { mutate, isPending } = useMutation({
    mutationFn: (body) => api.post('/nursing/handover', body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['handover'] });
      toast.success('Shift report recorded');
      setForm({ situation: '', background: '', assessment: '', recommendation: '' });
      setTasks(['']); setPatientId('');
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not save the shift report'),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">New shift report</h2>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 flex items-center justify-center rounded-lg hover:bg-gray-100"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <PatientPicker id="ho-patient" value={patientId} onChange={setPatientId}
              label="Patient (optional)" placeholder="Leave empty for a ward-wide report" />
            <div>
              <span className="block text-sm font-medium text-gray-700 mb-1.5">Shift</span>
              <div className="flex gap-2">
                {SHIFTS.map(s => (
                  <button key={s} type="button" onClick={() => setShift(s)}
                    className={`flex-1 min-h-[48px] rounded-lg border text-sm font-medium ${
                      shift === s ? 'border-[#2D5BFF] bg-[#2D5BFF]/5 text-[#2D5BFF]' : 'border-gray-200 hover:bg-gray-50'
                    }`}>
                    {s[0] + s.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {SBAR.map(s => (
            <div key={s.key}>
              <label htmlFor={`ho-${s.key}`} className="block text-sm font-medium text-gray-700 mb-1.5">{s.label}</label>
              <textarea id={`ho-${s.key}`} rows={2} placeholder={s.hint}
                value={form[s.key]} onChange={e => setForm(f => ({ ...f, [s.key]: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
            </div>
          ))}

          <div>
            <span className="block text-sm font-medium text-gray-700 mb-1.5">Outstanding tasks</span>
            {tasks.map((t, i) => (
              <input key={i} value={t} placeholder="e.g. Repeat FBC at 06:00"
                onChange={e => setTasks(ts => ts.map((x, j) => j === i ? e.target.value : x))}
                className="w-full min-h-[48px] px-3 border border-gray-300 rounded-lg text-sm mb-2" />
            ))}
            <button type="button" onClick={() => setTasks(ts => [...ts, ''])} className="text-sm text-[#2D5BFF] font-medium min-h-[44px]">
              + Add task
            </button>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-5 py-3 flex gap-3">
          <button onClick={onClose} className="flex-1 min-h-[48px] border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => mutate({
              patientId: patientId || undefined, shift, ...form,
              outstandingTasks: tasks.map(t => t.trim()).filter(Boolean),
            })}
            disabled={isPending}
            className="flex-1 min-h-[48px] bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50">
            {isPending ? 'Saving…' : 'Save shift report'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Handover() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const user = useSelector(s => s.auth?.user);
  const mayWrite = can(user?.role, user?.subRole, 'handover_write');

  const { data, isLoading } = useQuery({
    queryKey: ['handover'],
    queryFn: () => api.get('/nursing/handover', { params: { limit: 50 } }).then(r => r.data),
  });

  const { mutate: acknowledge } = useMutation({
    mutationFn: (id) => api.post(`/nursing/handover/${id}/acknowledge`).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['handover'] }); toast.success('Shift report acknowledged'); },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not acknowledge'),
  });

  const notes = data?.notes || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Shift report</h1>
          <p className="text-sm text-gray-500">SBAR report passed between nursing shifts</p>
        </div>
        {mayWrite && (
          <button onClick={() => setOpen(true)}
            className="flex items-center justify-center gap-2 px-4 min-h-[48px] bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]">
            <Plus size={16} /> New shift report
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="py-16 flex justify-center"><Spinner size="lg" /></div>
        ) : !notes.length ? (
          <EmptyState icon={ClipboardList} title="No shift reports"
            description="Record a structured SBAR report so the next shift knows exactly what is outstanding." />
        ) : (
          <div className="divide-y divide-gray-100">
            {notes.map(n => (
              <div key={n.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-[#2D5BFF]/10 text-[#2D5BFF] rounded text-xs font-medium">{n.shift}</span>
                    <span className="text-sm text-gray-600">
                      {n.patient ? `${n.patient.firstName} ${n.patient.lastName}` : 'Ward-wide'}
                    </span>
                    <span className="text-xs text-gray-400">{n.shiftDate ? format(new Date(n.shiftDate), 'dd MMM yyyy') : ''}</span>
                  </div>
                  {n.acknowledgedAt ? (
                    <span className="flex items-center gap-1 text-xs text-green-700 font-medium"><Check size={13} /> Acknowledged</span>
                  ) : mayWrite ? (
                    <button onClick={() => acknowledge(n.id)}
                      className="px-3 min-h-[44px] border border-gray-300 rounded-lg text-xs font-medium hover:bg-gray-50">
                      Acknowledge
                    </button>
                  ) : null}
                </div>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {SBAR.map(s => n[s.key] ? (
                    <div key={s.key}>
                      <div className="text-xs font-medium text-gray-500">{s.label}</div>
                      <p className="text-sm text-gray-800">{n[s.key]}</p>
                    </div>
                  ) : null)}
                </div>

                {Array.isArray(n.outstandingTasks) && n.outstandingTasks.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-medium text-gray-500 mb-1">Outstanding</div>
                    <ul className="list-disc list-inside space-y-0.5">
                      {n.outstandingTasks.map((t, i) => <li key={i} className="text-sm text-gray-700">{t}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <NewHandoverModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
