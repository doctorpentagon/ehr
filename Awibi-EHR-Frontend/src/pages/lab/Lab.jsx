import React, { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { Plus, FlaskConical, Search, CheckCircle, Clock, XCircle, Edit, PlayCircle, Send, Eye, TestTube2, ClipboardPlus, ChevronDown, UserRoundCheck, UserPlus, Link2, Keyboard, Mic, Camera, ListChecks, Upload, Square, ShieldCheck, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import api from '@/lib/api';
import PatientPicker from '@/components/clinical/PatientPicker';
import StatusBadge from '@/components/ui/StatusBadge';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import { toast } from 'sonner';
import EmptyState from '@/components/ui/EmptyState';
import { can } from '@/lib/permissions';

const PRIORITIES = ['ROUTINE', 'URGENT', 'STAT'];
const TABS = ['ALL', 'PENDING', 'COLLECTED', 'IN_PROGRESS', 'PRELIMINARY', 'COMPLETED', 'CORRECTED', 'CANCELLED'];
const RESULT_CAPTURE_METHODS = [
  { key: 'TYPE', label: 'Type', icon: Keyboard },
  { key: 'VOICE', label: 'Voice', icon: Mic },
  { key: 'SNAP', label: 'Handwriting', icon: Camera },
  { key: 'GUIDE', label: 'Report guide', icon: ListChecks },
];

const DIAGNOSTIC_SERVICES = [
  { id: 'ALL', label: 'All diagnostics', short: 'All' },
  { id: 'IMAGING', label: 'Imaging & Radiology', short: 'Imaging' },
  { id: 'HAEMATOLOGY', label: 'Haematology', short: 'Haematology' },
  { id: 'CHEMICAL_PATHOLOGY', label: 'Chemical Pathology', short: 'Chemical Pathology' },
  { id: 'MICROBIOLOGY', label: 'Microbiology', short: 'Microbiology' },
  { id: 'HISTOPATHOLOGY', label: 'Histopathology & Morbid Anatomy', short: 'Histopathology' },
];

const ROLE_DISCIPLINE = {
  RADIOLOGIST: 'IMAGING',
  RADIOGRAPHER: 'IMAGING',
  HAEMATOLOGIST: 'HAEMATOLOGY',
  CHEMICAL_PATHOLOGIST: 'CHEMICAL_PATHOLOGY',
  MICROBIOLOGIST: 'MICROBIOLOGY',
  HISTOPATHOLOGIST: 'HISTOPATHOLOGY',
};

function disciplineForTest(test = {}) {
  if (test.testType === 'IMAGING' || test.testType === 'ECG') return 'IMAGING';
  const category = String(test.category || '').toUpperCase();
  if (['HAEMATOLOGY', 'HEMATOLOGY'].includes(category)) return 'HAEMATOLOGY';
  if (['CHEMISTRY', 'CHEMICAL PATHOLOGY'].includes(category)) return 'CHEMICAL_PATHOLOGY';
  if (['MICROBIOLOGY', 'PARASITOLOGY', 'SEROLOGY'].includes(category)) return 'MICROBIOLOGY';
  if (['HISTOPATHOLOGY', 'MORBID ANATOMY', 'ANATOMICAL PATHOLOGY'].includes(category)) return 'HISTOPATHOLOGY';
  return null;
}

function orderDetailGuide(test = {}) {
  const key = `${test.code || ''} ${test.name || ''}`.toUpperCase();
  if (key.includes('SFA') || key.includes('SEMINAL FLUID')) {
    return {
      label: 'SFA collection details',
      placeholder: 'Abstinence period, collection time/method, complete sample, transport time and fertility question',
    };
  }
  if (key.includes('LFT') || key.includes('LIVER FUNCTION')) {
    return {
      label: 'LFT components / context',
      placeholder: 'Requested components, jaundice pattern, medicines/alcohol exposure or monitoring question',
    };
  }
  if (key.includes('VIRAL') || key.includes('HBSAG') || key.includes('HCV') || key.includes('HIV')) {
    return {
      label: 'Viral marker details',
      placeholder: 'Name each marker required, exposure/screening context and consent/counselling status where applicable',
    };
  }
  return null;
}

function testDisplayName(test = {}) {
  if (!test.code) return test.name || 'Unnamed investigation';
  return String(test.name || '').toUpperCase().includes(String(test.code).toUpperCase())
    ? test.name
    : `${test.name} (${test.code})`;
}

function workflowForRequest(workflows, request = {}) {
  const id = disciplineForTest({ testType: request.testType, category: request.diagnosticDiscipline });
  return workflows.find((workflow) => workflow.id === id);
}

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
  const lockedDiscipline = ROLE_DISCIPLINE[subRole] || null;
  const serviceOptions = lockedDiscipline
    ? DIAGNOSTIC_SERVICES.filter((service) => service.id === lockedDiscipline)
    : DIAGNOSTIC_SERVICES;
  const [tab, setTab] = useState('ALL');
  const [discipline, setDiscipline] = useState(lockedDiscipline || 'ALL');
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(Boolean(presetPatientId) && canOrder);
  const [referralOpen, setReferralOpen] = useState(false);
  const [resultModal, setResultModal] = useState(null);
  const [detailModal, setDetailModal] = useState(null);
  const [transferModal, setTransferModal] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['lab', tab, discipline, search],
    queryFn: () => api.get('/lab', { params: {
      status: tab === 'ALL' ? '' : tab,
      discipline: discipline === 'ALL' ? '' : discipline,
      search,
      limit: 40,
    } }).then(r => r.data),
  });

  const { data: stats } = useQuery({
    queryKey: ['lab-stats', discipline],
    queryFn: () => api.get('/lab/stats', { params: { discipline: discipline === 'ALL' ? '' : discipline } }).then(r => r.data),
  });

  const { data: workflowData } = useQuery({
    queryKey: ['diagnostic-workflows'],
    queryFn: () => api.get('/lab/workflows').then((response) => response.data),
  });
  const workflows = workflowData?.workflows || [];

  const requests = data?.requests || data || [];

  const { mutate: advance } = useMutation({
    mutationFn: ({ id, status }) => api.post(`/lab/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab'] });
      qc.invalidateQueries({ queryKey: ['lab-stats'] });
      toast.success('Status updated');
    },
    onError: () => toast.error('Could not update the request'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Diagnostics</h1>
          <p className="text-sm text-gray-500">Laboratory investigations, imaging and ECG</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canProcess && (
            <button onClick={() => setReferralOpen(true)}
              className="flex items-center gap-2 min-h-11 px-4 py-2 border border-[#2D5BFF] text-[#2D5BFF] bg-white rounded-lg text-sm font-medium hover:bg-[#2D5BFF]/5">
              <ClipboardPlus size={16} /> Register referral / walk-in
            </button>
          )}
          {canOrder && (
            <button onClick={() => setAddOpen(true)}
              className="flex items-center gap-2 min-h-11 px-4 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]">
              <Plus size={16} /> Order investigation
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-2 flex gap-2 overflow-x-auto" aria-label="Diagnostic service lines">
        {serviceOptions.map((service) => (
          <button key={service.id} type="button" onClick={() => setDiscipline(service.id)}
            className={`min-h-11 px-3 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              discipline === service.id ? 'bg-[#2D5BFF] text-white' : 'text-gray-600 hover:bg-gray-50'
            }`}>
            {service.label}
          </button>
        ))}
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
              placeholder="Search by Health ID, hospital number, patient, test or discipline…"
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 bg-gray-50" />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 flex justify-center"><Spinner /></div>
      ) : requests.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title="No diagnostic requests in this worklist"
          description={canProcess
            ? 'New orders appear here. You can also register a walk-in or referral.'
            : 'Order an approved investigation for a patient to get started.'}
          action={canOrder
            ? { label: 'Order investigation', onClick: () => setAddOpen(true) }
            : canProcess ? { label: 'Register referral / walk-in', onClick: () => setReferralOpen(true) } : undefined}
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
                    <div className="text-xs text-gray-500 mt-0.5">
                      {r.diagnosticDiscipline || 'General diagnostics'} · {requestOriginLabel(r.requestOrigin)}
                    </div>
                    {workflowForRequest(workflows, r) && (
                      <div className="text-xs text-[#2D5BFF] mt-0.5">
                        Next: {workflowForRequest(workflows, r).steps[(Array.isArray(r.workflowChecklist) ? r.workflowChecklist.length : 0)]?.title || 'Workflow complete'}
                      </div>
                    )}
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
      {referralOpen && <ReferralIntakeModal open={referralOpen} onClose={() => setReferralOpen(false)} subRole={subRole} />}
      {resultModal && <ResultModal request={resultModal} workflow={workflowForRequest(workflows, resultModal)} onClose={() => setResultModal(null)} />}
      {detailModal && <ResultViewerModal request={detailModal} workflow={workflowForRequest(workflows, detailModal)} canProcess={canProcess} canReview={canReview} canRelease={canRelease} onClose={() => setDetailModal(null)} />}
      {transferModal && <TransferModal request={transferModal} onClose={() => setTransferModal(null)} />}
    </div>
  );
}

function NewLabModal({ open, onClose, initialPatientId = '' }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    patientId: initialPatientId,
    discipline: 'ALL',
    selectedTestIds: [],
    search: '',
    priority: 'ROUTINE',
    clinicalIndication: '',
    requestedDetails: '',
    preparationAndTiming: '',
    specimenNotes: '',
    customOpen: false,
    customTestName: '',
    customDiscipline: 'CHEMICAL_PATHOLOGY',
    customSpecimen: '',
    customDetails: '',
    testDetails: {},
  });
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const { data: catalogueData, isLoading: catalogueLoading } = useQuery({
    queryKey: ['diagnostic-catalogue'],
    queryFn: () => api.get('/lab/catalogue').then((response) => response.data),
    enabled: open,
  });
  const catalogue = catalogueData?.tests || [];
  const services = DIAGNOSTIC_SERVICES.filter((service) => service.id !== 'ALL');
  const query = form.search.trim().toLowerCase();
  const tests = catalogue.filter((test) => {
    const discipline = disciplineForTest(test);
    if (form.discipline !== 'ALL' && discipline !== form.discipline) return false;
    if (!query) return true;
    return [test.name, test.code, test.category, test.specimenType]
      .filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
  });
  const selectedTests = catalogue.filter((test) => form.selectedTestIds.includes(test.id));

  const toggleTest = (testId) => setForm((current) => ({
    ...current,
    selectedTestIds: current.selectedTestIds.includes(testId)
      ? current.selectedTestIds.filter((id) => id !== testId)
      : current.selectedTestIds.length < 20 ? [...current.selectedTestIds, testId] : current.selectedTestIds,
    testDetails: current.selectedTestIds.includes(testId)
      ? Object.fromEntries(Object.entries(current.testDetails).filter(([id]) => id !== testId))
      : current.testDetails,
  }));

  const setTestDetail = (testId, value) => setForm((current) => ({
    ...current,
    testDetails: { ...current.testDetails, [testId]: value },
  }));

  const sharedNotes = [
    form.clinicalIndication.trim() ? `Clinical indication / question: ${form.clinicalIndication.trim()}` : null,
    form.requestedDetails.trim() ? `Requested components / details: ${form.requestedDetails.trim()}` : null,
    form.preparationAndTiming.trim() ? `Preparation / timing: ${form.preparationAndTiming.trim()}` : null,
    form.specimenNotes.trim() ? `Specimen / source notes: ${form.specimenNotes.trim()}` : null,
  ].filter(Boolean).join('\n');

  const customReady = form.customOpen && form.customTestName.trim() && form.customDetails.trim();
  const orderCount = selectedTests.length + (customReady ? 1 : 0);

  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      const testsToOrder = selectedTests.map((test) => ({
        catalogueTestId: test.id,
        priority: form.priority,
        notes: [
          sharedNotes,
          form.testDetails[test.id]?.trim() ? `Test-specific details: ${form.testDetails[test.id].trim()}` : null,
        ].filter(Boolean).join('\n') || undefined,
      }));
      if (customReady) {
        testsToOrder.push({
          testName: form.customTestName.trim(),
          testType: form.customDiscipline === 'IMAGING' ? 'IMAGING' : 'LAB',
          diagnosticDiscipline: form.customDiscipline,
          specimenType: form.customSpecimen.trim() || undefined,
          priority: form.priority,
          notes: [sharedNotes, `Custom investigation details: ${form.customDetails.trim()}`].filter(Boolean).join('\n'),
        });
      }
      return api.post('/lab', { patientId: form.patientId, tests: testsToOrder });
    },
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ['lab'] });
      qc.invalidateQueries({ queryKey: ['lab-stats'] });
      const count = data?.count || orderCount;
      toast.success(`${count} investigation${count === 1 ? '' : 's'} ordered`);
      onClose();
    },
    onError: err => toast.error(err.response?.data?.error || 'Could not place the investigation order'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Order investigation" size="lg">
      <div className="p-6 space-y-4">
        <PatientPicker value={form.patientId} onChange={(id) => setForm(f => ({ ...f, patientId: id }))} required autoFocus />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Diagnostic area</label>
            <select value={form.discipline} onChange={set('discipline')}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30">
              <option value="ALL">All diagnostic areas</option>
              {services.map((service) => <option key={service.id} value={service.id}>{service.label}</option>)}
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

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-medium text-gray-700">Investigation(s) <span className="text-red-500">*</span></label>
            <span className="text-xs font-semibold text-[#2D5BFF]">{selectedTests.length} selected</span>
          </div>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={form.search} onChange={set('search')} placeholder="Search LFT, viral markers, SFA, CT, specimen…"
              className="w-full min-h-11 pl-9 pr-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
          </div>
          <div className="max-h-64 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50/40 p-2">
            {catalogueLoading ? <p className="p-3 text-sm text-gray-500">Loading facility catalogue…</p>
              : tests.length ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {tests.map((test) => {
                    const checked = form.selectedTestIds.includes(test.id);
                    return (
                      <label key={test.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border bg-white p-3 ${checked ? 'border-[#2D5BFF] ring-1 ring-[#2D5BFF]/20' : 'border-gray-200'}`}>
                        <input type="checkbox" checked={checked} onChange={() => toggleTest(test.id)} className="mt-0.5 h-4 w-4 rounded" />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-gray-900">{testDisplayName(test)}</span>
                          <span className="block text-xs text-gray-500">{[test.category, test.specimenType, test.turnaroundHours ? `${test.turnaroundHours}h target` : null].filter(Boolean).join(' · ')}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : <p className="p-3 text-sm text-amber-700">No configured investigation matches this area/search. Use the custom option below.</p>}
          </div>
        </section>

        {selectedTests.some((test) => orderDetailGuide(test)) && (
          <section className="space-y-2 rounded-xl border border-blue-200 bg-blue-50/50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-blue-900">Details for selected tests</div>
            {selectedTests.filter((test) => orderDetailGuide(test)).map((test) => {
              const guide = orderDetailGuide(test);
              return (
                <div key={test.id}>
                  <label className="mb-1 block text-xs font-medium text-gray-700">{test.name} — {guide.label}</label>
                  <textarea value={form.testDetails[test.id] || ''} onChange={(event) => setTestDetail(test.id, event.target.value)} rows={2}
                    placeholder={guide.placeholder}
                    className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm resize-none" />
                </div>
              );
            })}
          </section>
        )}

        <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
          <button type="button" onClick={() => setForm((current) => ({ ...current, customOpen: !current.customOpen }))}
            className="flex min-h-10 w-full items-center justify-between text-left text-sm font-semibold text-amber-900">
            <span><Plus size={15} className="mr-1.5 inline" />Custom / not yet in catalogue</span>
            <ChevronDown size={16} className={form.customOpen ? 'rotate-180' : ''} />
          </button>
          {form.customOpen && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Exact investigation name *</label>
                <input value={form.customTestName} onChange={set('customTestName')} placeholder="e.g. Seminal Fluid Analysis"
                  className="w-full min-h-11 px-3 border border-amber-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Diagnostic area *</label>
                <select value={form.customDiscipline} onChange={set('customDiscipline')} className="w-full min-h-11 px-3 border border-amber-300 rounded-lg bg-white text-sm">
                  {services.map((service) => <option key={service.id} value={service.id}>{service.label}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Specimen / body site</label>
                <input value={form.customSpecimen} onChange={set('customSpecimen')} placeholder="e.g. Semen, serum, left knee"
                  className="w-full min-h-11 px-3 border border-amber-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Exact requested test details *</label>
                <input value={form.customDetails} onChange={set('customDetails')} placeholder="Components, method, views or special question"
                  className="w-full min-h-11 px-3 border border-amber-300 rounded-lg text-sm" />
              </div>
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-gray-200 p-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Clinical indication / question <span className="text-red-500">*</span></label>
            <textarea value={form.clinicalIndication} onChange={set('clinicalIndication')} rows={2}
              placeholder="Symptoms, provisional diagnosis and the clinical question this investigation should answer"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm resize-none" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Requested components / details</label>
              <input value={form.requestedDetails} onChange={set('requestedDetails')} placeholder="e.g. direct/total bilirubin; named viral markers"
                className="w-full min-h-11 px-3 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Preparation / timing</label>
              <input value={form.preparationAndTiming} onChange={set('preparationAndTiming')} placeholder="e.g. fasting, cycle day, pre-antibiotic"
                className="w-full min-h-11 px-3 border border-gray-200 rounded-lg text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Specimen / source notes</label>
            <input value={form.specimenNotes} onChange={set('specimenNotes')} placeholder="Anatomical site, collection concern, LMP/pregnancy or other relevant context"
              className="w-full min-h-11 px-3 border border-gray-200 rounded-lg text-sm" />
          </div>
        </section>

        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutate()}
            disabled={isPending || !form.patientId || !form.clinicalIndication.trim() || orderCount < 1 || orderCount > 20 || (form.customOpen && !customReady)}
            className="flex-1 py-2.5 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50">
            {isPending ? 'Ordering…' : `Place ${orderCount || ''} order${orderCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ReferralIntakeModal({ open, onClose, subRole }) {
  const qc = useQueryClient();
  const lockedDiscipline = ROLE_DISCIPLINE[subRole] || null;
  const services = DIAGNOSTIC_SERVICES.filter((service) => service.id !== 'ALL'
    && (!lockedDiscipline || service.id === lockedDiscipline));
  const [form, setForm] = useState({
    patientSource: 'EXISTING',
    patientId: '',
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    gender: '',
    phone: '',
    selectedDisciplines: lockedDiscipline ? [lockedDiscipline] : ['IMAGING'],
    catalogueTestIds: [],
    priority: 'ROUTINE',
    intakeType: 'EXTERNAL_REFERRAL',
    externalReferrerName: '',
    externalReference: '',
    notes: '',
  });
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const { data: catalogueData, isLoading: catalogueLoading } = useQuery({
    queryKey: ['diagnostic-catalogue', 'referral', subRole],
    queryFn: () => api.get('/lab/catalogue').then((response) => response.data),
    enabled: open,
  });
  const tests = catalogueData?.tests || [];

  const toggleDiscipline = (id) => setForm((current) => {
    const selected = current.selectedDisciplines.includes(id)
      ? current.selectedDisciplines.filter((value) => value !== id)
      : [...current.selectedDisciplines, id];
    const allowedTestIds = new Set(tests.filter((test) => selected.includes(disciplineForTest(test))).map((test) => test.id));
    return { ...current, selectedDisciplines: selected, catalogueTestIds: current.catalogueTestIds.filter((testId) => allowedTestIds.has(testId)) };
  });

  const toggleTest = (id) => setForm((current) => ({
    ...current,
    catalogueTestIds: current.catalogueTestIds.includes(id)
      ? current.catalogueTestIds.filter((value) => value !== id)
      : [...current.catalogueTestIds, id],
  }));

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post('/lab/referrals', {
      patientId: form.patientSource === 'EXISTING' ? form.patientId : undefined,
      walkInPatient: form.patientSource === 'NEW' ? {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        dateOfBirth: form.dateOfBirth,
        gender: form.gender,
        phone: form.phone.trim() || undefined,
      } : undefined,
      catalogueTestIds: form.catalogueTestIds,
      priority: form.priority,
      intakeType: form.intakeType,
      externalReferrerName: form.intakeType === 'EXTERNAL_REFERRAL' ? form.externalReferrerName.trim() : undefined,
      externalReference: form.externalReference.trim() || undefined,
      notes: form.notes.trim() || undefined,
    }),
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ['lab'] });
      qc.invalidateQueries({ queryKey: ['lab-stats'] });
      qc.invalidateQueries({ queryKey: ['patients'] });
      const patientNumber = data?.patient?.universalPatientId;
      toast.success(data?.patient?.provisional
        ? `${data.count} investigation${data.count === 1 ? '' : 's'} started. Provisional ID: ${patientNumber}`
        : `${data.count} investigation${data.count === 1 ? '' : 's'} registered in the worklist`);
      onClose();
    },
    onError: (error) => toast.error(error.response?.data?.error || 'Could not register diagnostic intake'),
  });

  const externalReferral = form.intakeType === 'EXTERNAL_REFERRAL';
  const hasPatient = form.patientSource === 'EXISTING'
    ? Boolean(form.patientId)
    : Boolean(form.firstName.trim() && form.lastName.trim() && form.dateOfBirth && form.gender);
  const canSubmit = hasPatient && form.catalogueTestIds.length > 0
    && (!externalReferral || form.externalReferrerName.trim());

  return (
    <Modal open={open} onClose={onClose} title="Register diagnostic referral / walk-in" size="md">
      <div className="p-6 space-y-4">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 leading-relaxed">
          Choose an existing patient or enter a walk-in. A walk-in gets a temporary Patient ID and Hosp No. Records can complete registration later.
        </div>

        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Patient identity route">
          <button type="button" onClick={() => setForm((current) => ({ ...current, patientSource: 'EXISTING' }))}
            className={`min-h-12 rounded-xl border px-3 text-left text-sm font-medium ${form.patientSource === 'EXISTING' ? 'border-[#2D5BFF] bg-[#2D5BFF]/5 text-[#2D5BFF]' : 'border-gray-200 text-gray-700'}`}>
            <UserRoundCheck size={17} className="inline mr-2" />Has Health ID / record
          </button>
          <button type="button" onClick={() => setForm((current) => ({ ...current, patientSource: 'NEW' }))}
            className={`min-h-12 rounded-xl border px-3 text-left text-sm font-medium ${form.patientSource === 'NEW' ? 'border-[#2D5BFF] bg-[#2D5BFF]/5 text-[#2D5BFF]' : 'border-gray-200 text-gray-700'}`}>
            <UserPlus size={17} className="inline mr-2" />New / no Health ID
          </button>
        </div>

        {form.patientSource === 'EXISTING' ? (
          <PatientPicker
            value={form.patientId}
            onChange={(patientId) => setForm((current) => ({ ...current, patientId }))}
            label="Patient Health ID / facility record"
            placeholder="Search Health ID, Hosp No, phone or patient name…"
            required autoFocus id="diagnostic-referral-patient"
          />
        ) : (
          <section className="rounded-xl border border-gray-200 p-3 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Minimum safe demographics</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input value={form.firstName} onChange={set('firstName')} placeholder="First name *" aria-label="First name"
                className="min-h-11 px-3 border border-gray-200 rounded-lg text-sm" />
              <input value={form.lastName} onChange={set('lastName')} placeholder="Last name *" aria-label="Last name"
                className="min-h-11 px-3 border border-gray-200 rounded-lg text-sm" />
              <div>
                <label className="block text-xs text-gray-600 mb-1">Date of birth *</label>
                <input type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} max={new Date().toISOString().slice(0, 10)}
                  className="w-full min-h-11 px-3 border border-gray-200 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Sex / gender for reference ranges *</label>
                <select value={form.gender} onChange={set('gender')} className="w-full min-h-11 px-3 border border-gray-200 rounded-lg text-sm bg-white">
                  <option value="">Select…</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option>
                </select>
              </div>
            </div>
            <input value={form.phone} onChange={set('phone')} placeholder="Phone (optional)" aria-label="Phone"
              className="w-full min-h-11 px-3 border border-gray-200 rounded-lg text-sm" />
            <p className="text-xs text-amber-700">This is not an Awibi Identity link. Check for duplicates and complete registration later.</p>
          </section>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Intake route</label>
            <select value={form.intakeType} onChange={set('intakeType')}
              className="w-full min-h-11 px-3 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30">
              <option value="EXTERNAL_REFERRAL">External referral</option>
              <option value="WALK_IN">Walk-in diagnostic service</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
            <select value={form.priority} onChange={set('priority')}
              className="w-full min-h-11 px-3 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30">
              {PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
            </select>
          </div>
        </div>

        <section>
          <label className="block text-xs font-medium text-gray-700 mb-2">1. Tick diagnostic service line(s) <span className="text-red-500">*</span></label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {services.map((service) => (
              <label key={service.id} className={`min-h-11 flex items-center gap-2 rounded-lg border px-3 text-sm cursor-pointer ${form.selectedDisciplines.includes(service.id) ? 'border-[#2D5BFF] bg-[#2D5BFF]/5' : 'border-gray-200'}`}>
                <input type="checkbox" checked={form.selectedDisciplines.includes(service.id)} onChange={() => toggleDiscipline(service.id)} disabled={Boolean(lockedDiscipline)} className="h-4 w-4 rounded" />
                <span className="font-medium">{service.label}</span>
              </label>
            ))}
          </div>
        </section>

        <section>
          <label className="block text-xs font-medium text-gray-700 mb-2">2. Tick investigation(s) to start <span className="text-red-500">*</span></label>
          {catalogueLoading ? <div className="text-sm text-gray-500">Loading facility catalogue…</div> : (
            <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
              {form.selectedDisciplines.map((disciplineId) => {
                const service = services.find((item) => item.id === disciplineId);
                const available = tests.filter((test) => disciplineForTest(test) === disciplineId);
                return (
                  <div key={disciplineId} className="rounded-xl border border-gray-200 p-3">
                    <div className="text-xs font-semibold text-gray-900 mb-2">{service?.label || disciplineId}</div>
                    {available.length ? available.map((test) => (
                      <label key={test.id} className="flex items-start gap-2 min-h-10 py-1.5 cursor-pointer">
                        <input type="checkbox" checked={form.catalogueTestIds.includes(test.id)} onChange={() => toggleTest(test.id)} className="mt-0.5 h-4 w-4 rounded" />
                        <span className="text-sm"><span className="font-medium text-gray-800">{test.name}</span><span className="block text-xs text-gray-500">{[test.specimenType, test.turnaroundHours ? `${test.turnaroundHours}h target` : null].filter(Boolean).join(' · ')}</span></span>
                      </label>
                    )) : <p className="text-xs text-amber-700">No active service is configured. An administrator must add it to the facility catalogue.</p>}
                  </div>
                );
              })}
              {form.selectedDisciplines.length === 0 && <p className="text-sm text-gray-500">Select at least one diagnostic service.</p>}
            </div>
          )}
        </section>

        {externalReferral && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Referrer / referring facility <span className="text-red-500">*</span></label>
              <input value={form.externalReferrerName} onChange={set('externalReferrerName')}
                placeholder="Dr name, clinic or hospital"
                className="w-full min-h-11 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Referral reference</label>
              <input value={form.externalReference} onChange={set('externalReference')}
                placeholder="Paper slip / external number"
                className="w-full min-h-11 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Clinical information / indication</label>
          <textarea value={form.notes} onChange={set('notes')} rows={3}
            placeholder="Reason for investigation, symptoms, relevant history and precautions…"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none" />
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={onClose}
            className="flex-1 min-h-12 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button type="button" onClick={() => mutate()} disabled={isPending || !canSubmit}
            className="flex-1 min-h-12 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50">
            {isPending ? 'Starting…' : `Register and start ${form.catalogueTestIds.length || ''} test${form.catalogueTestIds.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function requestOriginLabel(origin) {
  if (origin === 'EXTERNAL_REFERRAL') return 'External referral';
  if (origin === 'DIAGNOSTIC_WALK_IN') return 'Walk-in';
  return 'Clinician order';
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

function ResultViewerModal({ request, workflow, canProcess, canReview, canRelease, onClose }) {
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
      toast.success('Review recorded');
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
            <div className="text-xs uppercase tracking-wide text-gray-500">
              {request.requestOrigin === 'CLINICIAN_ORDER' || !request.requestOrigin ? 'Ordered by' : 'Registered by'}
            </div>
            <div>{request.requestedBy ? `${request.requestedBy.firstName} ${request.requestedBy.lastName}` : 'Not recorded'}</div>
            <div className="text-xs text-gray-500">
              {requestOriginLabel(request.requestOrigin)}{request.createdAt ? ` · ${format(new Date(request.createdAt), 'dd MMM yyyy, HH:mm')}` : ''}
            </div>
          </div>
        </section>

        {request.notes && <ReportBlock title="Clinical question / request notes" text={request.notes} />}
        {workflow && (
          <SpecialtyWorkflowPanel request={request} workflow={workflow} canProcess={canProcess} />
        )}
        {request.specimenType && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Specimen</h3>
            <p>{request.specimenType}{request.specimenId ? ` · ${request.specimenId}` : ''}</p>
          </section>
        )}

        {request.resultValue != null && (
          <section className={`rounded-xl border p-4 ${request.isCritical ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}>
            <div className="text-xs uppercase tracking-wide text-gray-500">Result</div>
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
            This critical result is still open. Acknowledge it, record the action taken and resolve the alert.
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

function SpecialtyWorkflowPanel({ request, workflow, canProcess }) {
  const qc = useQueryClient();
  const initial = Array.isArray(request.workflowChecklist) ? request.workflowChecklist : [];
  const [completed, setCompleted] = useState(initial);
  const [accessionNumber, setAccessionNumber] = useState(request.accessionNumber || '');
  const [imagingModality, setImagingModality] = useState(request.imagingModality || '');
  const [pacsStudyUrl, setPacsStudyUrl] = useState(request.pacsStudyUrl || '');
  const completedKeys = completed.map((entry) => entry.key);
  const isReported = ['PRELIMINARY', 'COMPLETED', 'CORRECTED'].includes(request.status);
  const isImaging = workflow.id === 'IMAGING';

  const save = useMutation({
    mutationFn: (keys) => api.put(`/lab/${request.id}/workflow`, {
      completedStepKeys: keys,
      ...(isImaging ? {
        accessionNumber: accessionNumber.trim() || undefined,
        imagingModality: imagingModality || undefined,
        pacsStudyUrl: pacsStudyUrl.trim() || undefined,
      } : {}),
    }),
    onSuccess: ({ data }) => {
      setCompleted(Array.isArray(data.workflowChecklist) ? data.workflowChecklist : []);
      qc.invalidateQueries({ queryKey: ['lab'] });
      qc.invalidateQueries({ queryKey: ['lab-stats'] });
      toast.success('Progress saved');
    },
    onError: (error) => toast.error(error.response?.data?.error || 'Could not save the progress'),
  });

  const toggleStep = (index) => {
    if (!canProcess || save.isPending) return;
    const count = completedKeys.length;
    if (index > count) return toast.error('Complete the earlier step first');
    if (index === workflow.steps.length - 1 && !isReported && index === count) {
      return toast.error('Enter the preliminary/final specialist report before completing release');
    }
    const next = index < count ? workflow.steps.slice(0, index).map((step) => step.key) : workflow.steps.slice(0, index + 1).map((step) => step.key);
    save.mutate(next);
  };

  return (
    <section className="rounded-xl border border-[#2D5BFF]/20 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-900">{workflow.label} process</h3>
          <p className="text-xs text-gray-500 mt-0.5">Complete each step in order. Staff name and time are recorded.</p>
        </div>
        <span className="shrink-0 rounded-full bg-[#2D5BFF]/10 px-2.5 py-1 text-xs font-semibold text-[#2D5BFF]">{completedKeys.length}/{workflow.steps.length}</span>
      </div>

      {isImaging && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-lg bg-purple-50 p-3">
          <input value={accessionNumber} onChange={(event) => setAccessionNumber(event.target.value)} disabled={!canProcess}
            placeholder="Accession / study number" aria-label="Accession or study number" className="min-h-10 rounded-lg border border-purple-200 px-3 text-sm" />
          <select value={imagingModality} onChange={(event) => setImagingModality(event.target.value)} disabled={!canProcess}
            aria-label="Imaging modality" className="min-h-10 rounded-lg border border-purple-200 bg-white px-3 text-sm">
            <option value="">Modality…</option><option value="XRAY">X-ray</option><option value="CT">CT</option><option value="MRI">MRI</option><option value="ULTRASOUND">Ultrasound</option><option value="MAMMOGRAPHY">Mammography</option><option value="FLUOROSCOPY">Fluoroscopy</option><option value="NUCLEAR_MEDICINE">Nuclear medicine</option><option value="OTHER">Other</option>
          </select>
          <div className="relative"><Link2 size={15} className="absolute left-3 top-3 text-purple-500" /><input value={pacsStudyUrl} onChange={(event) => setPacsStudyUrl(event.target.value)} disabled={!canProcess}
            placeholder="PACS/archive study link" aria-label="PACS or image archive study link" className="w-full min-h-10 rounded-lg border border-purple-200 pl-9 pr-3 text-sm" /></div>
          {canProcess && <button type="button" onClick={() => save.mutate(completedKeys)} disabled={save.isPending} className="sm:col-span-3 min-h-10 rounded-lg border border-purple-300 bg-white text-sm font-medium text-purple-700">Save imaging identifiers / archive link</button>}
        </div>
      )}

      <ol className="space-y-2">
        {workflow.steps.map((step, index) => {
          const done = completedKeys.includes(step.key);
          const available = index <= completedKeys.length && (index !== workflow.steps.length - 1 || isReported || done);
          return (
            <li key={step.key}>
              <button type="button" onClick={() => toggleStep(index)} disabled={!canProcess || !available || save.isPending}
                className={`w-full flex items-start gap-3 rounded-lg border p-3 text-left ${done ? 'border-green-200 bg-green-50' : available ? 'border-gray-200 bg-white hover:border-[#2D5BFF]/40' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs font-bold ${done ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 bg-white text-gray-500'}`}>{done ? '✓' : step.sequence}</span>
                <span><span className="block text-sm font-medium text-gray-900">{step.title}</span><span className="block text-xs leading-relaxed text-gray-500 mt-0.5">{step.detail}</span></span>
              </button>
            </li>
          );
        })}
      </ol>
      {!canProcess && <p className="text-xs text-gray-500">Only the assigned diagnostic team can update these steps.</p>}
    </section>
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

function ResultModal({ request, workflow, onClose }) {
  const qc = useQueryClient();
  const isImaging = request?.testType === 'IMAGING' || request?.testType === 'ECG';

  const [resultValue, setResultValue] = useState(request?.resultValue ?? '');
  const [result, setResult] = useState(request?.result || '');
  const [notes, setNotes] = useState(request?.aiDraft || '');
  const [findings, setFindings] = useState(request?.reportFindings || '');
  const [impression, setImpression] = useState(request?.reportImpression || '');
  const [preliminary, setPreliminary] = useState(false);
  const [captureMethod, setCaptureMethod] = useState('TYPE');
  const [sourceFile, setSourceFile] = useState(null);
  const [recording, setRecording] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [aiDraftReady, setAiDraftReady] = useState(false);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);

  const { data: aiStatus } = useQuery({
    queryKey: ['diagnostic-ai-status'],
    queryFn: () => api.get('/ai/diagnostic-status').then(response => response.data),
    enabled: captureMethod === 'VOICE' || captureMethod === 'SNAP',
    retry: false,
  });

  const flag = previewFlag(resultValue, request);
  const isCorrection = request?.status === 'COMPLETED' || request?.status === 'CORRECTED';

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.put(`/lab/${request.id}/result`, {
      result: result || undefined,
      aiDraft: notes || undefined,
      aiDraftReviewed: aiDraftReady || undefined,
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
        toast.error(`CRITICAL result (${data.abnormalFlag?.replace('_', ' ')}) — the responsible clinical team must acknowledge and act.`, { duration: 10000 });
      } else {
        toast.success(data?.status === 'CORRECTED' ? 'Result corrected' : 'Result submitted');
      }
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not submit the result'),
  });

  const canSubmit = isImaging ? Boolean(findings || impression || result) : (resultValue !== '' || Boolean(result));

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = event => { if (event.data?.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setSourceFile(new File([blob], 'diagnostic-result.webm', { type: 'audio/webm' }));
        stream.getTracks().forEach(track => track.stop());
      };
      mediaRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (_) {
      toast.error('Microphone access was not allowed');
    }
  }

  function stopRecording() {
    mediaRef.current?.stop();
    setRecording(false);
  }

  async function extractDiagnosticDraft() {
    if (!sourceFile) return toast.error(`Choose or record a ${captureMethod === 'VOICE' ? 'voice file' : 'photo or document'} first`);
    setExtracting(true);
    try {
      const body = new FormData();
      body.append('source_file', sourceFile);
      body.append('request_id', request.id);
      if (workflow?.reportFields?.length) body.append('report_fields', JSON.stringify(workflow.reportFields));
      const response = await api.post('/ai/diagnostic-result', body, { headers: { 'Content-Type': 'multipart/form-data' } }).then(item => item.data);
      const draft = response.draft || {};
      if (draft.resultValue != null) setResultValue(String(draft.resultValue));
      if (draft.result) setResult(draft.result);
      if (draft.findings) setFindings(draft.findings);
      if (draft.impression) setImpression(draft.impression);
      if (draft.notes || draft.transcript) setNotes(draft.notes || draft.transcript);
      setAiDraftReady(true);
      toast.success('Draft extracted — verify and submit when correct');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not extract this diagnostic result');
    } finally {
      setExtracting(false);
    }
  }

  return (
    <Modal open={!!request} onClose={onClose} title={`${isCorrection ? 'Correct' : 'Enter'} Result — ${request?.testName}`} size="md">
      <div className="p-6 space-y-4">
        <div className="bg-[#2D5BFF]/5 rounded-xl p-3 text-xs">
          <span className="font-medium text-gray-900">{request?.patient?.firstName} {request?.patient?.lastName}</span>
          {request?.patient?.universalPatientId && <span className="font-mono text-[#2D5BFF] ml-2">{request.patient.universalPatientId}</span>}
          <span className="text-[#2D5BFF] ml-2">{request?.testType} · {request?.priority}</span>
          {request?.specimenId && <span className="text-gray-500 ml-2">Specimen {request.specimenId}</span>}
          <div className="text-gray-600 mt-1">{demographicLabel(request)}</div>
        </div>

        <div>
          <p className="mb-2 text-xs text-gray-500">Choose how to enter the result. Every option opens the same review screen.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {RESULT_CAPTURE_METHODS.map(({ key, label, icon: Icon }) => (
              <button key={key} type="button" onClick={() => { setCaptureMethod(key); setSourceFile(null); setAiDraftReady(false); }}
                className={`flex min-h-11 items-center justify-center gap-2 rounded-lg border px-2 text-xs font-semibold ${captureMethod === key ? 'border-[#2D5BFF] bg-blue-50 text-[#2D5BFF]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                <Icon size={16} /> {label}
              </button>
            ))}
          </div>
        </div>

        {(captureMethod === 'VOICE' || captureMethod === 'SNAP') && (
          <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
            {aiStatus && !aiStatus.configured && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                Voice and image tools are not set up. Type the report or use the guide.
              </div>
            )}
            {captureMethod === 'VOICE' ? (
              <div className="flex flex-wrap gap-2">
                {!recording ? (
                  <button type="button" onClick={startRecording} className="flex min-h-11 items-center gap-2 rounded-lg bg-green-700 px-3 text-sm font-medium text-white"><Mic size={16} /> Record live</button>
                ) : (
                  <button type="button" onClick={stopRecording} className="flex min-h-11 items-center gap-2 rounded-lg bg-red-700 px-3 text-sm font-medium text-white"><Square size={14} fill="currentColor" /> Stop recording</button>
                )}
                <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700">
                  <Upload size={16} /> Upload audio
                  <input type="file" accept="audio/*" className="sr-only" onChange={event => setSourceFile(event.target.files?.[0] || null)} />
                </label>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-orange-700 px-3 text-sm font-medium text-white">
                  <Camera size={16} /> Use camera
                  <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={event => setSourceFile(event.target.files?.[0] || null)} />
                </label>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700">
                  <Upload size={16} /> Upload image or PDF
                  <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={event => setSourceFile(event.target.files?.[0] || null)} />
                </label>
              </div>
            )}
            {sourceFile && <p className="text-xs text-gray-600">Ready: {sourceFile.name}</p>}
            <button type="button" onClick={extractDiagnosticDraft} disabled={!sourceFile || extracting || aiStatus?.configured === false}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#2D5BFF] px-3 text-sm font-medium text-white disabled:opacity-50">
              {extracting ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              {extracting ? 'Extracting draft…' : 'Extract result and report draft'}
            </button>
            <p className="text-[11px] text-gray-500">The file is not saved. Check the draft before submitting.</p>
          </div>
        )}

        {aiDraftReady && (
          <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950">
            <ShieldCheck size={17} className="shrink-0 text-[#2D5BFF]" />
            <span><strong>Draft ready.</strong> Check every result, unit and finding before submitting.</span>
          </div>
        )}

        {isCorrection && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
            This result is already final. Saving records a <strong>correction</strong> — the original stays in the audit trail
            and the responsible clinical team must review it again.
          </div>
        )}

        {captureMethod === 'GUIDE' && workflow?.reportFields?.length > 0 && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            <strong>{workflow.label} questions:</strong> {workflow.reportFields.join(' · ')}
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
              placeholder={workflow?.reportFields?.length ? `Use these headings: ${workflow.reportFields.join('; ')}` : 'Result, morphology and comments…'}
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

        <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
          Final submission updates this doctor&rsquo;s request and stores the verified report against the selected patient ID. Preliminary keeps the request open for final reporting.
        </p>

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
    onError: () => toast.error('Could not send the request to the affiliate'),
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
            <p className="text-xs text-orange-600 p-3 bg-orange-50 rounded-lg">No diagnostic affiliate yet. Add one under Affiliates.</p>
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
