import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { Archive, AlertTriangle, CheckCircle2, ClipboardCheck, FileSignature, Package, Pill, Plus, RotateCcw, Search, ShieldAlert, Stethoscope } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import api from '../../lib/api';
import Modal from '../../components/ui/Modal';
import Spinner from '../../components/ui/Spinner';
import PatientPicker from '../../components/clinical/PatientPicker';
import { can } from '../../lib/permissions';

const field = 'w-full min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/25';
const money = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });

export default function Pharmacy() {
  const user = useSelector((state) => state.auth.user);
  const mayDispense = can(user?.role, user?.subRole, 'pharmacy_write');
  const mayEditStock = can(user?.role, user?.subRole, 'inventory_write');
  const [tab, setTab] = useState('QUEUE');
  const [status, setStatus] = useState('ACTIVE');
  const [stockView, setStockView] = useState('ACTIVE');
  const [search, setSearch] = useState('');
  const [dispensing, setDispensing] = useState(null);
  const [stockModal, setStockModal] = useState(null);
  const [archiveItem, setArchiveItem] = useState(null);
  const [patientDispenseOpen, setPatientDispenseOpen] = useState(false);
  const [patientId, setPatientId] = useState('');
  const [problemOpen, setProblemOpen] = useState(false);
  const [carePlanOpen, setCarePlanOpen] = useState(false);

  const queue = useQuery({
    queryKey: ['pharmacy-queue', status, search],
    queryFn: () => api.get('/orders/pharmacy/queue', { params: { status, search: search || undefined } }).then((response) => response.data),
    enabled: tab === 'QUEUE', refetchInterval: 30000,
  });
  const inventory = useQuery({
    queryKey: ['pharmacy-inventory', stockView, search],
    queryFn: () => api.get('/orders/pharmacy/inventory', { params: { stockStatus: stockView, search: search || undefined } }).then((response) => response.data),
  });
  const patientCare = useQuery({
    queryKey: ['pharmacy-patient-care', patientId],
    queryFn: () => api.get(`/orders/pharmacy/patient/${patientId}`).then((response) => response.data),
    enabled: tab === 'PATIENT_CARE' && Boolean(patientId),
  });
  const showcasePatient = useQuery({
    queryKey: ['pharmacy-showcase-patient'],
    queryFn: () => api.get('/patients', { params: { search: 'DEMO-SAMPLE-001', limit: 5 } })
      .then((response) => response.data?.patients?.find((patient) => patient.mrn === 'DEMO-SAMPLE-001') || null),
    staleTime: 60_000,
  });

  function openShowcase() {
    if (!showcasePatient.data) return;
    setTab('PATIENT_CARE');
    setPatientId(showcasePatient.data.id);
    setSearch('');
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-bold text-gray-900">Pharmacy</h1><p className="text-sm text-gray-500">Orders, dispensing, stock and medicine safety</p></div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {mayDispense && <button onClick={() => setPatientDispenseOpen(true)} className="min-h-10 rounded-lg bg-purple-700 px-3 text-sm font-semibold text-white"><ClipboardCheck size={15} className="mr-1.5 inline" />Dispense by patient / order</button>}
          <div className="flex rounded-lg border border-gray-200 bg-white p-1">
          {[['QUEUE','Orders & dispensing'],['INVENTORY','Stock'],['PATIENT_CARE','Safety & care']].map(([key, label]) => <button key={key} onClick={() => { setTab(key); setSearch(''); }} className={`min-h-9 rounded-md px-3 text-sm font-medium ${tab === key ? 'bg-[#0B1F66] text-white' : 'text-gray-600'}`}>{label}</button>)}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Awaiting dispensing" value={queue.data?.total ?? '—'} tone="bg-purple-600" icon={Pill} />
        <Metric label="Formulary items" value={inventory.data?.counts?.total ?? '—'} tone="bg-[#0B1F66]" icon={Package} />
        <Metric label="Low stock" value={inventory.data?.counts?.lowStock ?? '—'} tone="bg-orange-500" icon={AlertTriangle} />
        <Metric label="Expiring ≤90 days" value={inventory.data?.counts?.expiringSoon ?? '—'} tone="bg-red-500" icon={AlertTriangle} />
      </div>

      {showcasePatient.data && (
        <section className="rounded-xl border border-purple-200 bg-purple-50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-bold text-purple-950">End-to-end pharmacy sample</div>
              <p className="mt-1 text-xs text-purple-800">
                {showcasePatient.data.firstName} {showcasePatient.data.lastName} · {showcasePatient.data.universalPatientId} · prescription, safety review, stock issue, dispensing record, therapy problem and signed care plan
              </p>
            </div>
            <button type="button" onClick={openShowcase}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-purple-700 px-4 text-sm font-semibold text-white hover:bg-purple-800">
              <Stethoscope size={16} /> Open sample
            </button>
          </div>
        </section>
      )}

      {tab !== 'PATIENT_CARE' && <section className="rounded-xl border border-gray-200 bg-white p-3 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input className={`${field} pl-9`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tab === 'QUEUE' ? 'Search patient, Health ID, Hosp No or medicine…' : 'Search medicine, generic name or category…'} /></div>
        {tab === 'QUEUE' && <select className={`${field} sm:w-48`} value={status} onChange={(event) => setStatus(event.target.value)}><option value="ACTIVE">Awaiting / active</option><option value="COMPLETED">Dispensed</option><option value="CANCELLED">Cancelled</option><option value="ALL">All</option></select>}
        {tab === 'INVENTORY' && mayEditStock && <button onClick={() => setStockModal({ mode: 'create', item: null })} className="min-h-11 rounded-lg bg-[#0B1F66] px-4 text-sm font-semibold text-white"><Plus size={15} className="mr-1.5 inline" />Add stock item</button>}
      </section>}

      {tab === 'QUEUE'
        ? <PrescriptionQueue data={queue.data} loading={queue.isLoading} mayDispense={mayDispense} onDispense={setDispensing} />
        : tab === 'PATIENT_CARE'
          ? <PatientCareWorkspace patientId={patientId} setPatientId={setPatientId} data={patientCare.data} loading={patientCare.isLoading}
              onNewProblem={() => setProblemOpen(true)} onNewCarePlan={() => setCarePlanOpen(true)} />
          : <Inventory data={inventory.data} loading={inventory.isLoading} mayEdit={mayEditStock} stockView={stockView} onStockView={setStockView} onEdit={(item) => setStockModal({ mode: 'edit', item })} onArchive={setArchiveItem} />}

      {dispensing && <DispenseModal prescription={dispensing} onClose={() => setDispensing(null)} />}
      {stockModal && <InventoryModal mode={stockModal.mode} item={stockModal.item} onClose={() => setStockModal(null)} />}
      {archiveItem && <ArchiveInventoryModal item={archiveItem} onClose={() => setArchiveItem(null)} />}
      {patientDispenseOpen && <PatientOrderLookupModal onClose={() => setPatientDispenseOpen(false)} onSelect={(rx) => { setPatientDispenseOpen(false); setDispensing(rx); }} />}
      {problemOpen && <TherapyProblemModal patientId={patientId} prescriptions={patientCare.data?.prescriptions || []} onClose={() => setProblemOpen(false)} />}
      {carePlanOpen && <CarePlanModal patientId={patientId} onClose={() => setCarePlanOpen(false)} />}
    </div>
  );
}

function Metric({ label, value, tone, icon: Icon }) { return <div className={`${tone} rounded-xl p-4 text-white`}><div className="flex items-center justify-between"><div className="text-2xl font-extrabold">{value}</div><Icon size={19} className="opacity-80" /></div><div className="mt-1 text-xs opacity-85">{label}</div></div>; }

function PrescriptionQueue({ data, loading, mayDispense, onDispense }) {
  if (loading) return <Loading />;
  const rows = data?.prescriptions || [];
  if (!rows.length) return <Empty icon={CheckCircle2} title="No prescriptions here" text="New prescriptions will show here." />;
  return <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white"><table className="w-full min-w-[980px] text-sm"><thead className="border-b border-gray-200 bg-gray-50"><tr>{['Patient','Medicine','Directions','Prescriber','Ordered','Dispensing',''].map((title) => <th key={title} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">{rows.map((rx) => <tr key={rx.id} className="hover:bg-gray-50/60"><td className="px-4 py-3"><div className="font-medium text-gray-900">{rx.patient?.firstName} {rx.patient?.lastName}</div><div className="text-xs text-gray-500">{rx.patient?.mrn || rx.patient?.universalPatientId}</div></td><td className="px-4 py-3"><div className="font-medium text-gray-900">{rx.drugName}</div><div className="text-xs text-gray-500">{rx.route || '—'}</div></td><td className="px-4 py-3 text-gray-700">{[rx.dosage, rx.frequency, rx.duration].filter(Boolean).join(' · ') || 'Not stated'}{rx.instructions && <div className="mt-1 text-xs text-gray-500">{rx.instructions}</div>}</td><td className="px-4 py-3 text-gray-600">{rx.prescribedBy ? `${rx.prescribedBy.firstName} ${rx.prescribedBy.lastName}` : 'Not recorded'}</td><td className="px-4 py-3 text-xs text-gray-500">{format(new Date(rx.createdAt), 'dd MMM yyyy · HH:mm')}</td><td className="px-4 py-3">{rx.dispenses?.length ? <div><span className="font-medium text-green-700">{rx.dispenses.reduce((sum, item) => sum + item.quantity, 0)} issued</span><div className="text-xs text-gray-500">{money.format(rx.dispenses.reduce((sum, item) => sum + Number(item.amount), 0))}</div></div> : <span className="text-xs text-orange-700">Awaiting pharmacy</span>}</td><td className="px-4 py-3">{mayDispense && rx.status !== 'CANCELLED' && <button onClick={() => onDispense(rx)} className="min-h-10 rounded-lg bg-[#0B1F66] px-3 text-xs font-semibold text-white">{rx.status === 'COMPLETED' ? 'Issue again / balance' : 'Dispense'}</button>}</td></tr>)}</tbody></table></div>;
}

function Inventory({ data, loading, mayEdit, stockView, onStockView, onEdit, onArchive }) {
  const qc = useQueryClient();
  const restore = useMutation({
    mutationFn: (id) => api.post(`/orders/pharmacy/inventory/${id}/restore`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pharmacy-inventory'] }); toast.success('Stock item restored'); },
    onError: (error) => toast.error(error?.response?.data?.error || 'Could not restore stock item'),
  });
  const filters = [
    ['ACTIVE', 'All active', data?.counts?.total],
    ['LOW', 'Low stock', data?.counts?.lowStock],
    ['OUT', 'Out of stock', data?.counts?.outOfStock],
    ['ARCHIVED', 'Archived', data?.counts?.archived],
  ];
  const rows = data?.items || [];
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">{filters.map(([key, label, count]) => <button key={key} onClick={() => onStockView(key)} className={`min-h-9 rounded-lg border px-3 text-xs font-semibold ${stockView === key ? 'border-[#2D5BFF] bg-blue-50 text-[#2D5BFF]' : 'border-gray-200 bg-white text-gray-600'}`}>{label}{count !== undefined ? ` (${count})` : ''}</button>)}</div>
    {loading ? <Loading /> : !rows.length ? <Empty icon={Package} title={`No ${stockView === 'ARCHIVED' ? 'archived' : stockView.toLowerCase()} stock items`} text={stockView === 'ACTIVE' ? 'Use Add stock item to create the facility formulary and opening balance.' : 'No medicine matches this stock list and search.'} /> :
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white"><table className="w-full min-w-[980px] text-sm"><thead className="border-b border-gray-200 bg-gray-50"><tr>{['Medicine','Category','Available','Reorder at','Price','Expiry','Actions'].map((title) => <th key={title} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">{rows.map((item) => { const low = item.isActive && item.stockOnHand <= item.reorderLevel; const expiring = item.nextExpiryDate && new Date(item.nextExpiryDate).getTime() <= Date.now() + 90 * 86400000; return <tr key={item.id} className={!item.isActive ? 'bg-gray-50 opacity-75' : low ? 'bg-orange-50/40' : ''}><td className="px-4 py-3"><div className="font-medium text-gray-900">{item.name} {item.strength || ''}</div><div className="text-xs text-gray-500">{[item.genericName, item.form, item.isControlled ? 'Controlled' : null].filter(Boolean).join(' · ')}</div></td><td className="px-4 py-3 text-gray-600">{item.category || '—'}</td><td className={`px-4 py-3 font-semibold ${!item.isActive ? 'text-gray-500' : low ? 'text-orange-700' : 'text-green-700'}`}>{item.stockOnHand} {item.unitLabel || 'units'}{!item.isActive ? <div className="text-xs font-normal">Archived</div> : low && <div className="text-xs font-normal">{item.stockOnHand <= 0 ? 'Out of stock' : 'Low stock'}</div>}</td><td className="px-4 py-3 text-gray-600">{item.reorderLevel}</td><td className="px-4 py-3 text-gray-600">{money.format(Number(item.unitPrice))}</td><td className={`px-4 py-3 ${expiring ? 'font-medium text-red-700' : 'text-gray-600'}`}>{item.nextExpiryDate ? format(new Date(item.nextExpiryDate), 'dd MMM yyyy') : 'Not entered'}</td><td className="px-4 py-3">{mayEdit && (item.isActive ? <div className="flex gap-2"><button onClick={() => onEdit(item)} className="min-h-10 rounded-lg border border-gray-300 px-3 text-xs font-semibold text-gray-700">Edit</button><button onClick={() => onArchive(item)} className="min-h-10 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-700"><Archive size={13} className="mr-1 inline" />Archive</button></div> : <button onClick={() => restore.mutate(item.id)} disabled={restore.isPending} className="min-h-10 rounded-lg border border-green-300 px-3 text-xs font-semibold text-green-700 disabled:opacity-50"><RotateCcw size={13} className="mr-1 inline" />Restore</button>)}</td></tr>; })}</tbody></table></div>}
  </div>;
}

function PatientCareWorkspace({ patientId, setPatientId, data, loading, onNewProblem, onNewCarePlan }) {
  return <div className="space-y-4">
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <PatientPicker value={patientId} onChange={setPatientId} label="Patient Health ID / facility record"
        placeholder="Search Health ID, Hosp No, phone or patient name…" id="pharmacy-patient-picker" />
      <p className="mt-2 text-xs text-gray-500">View medicines, dispensing history, allergies and pharmacy care notes.</p>
    </section>
    {!patientId ? <Empty icon={Stethoscope} title="Select a patient" text="Review their medicines and pharmacy care notes." />
      : loading ? <Loading /> : data ? <PatientCareRecord data={data} onNewProblem={onNewProblem} onNewCarePlan={onNewCarePlan} /> : null}
  </div>;
}

function PatientCareRecord({ data, onNewProblem, onNewCarePlan }) {
  const active = (data.prescriptions || []).filter((item) => item.status === 'ACTIVE');
  const history = data.prescriptions || [];
  const allergies = data.patient?.allergies || [];
  const conditions = data.patient?.conditions || [];
  const warnings = data.safety?.warnings || [];
  const openProblems = (data.therapyProblems || []).filter((item) => item.status !== 'RESOLVED');

  return <>
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-bold text-gray-900">{data.patient?.firstName} {data.patient?.lastName}</h2><div className="text-xs text-[#2D5BFF] font-mono">{data.patient?.universalPatientId}{data.patient?.mrn ? ` · Hosp No ${data.patient.mrn}` : ''}</div></div>
        <div className="flex gap-2"><button onClick={onNewProblem} className="min-h-10 rounded-lg border border-purple-300 px-3 text-xs font-semibold text-purple-800"><Plus size={14} className="mr-1 inline" />Record DTP</button><button onClick={onNewCarePlan} className="min-h-10 rounded-lg bg-[#0B1F66] px-3 text-xs font-semibold text-white"><FileSignature size={14} className="mr-1 inline" />New care plan</button></div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3"><MiniSummary label="Active medicines" value={active.length} /><MiniSummary label="Open therapy problems" value={openProblems.length} alert={openProblems.length > 0} /><MiniSummary label="Recorded allergies" value={allergies.length} alert={allergies.some((item) => item.severity === 'SEVERE')} /></div>
    </section>

    <section className={`rounded-xl border p-4 ${warnings.length ? 'border-amber-300 bg-amber-50' : 'border-blue-200 bg-blue-50'}`}>
      <div className="flex items-start gap-3"><ShieldAlert size={20} className={warnings.length ? 'text-amber-700' : 'text-blue-700'} /><div className="min-w-0 flex-1"><h3 className="text-sm font-bold text-gray-900">Medicine safety</h3><p className="mt-1 text-xs text-gray-700">{data.safety?.scope}</p>{warnings.length ? <div className="mt-3 space-y-2">{warnings.map((warning, index) => <div key={`${warning.kind}-${index}`} className="rounded-lg bg-white/80 p-3 text-sm text-gray-900"><span className="mr-2 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold">{warning.severity}</span>{warning.message}</div>)}</div> : <p className="mt-2 text-sm text-blue-900">No allergy or duplicate medicine warning found.</p>}<p className="mt-3 text-xs font-medium text-gray-700">{data.safety?.limitation}</p></div></div>
    </section>

    <div className="grid gap-4 lg:grid-cols-2">
      <ClinicalList title="Recorded allergies" empty="No allergy has been recorded." rows={allergies.map((item) => ({ title: item.substance, detail: [item.severity, item.reaction].filter(Boolean).join(' · ') }))} alert />
      <ClinicalList title="Active conditions" empty="No active condition has been recorded." rows={conditions.map((item) => ({ title: item.name, detail: [item.icdCode, item.status].filter(Boolean).join(' · ') }))} />
    </div>

    <section className="rounded-xl border border-gray-200 bg-white overflow-hidden"><div className="border-b border-gray-100 px-4 py-3"><h3 className="text-sm font-bold text-gray-900">Medication history / prescribed-drug profile</h3><p className="text-xs text-gray-500">Current and previous prescriptions with every patient-linked issue event.</p></div>{!history.length ? <p className="p-5 text-sm text-gray-500">No prescriptions recorded.</p> : <div className="divide-y divide-gray-100">{history.map((rx) => <div key={rx.id} className="p-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><div className="font-semibold text-gray-900">{rx.drugName} <span className={`ml-1 text-[10px] rounded px-1.5 py-0.5 ${rx.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{rx.status}</span></div><div className="text-xs text-gray-600">{[rx.dosage, rx.route, rx.frequency, rx.duration].filter(Boolean).join(' · ') || 'Directions not fully recorded'}</div>{rx.instructions && <div className="mt-1 text-xs text-gray-500">{rx.instructions}</div>}</div><div className="text-xs text-gray-500 sm:text-right">Prescribed {format(new Date(rx.createdAt), 'dd MMM yyyy · HH:mm')}<br />{rx.dispenses?.length ? `${rx.dispenses.length} issue event(s) · ${rx.dispenses.reduce((sum, item) => sum + item.quantity, 0)} issued` : 'Not yet issued'}</div></div>)}</div>}</section>

    <section className="rounded-xl border border-gray-200 bg-white p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-bold text-gray-900">Drug Therapy Problems</h3><p className="text-xs text-gray-500">Actual or potential problems, recommendations and outcomes.</p></div><button onClick={onNewProblem} className="min-h-9 rounded-lg border border-gray-300 px-3 text-xs font-semibold">Add problem</button></div>{!(data.therapyProblems || []).length ? <p className="text-sm text-gray-500">No therapy problem recorded for this patient.</p> : <div className="space-y-3">{data.therapyProblems.map((problem) => <TherapyProblemCard key={problem.id} problem={problem} />)}</div>}</section>

    <section className="rounded-xl border border-gray-200 bg-white p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-bold text-gray-900">Pharmaceutical care plans</h3><p className="text-xs text-gray-500">SOAP or CORE–PRIME–FARM documentation with goals, interventions and follow-up.</p></div><button onClick={onNewCarePlan} className="min-h-9 rounded-lg bg-[#0B1F66] px-3 text-xs font-semibold text-white">New plan</button></div>{!(data.carePlans || []).length ? <p className="text-sm text-gray-500">No pharmaceutical care plan recorded.</p> : <div className="space-y-3">{data.carePlans.map((carePlan) => <CarePlanCard key={carePlan.id} carePlan={carePlan} />)}</div>}</section>
  </>;
}

function MiniSummary({ label, value, alert }) { return <div className={`rounded-lg p-3 ${alert ? 'bg-amber-50 text-amber-900' : 'bg-gray-50 text-gray-800'}`}><div className="text-xl font-extrabold">{value}</div><div className="text-xs">{label}</div></div>; }
function ClinicalList({ title, rows, empty, alert }) { return <section className="rounded-xl border border-gray-200 bg-white p-4"><h3 className="text-sm font-bold text-gray-900">{title}</h3>{rows.length ? <div className="mt-3 space-y-2">{rows.map((row, index) => <div key={`${row.title}-${index}`} className={`rounded-lg p-3 ${alert ? 'bg-red-50' : 'bg-gray-50'}`}><div className="text-sm font-semibold text-gray-900">{row.title}</div><div className="text-xs text-gray-600">{row.detail || 'No additional detail'}</div></div>)}</div> : <p className="mt-2 text-sm text-gray-500">{empty}</p>}</section>; }

function TherapyProblemCard({ problem }) {
  const qc = useQueryClient();
  const [resolution, setResolution] = useState(problem.resolution || '');
  const mutation = useMutation({ mutationFn: (status) => api.put(`/orders/pharmacy/problems/${problem.id}/status`, { status, resolution }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['pharmacy-patient-care'] }); toast.success('Therapy problem updated'); }, onError: (error) => toast.error(error?.response?.data?.error || 'Could not update therapy problem') });
  return <article className={`rounded-lg border p-3 ${problem.status === 'RESOLVED' ? 'border-green-200 bg-green-50/50' : problem.severity === 'CRITICAL' ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-xs font-bold text-purple-800">{problem.category.replaceAll('_', ' ')} · {problem.problemType} · {problem.severity}</div><p className="mt-1 text-sm font-semibold text-gray-900">{problem.description}</p>{problem.evidence && <p className="mt-1 text-xs text-gray-600">Evidence: {problem.evidence}</p>}{problem.recommendation && <p className="mt-1 text-xs text-gray-700">Recommendation: {problem.recommendation}</p>}</div><span className="rounded bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-700">{problem.status.replaceAll('_', ' ')}</span></div><div className="mt-2 text-xs text-gray-500">Recorded {format(new Date(problem.createdAt), 'dd MMM yyyy · HH:mm')} by {problem.identifiedBy?.firstName} {problem.identifiedBy?.lastName}{problem.prescription?.drugName ? ` · linked to ${problem.prescription.drugName}` : ''}</div>{problem.status !== 'RESOLVED' && <div className="mt-3 flex flex-col gap-2 sm:flex-row"><input className={`${field} flex-1`} value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder="Outcome / resolution required to close" /><button onClick={() => mutation.mutate('IN_REVIEW')} disabled={mutation.isPending} className="min-h-11 rounded-lg border border-gray-300 px-3 text-xs font-semibold">Mark in review</button><button onClick={() => mutation.mutate('RESOLVED')} disabled={mutation.isPending || resolution.trim().length < 3} className="min-h-11 rounded-lg bg-green-700 px-3 text-xs font-semibold text-white disabled:opacity-40">Resolve</button></div>}{problem.resolution && <p className="mt-2 text-xs text-green-800">Outcome: {problem.resolution}</p>}</article>;
}

function CarePlanCard({ carePlan }) {
  const qc = useQueryClient();
  const sign = useMutation({ mutationFn: () => api.post(`/orders/pharmacy/care-plans/${carePlan.id}/sign`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['pharmacy-patient-care'] }); toast.success('Pharmaceutical care plan signed'); }, onError: (error) => toast.error(error?.response?.data?.error || 'Could not sign care plan') });
  const isCore = carePlan.documentationFormat === 'CORE_PRIME_FARM';
  const methodSections = isCore ? [
    ['CORE · Condition', carePlan.coreCondition], ['CORE · Outcomes', carePlan.coreOutcomes],
    ['CORE · Regimen', carePlan.coreRegimen], ['CORE · Evaluation', carePlan.coreEvaluation],
    ['PRIME · Problems', carePlan.primeProblems], ['FARM · Findings', carePlan.farmFindings],
    ['FARM · Assessment', carePlan.farmAssessment], ['FARM · Resolution', carePlan.farmResolution],
    ['FARM · Monitoring', carePlan.farmMonitoring],
  ] : [['S · Subjective', carePlan.subjective], ['O · Objective', carePlan.objective], ['A · Assessment', carePlan.assessment], ['P · Plan', carePlan.plan]];
  const sections = [...methodSections, ['Patient needs', carePlan.patientNeeds], ['Therapy goals', carePlan.therapyGoals], ['Interventions', carePlan.interventions], ['Follow-up', carePlan.followUpPlan]].filter(([, value]) => value);
  return <article className="rounded-lg border border-gray-200 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-sm font-semibold text-gray-900">Pharmacist consultation · {format(new Date(carePlan.createdAt), 'dd MMM yyyy · HH:mm')}</div><div className="text-xs text-gray-500">{carePlan.pharmacist?.firstName} {carePlan.pharmacist?.lastName}{carePlan.pharmacist?.staffId ? ` · ${carePlan.pharmacist.staffId}` : ''}</div></div><div className="flex gap-1.5"><span className="rounded bg-blue-100 px-2 py-1 text-[10px] font-bold text-blue-800">{isCore ? 'CORE–PRIME–FARM' : 'SOAP'}</span><span className={`rounded px-2 py-1 text-[10px] font-bold ${carePlan.status === 'SIGNED' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{carePlan.status}</span></div></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{sections.map(([label, value]) => <div key={label} className="rounded bg-gray-50 p-3"><div className="text-[10px] font-bold uppercase text-gray-500">{label}</div><p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{value}</p></div>)}</div>{carePlan.adherence && <p className="mt-2 text-xs text-gray-700">Adherence: {carePlan.adherence}</p>}{carePlan.followUpAt && <p className="mt-1 text-xs font-medium text-[#2D5BFF]">Follow-up due {format(new Date(carePlan.followUpAt), 'dd MMM yyyy · HH:mm')}</p>}{carePlan.status !== 'SIGNED' && <button onClick={() => sign.mutate()} disabled={sign.isPending} className="mt-3 min-h-10 rounded-lg bg-green-700 px-4 text-xs font-semibold text-white disabled:opacity-50">{sign.isPending ? 'Signing…' : 'Sign care plan'}</button>}{carePlan.signedAt && <p className="mt-2 text-xs text-green-700">Signed {format(new Date(carePlan.signedAt), 'dd MMM yyyy · HH:mm')}</p>}</article>;
}

const DTP_CATEGORIES = [
  'NEEDS_ADDITIONAL_THERAPY', 'UNNECESSARY_THERAPY', 'INEFFECTIVE_THERAPY', 'DOSE_TOO_LOW',
  'DOSE_TOO_HIGH', 'ADVERSE_DRUG_REACTION', 'NON_ADHERENCE', 'DRUG_INTERACTION', 'MONITORING_REQUIRED', 'OTHER',
];

function TherapyProblemModal({ patientId, prescriptions, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ prescriptionId: '', category: 'MONITORING_REQUIRED', problemType: 'ACTUAL', severity: 'MODERATE', description: '', evidence: '', recommendation: '' });
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const mutation = useMutation({ mutationFn: () => api.post('/orders/pharmacy/problems', { patientId, ...form, prescriptionId: form.prescriptionId || undefined }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['pharmacy-patient-care'] }); toast.success('Drug Therapy Problem recorded'); onClose(); }, onError: (error) => toast.error(error?.response?.data?.error || 'Could not record therapy problem') });
  return <Modal open onClose={onClose} title="Record Drug Therapy Problem" size="md"><div className="space-y-3 p-6"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-gray-700">Problem category<select className={`${field} mt-1`} value={form.category} onChange={set('category')}>{DTP_CATEGORIES.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label><label className="text-xs font-medium text-gray-700">Linked medicine (optional)<select className={`${field} mt-1`} value={form.prescriptionId} onChange={set('prescriptionId')}><option value="">Whole regimen / not one medicine</option>{prescriptions.map((rx) => <option key={rx.id} value={rx.id}>{rx.drugName} · {rx.status}</option>)}</select></label></div><div className="grid grid-cols-2 gap-3"><label className="text-xs font-medium text-gray-700">Actual or potential<select className={`${field} mt-1`} value={form.problemType} onChange={set('problemType')}><option value="ACTUAL">Actual</option><option value="POTENTIAL">Potential</option></select></label><label className="text-xs font-medium text-gray-700">Severity<select className={`${field} mt-1`} value={form.severity} onChange={set('severity')}><option>LOW</option><option>MODERATE</option><option>HIGH</option><option>CRITICAL</option></select></label></div><textarea className={field} rows={3} value={form.description} onChange={set('description')} placeholder={form.category === 'DRUG_INTERACTION' ? 'Interacting medicines/substances, interaction type and expected clinical effect *' : 'Describe the medicine-related problem *'} /><textarea className={field} rows={2} value={form.evidence} onChange={set('evidence')} placeholder={form.category === 'DRUG_INTERACTION' ? 'Observed evidence or checked interaction source; do not treat an unverified alert as fact…' : 'Evidence, symptoms, result, adherence finding…'} /><textarea className={field} rows={2} value={form.recommendation} onChange={set('recommendation')} placeholder="Pharmacist recommendation / intervention" /><div className="flex gap-3"><button onClick={onClose} className="flex-1 min-h-11 rounded-lg border border-gray-300 text-sm">Cancel</button><button onClick={() => mutation.mutate()} disabled={mutation.isPending || form.description.trim().length < 5} className="flex-1 min-h-11 rounded-lg bg-purple-700 text-sm font-semibold text-white disabled:opacity-40">{mutation.isPending ? 'Recording…' : 'Record problem'}</button></div></div></Modal>;
}

function CarePlanModal({ patientId, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ documentationFormat: 'SOAP', subjective: '', objective: '', assessment: '', plan: '', coreCondition: '', coreOutcomes: '', coreRegimen: '', coreEvaluation: '', primeProblems: '', farmFindings: '', farmAssessment: '', farmResolution: '', farmMonitoring: '', patientNeeds: '', therapyGoals: '', interventions: '', followUpPlan: '', adherence: '', followUpAt: '' });
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const mutation = useMutation({ mutationFn: () => api.post('/orders/pharmacy/care-plans', { patientId, ...form, followUpAt: form.followUpAt || undefined }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['pharmacy-patient-care'] }); toast.success('Draft pharmaceutical care plan saved'); onClose(); }, onError: (error) => toast.error(error?.response?.data?.error || 'Could not save care plan') });
  const meaningful = Object.entries(form).some(([key, value]) => !['documentationFormat', 'followUpAt', 'adherence'].includes(key) && value.trim().length >= 3);
  const isCore = form.documentationFormat === 'CORE_PRIME_FARM';
  const soapFields = [['subjective','S — Subjective','Patient concerns, symptoms, medicine use and beliefs…'],['objective','O — Objective','Medication profile, observations, laboratory results and adherence evidence…'],['assessment','A — Assessment','Pharmacist assessment and identified priorities…'],['plan','P — Plan','Actions, recommendations, monitoring and counselling…']];
  const coreFields = [['coreCondition','C — Condition','Condition or indication being treated…'],['coreOutcomes','O — Outcomes','Patient-specific desired therapeutic outcomes…'],['coreRegimen','R — Regimen','Current or proposed pharmacotherapy regimen…'],['coreEvaluation','E — Evaluation','Parameters for effectiveness, safety and adherence…']];
  const farmFields = [['farmFindings','F — Findings','Patient-specific evidence supporting the medicine-related problem…'],['farmAssessment','A — Assessment','Severity, urgency, causes and pharmacist evaluation…'],['farmResolution','R — Resolution / prevention','Recommended or completed intervention and rationale…'],['farmMonitoring','M — Monitoring / follow-up','Effectiveness, safety, adherence, responsible person and review timing…']];
  return <Modal open onClose={onClose} title="New pharmaceutical care plan" size="lg"><div className="space-y-4 p-6"><div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-900">Choose the format appropriate to this consultation. Date, time and pharmacist are captured automatically. Save a draft, review it, then sign it from the patient record.</div><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setForm((current) => ({ ...current, documentationFormat: 'SOAP' }))} className={`min-h-12 rounded-lg border px-3 text-sm font-semibold ${!isCore ? 'border-[#2D5BFF] bg-blue-50 text-[#2D5BFF]' : 'border-gray-300 text-gray-600'}`}>SOAP</button><button type="button" onClick={() => setForm((current) => ({ ...current, documentationFormat: 'CORE_PRIME_FARM' }))} className={`min-h-12 rounded-lg border px-3 text-sm font-semibold ${isCore ? 'border-purple-600 bg-purple-50 text-purple-800' : 'border-gray-300 text-gray-600'}`}>CORE–PRIME–FARM</button></div>{!isCore ? <div className="grid gap-3 sm:grid-cols-2">{soapFields.map(([key,label,placeholder]) => <label key={key} className="text-xs font-medium text-gray-700">{label}<textarea className={`${field} mt-1 py-2`} rows={3} value={form[key]} onChange={set(key)} placeholder={placeholder} /></label>)}</div> : <><div><h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">CORE pharmacotherapy plan</h3><div className="grid gap-3 sm:grid-cols-2">{coreFields.map(([key,label,placeholder]) => <label key={key} className="text-xs font-medium text-gray-700">{label}<textarea className={`${field} mt-1 py-2`} rows={2} value={form[key]} onChange={set(key)} placeholder={placeholder} /></label>)}</div></div><label className="block text-xs font-medium text-gray-700">PRIME pharmacotherapy problems<textarea className={`${field} mt-1 py-2`} rows={2} value={form.primeProblems} onChange={set('primeProblems')} placeholder="Pharmaceutical need · Risk · Interaction · Mismatch · Efficacy issue" /></label><div><h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">FARM intervention note</h3><div className="grid gap-3 sm:grid-cols-2">{farmFields.map(([key,label,placeholder]) => <label key={key} className="text-xs font-medium text-gray-700">{label}<textarea className={`${field} mt-1 py-2`} rows={2} value={form[key]} onChange={set(key)} placeholder={placeholder} /></label>)}</div></div></>}<div><h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Shared care plan</h3><div className="grid gap-3 sm:grid-cols-2">{[['patientNeeds','Identified patient needs'],['therapyGoals','Aims and measurable objectives'],['interventions','Pharmacist interventions'],['followUpPlan','Follow-up plan']].map(([key,label]) => <label key={key} className="text-xs font-medium text-gray-700">{label}<textarea className={`${field} mt-1 py-2`} rows={2} value={form[key]} onChange={set(key)} /></label>)}</div></div><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-gray-700">Adherence assessment<select className={`${field} mt-1`} value={form.adherence} onChange={set('adherence')}><option value="">Not assessed</option><option>ADHERENT</option><option>PARTIALLY_ADHERENT</option><option>NON_ADHERENT</option><option>UNABLE_TO_ASSESS</option></select></label><label className="text-xs font-medium text-gray-700">Follow-up date and time<input className={`${field} mt-1`} type="datetime-local" value={form.followUpAt} onChange={set('followUpAt')} /></label></div><div className="flex gap-3"><button onClick={onClose} className="flex-1 min-h-11 rounded-lg border border-gray-300 text-sm">Cancel</button><button onClick={() => mutation.mutate()} disabled={mutation.isPending || !meaningful} className="flex-1 min-h-11 rounded-lg bg-[#0B1F66] text-sm font-semibold text-white disabled:opacity-40">{mutation.isPending ? 'Saving…' : 'Save draft care plan'}</button></div></div></Modal>;
}

function PatientOrderLookupModal({ onClose, onSelect }) {
  const [patientId, setPatientId] = useState('');
  const patient = useQuery({
    queryKey: ['pharmacy-dispense-patient', patientId],
    queryFn: () => api.get(`/orders/pharmacy/patient/${patientId}`).then((response) => response.data),
    enabled: Boolean(patientId),
  });
  const activeOrders = (patient.data?.prescriptions || []).filter((rx) => rx.status === 'ACTIVE');
  return <Modal open onClose={onClose} title="Dispense by patient and medication order" size="lg"><div className="space-y-4 p-6">
    <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-900">Select the patient and an active prescription. Then choose the stock item.</div>
    <PatientPicker value={patientId} onChange={setPatientId} label="Patient Health ID / facility record" placeholder="Search Health ID, Hosp No, phone or patient name…" id="pharmacy-dispense-patient-picker" />
    {patient.isLoading ? <Loading /> : patientId && patient.data ? <div className="space-y-3"><div className="rounded-lg border border-gray-200 p-3"><div className="font-semibold text-gray-900">{patient.data.patient?.firstName} {patient.data.patient?.lastName}</div><div className="text-xs font-mono text-[#2D5BFF]">{patient.data.patient?.universalPatientId}{patient.data.patient?.mrn ? ` · Hosp No ${patient.data.patient.mrn}` : ''}</div></div>{activeOrders.length ? <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">{activeOrders.map((rx) => <div key={rx.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-semibold text-gray-900">{rx.drugName}</div><div className="text-xs text-gray-600">{[rx.dosage, rx.route, rx.frequency, rx.duration].filter(Boolean).join(' · ') || 'Directions not fully recorded'}</div><div className="mt-1 text-xs text-gray-500">Ordered {format(new Date(rx.createdAt), 'dd MMM yyyy · HH:mm')}</div></div><button onClick={() => onSelect({ ...rx, patient: patient.data.patient })} className="min-h-10 rounded-lg bg-[#0B1F66] px-4 text-xs font-semibold text-white">Select to dispense</button></div>)}</div> : <div className="rounded-lg border border-amber-200 bg-amber-50 p-4"><div className="text-sm font-semibold text-amber-900">No active medication order</div><p className="mt-1 text-xs text-amber-800">A prescriber must enter or renew the medication order before pharmacy can dispense it.</p></div>}</div> : null}
    <button onClick={onClose} className="w-full min-h-11 rounded-lg border border-gray-300 text-sm">Close</button>
  </div></Modal>;
}

function DispenseModal({ prescription, onClose }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['pharmacy-inventory-dispense'], queryFn: () => api.get('/orders/pharmacy/inventory', { params: { stockStatus: 'ACTIVE' } }).then((response) => response.data) });
  const items = data?.items || [];
  const candidates = useMemo(() => { const name = prescription.drugName.toLowerCase(); return [...items].sort((a, b) => Number(b.name.toLowerCase().includes(name)) - Number(a.name.toLowerCase().includes(name))); }, [items, prescription.drugName]);
  const [form, setForm] = useState({ drugCatalogueId: '', quantity: '', unit: '', notes: '', complete: true });
  const selected = items.find((item) => item.id === form.drugCatalogueId);
  const mutation = useMutation({
    mutationFn: () => api.post(`/orders/pharmacy/dispense/${prescription.id}`, { ...form, quantity: Number(form.quantity), unit: form.unit || selected?.unitLabel }).then((response) => response.data),
    onSuccess: (result) => { qc.invalidateQueries({ queryKey: ['pharmacy-queue'] }); qc.invalidateQueries({ queryKey: ['pharmacy-inventory'] }); toast.success(`Dispensed · ${money.format(result.amount)}`); onClose(); },
    onError: (error) => toast.error(error?.response?.data?.error || 'Could not dispense this prescription'),
  });
  return <Modal open onClose={onClose} title="Dispense prescription" size="md"><div className="space-y-4 p-6"><div className="rounded-lg bg-purple-50 p-3"><div className="text-sm font-semibold text-purple-950">{prescription.drugName}</div><div className="text-xs text-purple-800">{prescription.patient?.firstName} {prescription.patient?.lastName} · {[prescription.dosage,prescription.frequency,prescription.duration].filter(Boolean).join(' · ')}</div></div><div><label className="mb-1 block text-xs font-medium text-gray-700">Match to facility stock *</label><select className={field} value={form.drugCatalogueId} onChange={(event) => { const item = items.find((candidate) => candidate.id === event.target.value); setForm((current) => ({ ...current, drugCatalogueId: event.target.value, unit: item?.unitLabel || '' })); }}><option value="">Choose stock item…</option>{candidates.map((item) => <option key={item.id} value={item.id}>{item.name} {item.strength || ''} — {item.stockOnHand} {item.unitLabel || 'units'}</option>)}</select></div><div className="grid gap-3 sm:grid-cols-2"><input className={field} type="number" min="0.01" step="0.01" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} placeholder="Quantity issued *" /><input className={field} value={form.unit} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))} placeholder="Unit, e.g. tablets" /></div>{selected && <div className="text-xs text-gray-600">Available: {selected.stockOnHand} {selected.unitLabel || 'units'} · Issue value: {money.format((Number(form.quantity) || 0) * Number(selected.unitPrice))}</div>}<textarea className={field} rows={2} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder={selected?.isControlled ? 'Controlled-drug register / witness reference *' : 'Dispensing note (optional)'} /><label className="flex items-start gap-2 text-sm text-gray-700"><input type="checkbox" className="mt-1" checked={form.complete} onChange={(event) => setForm((current) => ({ ...current, complete: event.target.checked }))} /><span>Mark prescription fully dispensed <span className="block text-xs text-gray-500">Clear this for a partial fill or balance owed.</span></span></label><div className="flex gap-3"><button onClick={onClose} className="flex-1 min-h-11 rounded-lg border border-gray-300 text-sm">Cancel</button><button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.drugCatalogueId || !(Number(form.quantity) > 0)} className="flex-1 min-h-11 rounded-lg bg-[#0B1F66] text-sm font-semibold text-white disabled:opacity-40">{mutation.isPending ? 'Recording…' : 'Record dispensing'}</button></div></div></Modal>;
}

function InventoryModal({ mode, item, onClose }) {
  const qc = useQueryClient();
  const initial = item || {};
  const [form, setForm] = useState({
    name: initial.name || '', genericName: initial.genericName || '', strength: initial.strength || '', form: initial.form || '', category: initial.category || '',
    defaultRoute: initial.defaultRoute || 'ORAL', defaultDose: initial.defaultDose || '', defaultFrequency: initial.defaultFrequency || '',
    stockOnHand: initial.stockOnHand ?? 0, reorderLevel: initial.reorderLevel ?? 0, unitLabel: initial.unitLabel || '', unitPrice: Number(initial.unitPrice || 0),
    nextExpiryDate: initial.nextExpiryDate ? String(initial.nextExpiryDate).slice(0, 10) : '', isControlled: Boolean(initial.isControlled),
  });
  const mutation = useMutation({
    mutationFn: () => mode === 'create' ? api.post('/orders/pharmacy/inventory', form) : api.put(`/orders/pharmacy/inventory/${item.id}`, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pharmacy-inventory'] }); qc.invalidateQueries({ queryKey: ['pharmacy-inventory-dispense'] }); toast.success(mode === 'create' ? 'Stock item created' : 'Stock item updated'); onClose(); },
    onError: (error) => toast.error(error?.response?.data?.error || `Could not ${mode === 'create' ? 'create' : 'update'} stock item`),
  });
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  return <Modal open onClose={onClose} title={mode === 'create' ? 'Add facility stock item' : `Edit ${item.name}`} size="lg"><div className="space-y-4 p-6">
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-gray-700">Medicine name *<input className={`${field} mt-1`} value={form.name} onChange={set('name')} placeholder="e.g. Paracetamol" /></label><label className="text-xs font-medium text-gray-700">Generic name<input className={`${field} mt-1`} value={form.genericName} onChange={set('genericName')} /></label><label className="text-xs font-medium text-gray-700">Strength<input className={`${field} mt-1`} value={form.strength} onChange={set('strength')} placeholder="e.g. 500 mg" /></label><label className="text-xs font-medium text-gray-700">Dosage form<input className={`${field} mt-1`} value={form.form} onChange={set('form')} placeholder="tablet, vial, syrup…" /></label><label className="text-xs font-medium text-gray-700">Category<input className={`${field} mt-1`} value={form.category} onChange={set('category')} placeholder="Analgesic, antibiotic…" /></label><label className="text-xs font-medium text-gray-700">Default route<select className={`${field} mt-1`} value={form.defaultRoute} onChange={set('defaultRoute')}>{['ORAL','IV','IM','SC','TOPICAL','RECTAL','INHALATION','SUBLINGUAL','OTHER'].map((route) => <option key={route}>{route}</option>)}</select></label><label className="text-xs font-medium text-gray-700">Default dose<input className={`${field} mt-1`} value={form.defaultDose} onChange={set('defaultDose')} /></label><label className="text-xs font-medium text-gray-700">Default frequency<input className={`${field} mt-1`} value={form.defaultFrequency} onChange={set('defaultFrequency')} placeholder="e.g. 8-hourly" /></label></div>
    <div className="border-t border-gray-100 pt-4"><h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-500">Stock and pricing</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><label className="text-xs font-medium text-gray-700">Quantity on hand<input className={`${field} mt-1`} type="number" min="0" step="0.01" value={form.stockOnHand} onChange={set('stockOnHand')} /></label><label className="text-xs font-medium text-gray-700">Reorder level<input className={`${field} mt-1`} type="number" min="0" step="0.01" value={form.reorderLevel} onChange={set('reorderLevel')} /></label><label className="text-xs font-medium text-gray-700">Stock unit<input className={`${field} mt-1`} value={form.unitLabel} onChange={set('unitLabel')} placeholder="tablets, vials, bottles…" /></label><label className="text-xs font-medium text-gray-700">Price per unit (NGN)<input className={`${field} mt-1`} type="number" min="0" step="0.01" value={form.unitPrice} onChange={set('unitPrice')} /></label><label className="text-xs font-medium text-gray-700">Nearest expiry<input className={`${field} mt-1`} type="date" value={form.nextExpiryDate} onChange={set('nextExpiryDate')} /></label><label className="flex min-h-11 items-center gap-2 self-end rounded-lg border border-gray-200 px-3 text-sm text-gray-700"><input type="checkbox" checked={form.isControlled} onChange={set('isControlled')} />Controlled medicine</label></div></div>
    <p className="text-xs text-amber-700">Current stock and nearest expiry only. Batch tracking is not yet available.</p>
    <div className="flex gap-3"><button onClick={onClose} className="flex-1 min-h-11 rounded-lg border border-gray-300 text-sm">Cancel</button><button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.name.trim()} className="flex-1 min-h-11 rounded-lg bg-[#0B1F66] text-sm font-semibold text-white disabled:opacity-40">{mutation.isPending ? 'Saving…' : mode === 'create' ? 'Create stock item' : 'Save changes'}</button></div>
  </div></Modal>;
}

function ArchiveInventoryModal({ item, onClose }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const mutation = useMutation({
    mutationFn: () => api.delete(`/orders/pharmacy/inventory/${item.id}`, { data: { reason } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pharmacy-inventory'] }); qc.invalidateQueries({ queryKey: ['pharmacy-inventory-dispense'] }); toast.success('Stock item archived; dispensing history is preserved'); onClose(); },
    onError: (error) => toast.error(error?.response?.data?.error || 'Could not archive stock item'),
  });
  return <Modal open onClose={onClose} title={`Archive ${item.name}`} size="sm"><div className="space-y-4 p-6"><div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This removes the medicine from active stock. Past dispensing records will remain available.</div><label className="block text-xs font-medium text-gray-700">Reason *<textarea className={`${field} mt-1 py-2`} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. No longer stocked" /></label><div className="flex gap-3"><button onClick={onClose} className="flex-1 min-h-11 rounded-lg border border-gray-300 text-sm">Cancel</button><button onClick={() => mutation.mutate()} disabled={mutation.isPending || reason.trim().length < 3} className="flex-1 min-h-11 rounded-lg bg-red-700 text-sm font-semibold text-white disabled:opacity-40">{mutation.isPending ? 'Archiving…' : 'Archive item'}</button></div></div></Modal>;
}

function Loading() { return <div className="flex justify-center py-16"><Spinner size="lg" /></div>; }
function Empty({ icon: Icon, title, text }) { return <div className="rounded-xl border border-gray-200 bg-white p-10 text-center"><Icon size={28} className="mx-auto text-gray-300" /><div className="mt-3 text-sm font-semibold text-gray-800">{title}</div><p className="mt-1 text-sm text-gray-500">{text}</p></div>; }
