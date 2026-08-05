import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, Plus, AlertTriangle, Heart, Activity, Pill,
  FlaskConical, FileText, Upload, Printer, X, Edit2,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import api from '@/lib/api';
import StatusBadge from '@/components/ui/StatusBadge';
import Avatar from '@/components/ui/Avatar';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import useAuthStore from '@/stores/authStore';
import VitalsTrendChart from '@/components/clinical/VitalsTrendChart';

const TABS = [
  { key: 'Overview',      label: 'Overview' },
  { key: 'Cases',         label: 'Cases' },
  { key: 'Vitals',        label: 'Vitals' },
  // Ward documentation belongs on the chart: a doctor reviewing a patient must
  // be able to see the catheter chart and the fluid balance the nurses keep,
  // without going to the nursing module and searching for the patient again.
  { key: 'Monitoring',    label: 'Monitoring' },
  { key: 'Allergies',     label: 'Allergies' },
  { key: 'Conditions',    label: 'Conditions' },
  { key: 'Prescriptions', label: 'Rx' },
  { key: 'Lab',           label: 'Diagnostics' },
  { key: 'Appointments',  label: 'Appointments' },
  { key: 'Documents',     label: 'Documents' },
];

export default function PatientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useAuthStore(s => s.can);
  const canWriteVitals = can('vitals_write');
  const canWriteClinical = can('clinical_write');
  const canWritePrescriptions = can('prescriptions_write');
  const canCreateCases = can('cases');
  const canRequestLab = can('lab');
  const [tab, setTab] = useState('Overview');
  const [vitalOpen, setVitalOpen] = useState(false);
  const [allergyOpen, setAllergyOpen] = useState(false);
  const [conditionOpen, setConditionOpen] = useState(false);
  const [rxOpen, setRxOpen] = useState(false);

  const { data: patient, isLoading } = useQuery({
    queryKey: ['patient', id],
    queryFn: () => api.get(`/patients/${id}`).then(r => r.data),
  });

  if (isLoading) return <div className="py-24 flex justify-center"><Spinner size="lg" /></div>;
  if (!patient) return <div className="text-center py-16 text-gray-500">Patient not found</div>;

  const age = patient.dateOfBirth
    ? Math.floor((Date.now() - new Date(patient.dateOfBirth)) / (365.25 * 24 * 3600 * 1000))
    : null;

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Back + actions */}
      <div className="flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
          <ChevronLeft size={18} /> Back to Patients
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.open(`/dashboard/patients/${id}/id-card`, '_blank')}
            className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          >
            <Printer size={15} /> Print ID Card
          </button>
          {canCreateCases && (
            <Link
              to={`/dashboard/cases/new?patientId=${patient.id}`}
              className="flex items-center gap-2 px-3 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]"
            >
              <Plus size={15} /> New Encounter
            </Link>
          )}
        </div>
      </div>

      {/* Patient header */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex flex-col sm:flex-row gap-4">
          <Avatar name={`${patient.firstName} ${patient.lastName}`} size="xl" src={patient.avatar} />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-xl font-bold text-gray-900">{patient.firstName} {patient.lastName}</h1>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <span className="font-mono text-sm text-[#2D5BFF] bg-blue-50 px-2.5 py-0.5 rounded-full font-semibold">
                    {patient.universalPatientId}
                  </span>
                  <span className="text-sm text-gray-400">{patient.mrn}</span>
                  <StatusBadge status={patient.status} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-sm">
              <Info label="Age / Gender" value={`${age ?? '—'} yrs / ${patient.gender}`} />
              <Info label="Blood Type" value={patient.bloodType || '—'} />
              <Info label="Phone" value={patient.phone || '—'} />
              <Info label="HMO" value={patient.hmo || 'None'} />
              <Info label="Date of Birth" value={patient.dateOfBirth ? format(new Date(patient.dateOfBirth), 'dd MMM yyyy') : '—'} />
              <Info label="NIN" value={patient.nin || '—'} />
              <Info label="State" value={patient.state || '—'} />
              <Info label="Marital Status" value={patient.maritalStatus || '—'} />
            </div>

            {/* Allergy chips in header */}
            {patient.allergies?.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {patient.allergies.map(a => (
                  <span key={a.id} className="flex items-center gap-1 px-2.5 py-1 bg-red-50 text-red-700 rounded-full text-xs font-medium">
                    <AlertTriangle size={11} /> {a.substance} ({a.severity?.toLowerCase()})
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="border-b border-gray-100 px-4 overflow-x-auto">
          <div className="flex gap-0 min-w-max">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  tab === t.key
                    ? 'border-[#2D5BFF] text-[#2D5BFF]'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5">
          {tab === 'Overview'      && <OverviewTab patient={patient} onAddVital={() => setVitalOpen(true)} canWrite={canWriteVitals} />}
          {tab === 'Cases'         && <CasesTab cases={patient.cases || []} patientId={patient.id} />}
          {tab === 'Vitals'        && <VitalsTab vitals={patient.vitals || []} onAdd={() => setVitalOpen(true)} canWrite={canWriteVitals} patientId={id} />}
          {tab === 'Monitoring'    && <MonitoringTab patientId={id} />}
          {tab === 'Allergies'     && <AllergiesTab patientId={id} allergies={patient.allergies || []} onAdd={() => setAllergyOpen(true)} canWrite={canWriteClinical} />}
          {tab === 'Conditions'    && <ConditionsTab patientId={id} conditions={patient.conditions || []} onAdd={() => setConditionOpen(true)} canWrite={canWriteClinical} />}
          {tab === 'Prescriptions' && <PrescriptionsTab patientId={id} prescriptions={patient.prescriptions || []} onAdd={() => setRxOpen(true)} canWrite={canWritePrescriptions} />}
          {tab === 'Lab'           && <LabTab labRequests={patient.labRequests || []} patientId={id} canRequest={canRequestLab} />}
          {tab === 'Appointments'  && <AppointmentsTab appointments={patient.appointments || []} patientId={id} />}
          {tab === 'Documents'     && <DocumentsTab patientId={id} />}
        </div>
      </div>

      {/* Modals */}
      {canWriteVitals && <AddVitalModal open={vitalOpen} onClose={() => setVitalOpen(false)} patientId={id} />}
      {canWriteClinical && <AddAllergyModal open={allergyOpen} onClose={() => setAllergyOpen(false)} patientId={id} />}
      {canWriteClinical && <AddConditionModal open={conditionOpen} onClose={() => setConditionOpen(false)} patientId={id} />}
      {canWritePrescriptions && <AddPrescriptionModal open={rxOpen} onClose={() => setRxOpen(false)} patientId={id} />}
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <div className="text-xs text-gray-400">{label}</div>
      <div className="font-medium text-gray-900 text-sm">{value}</div>
    </div>
  );
}

// ── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({ patient, onAddVital, canWrite }) {
  const lastVital = patient.vitals?.[0];
  return (
    <div className="space-y-6">
      {/* Conditions summary */}
      <Section title="Active Conditions" icon={Heart} iconColor="text-purple-600">
        {patient.conditions?.length === 0 ? (
          <p className="text-sm text-gray-400">No conditions recorded</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {patient.conditions?.map(c => (
              <span key={c.id} className="px-3 py-1.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700">
                {c.name} {c.icdCode && `(${c.icdCode})`}
              </span>
            ))}
          </div>
        )}
      </Section>

      {/* Last vitals */}
      <Section title="Latest Vitals" icon={Activity} iconColor="text-[#2D5BFF]" action={canWrite ? <button onClick={onAddVital} className="text-xs text-[#2D5BFF] hover:underline flex items-center gap-1"><Plus size={13} /> Add</button> : null}>
        {!lastVital ? (
          <p className="text-sm text-gray-400">No vitals recorded</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
            <VitalChip label="BP" value={lastVital.bloodPressureSystolic ? `${lastVital.bloodPressureSystolic}/${lastVital.bloodPressureDiastolic}` : '—'} unit="mmHg" />
            <VitalChip label="HR" value={lastVital.heartRate} unit="bpm" />
            <VitalChip label="Temp" value={lastVital.temperature} unit="°C" />
            <VitalChip label="SpO₂" value={lastVital.oxygenSaturation} unit="%" />
            <VitalChip label="BMI" value={lastVital.bmi} unit="kg/m²" />
          </div>
        )}
        {lastVital && <p className="text-xs text-gray-400 mt-2">Recorded {format(new Date(lastVital.recordedAt || lastVital.createdAt), 'dd MMM yyyy, hh:mm a')}</p>}
      </Section>

      {/* Emergency contact */}
      <Section title="Emergency Contact" icon={AlertTriangle} iconColor="text-orange-500">
        {patient.emergencyContactName ? (
          <div className="text-sm text-gray-700 space-y-0.5">
            <div className="font-medium">{patient.emergencyContactName}</div>
            <div className="text-gray-500">{patient.emergencyContactPhone} · {patient.emergencyContactRelation}</div>
          </div>
        ) : (
          <p className="text-sm text-gray-400">Not recorded</p>
        )}
      </Section>

      {/* Recent prescriptions */}
      {patient.prescriptions?.length > 0 && (
        <Section title="Active Prescriptions" icon={Pill} iconColor="text-green-600">
          <div className="space-y-2">
            {patient.prescriptions.slice(0, 3).map(rx => (
              <div key={rx.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <span className="text-sm font-medium text-gray-900">{rx.drugName} {rx.dosage}</span>
                  <span className="text-xs text-gray-500 ml-2">{rx.frequency} · {rx.duration}</span>
                </div>
                <StatusBadge status={rx.status} />
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, icon: Icon, iconColor, action, children }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className={`text-sm font-semibold text-gray-900 flex items-center gap-2`}>
          <Icon size={15} className={iconColor} /> {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function VitalChip({ label, value, unit }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 text-center">
      <div className="text-xs text-gray-400 mb-0.5">{label}</div>
      <div className="font-bold text-gray-900 text-sm">{value ?? '—'}</div>
      <div className="text-xs text-gray-400">{unit}</div>
    </div>
  );
}

// ── Cases Tab ─────────────────────────────────────────────────────────────────
function CasesTab({ cases, patientId }) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Link to={`/dashboard/cases/new?patientId=${patientId}`} className="flex items-center gap-2 px-3 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]">
          <Plus size={15} /> New Encounter
        </Link>
      </div>
      {cases.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">No encounters recorded yet</p>
      ) : cases.map(c => (
        <Link key={c.id} to={`/dashboard/cases/${c.id}`} className="block border border-gray-200 rounded-xl p-4 hover:border-[#2D5BFF]/40 hover:bg-[#2D5BFF]/5 transition-colors">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium text-gray-900">{c.title}</div>
              <div className="text-sm text-gray-500 mt-0.5">{c.chiefComplaint}</div>
            </div>
            <StatusBadge status={c.status} />
          </div>
          <div className="text-xs text-gray-400 mt-2">
            {c.createdAt ? format(new Date(c.createdAt), 'dd MMM yyyy') : ''} · {c.captureMethod?.replace(/_/g, ' ')}
            {c.author && <span> · Dr. {c.author.firstName} {c.author.lastName}</span>}
          </div>
        </Link>
      ))}
    </div>
  );
}

// ── Vitals Tab ────────────────────────────────────────────────────────────────
function VitalsTab({ vitals, onAdd, canWrite, patientId }) {
  return (
    <div className="space-y-3">
      {canWrite && <div className="flex justify-end">
        <button onClick={onAdd} className="flex items-center gap-2 px-3 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]">
          <Plus size={15} /> Record Vitals
        </button>
      </div>}
      <VitalsTrendChart patientId={patientId} />
      {vitals.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">No vitals recorded</p>
      ) : vitals.map(v => (
        <div key={v.id} className="border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-400 mb-3">{format(new Date(v.recordedAt || v.createdAt), 'dd MMM yyyy, hh:mm a')}</div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            <VitalChip label="BP" value={v.bloodPressureSystolic ? `${v.bloodPressureSystolic}/${v.bloodPressureDiastolic}` : '—'} unit="mmHg" />
            <VitalChip label="HR" value={v.heartRate} unit="bpm" />
            <VitalChip label="RR" value={v.respiratoryRate} unit="/min" />
            <VitalChip label="Temp" value={v.temperature} unit="°C" />
            <VitalChip label="SpO₂" value={v.oxygenSaturation} unit="%" />
            <VitalChip label="BMI" value={v.bmi} unit="kg/m²" />
          </div>
          {v.notes && <p className="text-xs text-gray-500 mt-2">{v.notes}</p>}
        </div>
      ))}
    </div>
  );
}

// ── Allergies Tab ─────────────────────────────────────────────────────────────
function AllergiesTab({ patientId, allergies, onAdd, canWrite }) {
  const qc = useQueryClient();
  const { mutate: del } = useMutation({
    mutationFn: (aid) => api.delete(`/patients/${patientId}/allergies/${aid}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['patient', patientId] }); toast.success('Allergy removed'); },
  });
  const SEV_COLOR = { MILD: 'bg-yellow-50 text-yellow-700', MODERATE: 'bg-orange-50 text-orange-700', SEVERE: 'bg-red-50 text-red-700', ANAPHYLAXIS: 'bg-red-100 text-red-800 font-bold' };

  return (
    <div className="space-y-3">
      {canWrite && <div className="flex justify-end">
        <button onClick={onAdd} className="flex items-center gap-2 px-3 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]">
          <Plus size={15} /> Add Allergy
        </button>
      </div>}
      {allergies.length === 0 ? (
        <div className="text-center py-10">
          <AlertTriangle size={32} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No allergies on record</p>
        </div>
      ) : allergies.map(a => (
        <div key={a.id} className="flex items-start justify-between gap-3 p-4 border border-red-100 bg-red-50/30 rounded-xl">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
              <AlertTriangle size={14} className="text-red-600" />
            </div>
            <div>
              <div className="font-semibold text-gray-900 text-sm">{a.substance}</div>
              {a.reaction && <div className="text-xs text-gray-600 mt-0.5">Reaction: {a.reaction}</div>}
              {a.onset && <div className="text-xs text-gray-400">Onset: {a.onset}</div>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SEV_COLOR[a.severity?.toUpperCase()] || 'bg-gray-100 text-gray-600'}`}>
              {a.severity}
            </span>
            {canWrite && <button onClick={() => del(a.id)} className="text-gray-400 hover:text-red-500 transition-colors">
              <X size={14} />
            </button>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Conditions Tab ────────────────────────────────────────────────────────────
function ConditionsTab({ patientId, conditions, onAdd, canWrite }) {
  const qc = useQueryClient();
  const { mutate: update } = useMutation({
    mutationFn: ({ cid, status }) => api.put(`/patients/${patientId}/conditions/${cid}`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['patient', patientId] }); toast.success('Condition updated'); },
  });

  return (
    <div className="space-y-3">
      {canWrite && <div className="flex justify-end">
        <button onClick={onAdd} className="flex items-center gap-2 px-3 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]">
          <Plus size={15} /> Add Condition
        </button>
      </div>}
      {conditions.length === 0 ? (
        <div className="text-center py-10">
          <Heart size={32} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No medical conditions on record</p>
        </div>
      ) : conditions.map(c => (
        <div key={c.id} className="flex items-start justify-between gap-3 p-4 border border-gray-200 rounded-xl hover:border-gray-300">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-purple-50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
              <Heart size={14} className="text-purple-600" />
            </div>
            <div>
              <div className="font-semibold text-gray-900 text-sm">{c.name}</div>
              {c.icdCode && <div className="text-xs text-gray-500 font-mono">ICD: {c.icdCode}</div>}
              {c.onset && <div className="text-xs text-gray-400 mt-0.5">Onset: {c.onset}</div>}
              {c.notes && <div className="text-xs text-gray-500 mt-1">{c.notes}</div>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <StatusBadge status={c.status} />
            {canWrite && c.status !== 'RESOLVED' && (
              <button onClick={() => update({ cid: c.id, status: 'RESOLVED' })} className="text-xs text-gray-400 hover:text-green-600 underline">
                Resolve
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Prescriptions Tab ─────────────────────────────────────────────────────────
function PrescriptionsTab({ patientId, prescriptions, onAdd, canWrite }) {
  const qc = useQueryClient();
  const { mutate: update } = useMutation({
    mutationFn: ({ pid, status }) => api.put(`/patients/${patientId}/prescriptions/${pid}`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['patient', patientId] }); toast.success('Prescription updated'); },
  });

  return (
    <div className="space-y-3">
      {canWrite && <div className="flex justify-end">
        <button onClick={onAdd} className="flex items-center gap-2 px-3 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]">
          <Plus size={15} /> Add Prescription
        </button>
      </div>}
      {prescriptions.length === 0 ? (
        <div className="text-center py-10">
          <Pill size={32} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No prescriptions recorded</p>
        </div>
      ) : prescriptions.map(rx => (
        <div key={rx.id} className="flex items-center gap-3 p-4 border border-gray-200 rounded-xl">
          <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <Pill size={18} className="text-green-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-gray-900">{rx.drugName} <span className="font-normal text-gray-600">{rx.dosage}</span></div>
            <div className="text-xs text-gray-500 mt-0.5">{rx.frequency} · {rx.duration} · Route: {rx.route}</div>
            {rx.instructions && <div className="text-xs text-gray-400 mt-0.5 italic">{rx.instructions}</div>}
            <div className="text-xs text-gray-400 mt-0.5">
              {rx.createdAt ? format(new Date(rx.createdAt), 'dd MMM yyyy') : ''}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <StatusBadge status={rx.status} />
            {canWrite && rx.status === 'ACTIVE' && (
              <button onClick={() => update({ pid: rx.id, status: 'COMPLETED' })} className="text-xs text-gray-400 hover:text-[#2D5BFF] underline">
                Mark done
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Lab Tab ───────────────────────────────────────────────────────────────────
/**
 * Read-only view of the ward documentation for this patient: every monitoring
 * sheet the nurses are keeping, its running fluid balance, and the most recent
 * observations. Authoring stays in the nursing module — this exists so a doctor
 * on a ward round can see the catheter output without leaving the chart.
 */
function MonitoringTab({ patientId }) {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['patient-monitoring', patientId],
    queryFn: () => api.get('/nursing/monitoring-sheets', { params: { patientId, status: 'ALL' } }).then(r => r.data),
  });

  const sheets = data?.sheets || [];

  if (isLoading) return <div className="py-10 flex justify-center"><Spinner /></div>;

  // Charts, order adherence and anything awaiting nursing, on one screen.
  const overviewLink = (
    <button
      onClick={() => navigate(`/dashboard/nursing/patient/${patientId}`)}
      className="w-full mb-4 border border-gray-300 px-4 py-3 text-sm text-left hover:bg-gray-50 flex items-center justify-between"
    >
      <span>
        <span className="font-medium text-gray-900">Open the full nursing record</span>
        <span className="block text-xs text-gray-500">
          Trend charts with target ranges, whether standing orders are being carried out, and anything awaiting a nurse
        </span>
      </span>
      <span className="text-gray-400">&rarr;</span>
    </button>
  );

  if (!sheets.length) {
    return (
      <div className="text-center py-12">
        <Activity size={34} className="text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No monitoring sheets for this patient.</p>
        <p className="text-xs text-gray-400 mt-1">
          Nursing staff start these from the Monitoring module when a catheter, drip or transfusion is running.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {overviewLink}
      {sheets.map(sheet => {
        const totals = sheet.totals || {};
        const entries = sheet.entries || [];
        const hasBalance = totals.intakeMl != null || totals.outputMl != null;
        return (
          <div key={sheet.id} className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200">
              <div className="min-w-0">
                <span className="font-medium text-gray-900">{sheet.title || sheet.customType || sheet.type?.replace(/_/g, ' ')}</span>
                <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium border ${
                  sheet.status === 'ACTIVE' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-100 text-gray-600 border-gray-200'
                }`}>{sheet.status}</span>
              </div>
              <button onClick={() => navigate(`/dashboard/nursing/${sheet.id}`)}
                className="text-xs font-medium text-[#2D5BFF] hover:underline min-h-11 px-2">
                Open full sheet &rarr;
              </button>
            </div>

            {hasBalance && (
              <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100 text-center">
                <div className="py-2">
                  <div className="text-xs text-gray-500">Intake</div>
                  <div className="font-semibold text-gray-900">{totals.intakeMl ?? 0} ml</div>
                </div>
                <div className="py-2">
                  <div className="text-xs text-gray-500">Output</div>
                  <div className="font-semibold text-gray-900">{totals.outputMl ?? 0} ml</div>
                </div>
                <div className="py-2">
                  <div className="text-xs text-gray-500">Balance</div>
                  <div className={`font-semibold ${Number(totals.balanceMl) < 0 ? 'text-amber-700' : 'text-gray-900'}`}>
                    {totals.balanceMl ?? 0} ml
                  </div>
                </div>
              </div>
            )}

            {!entries.length ? (
              <p className="px-4 py-3 text-sm text-gray-400">No observations recorded yet.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {entries.slice(0, 6).map(e => (
                  <div key={e.id} className={`px-4 py-2.5 text-sm ${e.isAbnormal ? 'bg-red-50/50' : ''}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-gray-500">
                        {e.recordedAt ? format(new Date(e.recordedAt), 'dd MMM HH:mm') : ''}
                      </span>
                      {e.isAbnormal && <span className="text-xs font-semibold text-red-700">ABNORMAL</span>}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-gray-700">
                      {Object.entries(e.values || {}).map(([k, v]) => (
                        <span key={k}><span className="text-gray-500">{k}:</span> {String(v)}</span>
                      ))}
                      {e.intakeMl != null && <span><span className="text-gray-500">in:</span> {e.intakeMl}ml</span>}
                      {e.outputMl != null && <span><span className="text-gray-500">out:</span> {e.outputMl}ml</span>}
                    </div>
                    {e.notes && <p className="text-xs text-gray-500 mt-0.5">{e.notes}</p>}
                  </div>
                ))}
                {entries.length > 6 && (
                  <p className="px-4 py-2 text-xs text-gray-400">
                    +{entries.length - 6} earlier observation{entries.length - 6 === 1 ? '' : 's'}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LabTab({ labRequests, patientId, canRequest }) {
  return (
    <div className="space-y-3">
      {canRequest && <div className="flex justify-end">
        <Link to={`/dashboard/lab?patientId=${patientId}`} className="flex items-center gap-2 px-3 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]">
          <Plus size={15} /> Request Test
        </Link>
      </div>}
      {labRequests.length === 0 ? (
        <div className="text-center py-10">
          <FlaskConical size={32} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No lab requests yet</p>
        </div>
      ) : labRequests.map(l => (
        <div key={l.id} className="p-4 border border-gray-200 rounded-xl">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-orange-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <FlaskConical size={16} className="text-orange-600" />
              </div>
              <div>
                <div className="font-medium text-gray-900">{l.testName}</div>
                <div className="text-xs text-gray-500">{l.testType} · Priority: {l.priority}</div>
              </div>
            </div>
            <StatusBadge status={l.status} />
          </div>
          {l.result && <div className="mt-3 bg-gray-50 border border-gray-100 rounded-lg p-3 text-sm text-gray-700">{l.result}</div>}
          <div className="text-xs text-gray-400 mt-2">{l.createdAt ? format(new Date(l.createdAt), 'dd MMM yyyy') : ''}</div>
        </div>
      ))}
    </div>
  );
}

// ── Appointments Tab ──────────────────────────────────────────────────────────
function AppointmentsTab({ appointments, patientId }) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Link to={`/dashboard/appointments?patientId=${patientId}`} className="flex items-center gap-2 px-3 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]">
          <Plus size={15} /> Book Appointment
        </Link>
      </div>
      {appointments.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">No appointments</p>
      ) : appointments.map(a => (
        <div key={a.id} className="border border-gray-200 rounded-xl p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium text-gray-900">{a.visitType?.replace(/_/g, ' ')}</div>
              <div className="text-sm text-gray-500">
                {a.scheduledAt ? format(new Date(a.scheduledAt), 'dd MMM yyyy, hh:mm a') : '—'}
              </div>
              {a.doctor && <div className="text-xs text-gray-400 mt-0.5">Dr. {a.doctor.firstName} {a.doctor.lastName}</div>}
              {a.remarks && <div className="text-xs text-gray-400 mt-0.5">{a.remarks}</div>}
            </div>
            <div className="flex flex-col items-end gap-1">
              <StatusBadge status={a.status} />
              <StatusBadge status={a.paymentStatus} />
            </div>
          </div>
          {a.charges > 0 && (
            <div className="mt-2 text-xs text-gray-500">
              Charges: <span className="font-semibold text-gray-900">₦{Number(a.charges).toLocaleString()}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Documents Tab ─────────────────────────────────────────────────────────────
function DocumentsTab({ patientId }) {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [openingId, setOpeningId] = useState(null);

  const { data: docs = [] } = useQuery({
    queryKey: ['patient-docs', patientId],
    queryFn: () => api.get('/uploads', { params: { patientId } }).then(r => r.data),
  });

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('patientId', patientId);
      await api.post('/uploads', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      qc.invalidateQueries({ queryKey: ['patient-docs', patientId] });
      toast.success('Document uploaded');
    } catch {
      toast.error('Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleOpen = async (document) => {
    setOpeningId(document.id);
    try {
      const { data } = await api.get(`/uploads/${document.id}/download`, { responseType: 'blob' });
      const objectUrl = URL.createObjectURL(data);
      const opened = window.open(objectUrl, '_blank', 'noopener,noreferrer');
      if (!opened) toast.error('Pop-up blocked — allow pop-ups to view this document');
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch {
      toast.error('Document could not be opened');
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <label className="flex items-center gap-2 px-3 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] cursor-pointer">
          <Upload size={15} />
          {uploading ? 'Uploading…' : 'Upload Document'}
          <input type="file" className="hidden" onChange={handleFileChange} accept="image/*,.pdf,.doc,.docx" disabled={uploading} />
        </label>
      </div>
      {docs.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-gray-200 rounded-xl">
          <FileText size={32} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No documents uploaded</p>
          <p className="text-xs text-gray-300 mt-1">Upload PDFs, images, or Word documents</p>
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-3 p-3 border border-gray-200 rounded-xl">
              <FileText size={18} className="text-[#2D5BFF] shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{d.originalName || d.name}</div>
                <div className="text-xs text-gray-400">{d.size ? `${Math.round(d.size / 1024)} KB` : ''}</div>
              </div>
              <button
                type="button"
                onClick={() => handleOpen(d)}
                disabled={openingId === d.id}
                className="text-xs text-[#2D5BFF] hover:underline disabled:opacity-50"
              >
                {openingId === d.id ? 'Opening…' : 'View'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Modals ────────────────────────────────────────────────────────────────────
function AddVitalModal({ open, onClose, patientId }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    bloodPressureSystolic: '', bloodPressureDiastolic: '', heartRate: '',
    respiratoryRate: '', temperature: '', oxygenSaturation: '',
    weight: '', height: '', bloodGlucose: '', notes: '',
  });
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post(`/patients/${patientId}/vitals`, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient', patientId] });
      toast.success('Vitals recorded');
      onClose();
      setForm({ bloodPressureSystolic: '', bloodPressureDiastolic: '', heartRate: '', respiratoryRate: '', temperature: '', oxygenSaturation: '', weight: '', height: '', bloodGlucose: '', notes: '' });
    },
    onError: () => toast.error('Failed to record vitals'),
  });

  const fields = [
    ['BP Systolic', 'bloodPressureSystolic', 'mmHg'],
    ['BP Diastolic', 'bloodPressureDiastolic', 'mmHg'],
    ['Heart Rate', 'heartRate', 'bpm'],
    ['Resp. Rate', 'respiratoryRate', '/min'],
    ['Temperature', 'temperature', '°C'],
    ['SpO₂', 'oxygenSaturation', '%'],
    ['Weight', 'weight', 'kg'],
    ['Height', 'height', 'cm'],
    ['Blood Glucose', 'bloodGlucose', 'mg/dL'],
  ];

  return (
    <Modal open={open} onClose={onClose} title="Record Vitals" size="md">
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {fields.map(([label, key, unit]) => (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-700 mb-1">{label} <span className="text-gray-400">({unit})</span></label>
              <input type="number" step="any" value={form[key]} onChange={set(key)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 focus:border-[#2D5BFF]" />
            </div>
          ))}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <textarea value={form.notes} onChange={set('notes')} rows={2}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 focus:border-[#2D5BFF] resize-none" />
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutate()} disabled={isPending}
            className="flex-1 py-2.5 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50">
            {isPending ? 'Saving…' : 'Save Vitals'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AddAllergyModal({ open, onClose, patientId }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ substance: '', reaction: '', severity: 'MILD', onset: '' });
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post(`/patients/${patientId}/allergies`, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient', patientId] });
      toast.success('Allergy added');
      onClose();
      setForm({ substance: '', reaction: '', severity: 'MILD', onset: '' });
    },
    onError: () => toast.error('Failed to add allergy'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Add Allergy" size="sm">
      <div className="p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Allergen / Substance <span className="text-red-500">*</span></label>
          <input value={form.substance} onChange={set('substance')} placeholder="e.g. Penicillin, Peanuts, Latex"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 focus:border-[#2D5BFF]" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Reaction</label>
          <input value={form.reaction} onChange={set('reaction')} placeholder="e.g. Hives, Difficulty breathing"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 focus:border-[#2D5BFF]" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Severity</label>
          <select value={form.severity} onChange={set('severity')}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 bg-white">
            {['MILD', 'MODERATE', 'SEVERE', 'ANAPHYLAXIS'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Onset</label>
          <input value={form.onset} onChange={set('onset')} placeholder="e.g. 2020, Childhood"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 focus:border-[#2D5BFF]" />
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutate()} disabled={isPending || !form.substance}
            className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">
            {isPending ? 'Adding…' : 'Add Allergy'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AddConditionModal({ open, onClose, patientId }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', icdCode: '', onset: '', status: 'ACTIVE', notes: '' });
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post(`/patients/${patientId}/conditions`, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient', patientId] });
      toast.success('Condition added');
      onClose();
      setForm({ name: '', icdCode: '', onset: '', status: 'ACTIVE', notes: '' });
    },
    onError: () => toast.error('Failed to add condition'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Add Medical Condition" size="sm">
      <div className="p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Condition Name <span className="text-red-500">*</span></label>
          <input value={form.name} onChange={set('name')} placeholder="e.g. Type 2 Diabetes, Hypertension"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 focus:border-[#2D5BFF]" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">ICD-10 Code</label>
            <input value={form.icdCode} onChange={set('icdCode')} placeholder="e.g. E11, I10"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 font-mono" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Onset</label>
            <input value={form.onset} onChange={set('onset')} placeholder="e.g. 2018, Birth"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
          <select value={form.status} onChange={set('status')}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 bg-white">
            {['ACTIVE', 'CONTROLLED', 'RESOLVED', 'CHRONIC'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <textarea value={form.notes} onChange={set('notes')} rows={2} placeholder="Additional context…"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none" />
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutate()} disabled={isPending || !form.name}
            className="flex-1 py-2.5 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50">
            {isPending ? 'Adding…' : 'Add Condition'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AddPrescriptionModal({ open, onClose, patientId }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    drugName: '', dosage: '', frequency: '', duration: '',
    route: 'ORAL', instructions: '', status: 'ACTIVE',
  });
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post(`/patients/${patientId}/prescriptions`, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient', patientId] });
      toast.success('Prescription added');
      onClose();
      setForm({ drugName: '', dosage: '', frequency: '', duration: '', route: 'ORAL', instructions: '', status: 'ACTIVE' });
    },
    onError: () => toast.error('Failed to add prescription'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Add Prescription" size="sm">
      <div className="p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Drug Name <span className="text-red-500">*</span></label>
          <input value={form.drugName} onChange={set('drugName')} placeholder="e.g. Amoxicillin, Metformin"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 focus:border-[#2D5BFF]" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Dosage <span className="text-red-500">*</span></label>
            <input value={form.dosage} onChange={set('dosage')} placeholder="e.g. 500mg, 10ml"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Frequency <span className="text-red-500">*</span></label>
            <input value={form.frequency} onChange={set('frequency')} placeholder="e.g. BD, TDS, OD"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Duration <span className="text-red-500">*</span></label>
            <input value={form.duration} onChange={set('duration')} placeholder="e.g. 7 days, 2 weeks"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Route</label>
            <select value={form.route} onChange={set('route')}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 bg-white">
              {['ORAL', 'IV', 'IM', 'SC', 'TOPICAL', 'SUBLINGUAL', 'INHALATION', 'RECTAL'].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Special Instructions</label>
          <textarea value={form.instructions} onChange={set('instructions')} rows={2} placeholder="e.g. Take after meals, avoid sunlight"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none" />
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutate()} disabled={isPending || !form.drugName || !form.dosage}
            className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
            {isPending ? 'Adding…' : 'Add Prescription'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
