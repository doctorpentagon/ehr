import React, { useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, FileText, Mic, Camera, ClipboardList, MicOff, Upload, Check, Loader2, Plus, Trash2, ArrowRight, Eye, RefreshCw } from 'lucide-react';
import { useSelector } from 'react-redux';
import { toast } from 'sonner';
import api from '@/lib/api';
import PatientPicker from '@/components/clinical/PatientPicker';
import Spinner from '@/components/ui/Spinner';
import ClinicalText from '@/components/clinical/ClinicalText';
import ClinicalAttribution from '@/components/clinical/ClinicalAttribution';
import ClinicalEventTime from '@/components/clinical/ClinicalEventTime';

const ENCOUNTER_TYPES = [
  { key: 'CONSULTATION',   label: 'Consultation' },
  { key: 'WARD_ROUND',     label: 'Ward round' },
  { key: 'PROCEDURE_ROOM', label: 'Procedure room' },
  { key: 'EMERGENCY',      label: 'Emergency' },
  { key: 'FOLLOW_UP',      label: 'Follow-up' },
  { key: 'ANTENATAL',      label: 'Antenatal' },
];

const METHODS = [
  { key: 'NOTE_TAKER',    label: 'Type SOAP Note', desc: 'Fast typing with a structured template', Icon: FileText, color: 'blue' },
  { key: 'VOICE',         label: 'Voice Record', desc: 'Speak or upload audio; AI structures SOAP', Icon: Mic, color: 'green' },
  { key: 'OCR',           label: 'Scan & Extract', desc: 'Snap or upload handwriting; AI extracts', Icon: Camera, color: 'orange' },
  { key: 'QUESTIONNAIRE', label: 'Questionnaire / Checklist', desc: 'Tap through findings and generate SOAP', Icon: ClipboardList, color: 'purple' },
];

const SOAP_FIELDS = [
  { key: 'chiefComplaint', label: 'Chief Complaint', placeholder: 'What brings the patient in today?' },
  { key: 'history',        label: 'History of Presenting Illness', placeholder: 'Onset, duration, character, associated symptoms…' },
  { key: 'reviewOfSystems', label: 'Review of Systems', placeholder: 'Document relevant positives and negatives by system…' },
  { key: 'examination',    label: 'Physical Examination', placeholder: 'General appearance and system examination findings…' },
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

const QUESTIONNAIRE_TEMPLATES = {
  GENERAL: {
    label: 'General',
    groups: [
      { title: 'Common symptoms', items: [['fever', 'Fever'], ['pain', 'Pain'], ['weakness', 'Weakness / fatigue'], ['poorAppetite', 'Poor appetite'], ['weightLoss', 'Weight loss']] },
      { title: 'System review', items: [['cough', 'Cough'], ['breathlessness', 'Breathlessness'], ['vomiting', 'Vomiting'], ['diarrhoea', 'Diarrhoea'], ['urinary', 'Urinary symptoms'], ['headache', 'Headache']] },
    ],
  },
  MEDICAL: {
    label: 'Medical',
    groups: [
      { title: 'Presenting symptoms', items: [['fever', 'Fever'], ['cough', 'Cough'], ['breathlessness', 'Shortness of breath'], ['chestPain', 'Chest pain'], ['palpitations', 'Palpitations'], ['legSwelling', 'Leg swelling']] },
      { title: 'Gastrointestinal / neurological / urinary', items: [['vomiting', 'Vomiting'], ['diarrhoea', 'Diarrhoea'], ['abdominalPain', 'Abdominal pain'], ['headache', 'Headache'], ['weakness', 'Weakness'], ['convulsion', 'Convulsion'], ['urinary', 'Urinary symptoms']] },
    ],
  },
  SURGICAL: {
    label: 'Surgical',
    groups: [
      { title: 'Surgical complaint', items: [['pain', 'Pain'], ['swelling', 'Swelling / lump'], ['wound', 'Wound'], ['discharge', 'Wound discharge'], ['bleeding', 'Bleeding'], ['trauma', 'History of trauma']] },
      { title: 'Associated symptoms', items: [['vomiting', 'Vomiting'], ['abdominalDistension', 'Abdominal distension'], ['bowelChange', 'Change in bowel habit'], ['urinary', 'Urinary symptoms'], ['fever', 'Fever'], ['weightLoss', 'Weight loss']] },
    ],
  },
  PEDIATRIC: {
    label: 'Paediatric',
    groups: [
      { title: 'Child’s symptoms', items: [['fever', 'Fever'], ['cough', 'Cough'], ['breathlessness', 'Difficulty breathing'], ['poorFeeding', 'Poor feeding'], ['vomiting', 'Vomiting'], ['diarrhoea', 'Diarrhoea'], ['convulsion', 'Convulsion'], ['rash', 'Rash']] },
      { title: 'Child wellbeing', items: [['reducedActivity', 'Reduced activity'], ['reducedUrine', 'Reduced urine'], ['weightLoss', 'Weight loss / poor growth'], ['sickContact', 'Sick contact'], ['immunisationIncomplete', 'Immunisation incomplete']] },
    ],
  },
  OBSTETRICS: {
    label: 'Obstetrics',
    groups: [
      { title: 'Pregnancy concerns', items: [['abdominalPain', 'Abdominal pain / contractions'], ['vaginalBleeding', 'Vaginal bleeding'], ['fluidLeak', 'Leakage of fluid'], ['reducedFetalMovement', 'Reduced fetal movement'], ['vaginalDischarge', 'Abnormal vaginal discharge']] },
      { title: 'Danger symptoms', items: [['headache', 'Severe headache'], ['blurredVision', 'Blurred vision'], ['legSwelling', 'Leg / facial swelling'], ['convulsion', 'Convulsion'], ['fever', 'Fever'], ['breathlessness', 'Breathlessness']] },
    ],
  },
};

const ORDER_TYPES = [
  { key: 'NURSING', label: 'Nursing care' },
  { key: 'MEDICATION', label: 'Medication' },
  { key: 'LAB', label: 'Laboratory' },
  { key: 'IMAGING', label: 'Imaging' },
  { key: 'TREATMENT', label: 'Treatment' },
  { key: 'DIET', label: 'Diet' },
  { key: 'ACTIVITY', label: 'Activity' },
];

const EMPTY_ORDER = {
  type: 'NURSING', name: '', priority: 'ROUTINE', instructions: '',
  catalogueTestId: '',
  frequencyHours: '', goal: '', goalMin: '', criticalLow: '',
  dosage: '', frequency: '', duration: '', route: 'ORAL',
};

export default function NewEncounter() {
  const navigate = useNavigate();
  const [urlParams] = useSearchParams();
  const qc = useQueryClient();
  const preselectedPatient = urlParams.get('patientId');
  const user = useSelector((st) => st.auth?.user);

  // Documentation is one workspace. Voice, OCR and the questionnaire are
  // input tools that feed the same clinical note instead of four isolated
  // encounter flows.
  const [method, setMethod] = useState(null);
  const [captureStage, setCaptureStage] = useState(true);
  const [patientId, setPatientId] = useState(preselectedPatient || '');
  const [title, setTitle] = useState('');
  const [form, setForm] = useState({ chiefComplaint: '', history: '', reviewOfSystems: '', examination: '', assessment: '', plan: '' });
  const [encounterType, setEncounterType] = useState('CONSULTATION');
  const [encounterTypeId, setEncounterTypeId] = useState('');
  const [retrospective, setRetrospective] = useState(false);
  const [occurredAt, setOccurredAt] = useState('');
  const [lateEntryReason, setLateEntryReason] = useState('');
  const [orders, setOrders] = useState([]);
  const [orderDraft, setOrderDraft] = useState(EMPTY_ORDER);
  const [diagnosisCodes, setDiagnosisCodes] = useState('');
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioName, setAudioName] = useState('recording.webm');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [aiStructuring, setAiStructuring] = useState(false);
  const [scanFile, setScanFile] = useState(null);
  const [ocrText, setOcrText] = useState('');
  const [extractingOcr, setExtractingOcr] = useState(false);
  const [previewFields, setPreviewFields] = useState({});
  const [severity, setSeverity] = useState(5);
  const [questionnaireTemplate, setQuestionnaireTemplate] = useState('GENERAL');
  const [questionnaireAnswers, setQuestionnaireAnswers] = useState({});
  const [questionnaireDetails, setQuestionnaireDetails] = useState({ chiefComplaint: '', history: '', examination: '', context: '' });
  const [questionnaireGenerated, setQuestionnaireGenerated] = useState(false);
  const { data: contextTypes } = useQuery({
    queryKey: ['encounter-types'],
    queryFn: () => api.get('/encounter-types').then(r => r.data?.types || []),
  });

  const { data: todaysClinics } = useQuery({
    queryKey: ['clinics-today'],
    queryFn: () => api.get('/encounter-types/schedules/today').then(r => r.data?.clinics || []),
  });

  const isDiagnosticDraft = orderDraft.type === 'LAB' || orderDraft.type === 'IMAGING';
  const { data: diagnosticCatalogue = [], isLoading: catalogueLoading } = useQuery({
    queryKey: ['diagnostic-catalogue', orderDraft.type],
    queryFn: () => api.get('/lab/catalogue', { params: { testType: orderDraft.type } }).then(r => r.data?.tests || []),
    enabled: isDiagnosticDraft,
  });

  const { data: aiStatus } = useQuery({
    queryKey: ['clinical-ai-status'],
    queryFn: () => api.get('/ai/status').then(response => response.data),
    enabled: method === 'VOICE' || method === 'OCR',
    retry: false,
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
  const speechRecognitionRef = useRef(null);
  const chunksRef = useRef([]);
  const fieldRefs = useRef({});

  React.useEffect(() => {
    if (!recording) return undefined;
    const timer = window.setInterval(() => setRecordingSeconds(seconds => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  const formatField = (key, style) => {
    const input = fieldRefs.current[key];
    if (!input) return;
    const value = form[key] || '';
    const start = input.selectionStart ?? value.length;
    const end = input.selectionEnd ?? start;
    const selected = value.slice(start, end);
    let replacement;

    if (style === 'bold') replacement = `**${selected || 'bold text'}**`;
    else if (style === 'italic') replacement = `_${selected || 'italic text'}_`;
    else if (style === 'underline') replacement = `++${selected || 'underlined text'}++`;
    else {
      const lines = (selected || value.slice(start) || 'List item').split('\n');
      replacement = lines.map((line, index) => (
        style === 'bullet' ? `• ${line.replace(/^\s*[•-]\s*/, '')}` : `${index + 1}. ${line.replace(/^\s*\d+\.\s*/, '')}`
      )).join('\n');
    }

    const next = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
    setForm(current => ({ ...current, [key]: next }));
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start, start + replacement.length);
    });
  };


  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRef.current = new MediaRecorder(stream);
      chunksRef.current = [];
      mediaRef.current.ondataavailable = e => chunksRef.current.push(e.data);
      mediaRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        setAudioName('live-consultation.webm');
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRef.current.start();
      setRecordingSeconds(0);
      setLiveTranscript('');
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-NG';
        recognition.onresult = (event) => {
          const words = Array.from(event.results).map(result => result[0]?.transcript || '').join(' ');
          setLiveTranscript(words.trim());
        };
        recognition.onerror = () => {};
        speechRecognitionRef.current = recognition;
        try { recognition.start(); } catch { /* audio capture still works */ }
      }
      setRecording(true);
    } catch (_) { toast.error('Microphone access denied'); }
  };

  const stopRecording = () => {
    mediaRef.current?.stop();
    try { speechRecognitionRef.current?.stop(); } catch { /* already stopped */ }
    setRecording(false);
  };

  const applyAiSoap = (response) => {
    const soap = response?.soap || response || {};
    setForm(current => ({
      ...current,
      chiefComplaint: soap.chiefComplaint ?? soap.cc ?? '',
      history: soap.history ?? soap.hpi ?? '',
      reviewOfSystems: soap.reviewOfSystems ?? soap.ros ?? '',
      examination: soap.examination ?? soap.pe ?? '',
      assessment: soap.assessment ?? '',
      plan: soap.plan ?? '',
    }));
    if (soap.transcript) setLiveTranscript(soap.transcript);
    setCaptureStage(false);
  };

  const structureVoice = async () => {
    if (!audioBlob) return toast.error('Record or upload an audio file first');
    if (!patientId) return toast.error('Select the patient before sending audio for extraction');
    setAiStructuring(true);
    try {
      const body = new FormData();
      body.append('audio_file', audioBlob, audioName);
      body.append('patient_id', patientId);
      const { data } = await api.post('/ai/transcribe-soap', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      applyAiSoap(data.soap);
      toast.success('AI structured the recording. Review every heading before saving.');
    } catch (error) {
      toast.error(error.response?.data?.error || 'AI could not structure this recording');
    } finally {
      setAiStructuring(false);
    }
  };

  const chooseMethod = (nextMethod) => {
    setMethod(nextMethod);
    setCaptureStage(nextMethod === 'VOICE' || nextMethod === 'OCR');
    setQuestionnaireGenerated(false);
  };

  const showClinicalReview = !captureStage && (method !== 'QUESTIONNAIRE' || questionnaireGenerated);

  const setQuestionnaireAnswer = (key, value) => {
    setQuestionnaireAnswers(current => ({
      ...current,
      [key]: { ...(current[key] || {}), answer: value },
    }));
  };

  const setQuestionnaireDuration = (key, value) => {
    setQuestionnaireAnswers(current => ({
      ...current,
      [key]: { ...(current[key] || {}), duration: value },
    }));
  };

  const generateQuestionnaireSoap = () => {
    if (!questionnaireDetails.chiefComplaint.trim()) return toast.error('Enter the chief complaint');
    const template = QUESTIONNAIRE_TEMPLATES[questionnaireTemplate];
    const labels = Object.fromEntries(template.groups.flatMap(group => group.items));
    const positive = [];
    const negative = [];
    Object.entries(questionnaireAnswers).forEach(([key, answer]) => {
      if (!answer?.answer || !labels[key]) return;
      const duration = answer.duration?.trim() ? ` for ${answer.duration.trim()}` : '';
      if (answer.answer === 'YES') positive.push(`${labels[key]}${duration}`);
      if (answer.answer === 'NO') negative.push(`No ${labels[key].toLowerCase()}`);
    });
    setForm(current => ({
      ...current,
      chiefComplaint: questionnaireDetails.chiefComplaint.trim(),
      history: [positive.length ? `Reports: ${positive.join('; ')}.` : '', questionnaireDetails.history.trim(), questionnaireDetails.context.trim()].filter(Boolean).join('\n'),
      reviewOfSystems: negative.length ? `${negative.join('; ')}.` : current.reviewOfSystems,
      examination: questionnaireDetails.examination.trim(),
    }));
    setQuestionnaireGenerated(true);
    toast.success('SOAP draft generated. Complete the assessment and plan, then review every heading.');
  };

  const extractScan = async () => {
    if (!scanFile) return toast.error('Choose an image first');
    setExtractingOcr(true);
    try {
      const body = new FormData();
      if (!patientId) return toast.error('Select the patient before sending the document for extraction');
      body.append('image_or_pdf', scanFile);
      body.append('patient_id', patientId);
      const { data } = await api.post('/ai/ocr-soap', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      applyAiSoap(data.soap);
      setOcrText(JSON.stringify(data.soap || {}));
      toast.success('AI structured the document. Review every heading before saving.');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Could not extract text from this image');
    } finally {
      setExtractingOcr(false);
    }
  };

  const addOrder = () => {
    const name = orderDraft.name.trim();
    if (!name) return toast.error('Enter the order or test name');
    if (isDiagnosticDraft && !orderDraft.catalogueTestId) return toast.error('Select the investigation from the facility catalogue');
    if (orderDraft.type === 'MEDICATION' && !orderDraft.dosage.trim()) return toast.error('Enter the medication dose');
    setOrders(current => [...current, {
      ...orderDraft, name, clientId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    }]);
    setOrderDraft({ ...EMPTY_ORDER, type: orderDraft.type });
  };

  const { mutate, isPending } = useMutation({
    mutationFn: async ({ draft = false, sign = false } = {}) => {
      if (sign && (!form.assessment.trim() || !form.plan.trim())) {
        throw Object.assign(new Error('Assessment and Plan are required before signing'), { isClinicalValidation: true });
      }
      if (sign && !diagnosisCodes.split(',').some(code => code.trim())) {
        throw Object.assign(new Error('Add at least one ICD-10 diagnosis code before signing'), { isClinicalValidation: true });
      }
      if (retrospective && (!occurredAt || !lateEntryReason.trim())) {
        throw Object.assign(new Error('Choose the earlier care time and give a reason for the late entry'), { isClinicalValidation: true });
      }
      let payload = {
        patientId, title: title || form.chiefComplaint || 'Encounter',
        captureMethod: method, encounterType, encounterTypeId,
        clinicianReviewedCapture: method === 'VOICE' || method === 'OCR',
        saveAsDraft: draft,
        ocrText: ocrText || undefined,
        orders: orders.map(({ clientId, ...order }) => order),
        icdCodes: diagnosisCodes.split(',').map(code => code.trim().toUpperCase()).filter(Boolean),
        occurredAt: retrospective ? new Date(occurredAt).toISOString() : undefined,
        lateEntryReason: retrospective ? lateEntryReason.trim() : undefined,
        ...form,
      };

      if (method === 'QUESTIONNAIRE') {
        payload.chiefComplaint = form.chiefComplaint;
        payload.notes = `Questionnaire template: ${QUESTIONNAIRE_TEMPLATES[questionnaireTemplate]?.label || 'General'}`;
      }

      const created = await api.post('/cases', payload);
      if (sign) await api.post(`/cases/${created.data.id}/sign`);
      return { ...created, signed: sign };
    },
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ['cases'] });
      toast.success(data.status === 'DRAFT' ? 'SOAP draft saved' : 'Encounter saved');
      navigate(`/dashboard/cases/${data.id}`);
    },
    onError: err => toast.error(err.response?.data?.error || err.message || 'Failed to save encounter'),
  });

  const setF = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
        <ChevronLeft size={18} /> Back
      </button>

      <div>
        <h1 className="text-xl font-bold text-gray-900">New Encounter</h1>
        <p className="text-sm text-gray-500 mt-1">Document once, using typing, voice, scan or guided questions together.</p>
      </div>

      {!method ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
          <div className="mb-5">
            <h2 className="text-base font-semibold text-gray-900">How would you like to document?</h2>
            <p className="mt-1 text-sm text-gray-500">Choose one starting point. Every option finishes in the same clinician-reviewed SOAP record.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {METHODS.map(({ key, label, desc, Icon }, index) => (
              <button key={key} type="button" onClick={() => chooseMethod(key)}
                className="group min-h-32 rounded-2xl border border-gray-200 bg-white p-5 text-left transition hover:-translate-y-0.5 hover:border-[#2D5BFF] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30">
                <div className="flex items-start justify-between gap-4">
                  <span className={`flex size-11 items-center justify-center rounded-xl ${index === 0 ? 'bg-blue-50 text-blue-700' : index === 1 ? 'bg-green-50 text-green-700' : index === 2 ? 'bg-orange-50 text-orange-700' : 'bg-purple-50 text-purple-700'}`}>
                    <Icon size={22} />
                  </span>
                  <ArrowRight size={18} className="mt-1 text-gray-300 transition group-hover:translate-x-1 group-hover:text-[#2D5BFF]" />
                </div>
                <div className="mt-4 font-semibold text-gray-900">{label}</div>
                <div className="mt-1 text-sm text-gray-500">{desc}</div>
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-xl bg-gray-50 p-3 text-xs leading-relaxed text-gray-600">
            Voice and Scan send the selected source to the configured Awibi clinical AI and receive a six-heading SOAP proposal. The source is not retained by this EHR, and the doctor must review before saving.
          </div>
        </section>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3">
          <div className="flex items-center gap-3">
            {React.createElement(METHODS.find(item => item.key === method)?.Icon || FileText, { size: 18, className: 'text-[#2D5BFF]' })}
            <div><div className="text-sm font-semibold text-gray-900">{METHODS.find(item => item.key === method)?.label}</div><div className="text-xs text-gray-600">Step {captureStage && (method === 'VOICE' || method === 'OCR') ? '1 of 2 · Capture' : '2 of 2 · Clinical review'}</div></div>
          </div>
          <button type="button" onClick={() => { setMethod(null); setCaptureStage(true); }} className="min-h-10 rounded-lg px-3 text-sm font-medium text-[#2D5BFF] hover:bg-white">Change method</button>
        </div>
      )}

      {method && (
        <ClinicalAttribution
          professional={user}
          label="Consultation will be recorded by"
          pending
        />
      )}

      {method && <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        {/* Patient select */}
        {!preselectedPatient && (
          <PatientPicker value={patientId} onChange={setPatientId} required autoFocus />
        )}

        <ClinicalEventTime
          custom={retrospective}
          onCustomChange={setRetrospective}
          value={occurredAt}
          onValueChange={setOccurredAt}
          reason={lateEntryReason}
          onReasonChange={setLateEntryReason}
          label="When did this consultation occur?"
        />

        {/* Title */}
        <div>
          <label htmlFor="case-title" className="block text-sm font-medium text-gray-700 mb-1">Case title</label>
          <input id="case-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Hypertension follow-up" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
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

        {/* Every input tool writes into the same structured clinical note. */}
        {showClinicalReview && <>
        {(method === 'VOICE' || method === 'OCR') && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
            <span className="font-semibold">Clinician review required.</span> The capture is only a source. Correct omissions and recognition errors in every field before saving.
          </div>
        )}
        {SOAP_FIELDS.map(({ key, label, placeholder }) => (
          <div key={key}>
            <label htmlFor={`clinical-${key}`} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
            <div className="flex items-center gap-1 border border-b-0 border-gray-300 rounded-t-lg bg-gray-50 px-2 py-1" aria-label={`${label} formatting`}>
              <button type="button" onClick={() => formatField(key, 'bold')} aria-label={`Bold ${label}`} title="Bold" className="w-8 h-8 rounded hover:bg-white font-bold">B</button>
              <button type="button" onClick={() => formatField(key, 'italic')} aria-label={`Italic ${label}`} title="Italic" className="w-8 h-8 rounded hover:bg-white italic">I</button>
              <button type="button" onClick={() => formatField(key, 'underline')} aria-label={`Underline ${label}`} title="Underline" className="w-8 h-8 rounded hover:bg-white underline">U</button>
              <button type="button" onClick={() => formatField(key, 'bullet')} aria-label={`Bulleted list ${label}`} title="Bulleted list" className="w-8 h-8 rounded hover:bg-white">•</button>
              <button type="button" onClick={() => formatField(key, 'number')} aria-label={`Numbered list ${label}`} title="Numbered list" className="w-8 h-8 rounded hover:bg-white">1.</button>
              <button type="button" onClick={() => setPreviewFields(current => ({ ...current, [key]: !current[key] }))} aria-label={`Preview ${label}`} title="Preview formatting" className={`ml-auto flex h-8 items-center gap-1 rounded px-2 text-xs ${previewFields[key] ? 'bg-blue-100 text-blue-800' : 'hover:bg-white text-gray-600'}`}><Eye size={14} /> Preview</button>
            </div>
            <textarea id={`clinical-${key}`} ref={node => { fieldRefs.current[key] = node; }} value={form[key]} onChange={setF(key)} rows={3} placeholder={placeholder}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-b-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-y" />
            {previewFields[key] && (
              <div className="mt-2 min-h-11 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                {form[key] ? <ClinicalText value={form[key]} className="text-sm text-gray-800" /> : <span className="text-xs text-gray-400">Formatting preview appears here.</span>}
              </div>
            )}
          </div>
        ))}

        <div>
          <label htmlFor="diagnosis-codes" className="block text-sm font-medium text-gray-700 mb-1">Diagnosis codes (ICD-10)</label>
          <input id="diagnosis-codes" value={diagnosisCodes} onChange={event => setDiagnosisCodes(event.target.value)}
            placeholder="e.g. G44.2, I10" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
          <p className="text-xs text-gray-500 mt-1">Separate multiple codes with commas. At least one code is required before this note can be signed.</p>
        </div>
        </>}

        {(method === 'VOICE' || method === 'OCR') && captureStage && aiStatus && !aiStatus.configured && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <div className="font-semibold">Clinical AI setup required</div>
            <p className="mt-1 text-xs leading-relaxed">The full capture and review screen is ready, but this local backend has no clinical-AI service configured yet. Follow section 12 in MANUAL_SETUP_REQUIRED.txt. Manual SOAP typing remains available.</p>
          </div>
        )}

        {/* Voice */}
        {method === 'VOICE' && captureStage && (
          <div className="text-center py-6">
            {!audioBlob ? (
              <>
                <div className={`w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-4 transition-all ${recording ? 'bg-red-100 animate-pulse' : 'bg-gray-100'}`}>
                  {recording ? <MicOff size={36} className="text-red-600" /> : <Mic size={36} className="text-gray-500" />}
                </div>
                <button onClick={recording ? stopRecording : startRecording} className={`px-6 py-3 rounded-xl font-medium text-white ${recording ? 'bg-red-600 hover:bg-red-700' : 'bg-[#2D5BFF] hover:bg-[#1a45e0]'}`}>
                  {recording ? 'Stop Recording' : 'Start Recording'}
                </button>
                <div className="mt-3 font-mono text-lg font-semibold tabular-nums text-gray-800">{String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}</div>
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
            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-left">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Live transcription preview</div>
              <p className="mt-2 min-h-12 text-sm leading-relaxed text-gray-700">{liveTranscript || (recording ? 'Listening…' : 'Live preview will appear here when supported by this browser. The saved audio is still processed by the Awibi clinical AI.')}</p>
            </div>
            {!recording && !audioBlob && (
              <label className="mt-4 flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50">
                <Upload size={16} /> Upload saved audio
                <input type="file" accept="audio/webm,audio/mpeg,audio/mp4,audio/wav,audio/ogg,.m4a" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) { setAudioBlob(file); setAudioName(file.name); } }} />
              </label>
            )}
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Add notes (optional)</label>
              <textarea value={form.chiefComplaint} onChange={setF('chiefComplaint')} rows={2} placeholder="Brief summary of the consultation…" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none" />
            </div>
            <p className="mx-auto mt-4 max-w-lg text-xs leading-relaxed text-gray-500">The audio is sent securely to the configured Awibi clinical AI to propose a SOAP note. The EHR does not retain the source audio after processing; only the clinician-approved structured note is saved.</p>
            {audioBlob && (
              <button type="button" disabled={aiStructuring || !patientId || aiStatus?.configured === false} onClick={structureVoice} className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#2D5BFF] px-5 text-sm font-medium text-white hover:bg-[#1a45e0] disabled:opacity-50">
                {aiStructuring ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                {aiStructuring ? 'AI is structuring your note…' : aiStatus?.configured === false ? 'AI setup required' : 'Structure into SOAP with AI'}
              </button>
            )}
          </div>
        )}

        {/* OCR */}
        {method === 'OCR' && captureStage && (
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
            <label className="mt-3 flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-4 text-sm font-medium text-orange-800 hover:bg-orange-100">
              <Camera size={17} /> Take photo of handwriting
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={event => setScanFile(event.target.files?.[0] || null)} />
            </label>
            <div className="mt-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">Additional notes</label>
              <textarea value={form.chiefComplaint} onChange={setF('chiefComplaint')} rows={2} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none" />
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button type="button" disabled={!scanFile || extractingOcr || aiStatus?.configured === false} onClick={extractScan} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[#2D5BFF] px-4 text-sm font-medium text-white hover:bg-[#1a45e0] disabled:opacity-50">
                {extractingOcr ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} {extractingOcr ? 'AI is extracting and structuring…' : aiStatus?.configured === false ? 'AI setup required' : 'Extract into SOAP with AI'}
              </button>
              <button type="button" onClick={() => setCaptureStage(false)} className="min-h-11 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50">Skip OCR and type manually</button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-gray-500">The AI proposal is not a clinical record until the doctor reviews all six headings and saves it. The source file is processed in memory and not retained by this EHR.</p>
          </div>
        )}

        {/* Questionnaire adds guided facts without replacing the shared note. */}
        {method === 'QUESTIONNAIRE' && !questionnaireGenerated && (
          <QuestionnaireBuilder
            templateKey={questionnaireTemplate}
            setTemplateKey={(value) => { setQuestionnaireTemplate(value); setQuestionnaireAnswers({}); }}
            answers={questionnaireAnswers}
            details={questionnaireDetails}
            setDetails={setQuestionnaireDetails}
            onAnswer={setQuestionnaireAnswer}
            onDuration={setQuestionnaireDuration}
            onGenerate={generateQuestionnaireSoap}
          />
        )}

        {false && method === 'QUESTIONNAIRE' && (
          <div className="rounded-xl border border-orange-200 bg-orange-50/50 p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">How long has this been going on?</label>
              <input type="text" value={form.duration || ''} onChange={setF('duration')} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Severity (1–10)</label>
              <div>
                <input type="range" min={1} max={10} value={severity} onChange={e => setSeverity(+e.target.value)} className="w-full" />
                <div className="flex justify-between text-xs text-gray-500 mt-1"><span>1 (mild)</span><span className="font-bold text-[#2D5BFF]">{severity}/10</span><span>10 (severe)</span></div>
              </div>
            </div>
            <p className="text-xs text-orange-800">The answers above and the shared clinical note are saved together.</p>
          </div>
        )}

        {/* To do / Doctor's orders — the actionable instructions from the case design */}
        <div>
          <div className={`${showClinicalReview ? '' : 'hidden'} rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-3`}>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Clinical orders</h2>
              <p className="text-xs text-gray-600 mt-0.5">Add once here. Nursing care, medicines and investigations go directly to the correct team.</p>
            </div>

            {orders.length > 0 && (
              <ol className="space-y-2">
                {orders.map((order, index) => (
                  <li key={order.clientId} className="flex items-start gap-2 rounded-lg border border-blue-100 bg-white p-3">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-800">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900">{order.name}</div>
                      <div className="text-xs text-gray-500">
                        {ORDER_TYPES.find(item => item.key === order.type)?.label} · {order.priority.toLowerCase()}
                        {order.dosage && ` · ${order.dosage}`}
                        {order.frequency && ` · ${order.frequency}`}
                        {order.frequencyHours && ` · every ${order.frequencyHours}h`}
                      </div>
                    </div>
                    <button type="button" onClick={() => setOrders(current => current.filter(item => item.clientId !== order.clientId))}
                      aria-label={`Remove ${order.name}`} className="size-10 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 flex items-center justify-center">
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
              </ol>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label htmlFor="order-type" className="block text-xs font-medium text-gray-700 mb-1">Type</label>
                <select id="order-type" value={orderDraft.type} onChange={event => setOrderDraft(current => ({ ...EMPTY_ORDER, type: event.target.value }))}
                  className="w-full min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm">
                  {ORDER_TYPES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="order-name" className="block text-xs font-medium text-gray-700 mb-1">Order / test / medicine</label>
                {isDiagnosticDraft ? (
                  <select id="order-name" value={orderDraft.catalogueTestId} disabled={catalogueLoading}
                    onChange={event => {
                      const selected = diagnosticCatalogue.find(test => test.id === event.target.value);
                      setOrderDraft(current => ({ ...current, catalogueTestId: event.target.value, name: selected?.name || '' }));
                    }}
                    className="w-full min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm disabled:bg-gray-100">
                    <option value="">{catalogueLoading ? 'Loading facility catalogue…' : `Select ${orderDraft.type === 'IMAGING' ? 'imaging study' : 'laboratory test'}…`}</option>
                    {diagnosticCatalogue.map(test => <option key={test.id} value={test.id}>{test.name}{test.category ? ` · ${test.category}` : ''}</option>)}
                  </select>
                ) : (
                  <input id="order-name" value={orderDraft.name} onChange={event => setOrderDraft(current => ({ ...current, name: event.target.value }))}
                    placeholder={orderDraft.type === 'MEDICATION' ? 'e.g. Artemether-lumefantrine' : 'e.g. Strict intake and output chart'}
                    className="w-full min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm" />
                )}
              </div>
            </div>

            {orderDraft.type === 'MEDICATION' ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <input aria-label="Dose" value={orderDraft.dosage} onChange={event => setOrderDraft(current => ({ ...current, dosage: event.target.value }))} placeholder="Dose, e.g. 1 g" className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm" />
                <input aria-label="Frequency" value={orderDraft.frequency} onChange={event => setOrderDraft(current => ({ ...current, frequency: event.target.value }))} placeholder="e.g. 8-hourly" className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm" />
                <input aria-label="Duration" value={orderDraft.duration} onChange={event => setOrderDraft(current => ({ ...current, duration: event.target.value }))} placeholder="e.g. 3 days" className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm" />
                <select aria-label="Route" value={orderDraft.route} onChange={event => setOrderDraft(current => ({ ...current, route: event.target.value }))} className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm">
                  {['ORAL', 'IV', 'IM', 'SC', 'TOPICAL', 'INHALED'].map(route => <option key={route}>{route}</option>)}
                </select>
              </div>
            ) : !['LAB', 'IMAGING'].includes(orderDraft.type) ? (
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input type="number" min="0.25" step="0.25" aria-label="Repeat every hours" value={orderDraft.frequencyHours}
                    onChange={event => setOrderDraft(current => ({ ...current, frequencyHours: event.target.value }))}
                    placeholder="Repeat every hours (optional)" className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm" />
                  <input aria-label="Clinical goal" value={orderDraft.goal} onChange={event => setOrderDraft(current => ({ ...current, goal: event.target.value }))}
                    placeholder="Clinical goal (optional)" className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input type="number" step="any" aria-label="Expected minimum" value={orderDraft.goalMin}
                    onChange={event => setOrderDraft(current => ({ ...current, goalMin: event.target.value }))}
                    placeholder="Expected minimum, e.g. 30" className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm" />
                  <input type="number" step="any" aria-label="Critical below" value={orderDraft.criticalLow}
                    onChange={event => setOrderDraft(current => ({ ...current, criticalLow: event.target.value }))}
                    placeholder="Critical at or below, e.g. 15" className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm" />
                </div>
                <p className="text-[11px] text-gray-500">For numeric monitoring, these limits travel with the order into the bedside chart.</p>
              </div>
            ) : null}

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
              <input aria-label="Order instructions" value={orderDraft.instructions} onChange={event => setOrderDraft(current => ({ ...current, instructions: event.target.value }))}
                placeholder="Instructions or specimen details (optional)" className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm" />
              <select aria-label="Priority" value={orderDraft.priority} onChange={event => setOrderDraft(current => ({ ...current, priority: event.target.value }))}
                className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm">
                <option value="ROUTINE">Routine</option><option value="URGENT">Urgent</option><option value="STAT">STAT</option>
              </select>
              <button type="button" onClick={addOrder} className="min-h-11 rounded-lg bg-[#0B1F66] px-4 text-sm font-medium text-white hover:bg-[#071647] flex items-center justify-center gap-2">
                <Plus size={15} /> Add order
              </button>
            </div>
          </div>
        </div>

        <div className={`${showClinicalReview ? '' : 'hidden'} grid grid-cols-1 gap-2 pt-2 sm:grid-cols-3`}>
          <button type="button" onClick={() => navigate(-1)} className="min-h-12 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button type="button" onClick={() => mutate({ draft: true })} disabled={isPending || !patientId || !encounterTypeId} className="min-h-12 rounded-lg border border-[#2D5BFF] text-sm font-medium text-[#2D5BFF] hover:bg-blue-50 disabled:opacity-50">Save Draft</button>
          {/* The context is required by the API; blocking here means the doctor
              finds out before they have typed a full note, not after. */}
          <button onClick={() => mutate({ sign: true })} disabled={isPending || !patientId || !encounterTypeId || !form.assessment.trim() || !form.plan.trim()} className="min-h-12 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50 flex items-center justify-center gap-2">
            {isPending && <Loader2 size={15} className="animate-spin" />}
            {isPending ? 'Saving…' : 'Save & Sign Encounter'}
          </button>
        </div>
      </div>}
    </div>
  );
}

function QuestionnaireBuilder({ templateKey, setTemplateKey, answers, details, setDetails, onAnswer, onDuration, onGenerate }) {
  const template = QUESTIONNAIRE_TEMPLATES[templateKey];
  return (
    <div className="space-y-5 rounded-xl border border-purple-200 bg-purple-50/40 p-4 sm:p-5">
      <div>
        <div className="text-sm font-semibold text-gray-900">Questionnaire / Checklist</div>
        <p className="mt-1 text-xs leading-relaxed text-gray-600">Choose the clerking template, tap Yes or No for relevant findings, and add duration. The system then generates a structured SOAP draft for review.</p>
      </div>
      <div>
        <label htmlFor="questionnaire-template" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-600">1. Select template</label>
        <select id="questionnaire-template" value={templateKey} onChange={event => setTemplateKey(event.target.value)} className="min-h-12 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm">
          {Object.entries(QUESTIONNAIRE_TEMPLATES).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="questionnaire-cc" className="mb-1 block text-sm font-medium text-gray-700">Chief complaint <span className="text-red-500">*</span></label>
          <input id="questionnaire-cc" value={details.chiefComplaint} onChange={event => setDetails(current => ({ ...current, chiefComplaint: event.target.value }))} placeholder="Patient's main complaint in their own words" className="min-h-12 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm" />
        </div>
        <div>
          <label htmlFor="questionnaire-context" className="mb-1 block text-sm font-medium text-gray-700">Relevant context</label>
          <input id="questionnaire-context" value={details.context} onChange={event => setDetails(current => ({ ...current, context: event.target.value }))} placeholder={templateKey === 'OBSTETRICS' ? 'Gestational age, parity, LMP' : templateKey === 'PEDIATRIC' ? 'Age, birth and immunisation history' : 'Comorbidities, medicines, risk factors'} className="min-h-12 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm" />
        </div>
        <div>
          <label htmlFor="questionnaire-exam" className="mb-1 block text-sm font-medium text-gray-700">Quick examination findings</label>
          <input id="questionnaire-exam" value={details.examination} onChange={event => setDetails(current => ({ ...current, examination: event.target.value }))} placeholder="General condition and relevant findings" className="min-h-12 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm" />
        </div>
      </div>
      <div className="space-y-4">
        {template.groups.map(group => (
          <section key={group.title}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-purple-800">{group.title}</h3>
            <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
              {group.items.map(([key, label]) => {
                const answer = answers[key] || {};
                return (
                  <div key={key} className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-[minmax(130px,1fr)_auto_minmax(130px,0.8fr)] sm:items-center">
                    <div className="text-sm font-medium text-gray-800">{label}</div>
                    <div className="inline-flex w-fit rounded-lg bg-gray-100 p-1">
                      {['YES', 'NO'].map(option => (
                        <button key={option} type="button" onClick={() => onAnswer(key, option)} className={`min-h-9 min-w-14 rounded-md px-2 text-xs font-semibold ${answer.answer === option ? option === 'YES' ? 'bg-green-600 text-white' : 'bg-gray-700 text-white' : 'text-gray-600 hover:bg-white'}`}>
                          {option === 'YES' ? 'Yes' : 'No'}
                        </button>
                      ))}
                    </div>
                    <input value={answer.duration || ''} onChange={event => onDuration(key, event.target.value)} disabled={answer.answer !== 'YES'} aria-label={`${label} duration`} placeholder="Duration, e.g. 3 days" className="min-h-10 rounded-lg border border-gray-300 px-3 text-xs disabled:bg-gray-100 disabled:text-gray-400" />
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <div>
        <label htmlFor="questionnaire-history" className="mb-1 block text-sm font-medium text-gray-700">Additional history</label>
        <textarea id="questionnaire-history" rows={3} value={details.history} onChange={event => setDetails(current => ({ ...current, history: event.target.value }))} placeholder="Onset, progression, previous treatment, relevant past history…" className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
      </div>
      <button type="button" onClick={onGenerate} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-purple-700 px-4 text-sm font-semibold text-white hover:bg-purple-800"><ClipboardList size={17} /> Generate SOAP Note</button>
    </div>
  );
}
