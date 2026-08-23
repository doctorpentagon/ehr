import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, AlertTriangle, Check, Printer, LayoutList, Table2, Keyboard, Mic, Camera, ListChecks, Square, Upload, Loader2, ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useSelector } from 'react-redux';
import api from '../../lib/api';
import Spinner from '../../components/ui/Spinner';
import ClinicalAttribution from '../../components/clinical/ClinicalAttribution';
import ClinicalEventTime from '../../components/clinical/ClinicalEventTime';
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
  { key: 'TYPE', label: 'Type', description: 'Enter the observation directly', Icon: Keyboard, tone: 'blue' },
  { key: 'VOICE', label: 'Voice', description: 'Record live or upload saved audio', Icon: Mic, tone: 'green' },
  { key: 'SNAP', label: 'Snap', description: 'Photograph handwriting or upload a file', Icon: Camera, tone: 'orange' },
  { key: 'CHECKLIST', label: 'Checklist', description: 'Use the assigned monitoring template', Icon: ListChecks, tone: 'purple' },
];

export default function MonitoringSheet() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [values, setValues] = useState({});
  const [notes, setNotes] = useState('');
  const [abnormal, setAbnormal] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [observationView, setObservationView] = useState('TABLE');
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
            <p className="mt-1 text-xs text-red-800">The durable alert is now open. Keep monitoring while the authorised clinician acknowledges and records action.</p>
          </div>
          <button type="button" onClick={() => setCriticalNotice(null)} aria-label="Dismiss critical notice" className="size-10 shrink-0 rounded-lg hover:bg-red-100">×</button>
        </div>
      )}

      {mayWrite && sheet.status === 'ACTIVE' && (
        showForm ? (
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 space-y-4">
            <div>
              <h2 className="font-semibold text-gray-900">Record observation</h2>
              <p className="mt-1 text-xs text-gray-500">Choose how to capture. Every route ends in the same structured, nurse-reviewed observation.</p>
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
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {CAPTURE_METHODS.map(({ key, label, description, Icon }) => (
                <button key={key} type="button" onClick={() => { setCaptureMethod(key); setCaptureFile(null); setAiDraftReady(false); setAiAbnormalSuggested(false); }}
                  className={`min-h-[92px] rounded-xl border p-3 text-left transition ${captureMethod === key ? 'border-[#2D5BFF] bg-blue-50 ring-2 ring-[#2D5BFF]/15' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
                  <Icon size={19} className={captureMethod === key ? 'text-[#2D5BFF]' : 'text-gray-500'} />
                  <div className="mt-2 text-sm font-semibold text-gray-900">{label}</div>
                  <div className="mt-0.5 text-[11px] leading-4 text-gray-500">{description}</div>
                </button>
              ))}
            </div>

            {(captureMethod === 'VOICE' || captureMethod === 'SNAP') && (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-3">
                {aiStatus && !aiStatus.configured && (
                  <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    Awibi Clinical AI is not configured locally yet. You can still Type or use the Checklist now; Voice and Snap extraction require the service in <span className="font-mono">MANUAL_SETUP_REQUIRED.txt</span>.
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
                <p className="text-[11px] leading-4 text-gray-500">The source file is not stored by this adapter. AI creates a draft only; it cannot save an observation, complete this sheet, or record medication administration.</p>
              </div>
            )}

            {captureMethod === 'CHECKLIST' && (
              <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 text-xs text-purple-900">
                This checklist comes from the assigned <strong>{sheet.title}</strong> template. Complete the applicable items below; required fields remain enforced.
              </div>
            )}

            {aiDraftReady && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950">
                <ShieldCheck size={17} className="mt-0.5 shrink-0 text-[#2D5BFF]" />
                <span><strong>AI draft ready for nurse review.</strong> Compare every extracted value with the patient/source, correct errors, then explicitly save.{aiAbnormalSuggested ? ' The AI suggested that this may be abnormal; confirm with the displayed values and local escalation policy.' : ''}</span>
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
              <button type="button" onClick={() => setObservationView('TABLE')} className={`flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${observationView === 'TABLE' ? 'bg-white text-[#2D5BFF] shadow-sm' : 'text-gray-600'}`}><Table2 size={14} /> Sheet</button>
              <button type="button" onClick={() => setObservationView('CARDS')} className={`flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${observationView === 'CARDS' ? 'bg-white text-[#2D5BFF] shadow-sm' : 'text-gray-600'}`}><LayoutList size={14} /> Cards</button>
            </div>
            <button type="button" onClick={() => window.print()} className="flex min-h-10 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-700 hover:bg-gray-50"><Printer size={14} /> Print</button>
          </div>
        </div>
        {!sheet.entries?.length ? (
          <div className="py-10 text-center text-sm text-gray-500">No observations recorded yet.</div>
        ) : observationView === 'TABLE' ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-xs">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="sticky left-0 z-10 bg-gray-50 px-3 py-3 text-left font-semibold text-gray-600">Observed at</th>
                  {fields.map(field => <th key={field.key} className="px-3 py-3 text-left font-semibold text-gray-600">{field.label}{field.unit ? ` (${field.unit})` : ''}</th>)}
                  <th className="px-3 py-3 text-left font-semibold text-gray-600">Notes</th>
                  <th className="px-3 py-3 text-left font-semibold text-gray-600">Recorded by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sheet.entries.map(entry => (
                  <tr key={entry.id} className={entry.isAbnormal ? 'bg-red-50/60' : 'bg-white'}>
                    <td className={`sticky left-0 whitespace-nowrap px-3 py-3 font-medium ${entry.isAbnormal ? 'bg-red-50 text-red-900' : 'bg-white text-gray-900'}`}>
                      {format(new Date(entry.recordedAt), 'dd MMM yy · HH:mm')}
                      {entry.lateEntryReason && <span className="mt-1 block text-[10px] font-semibold uppercase text-amber-700">Late entry</span>}
                    </td>
                    {fields.map(field => {
                      const value = entry.values?.[field.key];
                      const deviation = entry.deviations?.[field.key];
                      const display = value === 'true' ? 'Yes' : value === 'false' ? 'No' : value;
                      return <td key={field.key} className={`px-3 py-3 ${deviation ? 'font-bold text-red-800' : 'text-gray-700'}`}>{display === undefined || display === null || display === '' ? '—' : String(display)}{deviation && <span className="ml-1 text-[10px] uppercase">{String(deviation.severity || 'alert').replace(/_/g, ' ')}</span>}</td>;
                    })}
                    <td className="max-w-56 px-3 py-3 text-gray-600">{entry.notes || '—'}</td>
                    <td className="px-3 py-3 text-gray-600">
                      <span className="whitespace-nowrap">{entry.recordedBy ? `${entry.recordedBy.firstName} ${entry.recordedBy.lastName}` : 'Not captured'}</span>
                      <span className="mt-1 block whitespace-nowrap text-[10px] text-gray-400">EHR: {format(new Date(entry.createdAt), 'dd MMM yy · HH:mm')}</span>
                      {entry.lateEntryReason && <span className="mt-1 block max-w-48 text-[10px] text-amber-800">Reason: {entry.lateEntryReason}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
