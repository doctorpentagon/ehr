import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Activity, Search, X, ClipboardPlus, ArrowRight, Loader2, Pill } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import api from '../../lib/api';
import Avatar from '../../components/ui/Avatar';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import { can } from '../../lib/permissions';
import PatientPicker from '../../components/clinical/PatientPicker';
import ClinicalAttribution, { professionalName } from '../../components/clinical/ClinicalAttribution';
import ClinicalEventTime from '../../components/clinical/ClinicalEventTime';
import { useSelector } from 'react-redux';
import DrugChart from './DrugChart';

const STATUS_STYLES = {
  ACTIVE:    'bg-green-50 text-green-700 border-green-200',
  PAUSED:    'bg-amber-50 text-amber-700 border-amber-200',
  COMPLETED: 'bg-gray-100 text-gray-600 border-gray-200',
  CANCELLED: 'bg-red-50 text-red-700 border-red-200',
};

function MonitoringTabs({ active, onChange, showMedication }) {
  return (
    <div className="inline-flex w-full rounded-xl border border-gray-200 bg-white p-1 sm:w-auto" aria-label="Monitoring views">
      <button type="button" onClick={() => onChange('observations')}
        className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold sm:flex-none ${active === 'observations' ? 'bg-[#0B1F66] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
        <Activity size={16} /> Observation charts
      </button>
      {showMedication && (
        <button type="button" onClick={() => onChange('medications')}
          className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold sm:flex-none ${active === 'medications' ? 'bg-[#0B1F66] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
          <Pill size={16} /> Medication monitoring
        </button>
      )}
    </div>
  );
}

function NewSheetModal({ open, onClose }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const user = useSelector(s => s.auth?.user);
  const [patientId, setPatientId] = useState('');
  const [type, setType] = useState('');
  const [customType, setCustomType] = useState('');
  const [customFields, setCustomFields] = useState([{ key: '', label: '', unit: '', kind: 'number', goalMin: '', goalMax: '', criticalLow: '', criticalHigh: '' }]);
  const [targetValue, setTargetValue] = useState('');
  const [frequencyMins, setFrequencyMins] = useState('');
  const [instructions, setInstructions] = useState('');
  const [retrospective, setRetrospective] = useState(false);
  const [startedAt, setStartedAt] = useState('');
  const [lateEntryReason, setLateEntryReason] = useState('');

  const { data: templatesData } = useQuery({
    queryKey: ['monitoring-templates'],
    queryFn: () => api.get('/nursing/monitoring-templates').then(r => r.data),
    enabled: open,
  });
  const templates = templatesData?.templates || [];
  const selected = templates.find(t => t.type === type);
  const isCustom = type === 'CUSTOM';

  const { mutate, isPending } = useMutation({
    mutationFn: (body) => api.post('/nursing/monitoring-sheets', body).then(r => r.data),
    onSuccess: (sheet) => {
      qc.invalidateQueries({ queryKey: ['monitoring-sheets'] });
      toast.success('Monitoring started');
      reset();
      onClose();
      navigate(`/dashboard/nursing/sheet/${sheet.id}`);
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not create monitoring sheet'),
  });

  function reset() {
    setPatientId(''); setType(''); setCustomType('');
    setCustomFields([{ key: '', label: '', unit: '', kind: 'number', goalMin: '', goalMax: '', criticalLow: '', criticalHigh: '' }]);
    setTargetValue(''); setFrequencyMins(''); setInstructions('');
    setRetrospective(false); setStartedAt(''); setLateEntryReason('');
  }

  function submit() {
    if (!patientId) return toast.error('Choose a patient');
    if (!type) return toast.error('Choose what you are monitoring');
    if (retrospective && (!startedAt || !lateEntryReason.trim())) return toast.error('Choose the monitoring start time and give a reason for the late entry');
    const body = { patientId, type, instructions: instructions || undefined };
    if (retrospective) {
      body.startedAt = new Date(startedAt).toISOString();
      body.lateEntryReason = lateEntryReason.trim();
    }
    if (targetValue) body.targetValue = Number(targetValue);
    if (frequencyMins) body.frequencyMins = Number(frequencyMins);
    if (isCustom) {
      const fields = customFields
        .filter(f => f.label.trim())
        .map((f, i) => ({
          key: f.key.trim() || `field_${i + 1}`,
          label: f.label.trim(),
          unit: f.unit.trim() || undefined,
          kind: f.kind,
          ...(f.kind === 'number' ? {
            goalMin: f.goalMin === '' ? undefined : Number(f.goalMin),
            goalMax: f.goalMax === '' ? undefined : Number(f.goalMax),
            criticalLow: f.criticalLow === '' ? undefined : Number(f.criticalLow),
            criticalHigh: f.criticalHigh === '' ? undefined : Number(f.criticalHigh),
          } : {}),
        }));
      if (!fields.length) return toast.error('Add at least one field to your custom sheet');
      if (!customType.trim()) return toast.error('Name your custom monitoring');
      body.customType = customType.trim();
      body.title = customType.trim();
      body.fields = fields;
    }
    mutate(body);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Start monitoring</h2>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 flex items-center justify-center rounded-lg hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <ClinicalAttribution professional={user} label="Monitoring will be started by" pending compact />
          <PatientPicker id="ms-patient" value={patientId} onChange={setPatientId} required autoFocus />
          <ClinicalEventTime
            custom={retrospective}
            onCustomChange={setRetrospective}
            value={startedAt}
            onValueChange={setStartedAt}
            reason={lateEntryReason}
            onReasonChange={setLateEntryReason}
            label="When did this monitoring clinically start?"
          />

          <div>
            <span className="block text-sm font-medium text-gray-700 mb-1.5">What are you monitoring?</span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {templates.map(t => (
                <button key={t.type} type="button" onClick={() => setType(t.type)}
                  className={`min-h-[48px] px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
                    type === t.type ? 'border-[#2D5BFF] bg-[#2D5BFF]/5 text-[#2D5BFF] font-medium' : 'border-gray-200 hover:bg-gray-50'
                  }`}>
                  {t.label}
                </button>
              ))}
              <button type="button" onClick={() => setType('CUSTOM')}
                className={`min-h-[48px] px-3 py-2 rounded-lg border border-dashed text-sm text-left transition-colors ${
                  isCustom ? 'border-[#2D5BFF] bg-[#2D5BFF]/5 text-[#2D5BFF] font-medium' : 'border-gray-300 hover:bg-gray-50'
                }`}>
                + Something else
              </button>
            </div>
          </div>

          {selected && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <div className="text-xs font-medium text-gray-500 mb-2">You will record:</div>
              <div className="flex flex-wrap gap-1.5">
                {selected.fields.map(f => (
                  <span key={f.key} className="px-2 py-1 bg-white border border-gray-200 rounded text-xs text-gray-700">
                    {f.label}{f.unit ? ` (${f.unit})` : ''}{f.required ? ' *' : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {isCustom && (
            <div className="space-y-3 border border-dashed border-gray-300 rounded-lg p-3">
              <div>
                <label htmlFor="ms-custom-name" className="block text-sm font-medium text-gray-700 mb-1.5">Name this monitoring</label>
                <input id="ms-custom-name" value={customType} onChange={e => setCustomType(e.target.value)}
                  placeholder="e.g. Chest tube drainage"
                  className="w-full min-h-[48px] px-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
              </div>
              <div>
                <span className="block text-sm font-medium text-gray-700 mb-1.5">What will you record each time?</span>
                <div className="space-y-2">
                  {customFields.map((f, i) => (
                    <div key={i} className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_7rem_8rem] gap-2">
                        <input value={f.label} placeholder="Measurement, e.g. HbA1c"
                          onChange={e => setCustomFields(cf => cf.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                          className="min-h-[44px] px-3 border border-gray-300 rounded-lg text-sm" />
                        <input value={f.unit} placeholder="Unit, e.g. %"
                          onChange={e => setCustomFields(cf => cf.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))}
                          className="min-h-[44px] px-3 border border-gray-300 rounded-lg text-sm" />
                        <select value={f.kind} aria-label="Field type"
                          onChange={e => setCustomFields(cf => cf.map((x, j) => j === i ? { ...x, kind: e.target.value } : x))}
                          className="min-h-[44px] px-2 border border-gray-300 rounded-lg text-sm bg-white">
                          <option value="number">Number / chart</option>
                          <option value="text">Text</option>
                          <option value="boolean">Yes/No</option>
                        </select>
                      </div>
                      {f.kind === 'number' && (
                        <div>
                          <div className="mb-1 text-xs font-medium text-gray-600">Goal/reference band and optional critical limits</div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {[['goalMin', 'Goal min'], ['goalMax', 'Goal max'], ['criticalLow', 'Critical low'], ['criticalHigh', 'Critical high']].map(([key, label]) => (
                              <input key={key} type="number" step="any" value={f[key]} placeholder={label} aria-label={`${f.label || `Field ${i + 1}`} ${label}`}
                                onChange={e => setCustomFields(cf => cf.map((x, j) => j === i ? { ...x, [key]: e.target.value } : x))}
                                className="min-h-[40px] px-2 border border-gray-300 rounded-lg text-xs" />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setCustomFields(cf => [...cf, { key: '', label: '', unit: '', kind: 'number', goalMin: '', goalMax: '', criticalLow: '', criticalHigh: '' }])}
                  className="mt-2 text-sm text-[#2D5BFF] font-medium min-h-[44px]">+ Add another field</button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="ms-target" className="block text-sm font-medium text-gray-700 mb-1.5">Target / expected {selected?.targetUnit ? `(${selected.targetUnit})` : ''}</label>
              <input id="ms-target" type="number" inputMode="decimal" value={targetValue} onChange={e => setTargetValue(e.target.value)}
                className="w-full min-h-[48px] px-3 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label htmlFor="ms-freq" className="block text-sm font-medium text-gray-700 mb-1.5">
                Check every (minutes){selected?.frequencyMins ? ` — default ${selected.frequencyMins}` : ''}
              </label>
              <input id="ms-freq" type="number" inputMode="numeric" value={frequencyMins} onChange={e => setFrequencyMins(e.target.value)}
                placeholder={selected?.frequencyMins ? String(selected.frequencyMins) : ''}
                className="w-full min-h-[48px] px-3 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>

          <div>
            <label htmlFor="ms-instructions" className="block text-sm font-medium text-gray-700 mb-1.5">Instructions</label>
            <textarea id="ms-instructions" rows={2} value={instructions} onChange={e => setInstructions(e.target.value)}
              placeholder="e.g. Observe every 15 minutes for the first hour"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-5 py-3 flex gap-3">
          <button onClick={onClose} className="flex-1 min-h-[48px] border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={isPending}
            className="flex-1 min-h-[48px] bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50">
            {isPending ? 'Starting…' : 'Start monitoring'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Monitoring() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const [status, setStatus] = useState('ACTIVE');
  const [search, setSearch] = useState('');
  const [patientFilterId, setPatientFilterId] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const user = useSelector(s => s.auth?.user);
  const mayWrite = can(user?.role, user?.subRole, 'monitoring_write');
  const mayOrder = can(user?.role, user?.subRole, 'prescriptions_write');
  const mayViewMedication = can(user?.role, user?.subRole, 'drug_admin');
  const activeView = searchParams.get('view') === 'medications' && mayViewMedication ? 'medications' : 'observations';

  function changeView(view) {
    const next = new URLSearchParams(searchParams);
    if (view === 'medications') next.set('view', 'medications');
    else next.delete('view');
    setSearchParams(next);
  }

  const { data, isLoading } = useQuery({
    queryKey: ['monitoring-sheets', status, patientFilterId],
    queryFn: () => api.get('/nursing/monitoring-sheets', {
      params: { status: status || undefined, patientId: patientFilterId || undefined, limit: 50 },
    }).then(r => r.data),
  });

  const { data: showcaseData } = useQuery({
    queryKey: ['monitoring-showcase'],
    queryFn: () => api.get('/nursing/monitoring-sheets', { params: { status: 'ACTIVE', limit: 100 } }).then(r => r.data),
    staleTime: 60_000,
  });
  const showcaseSheet = (showcaseData?.sheets || []).find(sheet => sheet.patient?.mrn === 'DEMO-SAMPLE-001' && sheet.title?.startsWith('Sample:'));

  const { data: requestData } = useQuery({
    queryKey: ['monitoring-requests'],
    queryFn: () => api.get('/nursing/monitoring-requests').then(response => response.data),
    enabled: mayWrite,
    refetchInterval: 30_000,
  });
  const requests = requestData?.requests || [];
  const filteredRequests = requests.filter(request => {
    if (!search) return true;
    const q = search.toLowerCase();
    return request.orderName?.toLowerCase().includes(q)
      || request.goal?.toLowerCase().includes(q)
      || `${request.patient?.firstName || ''} ${request.patient?.lastName || ''}`.toLowerCase().includes(q)
      || request.patient?.mrn?.toLowerCase().includes(q);
  });

  const openOrderedChart = useMutation({
    mutationFn: request => api.post(`/nursing/monitoring-requests/${request.orderId}/initiate`, {
      title: request.suggested?.title || request.orderName,
      fields: request.suggested?.fields,
      frequencyMins: request.suggested?.frequencyMins,
      targetUnit: request.suggested?.targetUnit,
      instructions: request.instructions || request.goal,
    }).then(response => response.data),
    onSuccess: result => {
      qc.invalidateQueries({ queryKey: ['monitoring-requests'] });
      qc.invalidateQueries({ queryKey: ['monitoring-sheets'] });
      qc.invalidateQueries({ queryKey: ['standing-orders'] });
      toast.success('Ordered monitoring chart opened');
      navigate(`/dashboard/nursing/sheet/${result.sheet.id}`);
    },
    onError: error => toast.error(error.response?.data?.error || 'Could not open the ordered chart'),
  });

  const sheets = (data?.sheets || []).filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    const name = `${s.patient?.firstName || ''} ${s.patient?.lastName || ''}`.toLowerCase();
    return name.includes(q) || (s.title || '').toLowerCase().includes(q) || (s.patient?.universalPatientId || '').toLowerCase().includes(q);
  });

  if (activeView === 'medications') {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Monitoring</h1>
          <p className="text-sm text-gray-500">Patient observations and medicines given</p>
        </div>
        <MonitoringTabs active={activeView} onChange={changeView} showMedication={mayViewMedication} />
        <DrugChart embedded />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Monitoring</h1>
          <p className="text-sm text-gray-500">
            {mayWrite && mayOrder
              ? 'Start monitoring, send orders and review patient trends.'
              : mayWrite
                ? 'Start a chart or open a doctor’s order.'
              : mayOrder
                ? 'Send monitoring orders and review patient trends.'
                : 'Review patient observations and trends.'}
          </p>
          <span className="mt-1 inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
            {mayWrite && mayOrder ? 'Facility Admin view' : mayWrite ? 'Nurse view' : mayOrder ? 'Doctor view' : 'Read-only view'}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {mayOrder && (
            <button onClick={() => navigate('/dashboard/orders?mode=NURSING')}
              className="flex items-center justify-center gap-2 px-4 min-h-[48px] border border-[#2D5BFF] bg-white text-[#2D5BFF] rounded-lg text-sm font-medium hover:bg-blue-50">
              <ClipboardPlus size={16} /> Create monitoring order
            </button>
          )}
          {mayWrite && (
            <button onClick={() => setModalOpen(true)}
              className="flex items-center justify-center gap-2 px-4 min-h-[48px] bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]">
              <Plus size={16} /> Start monitoring
            </button>
          )}
        </div>
      </div>

      <MonitoringTabs active={activeView} onChange={changeView} showMedication={mayViewMedication} />

      {showcaseSheet && (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-bold text-emerald-950">End-to-end monitoring sample</div>
              <p className="mt-1 text-xs text-emerald-800">
                {showcaseSheet.patient.firstName} {showcaseSheet.patient.lastName} · {showcaseSheet.patient.universalPatientId} · doctor order, five timed observations, multimodal entry and visual trend
              </p>
            </div>
            <button type="button" onClick={() => navigate(`/dashboard/nursing/sheet/${showcaseSheet.id}`)}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800">
              Open sample <ArrowRight size={16} />
            </button>
          </div>
        </section>
      )}

      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <PatientPicker
          id="monitoring-patient-filter"
          label="Patient ID / hospital record"
          value={patientFilterId}
          onChange={setPatientFilterId}
          placeholder="Search Health ID, hospital number, phone or name…"
        />
        {patientFilterId && (
          <button
            type="button"
            onClick={() => navigate(`/dashboard/nursing/patient/${patientFilterId}`)}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#2D5BFF] px-4 text-sm font-semibold text-[#2D5BFF] hover:bg-blue-50 sm:w-auto"
          >
            <Activity size={16} /> View patient trends
          </button>
        )}
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter by chart name or order…" aria-label="Filter monitoring sheets and orders"
              className="w-full pl-9 pr-4 min-h-[48px] border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
          </div>
          <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by status"
            className="px-3 min-h-[48px] border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30">
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
            <option value="COMPLETED">Completed</option>
            <option value="">All</option>
          </select>
        </div>
      </div>

      {mayWrite && filteredRequests.length > 0 && (
        <section className="rounded-xl border border-blue-200 bg-blue-50/50 p-4" aria-labelledby="ordered-monitoring-title">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-[#2D5BFF]">
              <ClipboardPlus size={19} />
            </div>
            <div>
              <h2 id="ordered-monitoring-title" className="text-sm font-semibold text-gray-900">Orders waiting to be started</h2>
              <p className="mt-0.5 text-xs text-gray-600">Open an order to start the patient&rsquo;s chart.</p>
            </div>
          </div>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {filteredRequests.map(request => (
              <article key={request.orderId} className="rounded-lg border border-blue-100 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium text-gray-900">{request.orderName}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${request.priority === 'STAT' ? 'bg-red-100 text-red-800' : request.priority === 'URGENT' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>{request.priority}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-600">{request.patient?.firstName} {request.patient?.lastName} · {request.patient?.mrn || 'No hospital number'}</p>
                    {request.goal && <p className="mt-1 text-xs text-gray-500">Goal: {request.goal}</p>}
                    <p className="mt-1 text-[11px] text-gray-400">
                      {request.suggested?.fields?.length || 0} measurement{request.suggested?.fields?.length === 1 ? '' : 's'}
                      {request.suggested?.frequencyMins ? ` · every ${request.suggested.frequencyMins} min` : ''}
                    </p>
                  </div>
                  <button type="button" onClick={() => openOrderedChart.mutate(request)}
                    disabled={openOrderedChart.isPending && openOrderedChart.variables?.orderId === request.orderId}
                    className="min-h-11 shrink-0 rounded-lg bg-[#0B1F66] px-3 text-xs font-semibold text-white hover:bg-[#071647] disabled:opacity-50 flex items-center gap-1.5">
                    {openOrderedChart.isPending && openOrderedChart.variables?.orderId === request.orderId
                      ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                    Open chart
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="py-16 flex justify-center"><Spinner size="lg" /></div>
        ) : sheets.length === 0 ? (
          <EmptyState icon={Activity} title="No monitoring yet"
            description={mayWrite ? 'Start a chart for this patient.' : 'No active monitoring.'}
            action={mayWrite ? <button onClick={() => setModalOpen(true)} className="px-4 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium">Start monitoring</button> : null} />
        ) : (
          <div className="divide-y divide-gray-100">
            {sheets.map(s => (
              <button key={s.id} onClick={() => navigate(`/dashboard/nursing/sheet/${s.id}`)}
                className="w-full text-left p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 bg-[#2D5BFF]/10 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                    <Activity size={17} className="text-[#2D5BFF]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium text-gray-900 truncate">{s.title}</div>
                      <span className={`px-2 py-0.5 rounded-full border text-xs font-medium shrink-0 ${STATUS_STYLES[s.status] || ''}`}>{s.status}</span>
                    </div>
                    {s.patient && (
                      <div className="flex items-center gap-2 mt-1">
                        <Avatar name={`${s.patient.firstName} ${s.patient.lastName}`} size="sm" />
                        <span className="text-sm text-gray-600 truncate">{s.patient.firstName} {s.patient.lastName}</span>
                        <span className="text-xs font-mono text-[#2D5BFF]">{s.patient.universalPatientId}</span>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-400">
                      <span>{s._count?.entries ?? 0} entries</span>
                      {s.frequencyMins && <><span>·</span><span>every {s.frequencyMins} min</span></>}
                      <span>·</span>
                      <span>started {s.startedAt ? format(new Date(s.startedAt), 'dd MMM yyyy · HH:mm') : ''}</span>
                      {s.createdBy && <><span>·</span><span>by {professionalName(s.createdBy)}</span></>}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <NewSheetModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
