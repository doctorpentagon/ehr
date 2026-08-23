import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, ClipboardPlus, FlaskConical, Pill, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import PatientPicker from '../../components/clinical/PatientPicker';

const MODES = [
  { key: 'MEDICATION', label: 'Prescribe medicine', help: 'Sends a prescription to pharmacy and the nursing drug chart.', icon: Pill, tone: 'border-purple-200 bg-purple-50 text-purple-900' },
  { key: 'NURSING', label: 'Nursing care / monitoring', help: 'Sends an actionable order to the nursing queue.', icon: ClipboardPlus, tone: 'border-blue-200 bg-blue-50 text-blue-900' },
  { key: 'DIAGNOSTIC', label: 'Order investigation', help: 'Routes lab, imaging and ECG to Diagnostics.', icon: FlaskConical, tone: 'border-teal-200 bg-teal-50 text-teal-900' },
  { key: 'ADMISSION', label: 'Request admission', help: 'Sends the clinical admission decision to nursing for bed allocation.', icon: BedDouble, tone: 'border-orange-200 bg-orange-50 text-orange-900' },
];

const MONITORING_TYPES = [
  ['', 'No chart requested'], ['FLUID_BALANCE', 'Fluid balance'], ['URINE_OUTPUT', 'Urine output'],
  ['IV_FLUID', 'IV infusion'], ['BLOOD_TRANSFUSION', 'Blood transfusion'], ['NEURO_OBS', 'Neurological observations'],
  ['GLUCOSE', 'Blood glucose'], ['ELECTROLYTE', 'Electrolyte correction'], ['CUSTOM', 'Custom chart'],
];

const input = 'w-full min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/25';

export default function ClinicalOrders() {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const [patientId, setPatientId] = useState(searchParams.get('patientId') || '');
  const [patient, setPatient] = useState(null);
  const [mode, setMode] = useState('MEDICATION');
  const [med, setMed] = useState({ catalogueId: '', drugName: '', dosage: '', route: 'ORAL', frequency: '', duration: '', instructions: '' });
  const [care, setCare] = useState({ type: 'NURSING', name: '', goal: '', frequencyHours: '', priority: 'ROUTINE', monitoringType: '', instructions: '' });
  const [diagnostic, setDiagnostic] = useState({ testType: 'LAB', catalogueTestId: '', customName: '', priority: 'ROUTINE', notes: '' });
  const [admission, setAdmission] = useState({ diagnosis: '', reason: '', preferredWard: '', bedType: 'GENERAL', priority: 'ROUTINE' });

  const { data: drugData } = useQuery({
    queryKey: ['drug-catalogue-ordering'],
    queryFn: () => api.get('/orders/drug-catalogue?limit=50').then((response) => response.data),
  });
  const drugs = drugData?.drugs || [];

  const { data: testData } = useQuery({
    queryKey: ['diagnostic-catalogue-ordering'],
    queryFn: () => api.get('/lab/catalogue').then((response) => response.data),
  });
  const tests = useMemo(() => (testData?.tests || []).filter((test) => test.testType === diagnostic.testType), [testData, diagnostic.testType]);

  const { data: patientOrders } = useQuery({
    queryKey: ['patient-orders', patientId],
    queryFn: () => api.get(`/orders/patient/${patientId}`).then((response) => response.data),
    enabled: Boolean(patientId),
  });

  const medication = useMutation({
    mutationFn: () => api.post('/orders/medications', { patientId, medications: [{ ...med, drugName: med.drugName.trim() }] }).then((response) => response.data),
    onSuccess: () => complete('Prescription sent to pharmacy and nursing', () => setMed({ catalogueId: '', drugName: '', dosage: '', route: 'ORAL', frequency: '', duration: '', instructions: '' })),
    onError: fail,
  });
  const nursing = useMutation({
    mutationFn: () => api.post('/orders/standing', { ...care, patientId, frequencyHours: care.frequencyHours === '' ? null : Number(care.frequencyHours), monitoringType: care.monitoringType || undefined }).then((response) => response.data),
    onSuccess: () => complete('Nursing order sent', () => setCare({ type: 'NURSING', name: '', goal: '', frequencyHours: '', priority: 'ROUTINE', monitoringType: '', instructions: '' })),
    onError: fail,
  });
  const investigation = useMutation({
    mutationFn: () => api.post('/lab', {
      patientId, testType: diagnostic.testType, priority: diagnostic.priority, notes: diagnostic.notes || undefined,
      catalogueTestId: diagnostic.catalogueTestId && diagnostic.catalogueTestId !== '__OTHER__' ? diagnostic.catalogueTestId : undefined,
      testName: diagnostic.catalogueTestId === '__OTHER__' ? diagnostic.customName.trim() : undefined,
    }).then((response) => response.data),
    onSuccess: () => complete('Investigation sent to Diagnostics', () => setDiagnostic({ testType: 'LAB', catalogueTestId: '', customName: '', priority: 'ROUTINE', notes: '' })),
    onError: fail,
  });
  const admissionRequest = useMutation({
    mutationFn: () => api.post('/orders/standing', {
      patientId, type: 'TREATMENT', name: 'Admission requested', goal: admission.diagnosis,
      instructions: admission.reason, priority: admission.priority,
      details: { workflow: 'ADMISSION_REQUEST', diagnosis: admission.diagnosis, reason: admission.reason, preferredWard: admission.preferredWard, bedType: admission.bedType },
    }).then((response) => response.data),
    onSuccess: () => complete('Admission request sent to nursing', () => setAdmission({ diagnosis: '', reason: '', preferredWard: '', bedType: 'GENERAL', priority: 'ROUTINE' })),
    onError: fail,
  });

  function fail(error) {
    toast.error(error?.response?.data?.error || 'The order could not be sent');
  }
  function complete(message, reset) {
    qc.invalidateQueries({ queryKey: ['patient-orders', patientId] });
    qc.invalidateQueries({ queryKey: ['standing-orders'] });
    qc.invalidateQueries({ queryKey: ['monitoring-requests'] });
    qc.invalidateQueries({ queryKey: ['admission-requests'] });
    qc.invalidateQueries({ queryKey: ['pharmacy-queue'] });
    qc.invalidateQueries({ queryKey: ['lab'] });
    reset();
    toast.success(message);
  }

  const busy = medication.isPending || nursing.isPending || investigation.isPending || admissionRequest.isPending;

  return (
    <div className="space-y-5 max-w-5xl">
      <header>
        <h1 className="text-xl font-bold text-gray-900">Orders & prescriptions</h1>
        <p className="text-sm text-gray-500">Choose the patient once, then route the instruction to the team that must act on it.</p>
      </header>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <PatientPicker value={patientId} onChange={(id, selected) => { setPatientId(id); setPatient(selected); }} required autoFocus />
        {patient && <p className="mt-2 text-xs text-gray-500">Every order below will be linked to {patient.firstName} {patient.lastName}&rsquo;s hospital record and your professional account.</p>}
      </section>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {MODES.map(({ key, label, help, icon: Icon, tone }) => (
          <button key={key} type="button" onClick={() => setMode(key)} className={`min-h-32 rounded-xl border p-4 text-left transition ${mode === key ? `${tone} ring-2 ring-current/15` : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
            <Icon size={21} className="mb-4" />
            <div className="text-sm font-semibold">{label}</div>
            <div className="mt-1 text-xs opacity-75">{help}</div>
          </button>
        ))}
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        {mode === 'MEDICATION' && <MedicationForm value={med} setValue={setMed} drugs={drugs} />}
        {mode === 'NURSING' && <NursingForm value={care} setValue={setCare} />}
        {mode === 'DIAGNOSTIC' && <DiagnosticForm value={diagnostic} setValue={setDiagnostic} tests={tests} />}
        {mode === 'ADMISSION' && <AdmissionForm value={admission} setValue={setAdmission} />}
        <div className="mt-5 flex justify-end">
          <button type="button" disabled={!patientId || busy || !valid(mode, med, care, diagnostic, admission)} onClick={() => ({ MEDICATION: medication, NURSING: nursing, DIAGNOSTIC: investigation, ADMISSION: admissionRequest }[mode]).mutate()}
            className="flex min-h-11 items-center gap-2 rounded-lg bg-[#0B1F66] px-5 text-sm font-semibold text-white hover:bg-[#071647] disabled:opacity-40">
            <Send size={16} /> {busy ? 'Sending…' : destinationLabel(mode)}
          </button>
        </div>
      </section>

      {patientId && <RecentOrders data={patientOrders} />}
    </div>
  );
}

function MedicationForm({ value, setValue, drugs }) {
  const set = (key) => (event) => setValue((current) => ({ ...current, [key]: event.target.value }));
  const choose = (event) => {
    const selected = drugs.find((item) => item.id === event.target.value);
    setValue((current) => selected ? ({ ...current, catalogueId: selected.id, drugName: selected.name, dosage: selected.defaultDose || '', route: selected.defaultRoute || 'ORAL', frequency: selected.defaultFrequency || '' }) : ({ ...current, catalogueId: '' }));
  };
  return <div className="space-y-3"><Title title="Prescription" help="The pharmacist dispenses it; nursing sees active medicines on the drug chart." />
    <select className={input} value={value.catalogueId} onChange={choose}><option value="">Choose from facility formulary or type below…</option>{drugs.map((drug) => <option key={drug.id} value={drug.id}>{drug.name} {drug.strength || ''}{Number(drug.stockOnHand) <= Number(drug.reorderLevel) ? ' — low stock' : ''}</option>)}</select>
    <input className={input} value={value.drugName} onChange={set('drugName')} placeholder="Medicine name *" />
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><input className={input} value={value.dosage} onChange={set('dosage')} placeholder="Dose, e.g. 500 mg" /><select className={input} value={value.route} onChange={set('route')}>{['ORAL','IV','IM','SC','TOPICAL','INHALATION','RECTAL','OTHER'].map((route) => <option key={route}>{route}</option>)}</select><input className={input} value={value.frequency} onChange={set('frequency')} placeholder="Frequency" /><input className={input} value={value.duration} onChange={set('duration')} placeholder="Duration" /></div>
    <textarea className={input} rows={2} value={value.instructions} onChange={set('instructions')} placeholder="Instructions / indication / cautions" />
  </div>;
}

function NursingForm({ value, setValue }) {
  const set = (key) => (event) => setValue((current) => ({ ...current, [key]: event.target.value }));
  return <div className="space-y-3"><Title title="Nursing care or monitoring order" help="If a chart is requested, nursing gets a one-click ‘Open chart’ action." />
    <input className={input} value={value.name} onChange={set('name')} placeholder="What should nursing do? *" />
    <div className="grid gap-3 sm:grid-cols-2"><input className={input} value={value.goal} onChange={set('goal')} placeholder="Clinical goal / reason" /><select className={input} value={value.monitoringType} onChange={set('monitoringType')}>{MONITORING_TYPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
    <div className="grid gap-3 sm:grid-cols-2"><input className={input} type="number" min="0" step="0.5" value={value.frequencyHours} onChange={set('frequencyHours')} placeholder="Repeat every hours (blank = once)" /><select className={input} value={value.priority} onChange={set('priority')}>{['ROUTINE','URGENT','STAT'].map((item) => <option key={item}>{item}</option>)}</select></div>
    <textarea className={input} rows={2} value={value.instructions} onChange={set('instructions')} placeholder="Bedside instructions" />
  </div>;
}

function DiagnosticForm({ value, setValue, tests }) {
  const set = (key) => (event) => setValue((current) => ({ ...current, [key]: event.target.value }));
  return <div className="space-y-3"><Title title="Diagnostic investigation" help="Lab, imaging and ECG enter the discipline-specific worklist with patient demographics snapshotted at order time." />
    <div className="grid gap-3 sm:grid-cols-2"><select className={input} value={value.testType} onChange={(event) => setValue((current) => ({ ...current, testType: event.target.value, catalogueTestId: '', customName: '' }))}>{['LAB','IMAGING','ECG','OTHER'].map((type) => <option key={type}>{type}</option>)}</select><select className={input} value={value.priority} onChange={set('priority')}>{['ROUTINE','URGENT','STAT'].map((item) => <option key={item}>{item}</option>)}</select></div>
    <select className={input} value={value.catalogueTestId} onChange={set('catalogueTestId')}><option value="">Choose investigation…</option>{tests.map((test) => <option key={test.id} value={test.id}>{test.name}{test.category ? ` — ${test.category}` : ''}</option>)}<option value="__OTHER__">Other / not yet in catalogue</option></select>
    {value.catalogueTestId === '__OTHER__' && <input className={input} value={value.customName} onChange={set('customName')} placeholder="Investigation name *" />}
    <textarea className={input} rows={3} value={value.notes} onChange={set('notes')} placeholder="Clinical question, relevant history, specimen/site details" />
  </div>;
}

function AdmissionForm({ value, setValue }) {
  const set = (key) => (event) => setValue((current) => ({ ...current, [key]: event.target.value }));
  return <div className="space-y-3"><Title title="Admission request" help="This is the doctor’s clinical order. Nursing confirms the patient, allocates an available bed and records arrival on the ward." />
    <input className={input} value={value.diagnosis} onChange={set('diagnosis')} placeholder="Provisional / admitting diagnosis *" />
    <textarea className={input} rows={3} value={value.reason} onChange={set('reason')} placeholder="Reason for admission and immediate care instructions *" />
    <div className="grid gap-3 sm:grid-cols-3"><input className={input} value={value.preferredWard} onChange={set('preferredWard')} placeholder="Preferred ward (optional)" /><select className={input} value={value.bedType} onChange={set('bedType')}>{['GENERAL','PRIVATE','ICU','HDU','MATERNITY'].map((item) => <option key={item}>{item}</option>)}</select><select className={input} value={value.priority} onChange={set('priority')}>{['ROUTINE','URGENT','STAT'].map((item) => <option key={item}>{item}</option>)}</select></div>
  </div>;
}

function Title({ title, help }) { return <div><h2 className="text-base font-semibold text-gray-900">{title}</h2><p className="text-xs text-gray-500">{help}</p></div>; }
function valid(mode, med, care, diagnostic, admission) { if (mode === 'MEDICATION') return Boolean(med.drugName.trim()); if (mode === 'NURSING') return Boolean(care.name.trim()); if (mode === 'DIAGNOSTIC') return Boolean(diagnostic.catalogueTestId && (diagnostic.catalogueTestId !== '__OTHER__' || diagnostic.customName.trim())); return Boolean(admission.diagnosis.trim() && admission.reason.trim()); }
function destinationLabel(mode) { return ({ MEDICATION: 'Send prescription', NURSING: 'Send to nursing', DIAGNOSTIC: 'Send to Diagnostics', ADMISSION: 'Request admission' })[mode]; }

function RecentOrders({ data }) {
  const groups = [
    ['Active medicines', data?.medications || [], (item) => `${item.drugName} · ${[item.dosage, item.route, item.frequency].filter(Boolean).join(' · ')}`],
    ['Investigations', data?.investigations || [], (item) => `${item.testName} · ${item.status}`],
    ['Care & monitoring', data?.standingOrders || [], (item) => `${item.name} · ${item.status}`],
  ];
  return <section className="rounded-xl border border-gray-200 bg-white p-4"><h2 className="text-sm font-semibold text-gray-900">This patient&rsquo;s active order trail</h2><div className="mt-3 grid gap-3 md:grid-cols-3">{groups.map(([label, items, render]) => <div key={label} className="rounded-lg bg-gray-50 p-3"><div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>{items.length ? <ul className="mt-2 space-y-1.5">{items.slice(0, 5).map((item) => <li key={item.id} className="text-xs text-gray-700">{render(item)}</li>)}</ul> : <p className="mt-2 text-xs text-gray-400">None active</p>}</div>)}</div></section>;
}
