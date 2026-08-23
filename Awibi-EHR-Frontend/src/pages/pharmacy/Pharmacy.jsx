import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { AlertTriangle, CheckCircle2, Package, Pill, Search } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import api from '../../lib/api';
import Modal from '../../components/ui/Modal';
import Spinner from '../../components/ui/Spinner';
import { can } from '../../lib/permissions';

const field = 'w-full min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/25';
const money = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });

export default function Pharmacy() {
  const user = useSelector((state) => state.auth.user);
  const mayDispense = can(user?.role, user?.subRole, 'pharmacy_write');
  const mayEditStock = can(user?.role, user?.subRole, 'inventory_write');
  const [tab, setTab] = useState('QUEUE');
  const [status, setStatus] = useState('ACTIVE');
  const [search, setSearch] = useState('');
  const [dispensing, setDispensing] = useState(null);
  const [editing, setEditing] = useState(null);

  const queue = useQuery({
    queryKey: ['pharmacy-queue', status, search],
    queryFn: () => api.get('/orders/pharmacy/queue', { params: { status, search: search || undefined } }).then((response) => response.data),
    enabled: tab === 'QUEUE', refetchInterval: 30000,
  });
  const inventory = useQuery({
    queryKey: ['pharmacy-inventory', search],
    queryFn: () => api.get('/orders/pharmacy/inventory', { params: { search: search || undefined } }).then((response) => response.data),
    enabled: tab === 'INVENTORY',
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-bold text-gray-900">Pharmacy</h1><p className="text-sm text-gray-500">Prescription verification, dispensing, patient-linked issues and facility stock</p></div>
        <div className="flex rounded-lg border border-gray-200 bg-white p-1">
          {[['QUEUE','Prescription queue'],['INVENTORY','Inventory']].map(([key, label]) => <button key={key} onClick={() => { setTab(key); setSearch(''); }} className={`min-h-9 rounded-md px-3 text-sm font-medium ${tab === key ? 'bg-[#0B1F66] text-white' : 'text-gray-600'}`}>{label}</button>)}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Awaiting dispensing" value={queue.data?.total ?? '—'} tone="bg-purple-600" icon={Pill} />
        <Metric label="Formulary items" value={inventory.data?.counts?.total ?? '—'} tone="bg-[#0B1F66]" icon={Package} />
        <Metric label="Low stock" value={inventory.data?.counts?.lowStock ?? '—'} tone="bg-orange-500" icon={AlertTriangle} />
        <Metric label="Expiring ≤90 days" value={inventory.data?.counts?.expiringSoon ?? '—'} tone="bg-red-500" icon={AlertTriangle} />
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-3 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input className={`${field} pl-9`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tab === 'QUEUE' ? 'Search patient, Hosp No or medicine…' : 'Search medicine, generic name or category…'} /></div>
        {tab === 'QUEUE' && <select className={`${field} sm:w-48`} value={status} onChange={(event) => setStatus(event.target.value)}><option value="ACTIVE">Awaiting / active</option><option value="COMPLETED">Dispensed</option><option value="CANCELLED">Cancelled</option><option value="ALL">All</option></select>}
      </section>

      {tab === 'QUEUE'
        ? <PrescriptionQueue data={queue.data} loading={queue.isLoading} mayDispense={mayDispense} onDispense={setDispensing} />
        : <Inventory data={inventory.data} loading={inventory.isLoading} mayEdit={mayEditStock} onEdit={setEditing} />}

      {dispensing && <DispenseModal prescription={dispensing} inventory={inventory.data?.items} onClose={() => setDispensing(null)} />}
      {editing && <InventoryModal item={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Metric({ label, value, tone, icon: Icon }) { return <div className={`${tone} rounded-xl p-4 text-white`}><div className="flex items-center justify-between"><div className="text-2xl font-extrabold">{value}</div><Icon size={19} className="opacity-80" /></div><div className="mt-1 text-xs opacity-85">{label}</div></div>; }

function PrescriptionQueue({ data, loading, mayDispense, onDispense }) {
  if (loading) return <Loading />;
  const rows = data?.prescriptions || [];
  if (!rows.length) return <Empty icon={CheckCircle2} title="No prescriptions in this queue" text="New doctor prescriptions will appear here automatically." />;
  return <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white"><table className="w-full min-w-[980px] text-sm"><thead className="border-b border-gray-200 bg-gray-50"><tr>{['Patient','Medicine','Directions','Prescriber','Ordered','Dispensing',''].map((title) => <th key={title} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">{rows.map((rx) => <tr key={rx.id} className="hover:bg-gray-50/60"><td className="px-4 py-3"><div className="font-medium text-gray-900">{rx.patient?.firstName} {rx.patient?.lastName}</div><div className="text-xs text-gray-500">{rx.patient?.mrn || rx.patient?.universalPatientId}</div></td><td className="px-4 py-3"><div className="font-medium text-gray-900">{rx.drugName}</div><div className="text-xs text-gray-500">{rx.route || '—'}</div></td><td className="px-4 py-3 text-gray-700">{[rx.dosage, rx.frequency, rx.duration].filter(Boolean).join(' · ') || 'Not stated'}{rx.instructions && <div className="mt-1 text-xs text-gray-500">{rx.instructions}</div>}</td><td className="px-4 py-3 text-gray-600">{rx.prescribedBy ? `${rx.prescribedBy.firstName} ${rx.prescribedBy.lastName}` : 'Not recorded'}</td><td className="px-4 py-3 text-xs text-gray-500">{format(new Date(rx.createdAt), 'dd MMM yyyy · HH:mm')}</td><td className="px-4 py-3">{rx.dispenses?.length ? <div><span className="font-medium text-green-700">{rx.dispenses.reduce((sum, item) => sum + item.quantity, 0)} issued</span><div className="text-xs text-gray-500">{money.format(rx.dispenses.reduce((sum, item) => sum + Number(item.amount), 0))}</div></div> : <span className="text-xs text-orange-700">Awaiting pharmacy</span>}</td><td className="px-4 py-3">{mayDispense && rx.status !== 'CANCELLED' && <button onClick={() => onDispense(rx)} className="min-h-10 rounded-lg bg-[#0B1F66] px-3 text-xs font-semibold text-white">{rx.status === 'COMPLETED' ? 'Issue again / balance' : 'Dispense'}</button>}</td></tr>)}</tbody></table></div>;
}

function Inventory({ data, loading, mayEdit, onEdit }) {
  if (loading) return <Loading />;
  const rows = data?.items || [];
  if (!rows.length) return <Empty icon={Package} title="No medicines in the formulary" text="A facility administrator can seed or add the hospital formulary before dispensing." />;
  return <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white"><table className="w-full min-w-[900px] text-sm"><thead className="border-b border-gray-200 bg-gray-50"><tr>{['Medicine','Category','Available','Reorder at','Price','Expiry',''].map((title) => <th key={title} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">{rows.map((item) => { const low = item.stockOnHand <= item.reorderLevel; const expiring = item.nextExpiryDate && new Date(item.nextExpiryDate).getTime() <= Date.now() + 90 * 86400000; return <tr key={item.id} className={low ? 'bg-orange-50/40' : ''}><td className="px-4 py-3"><div className="font-medium text-gray-900">{item.name} {item.strength || ''}</div><div className="text-xs text-gray-500">{item.genericName || item.form || ''}{item.isControlled ? ' · Controlled' : ''}</div></td><td className="px-4 py-3 text-gray-600">{item.category || '—'}</td><td className={`px-4 py-3 font-semibold ${low ? 'text-orange-700' : 'text-green-700'}`}>{item.stockOnHand} {item.unitLabel || 'units'}{low && <div className="text-xs font-normal">Low stock</div>}</td><td className="px-4 py-3 text-gray-600">{item.reorderLevel}</td><td className="px-4 py-3 text-gray-600">{money.format(Number(item.unitPrice))}</td><td className={`px-4 py-3 ${expiring ? 'font-medium text-red-700' : 'text-gray-600'}`}>{item.nextExpiryDate ? format(new Date(item.nextExpiryDate), 'dd MMM yyyy') : 'Not entered'}</td><td className="px-4 py-3">{mayEdit && <button onClick={() => onEdit(item)} className="min-h-10 rounded-lg border border-gray-300 px-3 text-xs font-semibold text-gray-700">Update stock</button>}</td></tr>; })}</tbody></table></div>;
}

function DispenseModal({ prescription, inventory: initialInventory, onClose }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['pharmacy-inventory', ''], queryFn: () => api.get('/orders/pharmacy/inventory').then((response) => response.data), enabled: !initialInventory });
  const items = initialInventory || data?.items || [];
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

function InventoryModal({ item, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ stockOnHand: item.stockOnHand, reorderLevel: item.reorderLevel, unitLabel: item.unitLabel || '', unitPrice: Number(item.unitPrice), nextExpiryDate: item.nextExpiryDate ? String(item.nextExpiryDate).slice(0, 10) : '' });
  const mutation = useMutation({ mutationFn: () => api.put(`/orders/pharmacy/inventory/${item.id}`, form).then((response) => response.data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['pharmacy-inventory'] }); toast.success('Inventory updated'); onClose(); }, onError: (error) => toast.error(error?.response?.data?.error || 'Could not update stock') });
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return <Modal open onClose={onClose} title={`Update ${item.name}`} size="sm"><div className="space-y-3 p-6"><div className="grid grid-cols-2 gap-3"><label className="text-xs font-medium text-gray-700">Quantity on hand<input className={`${field} mt-1`} type="number" min="0" step="0.01" value={form.stockOnHand} onChange={set('stockOnHand')} /></label><label className="text-xs font-medium text-gray-700">Reorder level<input className={`${field} mt-1`} type="number" min="0" step="0.01" value={form.reorderLevel} onChange={set('reorderLevel')} /></label></div><label className="block text-xs font-medium text-gray-700">Stock unit<input className={`${field} mt-1`} value={form.unitLabel} onChange={set('unitLabel')} placeholder="tablets, vials, bottles…" /></label><label className="block text-xs font-medium text-gray-700">Selling price per unit (NGN)<input className={`${field} mt-1`} type="number" min="0" step="0.01" value={form.unitPrice} onChange={set('unitPrice')} /></label><label className="block text-xs font-medium text-gray-700">Nearest expiry date<input className={`${field} mt-1`} type="date" value={form.nextExpiryDate} onChange={set('nextExpiryDate')} /></label><p className="text-xs text-amber-700">For beta use this records the nearest expiry. Production batch/lot and FEFO stock movements remain a separate controlled rollout.</p><div className="flex gap-3"><button onClick={onClose} className="flex-1 min-h-11 rounded-lg border border-gray-300 text-sm">Cancel</button><button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="flex-1 min-h-11 rounded-lg bg-[#0B1F66] text-sm font-semibold text-white disabled:opacity-40">{mutation.isPending ? 'Saving…' : 'Save stock'}</button></div></div></Modal>;
}

function Loading() { return <div className="flex justify-center py-16"><Spinner size="lg" /></div>; }
function Empty({ icon: Icon, title, text }) { return <div className="rounded-xl border border-gray-200 bg-white p-10 text-center"><Icon size={28} className="mx-auto text-gray-300" /><div className="mt-3 text-sm font-semibold text-gray-800">{title}</div><p className="mt-1 text-sm text-gray-500">{text}</p></div>; }
