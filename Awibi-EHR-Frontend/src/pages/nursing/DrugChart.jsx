import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pill, Plus, X, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useSelector } from 'react-redux';
import api from '../../lib/api';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import { can } from '../../lib/permissions';
import PatientPicker from '../../components/clinical/PatientPicker';

const ROUTES = ['ORAL', 'IV', 'IM', 'SC', 'TOPICAL', 'RECTAL', 'INHALATION', 'SUBLINGUAL', 'OTHER'];
const STATUSES = ['GIVEN', 'MISSED', 'REFUSED', 'HELD'];
const STATUS_STYLES = {
  GIVEN:   'bg-green-50 text-green-700 border-green-200',
  MISSED:  'bg-red-50 text-red-700 border-red-200',
  REFUSED: 'bg-amber-50 text-amber-700 border-amber-200',
  HELD:    'bg-gray-100 text-gray-600 border-gray-200',
};

function RecordDoseModal({ open, onClose, patientId, prescription }) {
  const qc = useQueryClient();
  const [dose, setDose] = useState('');
  const [route, setRoute] = useState('');
  const [status, setStatus] = useState('GIVEN');
  const [balance, setBalance] = useState('');
  const [reason, setReason] = useState('');
  const [drugName, setDrugName] = useState('');
  const [notes, setNotes] = useState('');

  const unscheduled = !prescription;
  // The API rejects a deviation without justification; mirror that in the UI.
  const reasonRequired = unscheduled || status !== 'GIVEN';

  const { mutate, isPending } = useMutation({
    mutationFn: (body) => api.post('/nursing/drug-administrations', body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drug-chart', patientId] });
      toast.success('Administration recorded');
      setDose(''); setRoute(''); setStatus('GIVEN'); setBalance(''); setReason(''); setDrugName(''); setNotes('');
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not record administration'),
  });

  if (!open) return null;

  function submit() {
    if (unscheduled && !drugName.trim()) return toast.error('Enter the drug name');
    if (reasonRequired && !reason.trim()) {
      return toast.error(unscheduled ? 'An unscheduled dose needs a reason' : `A ${status.toLowerCase()} dose needs a reason`);
    }
    mutate({
      patientId,
      prescriptionId: prescription?.id,
      drugName: unscheduled ? drugName.trim() : undefined,
      dose: dose || undefined,
      route: route || undefined,
      status,
      balanceRemaining: balance ? Number(balance) : undefined,
      reason: reason.trim() || undefined,
      notes: notes || undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">
            {prescription ? `Give ${prescription.drugName}` : 'Unscheduled administration'}
          </h2>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 flex items-center justify-center rounded-lg hover:bg-gray-100"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4">
          {unscheduled && (
            <div className="flex gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>No prescription linked. This will be flagged as unscheduled and needs a reason.</span>
            </div>
          )}
          {unscheduled && (
            <div>
              <label htmlFor="dc-drug" className="block text-sm font-medium text-gray-700 mb-1.5">Drug name *</label>
              <input id="dc-drug" value={drugName} onChange={e => setDrugName(e.target.value)}
                placeholder="e.g. Adrenaline 1mg"
                className="w-full min-h-[48px] px-3 border border-gray-300 rounded-lg text-sm" />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="dc-dose" className="block text-sm font-medium text-gray-700 mb-1.5">Dose given</label>
              <input id="dc-dose" value={dose} onChange={e => setDose(e.target.value)}
                placeholder={prescription?.dosage || 'e.g. 5mg'}
                className="w-full min-h-[48px] px-3 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label htmlFor="dc-route" className="block text-sm font-medium text-gray-700 mb-1.5">Route</label>
              <select id="dc-route" value={route} onChange={e => setRoute(e.target.value)}
                className="w-full min-h-[48px] px-3 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="">{prescription?.route || 'Select…'}</option>
                {ROUTES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="dc-status" className="block text-sm font-medium text-gray-700 mb-1.5">Status</label>
              <select id="dc-status" value={status} onChange={e => setStatus(e.target.value)}
                className="w-full min-h-[48px] px-3 border border-gray-300 rounded-lg text-sm bg-white">
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="dc-balance" className="block text-sm font-medium text-gray-700 mb-1.5">Balance remaining</label>
              <input id="dc-balance" type="number" inputMode="decimal" value={balance} onChange={e => setBalance(e.target.value)}
                placeholder="e.g. 250 (ml left)"
                className="w-full min-h-[48px] px-3 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>

          <div>
            <label htmlFor="dc-reason" className="block text-sm font-medium text-gray-700 mb-1.5">
              Reason {reasonRequired && <span className="text-red-600">*</span>}
            </label>
            <input id="dc-reason" value={reason} onChange={e => setReason(e.target.value)}
              placeholder={reasonRequired ? 'Required — why did this deviate?' : 'Optional'}
              className={`w-full min-h-[48px] px-3 border rounded-lg text-sm ${reasonRequired && !reason ? 'border-red-300' : 'border-gray-300'}`} />
          </div>

          <div>
            <label htmlFor="dc-notes" className="block text-sm font-medium text-gray-700 mb-1.5">Notes</label>
            <textarea id="dc-notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-5 py-3 flex gap-3">
          <button onClick={onClose} className="flex-1 min-h-[48px] border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={isPending}
            className="flex-1 min-h-[48px] bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50">
            {isPending ? 'Saving…' : 'Record'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DrugChart() {
  const [patientId, setPatientId] = useState('');
  const [modal, setModal] = useState({ open: false, prescription: null });
  const user = useSelector(s => s.auth?.user);
  const mayWrite = can(user?.role, user?.subRole, 'drug_admin_write');

  const { data, isLoading } = useQuery({
    queryKey: ['drug-chart', patientId],
    queryFn: () => api.get(`/nursing/drug-chart/${patientId}`).then(r => r.data),
    enabled: Boolean(patientId),
  });

  const prescriptions = data?.prescriptions || [];
  const unscheduled = data?.unscheduled || [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Drug chart</h1>
        <p className="text-sm text-gray-500">Medication administration record — oral, IV, IM and more</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <PatientPicker id="dc-patient" value={patientId} onChange={setPatientId} autoFocus />
      </div>

      {!patientId ? (
        <div className="bg-white rounded-xl border border-gray-200">
          <EmptyState icon={Pill} title="Choose a patient" description="Select a patient to see their prescribed medicines and record administrations." />
        </div>
      ) : isLoading ? (
        <div className="py-16 flex justify-center"><Spinner size="lg" /></div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="font-semibold text-gray-900 text-sm">Prescribed medicines ({prescriptions.length})</span>
              {mayWrite && (
                <button onClick={() => setModal({ open: true, prescription: null })}
                  className="flex items-center gap-1.5 px-3 min-h-[44px] border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">
                  <Plus size={15} /> Unscheduled
                </button>
              )}
            </div>
            {!prescriptions.length ? (
              <div className="py-10 text-center text-sm text-gray-500">
                No active prescriptions. A doctor must prescribe before scheduled doses appear here.
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {prescriptions.map(p => (
                  <div key={p.id} className="p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900">{p.drugName}</div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {[p.dosage, p.frequency, p.duration, p.route].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      {mayWrite && (
                        <button onClick={() => setModal({ open: true, prescription: p })}
                          className="px-4 min-h-[44px] bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] shrink-0">
                          Give dose
                        </button>
                      )}
                    </div>
                    {p.administrations?.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {p.administrations.map(a => (
                          <span key={a.id} className={`px-2 py-1 rounded border text-xs ${STATUS_STYLES[a.status]}`}>
                            {a.status} {a.administeredAt ? `· ${format(new Date(a.administeredAt), 'dd MMM HH:mm')}` : ''} {a.dose ? `· ${a.dose}` : ''} {a.route ? `· ${a.route}` : ''}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {unscheduled.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-900 text-sm flex items-center gap-2">
                <AlertTriangle size={15} className="text-amber-600" /> Unscheduled administrations ({unscheduled.length})
              </div>
              <div className="divide-y divide-gray-100">
                {unscheduled.map(a => (
                  <div key={a.id} className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-gray-900">{a.drugName}</span>
                      <span className={`px-2 py-0.5 rounded border text-xs ${STATUS_STYLES[a.status]}`}>{a.status}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {[a.dose, a.route, a.administeredAt && format(new Date(a.administeredAt), 'dd MMM yyyy HH:mm')].filter(Boolean).join(' · ')}
                    </div>
                    {a.reason && <p className="text-sm text-gray-700 mt-1.5"><span className="text-gray-500">Reason:</span> {a.reason}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <RecordDoseModal open={modal.open} onClose={() => setModal({ open: false, prescription: null })}
        patientId={patientId} prescription={modal.prescription} />
    </div>
  );
}
