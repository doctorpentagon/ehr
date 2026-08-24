import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, AlertTriangle, Check, Printer, LayoutList, Table2, BarChart3, Keyboard, Mic, Camera, ListChecks, Square, Upload, Loader2, ShieldCheck, Download, Columns3, Rows3, Search, ClipboardPlus } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useSelector } from 'react-redux';
import api from '../../lib/api';
import Spinner from '../../components/ui/Spinner';
import ClinicalAttribution from '../../components/clinical/ClinicalAttribution';
import ClinicalEventTime from '../../components/clinical/ClinicalEventTime';
import MonitoringChart from '../../components/clinical/MonitoringChart';
import { can } from '../../lib/permissions';

// Fields flagged mapsTo feed the running intake/output balance.
function splitBalance(fields, values) {
  const out = { intakeMl: undefined, outputMl: undefined };
  fields.forEach(f => {
    if (!f.mapsTo) return;
    const v = values[f.key];
    if (v === '' || v == null) return;
    out[f.mapsTo] = Number(v);
  });
  return out;
}

const CAPTURE_METHODS = [
  { key: 'TYPE', label: 'Type', Icon: Keyboard },
  { key: 'VOICE', label: 'Voice', Icon: Mic },
  { key: 'SNAP', label: 'Handwriting', Icon: Camera },
  { key: 'QUESTIONNAIRE', label: 'Questionnaire', Icon: ListChecks },
];

function deviationTone(deviation) {
  const severity = deviation?.severity || '';
  if (severity.startsWith('CRITICAL')) return 'bg-red-50 font-bold text-red-800';
  if (severity === 'LOW' || severity === 'HIGH') return 'bg-amber-50 font-semibold text-amber-800';
  return 'text-gray-700';
}

export default function MonitoringSheet() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [values, setValues] = useState({});
  const [notes, setNotes] = useState('');
  const [abnormal, setAbnormal] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [observationView, setObservationView] = useState('CHART');
  const [chartFieldKey, setChartFieldKey] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [abnormalOnly, setAbnormalOnly] = useState(false);
  const [compactSheet, setCompactSheet] = useState(false);
  const [hiddenFieldKeys, setHiddenFieldKeys] = useState([]);
  const [criticalNotice, setCriticalNotice] = useState(null);
  const [captureMethod, setCaptureMethod] = useState('TYPE');
  const [captureFile, setCaptureFile] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [extracting, setExtracting] = useState(false);
  const [aiDraftReady, setAiDraftReady] = useState(false);
  const [aiAbnormalSuggested, setAiAbnormalSuggested] = useState(false);
  const [retrospective, setRetrospective] = useState(false);
  const [observedAt, setObservedAt] = useState('');
  const [lateEntryReason, setLateEntryReason] = useState('');
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);

  const user = useSelector(s => s.auth?.user);
  const mayWrite = can(user?.role, user?.subRole, 'monitoring_write');

  const { data: sheet, isLoading } = useQuery({
    queryKey: ['monitoring-sheet', id],
    queryFn: () => api.get(`/nursing/monitoring-sheets/${id}`).then(r => r.data),
  });

  const { data: aiStatus } = useQuery({
    queryKey: ['nursing-ai-status'],
    queryFn: () => api.get('/ai/nursing-status').then(r => r.data),
    enabled: showForm && (captureMethod === 'VOICE' || captureMethod === 'SNAP'),
    retry: false,
  });

  useEffect(() => {
    if (!recording) return undefined;
    const timer = window.setInterval(() => setRecordingSeconds(seconds => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  const { mutate: addEntry, isPending } = useMutation({
    mutationFn: (body) => api.post(`/nursing/monitoring-sheets/${id}/entries`, body).then(r => r.data),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['monitoring-sheet', id] });
      qc.invalidateQueries({ queryKey: ['clinical-alerts'] });
      if (result.alert) {
        setCriticalNotice(result.alert);
        toast.error(result.alert.message, { duration: 10_000 });
      } else {
        toast.success('Observation recorded');
      }
      setValues({}); setNotes(''); setAbnormal(false); setShowForm(false);
      setCaptureFile(null); setCaptureMethod('TYPE'); setAiDraftReady(false); setAiAbnormalSuggested(false);
      setRetrospective(false); setObservedAt(''); setLateEntryReason('');
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not record observation'),
  });

  const { mutate: setStatus } = useMutation({
    mutationFn: (status) => api.patch(`/nursing/monitoring-sheets/${id}`, { status }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['monitoring-sheet', id] }); toast.success('Sheet updated'); },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not update sheet'),
  });

  if (isLoading) return <div className="py-16 flex justify-center"><Spinner size="lg" /></div>;
  if (!sheet) return <div className="p-6 text-sm text-gray-500">Monitoring sheet not found.</div>;

  const fields = sheet.fields || [];
  const totals = sheet.totals || { intakeMl: 0, outputMl: 0, balanceMl: 0 };
  const numericSeries = fields
    .filter(field => field.kind === 'number')
    .map(field => {
      const points = [...(sheet.entries || [])]
        .reverse()
        .filter(entry => entry.values?.[field.key] != null && entry.values[field.key] !== '' && Number.isFinite(Number(entry.values[field.key])))
        .map(entry => ({
          at: entry.recordedAt,
          value: Number(entry.values[field.key]),
          severity: entry.deviations?.[field.key]?.severity || 'NORMAL',
          deviation: entry.deviations?.[field.key]?.deviation ?? 0,
        }));
      if (!points.length) return null;
      return {
        key: field.key,
        label: field.label,
        unit: field.unit || null,
        goalMin: field.goalMin ?? null,
        goalMax: field.goalMax ?? null,
        criticalLow: field.criticalLow ?? null,
        criticalHigh: field.criticalHigh ?? null,
        points,
        trend: points.length < 2 ? 'FLAT'
          : points.at(-1).value > points.at(-2).value ? 'RISING'
            : points.at(-1).value < points.at(-2).value ? 'FALLING' : 'FLAT',
        abnormalCount: points.filter(point => point.severity !== 'NORMAL').length,
      };
    })
    .filter(Boolean);
  const activeSeries = numericSeries.find(series => series.key === chartFieldKey) || numericSeries[0];
  const visibleFields = fields.filter(field => !hiddenFieldKeys.includes(field.key));
  const tableEntries = (sheet.entries || []).filter(entry => {
    if (abnormalOnly && !entry.isAbnormal) return false;
    if (!tableSearch.trim()) return true;
    const haystack = [
      entry.notes,
      entry.recordedBy?.firstName,
      entry.recordedBy?.lastName,
      ...Object.values(entry.values || {}),
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(tableSearch.trim().toLowerCase());
  });
  const latestEntry = sheet.entries?.[0] || null;
  const nextDueAt = latestEntry && sheet.frequencyMins
    ? new Date(new Date(latestEntry.recordedAt).getTime() + Number(sheet.frequencyMins) * 60_000)
    : null;
  const isOverdue = sheet.status === 'ACTIVE' && nextDueAt && nextDueAt.getTime() < Date.now();

  function downloadCsv() {
    const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const headers = ['Observed at', ...visibleFields.map(field => `${field.label}${field.unit ? ` (${field.unit})` : ''}`), 'Notes', 'Recorded by', 'EHR entry time'];
    const rows = [...tableEntries].reverse().map(entry => [
      format(new Date(entry.recordedAt), 'yyyy-MM-dd HH:mm'),
      ...visibleFields.map(field => entry.values?.[field.key] ?? ''),
      entry.notes || '',
      entry.recordedBy ? `${entry.recordedBy.firstName} ${entry.recordedBy.lastName}` : '',
      format(new Date(entry.createdAt), 'yyyy-MM-dd HH:mm'),
    ]);
    const blob = new Blob([[headers, ...rows].map(row => row.map(quote).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${String(sheet.title || 'monitoring').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${format(new Date(), 'yyyyMMdd')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function submit() {
    const missing = fields.filter(f => f.required && (values[f.key] === '' || values[f.key] == null));
    if (missing.length) return toast.error(`${missing[0].label} is required`);
    if (retrospective && (!observedAt || !lateEntryReason.trim())) return toast.error('Choose the observation time and give a reason for the late entry');
    addEntry({
      values,
      notes: notes || undefined,
      isAbnormal: abnormal,
      recordedAt: retrospective ? new Date(observedAt).toISOString() : undefined,
      lateEntryReason: retrospective ? lateEntryReason.trim() : undefined,
      ...splitBalance(fields, values),
    });
  }

  function closeForm() {
    if (recording) mediaRef.current?.stop();
    setShowForm(false);
    setCaptureFile(null);
    setCaptureMethod('TYPE');
    setAiDraftReady(false);
    setAiAbnormalSuggested(false);
    setRetrospective(false);
    setObservedAt('');
    setLateEntryReason('');
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = event => { if (event.data?.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setCaptureFile(new File([blob], 'nursing-observation.webm', { type: 'audio/webm' }));
        stream.getTracks().forEach(track => track.stop());
      };
      mediaRef.current = recorder;
      recorder.start();
      setRecordingSeconds(0);
      setRecording(true);
    } catch (_) {
      toast.error('Microphone access was not allowed');
    }
  }

  function stopRecording() {
    mediaRef.current?.stop();
    setRecording(false);
  }

  async function extractObservation() {
    if (!captureFile) return toast.error(`Choose or record a ${captureMethod === 'VOICE' ? 'voice file' : 'photo or document'} first`);
    setExtracting(true);
    try {
      const body = new FormData();
      body.append('source_file', captureFile);
      body.append('patient_id', sheet.patientId);
      body.append('monitoring_sheet_id', sheet.id);
      const result = await api.post('/ai/nursing-observation', body, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
      const proposal = result.observation || {};
      setValues(current => ({ ...current, ...(proposal.values || {}) }));
      if (proposal.notes) setNotes(proposal.notes);
      setAiAbnormalSuggested(Boolean(proposal.abnormalSuggested));
      setAiDraftReady(true);
      toast.success('Draft extracted — review every value before saving');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not extract this nursing observation');
    } finally {
      setExtracting(false);
    }
  }

  return (
    <div className="space-y-4">
      <button onClick={() => navigate('/dashboard/nursing')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 min-h-[44px]">
        <ArrowLeft size={16} /> Back to monitoring
      </button>

      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900">{sheet.title}</h1>
            {sheet.patient && (
              <p className="text-sm text-gray-600 mt-0.5">
                {sheet.patient.firstName} {sheet.patient.lastName}
                <span className="ml-2 font-mono text-xs text-[#2D5BFF]">{sheet.patient.universalPatientId}</span>
              </p>
            )}
            {sheet.instructions && <p className="text-sm text-gray-500 mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{sheet.instructions}</p>}
            {sheet.originatingOrder && (
              <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
                <div className="flex items-center gap-2 font-bold"><ClipboardPlus size={16} /> Practitioner order</div>
                <p className="mt-1 font-semibold">{sheet.originatingOrder.name}</p>
                {sheet.originatingOrder.goal && <p className="mt-1 text-xs"><strong>Goal:</strong> {sheet.originatingOrder.goal}</p>}
                {sheet.originatingOrder.instructions && <p className="mt-1 text-xs"><strong>Instruction:</strong> {sheet.originatingOrder.instructions}</p>}
                <p className="mt-2 text-xs text-blue-800">
                  Ordered {format(new Date(sheet.originatingOrder.createdAt), 'dd MMM yyyy · hh:mm a')}
                  {sheet.originatingOrder.orderedBy ? ` by ${sheet.originatingOrder.orderedBy.firstName} ${sheet.originatingOrder.orderedBy.lastName}` : ''}
                  {sheet.originatingOrder.frequencyHours ? ` · every ${sheet.originatingOrder.frequencyHours} hour${Number(sheet.originatingOrder.frequencyHours) === 1 ? '' : 's'}` : ''}
                  {sheet.originatingOrder.executions?.length ? ` · ${sheet.originatingOrder.executions.length} checks recorded` : ''}
                </p>
              </div>
            )}
          </div>
          {mayWrite && sheet.status === 'ACTIVE' && (
            <div className="flex gap-2 shrink-0">
              <button onClick={() => setStatus('COMPLETED')} className="px-3 min-h-[44px] border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">Complete</button>
            </div>
          )}
        </div>

        <div className="mt-4">
          <ClinicalAttribution
            professional={sheet.createdBy}
            timestamp={sheet.createdAt}
            label="Monitoring recorded in EHR by"
            compact
          />
          <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
            <strong>Monitoring clinically started:</strong> {format(new Date(sheet.startedAt), 'dd MMM yyyy · hh:mm a')}
            {sheet.lateEntryReason && <span className="mt-1 block text-amber-800"><strong>Late entry reason:</strong> {sheet.lateEntryReason}</span>}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Monitoring workflow">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Source</div>
            <div className="mt-1 text-sm font-semibold text-gray-900">{sheet.orderId ? 'Doctor order' : 'Nurse initiated'}</div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Chart</div>
            <div className="mt-1 text-sm font-semibold text-gray-900">{sheet.status}</div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Latest observation</div>
            <div className="mt-1 text-sm font-semibold text-gray-900">{latestEntry ? format(new Date(latestEntry.recordedAt), 'dd MMM · HH:mm') : 'Not recorded'}</div>
          </div>
          <div className={`rounded-lg border p-3 ${isOverdue ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
            <div className={`text-[11px] font-semibold uppercase tracking-wide ${isOverdue ? 'text-red-700' : 'text-gray-500'}`}>{sheet.status === 'COMPLETED' ? 'Status' : 'Next due'}</div>
            <div className={`mt-1 text-sm font-semibold ${isOverdue ? 'text-red-800' : 'text-gray-900'}`}>
              {sheet.status === 'COMPLETED' ? 'Completed' : nextDueAt ? `${format(nextDueAt, 'dd MMM · HH:mm')}${isOverdue ? ' · overdue' : ''}` : 'As clinically indicated'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
            <div className="text-xs text-blue-600 font-medium">Intake</div>
            <div className="text-lg font-bold text-blue-900">{totals.intakeMl} <span className="text-xs font-normal">ml</span></div>
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
            <div className="text-xs text-amber-600 font-medium">Output</div>
            <div className="text-lg font-bold text-amber-900">{totals.outputMl} <span className="text-xs font-normal">ml</span></div>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <div className="text-xs text-gray-500 font-medium">Balance</div>
            <div className={`text-lg font-bold ${totals.balanceMl < 0 ? 'text-red-700' : 'text-gray-900'}`}>
              {totals.balanceMl > 0 ? '+' : ''}{totals.balanceMl} <span className="text-xs font-normal">ml</span>
            </div>
          </div>
        </div>
        {sheet.targetValue != null && (
          <p className="text-xs text-gray-500 mt-2">Target: {sheet.targetValue} {sheet.targetUnit || ''}{sheet.frequencyMins ? ` · check every ${sheet.frequencyMins} min` : ''}</p>
        )}
      </div>

      {criticalNotice && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border-2 border-red-300 bg-red-50 p-4 text-red-950">
          <AlertTriangle size={21} className="mt-0.5 shrink-0 text-red-700" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold">Critical observation - immediate escalation required</div>
            <p className="mt-1 text-sm">{criticalNotice.message}</p>
            <p className="mt-1 text-xs text-red-800">Critical alert sent. Continue monitoring until a clinician responds.</p>
          </div>
          <button type="button" onClick={() => setCriticalNotice(null)} aria-label="Dismiss critical notice" className="size-10 shrink-0 rounded-lg hover:bg-red-100">×</button>
        </div>
      )}

      {mayWrite && sheet.status === 'ACTIVE' && (
        showForm ? (
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 space-y-4">
            <div>
              <h2 className="font-semibold text-gray-900">Record observation</h2>
              <p className="mt-1 text-xs text-gray-500">Enter one or more readings. Check them before saving.</p>
            </div>
            <ClinicalAttribution
              professional={user}
              label="Observation will be recorded by"
              pending
              compact
            />
            <ClinicalEventTime
              custom={retrospective}
              onCustomChange={setRetrospective}
              value={observedAt}
              onValueChange={setObservedAt}
              reason={lateEntryReason}
              onReasonChange={setLateEntryReason}
              label="When was this observation taken?"
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CAPTURE_METHODS.map(({ key, label, Icon }) => (
                <button key={key} type="button" onClick={() => { setCaptureMethod(key); setCaptureFile(null); setAiDraftReady(false); setAiAbnormalSuggested(false); }}
                  className={`flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition ${captureMethod === key ? 'border-[#2D5BFF] bg-blue-50 text-[#2D5BFF]' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
                  <Icon size={17} /> {label}
                </button>
              ))}
            </div>

            {(captureMethod === 'VOICE' || captureMethod === 'SNAP') && (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-3">
                {aiStatus && !aiStatus.configured && (
                  <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    Voice and handwriting are not set up yet. Use typing or the form.
                  </div>
                )}
                {captureMethod === 'VOICE' ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {!recording ? (
                        <button type="button" onClick={startRecording} className="flex min-h-11 items-center gap-2 rounded-lg bg-green-700 px-3 text-sm font-medium text-white hover:bg-green-800"><Mic size={16} /> Record live</button>
                      ) : (
                        <button type="button" onClick={stopRecording} className="flex min-h-11 items-center gap-2 rounded-lg bg-red-700 px-3 text-sm font-medium text-white"><Square size={15} fill="currentColor" /> Stop {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}</button>
                      )}
                      <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
                        <Upload size={16} /> Upload saved audio
                        <input type="file" accept="audio/*" className="sr-only" onChange={event => setCaptureFile(event.target.files?.[0] || null)} />
                      </label>
                    </div>
                    {captureFile && <p className="text-xs text-gray-600">Ready: {captureFile.name}</p>}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-orange-700 px-3 text-sm font-medium text-white hover:bg-orange-800">
                      <Camera size={16} /> Use camera
                      <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={event => setCaptureFile(event.target.files?.[0] || null)} />
                    </label>
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
                      <Upload size={16} /> Upload image or PDF
                      <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={event => setCaptureFile(event.target.files?.[0] || null)} />
                    </label>
                    {captureFile && <p className="w-full text-xs text-gray-600">Ready: {captureFile.name}</p>}
                  </div>
                )}
                <button type="button" onClick={extractObservation} disabled={!captureFile || extracting || aiStatus?.configured === false}
                  className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#2D5BFF] px-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
                  {extracting ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                  {extracting ? 'Extracting draft…' : 'Extract into monitoring fields'}
                </button>
                <p className="text-[11px] leading-4 text-gray-500">The file is used to prepare a draft and is not saved. Check the draft before saving.</p>
              </div>
            )}

            {captureMethod === 'QUESTIONNAIRE' && (
              <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 text-xs text-purple-900">
                Guided <strong>{sheet.title}</strong> questions are shown below. Complete the applicable measurements; required items remain enforced.
              </div>
            )}

            {aiDraftReady && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950">
                <ShieldCheck size={17} className="mt-0.5 shrink-0 text-[#2D5BFF]" />
                <span><strong>Draft ready.</strong> Check every value before saving.{aiAbnormalSuggested ? ' One or more values may be abnormal.' : ''}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {fields.map(f => (
                <div key={f.key}>
                  <label htmlFor={`f-${f.key}`} className="block text-sm font-medium text-gray-700 mb-1.5">
                    {f.label}{f.unit ? ` (${f.unit})` : ''}{f.required ? ' *' : ''}
                  </label>
                  {f.kind === 'select' ? (
                    <select id={`f-${f.key}`} value={values[f.key] ?? ''} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                      className="w-full min-h-[48px] px-3 border border-gray-300 rounded-lg text-sm bg-white">
                      <option value="">Select…</option>
                      {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.kind === 'boolean' ? (
                    <select id={`f-${f.key}`} value={values[f.key] ?? ''} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                      className="w-full min-h-[48px] px-3 border border-gray-300 rounded-lg text-sm bg-white">
                      <option value="">Select…</option>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  ) : (
                    <input id={`f-${f.key}`} type={f.kind === 'number' ? 'number' : 'text'}
                      inputMode={f.kind === 'number' ? 'decimal' : 'text'}
                      value={values[f.key] ?? ''} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                      className="w-full min-h-[48px] px-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
                  )}
                </div>
              ))}
            </div>
            <div>
              <label htmlFor="entry-notes" className="block text-sm font-medium text-gray-700 mb-1.5">Notes</label>
              <textarea id="entry-notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <label className="flex items-center gap-2 min-h-[44px] cursor-pointer">
              <input type="checkbox" checked={abnormal} onChange={e => setAbnormal(e.target.checked)} className="w-5 h-5 rounded border-gray-300" />
              <span className="text-sm text-gray-700">Flag as abnormal / escalate</span>
            </label>
            <div className="flex gap-3">
              <button onClick={closeForm} className="flex-1 min-h-[48px] border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
              <button onClick={submit} disabled={isPending}
                className="flex-1 min-h-[48px] bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50">
                {isPending ? 'Saving…' : 'Save observation'}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowForm(true)}
            className="w-full flex items-center justify-center gap-2 min-h-[52px] bg-[#2D5BFF] text-white rounded-xl text-sm font-medium hover:bg-[#1a45e0]">
            <Plus size={18} /> Record observation
          </button>
        )
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
          <div className="font-semibold text-gray-900 text-sm">Observations ({sheet.entries?.length || 0})</div>
          <div className="flex items-center gap-2 print:hidden">
            <div className="inline-flex rounded-lg bg-gray-100 p-1">
              <button type="button" onClick={() => setObservationView('CHART')} className={`flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${observationView === 'CHART' ? 'bg-white text-[#2D5BFF] shadow-sm' : 'text-gray-600'}`}><BarChart3 size={14} /> Chart</button>
              <button type="button" onClick={() => setObservationView('TABLE')} className={`flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${observationView === 'TABLE' ? 'bg-white text-[#2D5BFF] shadow-sm' : 'text-gray-600'}`}><Table2 size={14} /> Sheet</button>
              <button type="button" onClick={() => setObservationView('CARDS')} className={`flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${observationView === 'CARDS' ? 'bg-white text-[#2D5BFF] shadow-sm' : 'text-gray-600'}`}><LayoutList size={14} /> Cards</button>
            </div>
            <button type="button" onClick={() => window.print()} className="flex min-h-10 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-700 hover:bg-gray-50"><Printer size={14} /> Print</button>
          </div>
        </div>
        {observationView === 'TABLE' && sheet.entries?.length > 0 && (
          <div className="space-y-2 border-b border-gray-200 bg-gray-50/70 p-3 print:hidden">
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-48 flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={tableSearch} onChange={event => setTableSearch(event.target.value)} placeholder="Find a value, note or professional…"
                  className="min-h-10 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/20" />
              </label>
              <button type="button" onClick={() => setAbnormalOnly(current => !current)}
                className={`flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold ${abnormalOnly ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-200 bg-white text-gray-600'}`}>
                <AlertTriangle size={14} /> Abnormal only
              </button>
              <button type="button" onClick={() => setCompactSheet(current => !current)}
                className={`flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold ${compactSheet ? 'border-blue-300 bg-blue-50 text-[#2D5BFF]' : 'border-gray-200 bg-white text-gray-600'}`}>
                <Rows3 size={14} /> Compact rows
              </button>
              <details className="relative">
                <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600">
                  <Columns3 size={14} /> Columns
                </summary>
                <div className="absolute right-0 z-30 mt-1 min-w-56 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
                  <div className="mb-2 text-xs font-semibold text-gray-900">Visible measurements</div>
                  <div className="max-h-56 space-y-2 overflow-y-auto">
                    {fields.map(field => (
                      <label key={field.key} className="flex cursor-pointer items-center gap-2 text-xs text-gray-700">
                        <input type="checkbox" checked={!hiddenFieldKeys.includes(field.key)}
                          onChange={() => setHiddenFieldKeys(current => current.includes(field.key) ? current.filter(key => key !== field.key) : [...current, field.key])} />
                        {field.label}
                      </label>
                    ))}
                  </div>
                </div>
              </details>
              <button type="button" onClick={downloadCsv} className="flex min-h-10 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600">
                <Download size={14} /> CSV
              </button>
            </div>
            <p className="text-[11px] text-gray-500">Saved entries cannot be edited. Add a correction if needed.</p>
          </div>
        )}
        {!sheet.entries?.length ? (
          <div className="py-10 text-center text-sm text-gray-500">No observations recorded yet.</div>
        ) : observationView === 'CHART' ? (
          <div className="space-y-3 p-4">
            {numericSeries.length ? (
              <>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Value over time</h3>
                    <p className="text-xs text-gray-500">Green is within range, amber is outside goal, and red is critical.</p>
                  </div>
                  <label className="text-xs font-medium text-gray-600">
                    Measurement
                    <select
                      value={activeSeries?.key || ''}
                      onChange={event => setChartFieldKey(event.target.value)}
                      className="ml-2 min-h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30"
                    >
                      {numericSeries.map(series => <option key={series.key} value={series.key}>{series.label}{series.unit ? ` (${series.unit})` : ''}</option>)}
                    </select>
                  </label>
                </div>
                <MonitoringChart series={activeSeries} height={300} variant="bar" />
              </>
            ) : (
              <div className="py-10 text-center text-sm text-gray-500">No number-based readings yet. Use Sheet or Cards for text and checklists.</div>
            )}
          </div>
        ) : observationView === 'TABLE' ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-xs">
              <thead className="sticky top-0 z-20 border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="sticky left-0 z-10 bg-gray-50 px-3 py-3 text-left font-semibold text-gray-600">Observed at</th>
                  {visibleFields.map(field => <th key={field.key} className="border-l border-gray-200 px-3 py-3 text-left font-semibold text-gray-600">{field.label}{field.unit ? ` (${field.unit})` : ''}</th>)}
                  <th className="px-3 py-3 text-left font-semibold text-gray-600">Notes</th>
                  <th className="px-3 py-3 text-left font-semibold text-gray-600">Recorded by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tableEntries.map((entry, rowIndex) => (
                  <tr key={entry.id} className={entry.isAbnormal ? 'bg-red-50/40' : rowIndex % 2 ? 'bg-gray-50/40' : 'bg-white'}>
                    <td className={`sticky left-0 whitespace-nowrap px-3 font-medium ${compactSheet ? 'py-1.5' : 'py-3'} ${entry.isAbnormal ? 'bg-red-50 text-red-900' : rowIndex % 2 ? 'bg-gray-50 text-gray-900' : 'bg-white text-gray-900'}`}>
                      {format(new Date(entry.recordedAt), 'dd MMM yy · HH:mm')}
                      {entry.lateEntryReason && <span className="mt-1 block text-[10px] font-semibold uppercase text-amber-700">Late entry</span>}
                    </td>
                    {visibleFields.map(field => {
                      const value = entry.values?.[field.key];
                      const deviation = entry.deviations?.[field.key];
                      const display = value === 'true' ? 'Yes' : value === 'false' ? 'No' : value;
                      return <td key={field.key} className={`border-l border-gray-100 px-3 ${compactSheet ? 'py-1.5' : 'py-3'} ${deviationTone(deviation)}`}>{display === undefined || display === null || display === '' ? '—' : String(display)}{deviation && <span className="ml-1 text-[10px] uppercase">{String(deviation.severity || 'alert').replace(/_/g, ' ')}</span>}</td>;
                    })}
                    <td className={`max-w-56 border-l border-gray-100 px-3 text-gray-600 ${compactSheet ? 'py-1.5' : 'py-3'}`}>{entry.notes || '—'}</td>
                    <td className={`border-l border-gray-100 px-3 text-gray-600 ${compactSheet ? 'py-1.5' : 'py-3'}`}>
                      <span className="whitespace-nowrap">{entry.recordedBy ? `${entry.recordedBy.firstName} ${entry.recordedBy.lastName}` : 'Not captured'}</span>
                      <span className="mt-1 block whitespace-nowrap text-[10px] text-gray-400">EHR: {format(new Date(entry.createdAt), 'dd MMM yy · HH:mm')}</span>
                      {entry.lateEntryReason && <span className="mt-1 block max-w-48 text-[10px] text-amber-800">Reason: {entry.lateEntryReason}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {tableEntries.length === 0 && <div className="py-8 text-center text-sm text-gray-500">No rows match these sheet filters.</div>}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {sheet.entries.map(e => (
              <div key={e.id} className={`p-4 ${e.isAbnormal ? 'bg-red-50/60' : ''}`}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-sm font-medium text-gray-900">
                    {format(new Date(e.recordedAt), 'dd MMM yyyy · HH:mm')}
                  </span>
                  {e.isAbnormal
                    ? <span className="flex items-center gap-1 text-xs font-medium text-red-700"><AlertTriangle size={13} /> Abnormal</span>
                    : <Check size={14} className="text-green-600" />}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {fields.map(f => {
                    const v = e.values?.[f.key];
                    if (v === undefined || v === null || v === '') return null;
                    const display = v === 'true' ? 'Yes' : v === 'false' ? 'No' : v;
                    return (
                      <span key={f.key} className="px-2 py-1 bg-gray-50 border border-gray-200 rounded text-xs text-gray-700">
                        <span className="text-gray-500">{f.label}:</span> {display}{f.unit ? ` ${f.unit}` : ''}
                      </span>
                    );
                  })}
                </div>
                {(e.intakeMl != null || e.outputMl != null) && (
                  <div className="mt-2 text-xs text-gray-500">
                    {e.intakeMl != null && <span className="mr-3">In: {e.intakeMl} ml</span>}
                    {e.outputMl != null && <span>Out: {e.outputMl} ml</span>}
                  </div>
                )}
                {e.notes && <p className="mt-2 text-sm text-gray-600">{e.notes}</p>}
                <p className="mt-2 text-xs text-gray-500">
                  Recorded by {e.recordedBy ? `${e.recordedBy.firstName} ${e.recordedBy.lastName}` : 'professional not captured'}
                  {e.createdAt ? ` in EHR on ${format(new Date(e.createdAt), 'dd MMM yyyy · HH:mm')}` : ''}
                </p>
                {e.lateEntryReason && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">Late entry reason: {e.lateEntryReason}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
