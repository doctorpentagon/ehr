import React, { useState, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, FileText, Mic, Camera, ClipboardList, Square, MicOff, Upload, Check, Loader2 } from 'lucide-react';
import { useSelector } from 'react-redux';
import { toast } from 'sonner';
import api from '@/lib/api';
import PatientPicker from '@/components/clinical/PatientPicker';
import Spinner from '@/components/ui/Spinner';

const ENCOUNTER_TYPES = [
  { key: 'CONSULTATION',   label: 'Consultation' },
  { key: 'WARD_ROUND',     label: 'Ward round' },
  { key: 'PROCEDURE_ROOM', label: 'Procedure room' },
  { key: 'EMERGENCY',      label: 'Emergency' },
  { key: 'FOLLOW_UP',      label: 'Follow-up' },
  { key: 'ANTENATAL',      label: 'Antenatal' },
];

const METHODS = [
  { key: 'NOTE_TAKER',    label: 'SOAP Note',      desc: 'Type structured SOAP notes',   Icon: FileText, color: 'blue' },
  { key: 'VOICE',         label: 'Voice Recording', desc: 'Record consultation audio',    Icon: Mic,      color: 'purple' },
  { key: 'OCR',           label: 'Scan / OCR',      desc: 'Upload handwritten notes',     Icon: Camera,   color: 'teal' },
  { key: 'QUESTIONNAIRE', label: 'Questionnaire',   desc: 'Guided symptom collection',    Icon: ClipboardList, color: 'orange' },
];

const SOAP_FIELDS = [
  { key: 'chiefComplaint', label: 'Chief Complaint', placeholder: 'What brings the patient in today?' },
  { key: 'history',        label: 'History of Presenting Illness', placeholder: 'Onset, duration, character, associated symptoms…' },
  { key: 'examination',    label: 'Examination Findings', placeholder: 'General appearance, systems review…' },
  { key: 'assessment',     label: 'Assessment / Diagnosis', placeholder: 'Working or confirmed diagnosis…' },
  { key: 'plan',           label: 'Plan', placeholder: 'Investigations, medications, referrals, follow-up…' },
];

const QUESTIONNAIRE = [
  { key: 'chiefComplaint', label: '1. What is the main complaint?', type: 'text' },
  { key: 'duration',       label: '2. How long has this been going on?', type: 'text' },
  { key: 'severity',       label: '3. Severity (1–10)?', type: 'range' },
  { key: 'history',        label: '4. Relevant medical history?', type: 'textarea' },
  { key: 'assessment',     label: '5. Preliminary assessment?', type: 'textarea' },
  { key: 'plan',           label: '6. Management plan?', type: 'textarea' },
];

export default function NewEncounter() {
  const navigate = useNavigate();
  const [urlParams] = useSearchParams();
  const qc = useQueryClient();
  const preselectedPatient = urlParams.get('patientId');
  const user = useSelector((st) => st.auth?.user);

  const [method, setMethod] = useState(null);
  const [patientId, setPatientId] = useState(preselectedPatient || '');
  const [title, setTitle] = useState('');
  const [form, setForm] = useState({ chiefComplaint: '', history: '', examination: '', assessment: '', plan: '' });
  const [encounterType, setEncounterType] = useState('CONSULTATION');
  const [encounterTypeId, setEncounterTypeId] = useState('');
  const [doctorsOrders, setDoctorsOrders] = useState('');
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [scanFile, setScanFile] = useState(null);
  const [severity, setSeverity] = useState(5);
  const { data: contextTypes } = useQuery({
    queryKey: ['encounter-types'],
    queryFn: () => api.get('/encounter-types').then(r => r.data?.types || []),
  });

  const { data: todaysClinics } = useQuery({
    queryKey: ['clinics-today'],
    queryFn: () => api.get('/encounter-types/schedules/today').then(r => r.data?.clinics || []),
  });

  // The clinic running right now that this doctor is named on. Confirming a
  // sensible default is faster and less error-prone than picking from a list
  // every single time.
  const todaysClinic = (todaysClinics || []).find(
    c => c.isRunningNow && (c.doctors || []).some(d => d.id === user?.id),
  ) || (todaysClinics || []).find(c => c.isRunningNow);

  React.useEffect(() => {
    if (!encounterTypeId && todaysClinic?.encounterTypeId) setEncounterTypeId(todaysClinic.encounterTypeId);
  }, [todaysClinic, encounterTypeId]);

  const mediaRef = useRef(null);
  const chunksRef = useRef([]);


  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRef.current = new MediaRecorder(stream);
      chunksRef.current = [];
      mediaRef.current.ondataavailable = e => chunksRef.current.push(e.data);
      mediaRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRef.current.start();
      setRecording(true);
    } catch (_) { toast.error('Microphone access denied'); }
  };

  const stopRecording = () => { mediaRef.current?.stop(); setRecording(false); };

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      let payload = {
        patientId, title: title || form.chiefComplaint || 'Encounter',
        captureMethod: method, encounterType, encounterTypeId, doctorsOrders, ...form,
      };

      if (method === 'QUESTIONNAIRE') {
        payload.chiefComplaint = form.chiefComplaint;
        payload.notes = `Severity: ${severity}/10`;
      }

      if (method === 'OCR' && scanFile) {
        const fd = new FormData();
        fd.append('scan', scanFile);
        Object.entries(payload).forEach(([k, v]) => fd.append(k, v));
        return api.post('/cases', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      if (method === 'VOICE' && audioBlob) {
        const fd = new FormData();
        fd.append('audio', audioBlob, 'recording.webm');
        Object.entries(payload).forEach(([k, v]) => fd.append(k, v));
        return api.post('/cases', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      return api.post('/cases', payload);
    },
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ['cases'] });
      toast.success('Encounter saved!');
      navigate(`/dashboard/cases/${data.id}`);
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed to save encounter'),
  });

  const setF = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  if (!method) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
          <ChevronLeft size={18} /> Back
        </button>
        <h1 className="text-xl font-bold text-gray-900">New Encounter</h1>
        <p className="text-sm text-gray-500">Choose how to document this consultation</p>

        <div className="grid sm:grid-cols-2 gap-3">
          {METHODS.map(({ key, label, desc, Icon, color }) => {
            const C = { blue: 'bg-[#2D5BFF]/10 text-[#2D5BFF] border-[#2D5BFF]/30 hover:border-[#2D5BFF]', purple: 'bg-purple-50 text-purple-600 border-purple-200 hover:border-purple-400', teal: 'bg-teal-50 text-teal-600 border-teal-200 hover:border-teal-400', orange: 'bg-orange-50 text-orange-600 border-orange-200 hover:border-orange-400' }[color];
            return (
              <button key={key} onClick={() => setMethod(key)} className={`border-2 rounded-xl p-5 text-left transition-all hover:shadow-md ${C}`}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: 'currentColor', color: 'transparent' }}>
                  <Icon size={20} style={{ color: 'inherit', filter: 'invert(1) brightness(2)' }} />
                </div>
                <div className="font-semibold text-gray-900">{label}</div>
                <div className="text-sm text-gray-500 mt-1">{desc}</div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <button onClick={() => setMethod(null)} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
        <ChevronLeft size={18} /> Change method
      </button>

      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-gray-900">{METHODS.find(m => m.key === method)?.label}</h1>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        {/* Patient select */}
        {!preselectedPatient && (
          <PatientPicker value={patientId} onChange={setPatientId} required autoFocus />
        )}

        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Case title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Hypertension follow-up" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
        </div>

        {/*
          Encounter context — required.
          Billing, the clinic timetable and every report are built on this, so a
          record that cannot tell an emergency attendance from a routine clinic
          review is not much use to any of them. If the doctor is running a
          clinic right now, that one is pre-selected: the common case should be
          confirming, not choosing.
        */}
        <div>
          <span className="block text-sm font-medium text-gray-700 mb-1.5">
            Encounter context <span className="text-red-500">*</span>
          </span>
          {todaysClinic && (
            <p className="text-xs text-[#2D5BFF] mb-1.5">
              You are running {todaysClinic.name} today
              {todaysClinic.location ? ` in ${todaysClinic.location}` : ''} — pre-selected below.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {(contextTypes || []).map(t => (
              <button key={t.id} type="button" onClick={() => setEncounterTypeId(t.id)}
                aria-pressed={encounterTypeId === t.id}
                title={t.description || undefined}
                className={`px-3 min-h-11 rounded-lg border text-sm font-medium transition-colors ${
                  encounterTypeId === t.id ? 'border-[#2D5BFF] bg-[#2D5BFF]/5 text-[#2D5BFF]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}>
                {t.name}
              </button>
            ))}
          </div>
          {!encounterTypeId && (
            <p className="text-xs text-gray-500 mt-1.5">Choose one before saving.</p>
          )}
        </div>

        {/* How the encounter was conducted — kept separate from what kind of
            contact it was, because they answer different questions. */}
        <div>
          <span className="block text-sm font-medium text-gray-700 mb-1.5">Setting</span>
          <div className="flex flex-wrap gap-2">
            {ENCOUNTER_TYPES.map(t => (
              <button key={t.key} type="button" onClick={() => setEncounterType(t.key)}
                aria-pressed={encounterType === t.key}
                className={`px-3 min-h-11 rounded-lg border text-sm font-medium transition-colors ${
                  encounterType === t.key ? 'border-[#2D5BFF] bg-[#2D5BFF]/5 text-[#2D5BFF]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* SOAP Note */}
        {method === 'NOTE_TAKER' && SOAP_FIELDS.map(({ key, label, placeholder }) => (
          <div key={key}>
            <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
            <textarea value={form[key]} onChange={setF(key)} rows={3} placeholder={placeholder} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none" />
          </div>
        ))}

        {/* Voice */}
        {method === 'VOICE' && (
          <div className="text-center py-6">
            {!audioBlob ? (
              <>
                <div className={`w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-4 transition-all ${recording ? 'bg-red-100 animate-pulse' : 'bg-gray-100'}`}>
                  {recording ? <MicOff size={36} className="text-red-600" /> : <Mic size={36} className="text-gray-500" />}
                </div>
                <button onClick={recording ? stopRecording : startRecording} className={`px-6 py-3 rounded-xl font-medium text-white ${recording ? 'bg-red-600 hover:bg-red-700' : 'bg-[#2D5BFF] hover:bg-[#1a45e0]'}`}>
                  {recording ? 'Stop Recording' : 'Start Recording'}
                </button>
                {recording && <div className="mt-3 text-sm text-red-600 font-medium animate-pulse">● Recording…</div>}
              </>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-xl p-5">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3"><Check size={22} className="text-green-600" /></div>
                <div className="font-medium text-green-800 mb-2">Recording complete</div>
                <audio controls src={URL.createObjectURL(audioBlob)} className="w-full" />
                <button onClick={() => setAudioBlob(null)} className="mt-3 text-sm text-gray-500 hover:text-gray-700">Re-record</button>
              </div>
            )}
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Add notes (optional)</label>
              <textarea value={form.chiefComplaint} onChange={setF('chiefComplaint')} rows={2} placeholder="Brief summary of the consultation…" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none" />
            </div>
          </div>
        )}

        {/* OCR */}
        {method === 'OCR' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Upload handwritten / printed notes</label>
            <label className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all ${scanFile ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-[#2D5BFF] hover:bg-[#2D5BFF]/5'}`}>
              {scanFile ? (
                <><Check size={28} className="text-green-600 mb-2" /><span className="text-sm font-medium text-green-700">{scanFile.name}</span><span className="text-xs text-green-500 mt-1">Click to change</span></>
              ) : (
                <><Upload size={28} className="text-gray-400 mb-2" /><span className="text-sm font-medium text-gray-600">Click or drag to upload</span><span className="text-xs text-gray-400 mt-1">PNG, JPG, PDF — max 10MB</span></>
              )}
              <input type="file" accept="image/*,.pdf" className="hidden" onChange={e => setScanFile(e.target.files[0])} />
            </label>
            <div className="mt-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">Additional notes</label>
              <textarea value={form.chiefComplaint} onChange={setF('chiefComplaint')} rows={2} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none" />
            </div>
          </div>
        )}

        {/* Questionnaire */}
        {method === 'QUESTIONNAIRE' && QUESTIONNAIRE.map(({ key, label, type }) => (
          <div key={key}>
            <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
            {type === 'range' ? (
              <div>
                <input type="range" min={1} max={10} value={severity} onChange={e => setSeverity(+e.target.value)} className="w-full" />
                <div className="flex justify-between text-xs text-gray-500 mt-1"><span>1 (mild)</span><span className="font-bold text-[#2D5BFF]">{severity}/10</span><span>10 (severe)</span></div>
              </div>
            ) : type === 'textarea' ? (
              <textarea rows={3} value={form[key] || ''} onChange={setF(key)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none" />
            ) : (
              <input type="text" value={form[key] || ''} onChange={setF(key)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
            )}
          </div>
        ))}

        {/* To do / Doctor's orders — the actionable instructions from the case design */}
        <div>
          <label htmlFor="doctors-orders" className="block text-sm font-medium text-gray-700 mb-1">
            To do / Doctor&rsquo;s orders
          </label>
          <textarea id="doctors-orders" rows={3} value={doctorsOrders} onChange={e => setDoctorsOrders(e.target.value)}
            placeholder={'1. IV Ceftriaxone 1g BD\n2. Chest X-ray\n3. Strict intake/output chart'}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none" />
          <p className="text-xs text-gray-500 mt-1">Nursing staff see these on the ward.</p>
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => navigate(-1)} className="flex-1 min-h-12 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          {/* The context is required by the API; blocking here means the doctor
              finds out before they have typed a full note, not after. */}
          <button onClick={() => mutate()} disabled={isPending || !patientId || !encounterTypeId} className="flex-1 min-h-12 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50 flex items-center justify-center gap-2">
            {isPending && <Loader2 size={15} className="animate-spin" />}
            {isPending ? 'Saving…' : 'Save case'}
          </button>
        </div>
      </div>
    </div>
  );
}
