import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FlaskConical, Search, CheckCircle, Clock, XCircle, Edit, PlayCircle, Send } from 'lucide-react';
import { format } from 'date-fns';
import api from '@/lib/api';
import PatientPicker from '@/components/clinical/PatientPicker';
import StatusBadge from '@/components/ui/StatusBadge';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import { toast } from 'sonner';
import EmptyState from '@/components/ui/EmptyState';

const TEST_TYPES = ['LAB', 'IMAGING', 'ECG', 'OTHER'];
const PRIORITIES = ['ROUTINE', 'URGENT', 'STAT'];
const TABS = ['ALL', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

const PRIORITY_COLOR = {
  ROUTINE: 'bg-gray-100 text-gray-600',
  URGENT:  'bg-orange-100 text-orange-700',
  STAT:    'bg-red-100 text-red-700',
};

export default function Lab() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('ALL');
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [resultModal, setResultModal] = useState(null);
  const [transferModal, setTransferModal] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['lab', tab, search],
    queryFn: () => api.get('/lab', { params: { status: tab === 'ALL' ? '' : tab, search, limit: 40 } }).then(r => r.data),
  });

  const { data: stats } = useQuery({
    queryKey: ['lab-stats'],
    queryFn: () => api.get('/lab/stats').then(r => r.data),
  });

  const requests = data?.requests || data || [];

  const { mutate: advance } = useMutation({
    mutationFn: ({ id, status }) => api.put(`/lab/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab'] });
      qc.invalidateQueries({ queryKey: ['lab-stats'] });
      toast.success('Status updated');
    },
    onError: () => toast.error('Failed to update'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Diagnostics</h1>
          <p className="text-sm text-gray-500">Laboratory investigations, imaging and ECG</p>
        </div>
        <button onClick={() => setAddOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]">
          <Plus size={16} /> New Request
        </button>
      </div>

      {/* Stats strip */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Pending',     value: stats.pending,    bg: 'bg-yellow-500', icon: <Clock size={18} /> },
            { label: 'In Progress', value: stats.inProgress, bg: 'bg-[#2D5BFF]', icon: <FlaskConical size={18} /> },
            { label: 'Completed',   value: stats.completed,  bg: 'bg-green-600',  icon: <CheckCircle size={18} /> },
            { label: 'Cancelled',   value: stats.cancelled,  bg: 'bg-red-500',    icon: <XCircle size={18} /> },
          ].map(({ label, value, bg, icon }) => (
            <div key={label} className={`${bg} text-white rounded-xl p-4 flex items-center gap-3`}>
              {icon}
              <div>
                <div className="text-2xl font-extrabold">{value ?? 0}</div>
                <div className="text-sm opacity-80">{label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs + search */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="border-b border-gray-100 px-4 flex gap-0 overflow-x-auto">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${tab === t ? 'border-[#2D5BFF] text-[#2D5BFF]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
        <div className="p-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by patient name or test…"
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 bg-gray-50" />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 flex justify-center"><Spinner /></div>
      ) : requests.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title="No lab requests"
          description="Request a test for a patient to get started."
          action={{ label: 'New Lab Request', onClick: () => setAddOpen(true) }}
        />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Test', 'Patient', 'Type', 'Priority', 'Status', 'Date', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {requests.map(r => (
                <tr key={r.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{r.testName}</div>
                    {r.result && (
                      <div className="text-xs text-green-700 mt-0.5 line-clamp-1">✓ {r.result.slice(0, 60)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-gray-900">{r.patient?.firstName} {r.patient?.lastName}</div>
                    <div className="text-xs font-mono text-gray-400">{r.patient?.universalPatientId}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.testType === 'IMAGING' ? 'bg-purple-100 text-purple-700' : r.testType === 'ECG' ? 'bg-teal-100 text-teal-700' : 'bg-orange-100 text-orange-700'}`}>
                      {r.testType}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLOR[r.priority] || 'bg-gray-100 text-gray-600'}`}>
                      {r.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                    {r.createdAt ? format(new Date(r.createdAt), 'dd MMM HH:mm') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {r.status === 'PENDING' && (
                        <button onClick={() => advance({ id: r.id, status: 'IN_PROGRESS' })}
                          title="Start processing"
                          className="p-1.5 text-gray-400 hover:text-[#2D5BFF] hover:bg-[#2D5BFF]/10 rounded-lg">
                          <PlayCircle size={14} />
                        </button>
                      )}
                      {(r.status === 'PENDING' || r.status === 'IN_PROGRESS') && (
                        <>
                          <button onClick={() => setResultModal(r)}
                            title="Enter result"
                            className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg">
                            <Edit size={14} />
                          </button>
                          <button onClick={() => setTransferModal(r)}
                            title="Transfer to affiliate lab"
                            className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg">
                            <Send size={14} />
                          </button>
                        </>
                      )}
                      {r.status === 'IN_PROGRESS' && (
                        <button onClick={() => advance({ id: r.id, status: 'CANCELLED' })}
                          title="Cancel"
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                          <XCircle size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && <NewLabModal open={addOpen} onClose={() => setAddOpen(false)} />}
      {resultModal && <ResultModal request={resultModal} onClose={() => setResultModal(null)} />}
      {transferModal && <TransferModal request={transferModal} onClose={() => setTransferModal(null)} />}
    </div>
  );
}

function NewLabModal({ open, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    patientId: '', caseId: '', testName: '', testType: 'LAB',
    priority: 'ROUTINE', requestNotes: '',
  });
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const COMMON_TESTS = {
    LAB:     ['Full Blood Count (FBC)', 'Malaria RDT', 'Fasting Blood Sugar', 'HbA1c', 'Urinalysis', 'Liver Function Test', 'Renal Function Test', 'Widal Test', 'Genotype', 'Blood Group'],
    IMAGING: ['Chest X-Ray', 'Abdominal Ultrasound', 'Pelvic Ultrasound', 'Echocardiogram', 'CT Scan - Head', 'MRI - Spine'],
    ECG:     ['12-Lead ECG', '24hr Holter Monitor'],
    OTHER:   ['Other'],
  };

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post('/lab', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab'] });
      qc.invalidateQueries({ queryKey: ['lab-stats'] });
      toast.success('Lab request created');
      onClose();
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed'),
  });

  return (
    <Modal open={open} onClose={onClose} title="New Lab / Imaging Request" size="md">
      <div className="p-6 space-y-4">
        <PatientPicker value={form.patientId} onChange={(id) => setForm(f => ({ ...f, patientId: id }))} required autoFocus />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Test Type</label>
            <select value={form.testType} onChange={set('testType')}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30">
              {TEST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
            <select value={form.priority} onChange={set('priority')}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30">
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Test Name <span className="text-red-500">*</span></label>
          <input list="test-suggestions" value={form.testName} onChange={set('testName')}
            placeholder="e.g. Full Blood Count, Chest X-Ray"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
          <datalist id="test-suggestions">
            {(COMMON_TESTS[form.testType] || []).map(t => <option key={t} value={t} />)}
          </datalist>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Clinical Notes</label>
          <textarea value={form.requestNotes} onChange={set('requestNotes')} rows={2}
            placeholder="Relevant clinical information for the lab…"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none" />
        </div>

        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutate()}
            disabled={isPending || !form.patientId || !form.testName}
            className="flex-1 py-2.5 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50">
            {isPending ? 'Creating…' : 'Create Request'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Interprets a typed value against the request's reference range so the operator
// sees the flag BEFORE saving. The backend recomputes this authoritatively.
function previewFlag(value, req) {
  if (value === '' || value == null || !Number.isFinite(Number(value))) return null;
  const v = Number(value);
  const { referenceLow: lo, referenceHigh: hi } = req || {};
  if (lo == null && hi == null) return null;
  if (lo != null && v < Number(lo)) return { label: 'LOW', tone: 'amber' };
  if (hi != null && v > Number(hi)) return { label: 'HIGH', tone: 'amber' };
  return { label: 'NORMAL', tone: 'green' };
}

function ResultModal({ request, onClose }) {
  const qc = useQueryClient();
  const isImaging = request?.testType === 'IMAGING' || request?.testType === 'ECG';

  const [resultValue, setResultValue] = useState(request?.resultValue ?? '');
  const [result, setResult] = useState(request?.result || '');
  const [notes, setNotes] = useState(request?.aiDraft || '');
  const [findings, setFindings] = useState(request?.reportFindings || '');
  const [impression, setImpression] = useState(request?.reportImpression || '');
  const [preliminary, setPreliminary] = useState(false);

  const flag = previewFlag(resultValue, request);
  const isCorrection = request?.status === 'COMPLETED' || request?.status === 'CORRECTED';

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.put(`/lab/${request.id}/result`, {
      result: result || undefined,
      aiDraft: notes || undefined,
      resultValue: resultValue === '' ? undefined : Number(resultValue),
      reportFindings: findings || undefined,
      reportImpression: impression || undefined,
      preliminary: preliminary || undefined,
    }),
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ['lab'] });
      qc.invalidateQueries({ queryKey: ['lab-stats'] });
      qc.invalidateQueries({ queryKey: ['critical-alerts'] });
      if (data?.isCritical) {
        toast.error(`CRITICAL result (${data.abnormalFlag?.replace('_', ' ')}) — the ordering clinician must acknowledge it.`, { duration: 10000 });
      } else {
        toast.success(data?.status === 'CORRECTED' ? 'Result corrected' : 'Result submitted');
      }
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed to submit result'),
  });

  const canSubmit = isImaging ? Boolean(findings || impression || result) : (resultValue !== '' || Boolean(result));

  return (
    <Modal open={!!request} onClose={onClose} title={`${isCorrection ? 'Correct' : 'Enter'} Result — ${request?.testName}`} size="md">
      <div className="p-6 space-y-4">
        <div className="bg-[#2D5BFF]/5 rounded-xl p-3 text-xs">
          <span className="font-medium text-gray-900">{request?.patient?.firstName} {request?.patient?.lastName}</span>
          <span className="text-[#2D5BFF] ml-2">{request?.testType} · {request?.priority}</span>
          {request?.specimenId && <span className="text-gray-500 ml-2">Specimen {request.specimenId}</span>}
        </div>

        {isCorrection && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
            This result is already final. Saving records a <strong>correction</strong> — the original stays in the audit trail
            and the ordering clinician must review it again.
          </div>
        )}

        {!isImaging && (
          <div>
            <label htmlFor="rv" className="block text-xs font-medium text-gray-700 mb-1">
              Numeric result {request?.resultUnit ? `(${request.resultUnit})` : ''}
            </label>
            <div className="flex items-center gap-2">
              <input id="rv" type="number" step="any" inputMode="decimal" value={resultValue}
                onChange={e => setResultValue(e.target.value)}
                className="flex-1 min-h-[48px] px-3 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
              {flag && (
                <span className={`px-2.5 py-1.5 rounded-lg text-xs font-bold ${
                  flag.tone === 'green' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'
                }`}>{flag.label}</span>
              )}
            </div>
            {(request?.referenceLow != null || request?.referenceHigh != null) && (
              <p className="text-xs text-gray-500 mt-1">
                Reference: {request.referenceLow ?? '—'}–{request.referenceHigh ?? '—'} {request.resultUnit || ''}
                <span className="ml-1 text-gray-400">· critical values are flagged automatically on save</span>
              </p>
            )}
          </div>
        )}

        {isImaging ? (
          <>
            <div>
              <label htmlFor="rf" className="block text-xs font-medium text-gray-700 mb-1">Findings</label>
              <textarea id="rf" rows={4} value={findings} onChange={e => setFindings(e.target.value)}
                placeholder="Describe what is seen on the study…"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none" />
            </div>
            <div>
              <label htmlFor="ri" className="block text-xs font-medium text-gray-700 mb-1">Impression</label>
              <textarea id="ri" rows={2} value={impression} onChange={e => setImpression(e.target.value)}
                placeholder="Radiological conclusion…"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none" />
            </div>
          </>
        ) : (
          <div>
            <label htmlFor="rt" className="block text-xs font-medium text-gray-700 mb-1">Result narrative / observations</label>
            <textarea id="rt" rows={4} value={result} onChange={e => setResult(e.target.value)}
              placeholder="Free-text result, morphology, comments…"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none font-mono" />
          </div>
        )}

        <div>
          <label htmlFor="rn" className="block text-xs font-medium text-gray-700 mb-1">Interpretation / notes</label>
          <textarea id="rn" rows={2} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Clinical interpretation, recommendations, follow-up…"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none" />
        </div>

        {!isCorrection && (
          <label className="flex items-center gap-2 min-h-[44px] cursor-pointer">
            <input type="checkbox" checked={preliminary} onChange={e => setPreliminary(e.target.checked)} className="w-5 h-5 rounded border-gray-300" />
            <span className="text-sm text-gray-700">Save as preliminary (not yet final)</span>
          </label>
        )}

        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 min-h-[48px] border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutate()}
            disabled={isPending || !canSubmit}
            className="flex-1 min-h-[48px] bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
            {isPending ? 'Submitting…' : isCorrection ? 'Save correction' : preliminary ? 'Save preliminary' : 'Submit result'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function TransferModal({ request, onClose }) {
  const qc = useQueryClient();
  const [affiliateId, setAffiliateId] = useState('');
  const [notes, setNotes] = useState('');

  const { data: aData } = useQuery({
    queryKey: ['affiliates'],
    queryFn: () => api.get('/affiliates').then(r => r.data),
  });
  const affiliates = (aData?.affiliates || aData || []).filter(a =>
    a.type === 'LAB' || a.type === 'IMAGING'
  );

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.put(`/lab/${request.id}`, { status: 'IN_PROGRESS', affiliateId, transferNotes: notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab'] });
      toast.success('Request transferred to affiliate');
      onClose();
    },
    onError: () => toast.error('Transfer failed'),
  });

  return (
    <Modal open={!!request} onClose={onClose} title="Transfer to Affiliate Lab" size="sm">
      <div className="p-6 space-y-4">
        <div className="bg-gray-50 rounded-xl p-3 text-xs">
          <span className="font-medium">{request?.testName}</span>
          <span className="text-gray-500 ml-2">for {request?.patient?.firstName} {request?.patient?.lastName}</span>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Affiliate Lab / Imaging Centre</label>
          {affiliates.length === 0 ? (
            <p className="text-xs text-orange-600 p-3 bg-orange-50 rounded-lg">No affiliated labs configured. Add affiliates under the Affiliates section.</p>
          ) : (
            <select value={affiliateId} onChange={e => setAffiliateId(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30">
              <option value="">Select affiliate…</option>
              {affiliates.map(a => (
                <option key={a.id} value={a.id}>{a.name} ({a.type})</option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Transfer Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            placeholder="Any special instructions for the affiliate…"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none" />
        </div>

        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutate()}
            disabled={isPending || !affiliateId}
            className="flex-1 py-2.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
            {isPending ? 'Transferring…' : 'Transfer'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
