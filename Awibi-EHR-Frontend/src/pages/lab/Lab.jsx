import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { Plus, FlaskConical, Search, CheckCircle, Clock, XCircle, Edit, PlayCircle, Send, Eye, TestTube2 } from 'lucide-react';
import { format } from 'date-fns';
import api from '@/lib/api';
import PatientPicker from '@/components/clinical/PatientPicker';
import StatusBadge from '@/components/ui/StatusBadge';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import { toast } from 'sonner';
import EmptyState from '@/components/ui/EmptyState';
import { can } from '@/lib/permissions';

const TEST_TYPES = ['LAB', 'IMAGING', 'ECG', 'OTHER'];
const PRIORITIES = ['ROUTINE', 'URGENT', 'STAT'];
const TABS = ['ALL', 'PENDING', 'COLLECTED', 'IN_PROGRESS', 'PRELIMINARY', 'COMPLETED', 'CORRECTED', 'CANCELLED'];

const PRIORITY_COLOR = {
  ROUTINE: 'bg-gray-100 text-gray-600',
  URGENT:  'bg-orange-100 text-orange-700',
  STAT:    'bg-red-100 text-red-700',
};

export default function Lab() {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const presetPatientId = searchParams.get('patientId') || '';
  const { user } = useSelector((state) => state.auth);
  const role = user?.role?.toUpperCase() || '';
  const subRole = user?.subRole?.toUpperCase() || '';
  const canOrder = can(role, subRole, 'diagnostic_order');
  const canProcess = can(role, subRole, 'diagnostic_process');
  const canReview = can(role, subRole, 'clinical_write');
  const canRelease = canProcess || canReview;
  const [tab, setTab] = useState('ALL');
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(Boolean(presetPatientId));
  const [resultModal, setResultModal] = useState(null);
  const [detailModal, setDetailModal] = useState(null);
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
    mutationFn: ({ id, status }) => api.post(`/lab/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab'] });
      qc.invalidateQueries({ queryKey: ['lab-stats'] });
      toast.success('Status updated');
    },
    onError: () => toast.error('Failed to update'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Diagnostics</h1>
          <p className="text-sm text-gray-500">Laboratory investigations, imaging and ECG</p>
        </div>
        {canOrder && (
          <button onClick={() => setAddOpen(true)}
            className="flex items-center gap-2 min-h-11 px-4 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]">
            <Plus size={16} /> Order investigation
          </button>
        )}
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
          action={canOrder ? { label: 'Order investigation', onClick: () => setAddOpen(true) } : undefined}
        />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
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
                    <div className="text-xs text-gray-500 mt-0.5">
                      {demographicLabel(r)}
                    </div>
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
                      <button onClick={() => setDetailModal(r)}
                        title="View complete request and result"
                        className="p-1.5 text-gray-400 hover:text-[#2D5BFF] hover:bg-[#2D5BFF]/10 rounded-lg">
                        <Eye size={14} />
                      </button>
                      {canProcess && r.status === 'PENDING' && (
                        <button onClick={() => advance({ id: r.id, status: r.testType === 'LAB' ? 'COLLECTED' : 'IN_PROGRESS' })}
                          title={r.testType === 'LAB' ? 'Record specimen collected' : 'Start processing'}
                          className="p-1.5 text-gray-400 hover:text-[#2D5BFF] hover:bg-[#2D5BFF]/10 rounded-lg">
                          {r.testType === 'LAB' ? <TestTube2 size={14} /> : <PlayCircle size={14} />}
                        </button>
                      )}
                      {canProcess && r.status === 'COLLECTED' && (
                        <button onClick={() => advance({ id: r.id, status: 'IN_PROGRESS' })}
                          title="Receive and start processing"
                          className="p-1.5 text-gray-400 hover:text-[#2D5BFF] hover:bg-[#2D5BFF]/10 rounded-lg">
                          <PlayCircle size={14} />
                        </button>
                      )}
                      {canProcess && ['IN_PROGRESS', 'PRELIMINARY', 'COMPLETED', 'CORRECTED'].includes(r.status) && (
                        <>
                          <button onClick={() => setResultModal(r)}
                            title={['COMPLETED', 'CORRECTED'].includes(r.status) ? 'Enter audited correction' : 'Enter result'}
                            className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg">
                            <Edit size={14} />
                          </button>
                        </>
                      )}
                      {canProcess && ['PENDING', 'COLLECTED', 'IN_PROGRESS'].includes(r.status) && (
                        <button onClick={() => setTransferModal(r)}
                          title="Refer to affiliate diagnostic provider"
                          className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg">
                          <Send size={14} />
                        </button>
                      )}
                      {canProcess && r.status === 'IN_PROGRESS' && (
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

      {addOpen && <NewLabModal open={addOpen} onClose={() => setAddOpen(false)} initialPatientId={presetPatientId} />}
      {resultModal && <ResultModal request={resultModal} onClose={() => setResultModal(null)} />}
      {detailModal && <ResultViewerModal request={detailModal} canReview={canReview} canRelease={canRelease} onClose={() => setDetailModal(null)} />}
      {transferModal && <TransferModal request={transferModal} onClose={() => setTransferModal(null)} />}
    </div>
  );
}

function NewLabModal({ open, onClose, initialPatientId = '' }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    patientId: initialPatientId, caseId: '', catalogueTestId: '', customTestName: '', testType: 'LAB',
    priority: 'ROUTINE', notes: '',
  });
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const { data: catalogueData, isLoading: catalogueLoading } = useQuery({
    queryKey: ['diagnostic-catalogue'],
    queryFn: () => api.get('/lab/catalogue').then((response) => response.data),
    enabled: open,
  });
  const tests = (catalogueData?.tests || []).filter((test) => test.testType === form.testType);
  const selectedTest = tests.find((test) => test.id === form.catalogueTestId);

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post('/lab', {
      patientId: form.patientId,
      caseId: form.caseId || undefined,
      testType: form.testType,
      priority: form.priority,
      notes: form.notes || undefined,
      catalogueTestId: form.catalogueTestId && form.catalogueTestId !== '__OTHER__' ? form.catalogueTestId : undefined,
      testName: form.catalogueTestId === '__OTHER__' ? form.customTestName.trim() : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab'] });
      qc.invalidateQueries({ queryKey: ['lab-stats'] });
      toast.success('Investigation ordered');
      onClose();
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Order investigation" size="md">
      <div className="p-6 space-y-4">
        <PatientPicker value={form.patientId} onChange={(id) => setForm(f => ({ ...f, patientId: id }))} required autoFocus />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Test Type</label>
            <select value={form.testType} onChange={(event) => setForm((current) => ({
              ...current,
              testType: event.target.value,
              catalogueTestId: '',
              customTestName: '',
            }))}
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
          <label className="block text-xs font-medium text-gray-700 mb-1">Investigation <span className="text-red-500">*</span></label>
          <select value={form.catalogueTestId} onChange={set('catalogueTestId')} disabled={catalogueLoading}
            className="w-full min-h-11 px-3 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30">
            <option value="">{catalogueLoading ? 'Loading facility catalogue…' : 'Choose from the facility catalogue…'}</option>
            {tests.map((test) => (
              <option key={test.id} value={test.id}>
                {test.name}{test.category ? ` — ${test.category}` : ''}
              </option>
            ))}
            <option value="__OTHER__">Other / not yet in catalogue</option>
          </select>
          {form.catalogueTestId === '__OTHER__' && (
            <input value={form.customTestName} onChange={set('customTestName')}
              placeholder="Name the investigation exactly"
              className="w-full min-h-11 mt-2 px-3 border border-amber-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-300/40" />
          )}
          {selectedTest && (
            <p className="text-xs text-gray-500 mt-1">
              {[selectedTest.category, selectedTest.specimenType, selectedTest.turnaroundHours ? `${selectedTest.turnaroundHours}h target` : null]
                .filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Clinical Notes</label>
          <textarea value={form.notes} onChange={set('notes')} rows={3}
            placeholder="Relevant clinical information for the lab…"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none" />
        </div>

        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutate()}
            disabled={isPending || !form.patientId || !form.catalogueTestId || (form.catalogueTestId === '__OTHER__' && !form.customTestName.trim())}
            className="flex-1 py-2.5 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50">
            {isPending ? 'Ordering…' : 'Place order'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ageOn(dateOfBirth, at = new Date()) {
  if (!dateOfBirth) return null;
  const birth = new Date(dateOfBirth);
  const reference = new Date(at);
  if (Number.isNaN(birth.getTime()) || birth > reference) return null;
  let years = reference.getFullYear() - birth.getFullYear();
  const beforeBirthday = reference.getMonth() < birth.getMonth()
    || (reference.getMonth() === birth.getMonth() && reference.getDate() < birth.getDate());
  if (beforeBirthday) years -= 1;
  return years;
}

function demographicLabel(request) {
  const dateOfBirth = request.patientDateOfBirthAtOrder || request.patient?.dateOfBirth;
  const gender = request.patientGenderAtOrder || request.patient?.gender;
  const age = ageOn(dateOfBirth, request.createdAt || new Date());
  return [age == null ? 'Age not recorded' : `Age ${age}`, gender ? gender.replaceAll('_', ' ') : 'Gender not recorded'].join(' · ');
}

function ResultViewerModal({ request, canReview, canRelease, onClose }) {
  const qc = useQueryClient();
  const isImaging = request.testType === 'IMAGING' || request.testType === 'ECG';
  const attachments = Array.isArray(request.attachments) ? request.attachments : [];
  const isReported = ['PRELIMINARY', 'COMPLETED', 'CORRECTED'].includes(request.status);
  const isFinal = ['COMPLETED', 'CORRECTED'].includes(request.status);

  const review = useMutation({
    mutationFn: () => api.post(`/lab/${request.id}/review`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab'] });
      qc.invalidateQueries({ queryKey: ['alerts'] });
      toast.success('Clinical review recorded in the audit trail');
      onClose();
    },
    onError: (error) => toast.error(error.response?.data?.error || 'Could not record review'),
  });

  const release = useMutation({
    mutationFn: () => api.post(`/lab/${request.id}/transfer`, {}),
    onSuccess: () => toast.success('Result released to the patient’s Awibi Identity inbox'),
    onError: (error) => toast.error(error.response?.data?.error || 'Could not release result'),
  });

  return (
    <Modal open={!!request} onClose={onClose} title={`Investigation — ${request.testName}`} size="lg">
      <div className="p-5 sm:p-6 space-y-5 text-sm">
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl bg-gray-50 p-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Patient</div>
            <div className="font-semibold text-gray-900">{request.patient?.firstName} {request.patient?.lastName}</div>
            <div className="font-mono text-xs text-[#2D5BFF]">{request.patient?.universalPatientId}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Demographics at order</div>
            <div className="font-medium text-gray-900">{demographicLabel(request)}</div>
            <div className="text-xs text-gray-500">
              DOB {request.patientDateOfBirthAtOrder || request.patient?.dateOfBirth
                ? format(new Date(request.patientDateOfBirthAtOrder || request.patient.dateOfBirth), 'dd MMM yyyy')
                : 'not recorded'}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Request</div>
            <div>{request.testType} · {request.priority} · <StatusBadge status={request.status} /></div>
            <div className="text-xs text-gray-500">{request.diagnosticDiscipline || 'General diagnostics'} · version {request.resultVersion || 0}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Ordered by</div>
            <div>{request.requestedBy ? `${request.requestedBy.firstName} ${request.requestedBy.lastName}` : 'Not recorded'}</div>
            <div className="text-xs text-gray-500">{request.createdAt ? format(new Date(request.createdAt), 'dd MMM yyyy, HH:mm') : ''}</div>
          </div>
        </section>

        {request.notes && <ReportBlock title="Clinical question / request notes" text={request.notes} />}
        {request.specimenType && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Specimen</h3>
            <p>{request.specimenType}{request.specimenId ? ` · ${request.specimenId}` : ''}</p>
          </section>
        )}

        {request.resultValue != null && (
          <section className={`rounded-xl border p-4 ${request.isCritical ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}>
            <div className="text-xs uppercase tracking-wide text-gray-500">Structured result</div>
            <div className="text-2xl font-bold text-gray-900">
              {request.resultValue} {request.resultUnit || ''}
              {request.abnormalFlag && <span className="ml-2 text-sm text-red-700">{request.abnormalFlag.replaceAll('_', ' ')}</span>}
            </div>
            {(request.referenceLow != null || request.referenceHigh != null) && (
              <div className="text-xs text-gray-600 mt-1">Reference {request.referenceLow ?? '—'}–{request.referenceHigh ?? '—'} {request.resultUnit || ''}</div>
            )}
          </section>
        )}

        {isImaging && request.reportFindings && <ReportBlock title="Findings" text={request.reportFindings} />}
        {isImaging && request.reportImpression && <ReportBlock title="Impression" text={request.reportImpression} emphasized />}
        {request.result && <ReportBlock title={isImaging ? 'Additional report narrative' : 'Complete result'} text={request.result} />}
        {request.aiDraft && <ReportBlock title="Interpretation / notes" text={request.aiDraft} />}

        {(request.resultFileUrl || attachments.length > 0) && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Files</h3>
            <div className="flex flex-wrap gap-2">
              {request.resultFileUrl && <FileLink href={request.resultFileUrl} label="Open result file" />}
              {attachments.map((attachment, index) => (
                <FileLink key={`${attachment.url || 'attachment'}-${index}`} href={attachment.url} label={attachment.name || `Attachment ${index + 1}`} />
              ))}
            </div>
          </section>
        )}

        {!request.result && !request.reportFindings && !request.reportImpression && request.resultValue == null && (
          <div className="rounded-xl border border-dashed border-gray-300 p-5 text-center text-gray-500">No result has been entered yet.</div>
        )}

        {request.isCritical && !request.criticalAckAt && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
            This critical result remains open. Use the critical-alert panel to acknowledge it, record the action taken, and resolve the safety episode.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {canReview && isReported && !request.reviewedByDoctorAt && (
            <button type="button" disabled={review.isPending || (request.isCritical && !request.criticalAckAt)} onClick={() => review.mutate()}
              className="min-h-11 rounded-lg bg-[#0B1F66] px-4 text-white font-medium disabled:cursor-not-allowed disabled:opacity-50">
              {review.isPending ? 'Recording review…' : 'Mark clinically reviewed'}
            </button>
          )}
          {request.reviewedByDoctorAt && (
            <div className="min-h-11 flex items-center justify-center rounded-lg border border-green-200 bg-green-50 px-4 font-medium text-green-800">
              Clinical review recorded
            </div>
          )}
          {canRelease && isFinal && (
            <button type="button" disabled={release.isPending} onClick={() => release.mutate()}
              className="min-h-11 rounded-lg border border-[#2D5BFF] px-4 font-medium text-[#2D5BFF] disabled:opacity-50">
              {release.isPending ? 'Releasing…' : 'Release to Awibi Identity'}
            </button>
          )}
          <button onClick={onClose} className="min-h-11 rounded-lg bg-gray-900 px-4 text-white font-medium">Close</button>
        </div>
      </div>
    </Modal>
  );
}

function ReportBlock({ title, text, emphasized = false }) {
  return (
    <section className={emphasized ? 'rounded-xl border border-[#2D5BFF]/20 bg-[#2D5BFF]/5 p-4' : ''}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{title}</h3>
      <p className="whitespace-pre-wrap break-words leading-6 text-gray-900">{text}</p>
    </section>
  );
}

function FileLink({ href, label }) {
  if (!href) return null;
  return <a href={href} target="_blank" rel="noreferrer" className="rounded-lg border border-gray-300 px-3 py-2 text-[#2D5BFF] hover:bg-[#2D5BFF]/5">{label}</a>;
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
          <div className="text-gray-600 mt-1">{demographicLabel(request)}</div>
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
    mutationFn: () => api.post(`/lab/${request.id}/refer`, { affiliateId, notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab'] });
      toast.success('Request transferred to affiliate');
      onClose();
    },
    onError: () => toast.error('Transfer failed'),
  });

  return (
    <Modal open={!!request} onClose={onClose} title="Refer to affiliate diagnostic provider" size="sm">
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
