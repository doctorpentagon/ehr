import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, AlertTriangle, Check, X, Pause, Play, Search } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { useSelector } from 'react-redux';
import api from '../../lib/api';
import Spinner from '../../components/ui/Spinner';
import { can } from '../../lib/permissions';

/**
 * Standing orders: what was instructed, and whether it is actually happening.
 *
 * The task worklist answers "what is due now". This answers the ward-round
 * question — a Q2H turn order looks the same on a task list whether it ran
 * twelve times or once, and only the execution count tells them apart.
 */

const ORDER_TYPES = ['MEDICATION', 'NURSING', 'DIET', 'ACTIVITY', 'TREATMENT', 'LAB', 'IMAGING'];

// Common nursing instructions, so the frequent case is two taps rather than typing.
const COMMON_NURSING = [
  { name: 'Turn and reposition', frequencyHours: 2, goal: 'Prevent pressure ulcer' },
  { name: 'Elevate affected limb', frequencyHours: null, goal: 'Reduce swelling' },
  { name: 'Head of bed 30°', frequencyHours: null, goal: 'Reduce aspiration risk' },
  { name: 'Measure urine output', frequencyHours: 1, goal: 'Monitor renal function' },
  { name: 'Measure abdominal girth', frequencyHours: 24, goal: 'Monitor distension' },
  { name: 'Chest physiotherapy', frequencyHours: 8, goal: 'Prevent atelectasis' },
  { name: 'Mouth care', frequencyHours: 4, goal: 'Prevent oral infection' },
  { name: 'Pressure area check', frequencyHours: 4, goal: 'Prevent pressure ulcer' },
];

function OrderForm({ patients, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    patientId: '', type: 'NURSING', name: '', goal: '',
    frequencyHours: '', priority: 'ROUTINE', instructions: '',
  });
  const [patientQuery, setPatientQuery] = useState('');

  // Typing beats scrolling once a ward has more than a handful of patients.
  const matches = useMemo(() => {
    const q = patientQuery.trim().toLowerCase();
    if (!q) return patients.slice(0, 8);
    return patients.filter((p) =>
      `${p.firstName} ${p.lastName}`.toLowerCase().includes(q) || (p.mrn || '').toLowerCase().includes(q),
    ).slice(0, 8);
  }, [patients, patientQuery]);

  const selected = patients.find((p) => p.id === form.patientId);

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post('/orders/standing', {
      ...form,
      frequencyHours: form.frequencyHours === '' ? null : Number(form.frequencyHours),
    }).then((r) => r.data),
    onSuccess: (order) => {
      qc.invalidateQueries({ queryKey: ['standing-orders'] });
      toast.success('Order placed');
      if (order.suggestedMonitoringSheet) {
        toast.info(order.suggestedMonitoringSheet.reason, { duration: 7000 });
      }
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not place the order'),
  });

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-900 mb-4">New order</h3>

        <label className="block text-sm font-medium text-gray-700 mb-1">Patient</label>
        {selected ? (
          <div className="flex items-center justify-between border border-gray-300 px-3 py-2 mb-3">
            <span className="text-sm text-gray-900">
              {selected.firstName} {selected.lastName}
              <span className="text-gray-500 ml-2 text-xs">{selected.mrn}</span>
            </span>
            <button onClick={() => { setForm((f) => ({ ...f, patientId: '' })); setPatientQuery(''); }}
              className="text-gray-400 hover:text-gray-700"><X size={15} /></button>
          </div>
        ) : (
          <div className="mb-3">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={patientQuery} onChange={(e) => setPatientQuery(e.target.value)}
                placeholder="Type a name or hospital number"
                className="w-full border border-gray-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-gray-500"
              />
            </div>
            {matches.length > 0 && (
              <ul className="border border-t-0 border-gray-300 max-h-44 overflow-y-auto">
                {matches.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => setForm((f) => ({ ...f, patientId: p.id }))}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      {p.firstName} {p.lastName}
                      <span className="text-gray-500 ml-2 text-xs">{p.mrn}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
        <select value={form.type} onChange={set('type')}
          className="w-full border border-gray-300 px-3 py-2 text-sm mb-3 focus:outline-none focus:border-gray-500">
          {ORDER_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}
        </select>

        {form.type === 'NURSING' && (
          <div className="mb-3">
            <div className="text-xs text-gray-500 mb-1.5">Common instructions</div>
            <div className="flex flex-wrap gap-1.5">
              {COMMON_NURSING.map((c) => (
                <button
                  key={c.name}
                  onClick={() => setForm((f) => ({
                    ...f, name: c.name, goal: c.goal,
                    frequencyHours: c.frequencyHours == null ? '' : String(c.frequencyHours),
                  }))}
                  className="px-2 py-1 text-xs border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="block text-sm font-medium text-gray-700 mb-1">Order</label>
        <input value={form.name} onChange={set('name')} placeholder="e.g. Turn and reposition"
          className="w-full border border-gray-300 px-3 py-2 text-sm mb-3 focus:outline-none focus:border-gray-500" />

        <label className="block text-sm font-medium text-gray-700 mb-1">
          Goal <span className="font-normal text-gray-500">— why this is being ordered</span>
        </label>
        <input value={form.goal} onChange={set('goal')} placeholder="e.g. Prevent pressure ulcer"
          className="w-full border border-gray-300 px-3 py-2 text-sm mb-3 focus:outline-none focus:border-gray-500" />

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Every (hours)</label>
            <input type="number" min="0" step="0.5" value={form.frequencyHours} onChange={set('frequencyHours')}
              placeholder="blank = once"
              className="w-full border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-gray-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
            <select value={form.priority} onChange={set('priority')}
              className="w-full border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-gray-500">
              {['ROUTINE', 'URGENT', 'STAT'].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        <label className="block text-sm font-medium text-gray-700 mb-1">Instructions (optional)</label>
        <textarea value={form.instructions} onChange={set('instructions')} rows={2}
          className="w-full border border-gray-300 px-3 py-2 text-sm mb-4 focus:outline-none focus:border-gray-500" />

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 border border-gray-300">Cancel</button>
          <button onClick={() => mutate()} disabled={isPending || !form.patientId || !form.name.trim()}
            className="px-4 py-2 text-sm bg-gray-900 text-white disabled:opacity-50">
            {isPending ? 'Placing…' : 'Place order'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ExecuteDialog({ order, onClose }) {
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState('DONE');
  const [result, setResult] = useState('');
  const [reason, setReason] = useState('');

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post(`/orders/standing/${order.id}/execute`, { outcome, result, reason }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['standing-orders'] });
      toast.success(outcome === 'DONE' ? 'Recorded' : 'Recorded with a reason');
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not record it'),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-md max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-900">{order.name}</h3>
        {order.goal && <p className="text-xs text-gray-500 mt-0.5">{order.goal}</p>}
        {order.instructions && <p className="text-sm text-gray-700 mt-2">{order.instructions}</p>}

        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            ['DONE', 'Done', 'border-green-600 bg-green-50 text-green-800'],
            ['SKIPPED', 'Skipped', 'border-amber-600 bg-amber-50 text-amber-800'],
            ['UNABLE', 'Unable', 'border-red-600 bg-red-50 text-red-800'],
          ].map(([value, label, active]) => (
            <button
              key={value} onClick={() => setOutcome(value)}
              className={`py-3 text-sm font-medium border ${outcome === value ? active : 'border-gray-300 text-gray-700'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {outcome === 'DONE' ? (
          <textarea
            value={result} onChange={(e) => setResult(e.target.value)} rows={3}
            placeholder="What was done or found, e.g. Turned to left side, skin intact"
            className="mt-3 w-full border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-gray-500"
          />
        ) : (
          <>
            {/* A recorded skip is a clinical fact. One that simply never appears
                is a hole nobody can explain later, so the reason is required. */}
            <textarea
              value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
              placeholder="Why was it not carried out? e.g. Patient in theatre"
              className="mt-3 w-full border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-gray-500"
            />
            <p className="text-xs text-gray-500 mt-1">A reason is required so the record explains itself later.</p>
          </>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 border border-gray-300">Cancel</button>
          <button
            onClick={() => mutate()}
            disabled={isPending || (outcome !== 'DONE' && reason.trim().length < 3)}
            className="px-4 py-2 text-sm bg-gray-900 text-white disabled:opacity-50"
          >
            {isPending ? 'Recording…' : 'Record'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Orders() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [executing, setExecuting] = useState(null);
  const [overdueOnly, setOverdueOnly] = useState(false);

  const user = useSelector((s) => s.auth?.user);
  const mayOrder = can(user?.role, user?.subRole, 'prescriptions_write');
  const mayExecute = can(user?.role, user?.subRole, 'drug_admin_write');

  const { data, isLoading } = useQuery({
    queryKey: ['standing-orders', overdueOnly],
    queryFn: () => api.get(`/orders/standing?status=ACTIVE${overdueOnly ? '&overdueOnly=true' : ''}`).then((r) => r.data),
    refetchInterval: 60_000,
  });

  const { data: patients } = useQuery({
    queryKey: ['patients-for-orders'],
    queryFn: () => api.get('/patients?limit=200').then((r) => r.data?.patients || []),
    enabled: mayOrder,
  });

  const { mutate: setStatus } = useMutation({
    mutationFn: ({ id, status, reason }) => api.put(`/orders/standing/${id}/status`, { status, reason }).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['standing-orders'] }); toast.success('Order updated'); },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not update the order'),
  });

  if (isLoading) return <div className="py-16 flex justify-center"><Spinner size="lg" /></div>;

  const orders = data?.orders || [];
  const counts = data?.counts || {};

  // Grouped by patient, because a nurse works a bay at a time, not an order list.
  const byPatient = orders.reduce((acc, o) => {
    const key = o.patient?.id || 'unknown';
    (acc[key] ||= { patient: o.patient, orders: [] }).orders.push(o);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Standing orders</h1>
          <p className="text-sm text-gray-500">
            {counts.total || 0} active
            {counts.overdue > 0 && <span className="text-red-700 font-medium"> · {counts.overdue} overdue</span>}
            {counts.held > 0 && <span className="text-amber-700"> · {counts.held} on hold</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOverdueOnly((v) => !v)}
            className={`px-3 py-2 text-sm border ${overdueOnly ? 'bg-red-50 border-red-300 text-red-800' : 'border-gray-300 text-gray-700'}`}
          >
            Overdue only
          </button>
          {mayOrder && (
            <button onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm">
              <Plus size={16} /> New order
            </button>
          )}
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="border border-gray-200 bg-white p-10 text-center">
          <p className="text-sm text-gray-500">
            {overdueOnly ? 'Nothing is overdue.' : 'No active standing orders.'}
          </p>
        </div>
      ) : (
        Object.values(byPatient).map(({ patient, orders: list }) => (
          <section key={patient?.id || 'unknown'} className="border border-gray-200 bg-white">
            <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50">
              <h2 className="text-sm font-semibold text-gray-900">
                {patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown patient'}
                {patient?.mrn && <span className="ml-2 text-xs font-normal text-gray-500">{patient.mrn}</span>}
              </h2>
            </div>
            <ul className="divide-y divide-gray-100">
              {list.map((o) => (
                <li key={o.id} className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-900">{o.name}</span>
                      {o.priority !== 'ROUTINE' && (
                        <span className={`text-xs px-1.5 py-0.5 font-medium ${o.priority === 'STAT' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                          {o.priority}
                        </span>
                      )}
                      {o.isOverdue && (
                        <span className="flex items-center gap-1 text-xs text-red-700 font-medium">
                          <AlertTriangle size={12} /> {o.hoursLate}h late
                        </span>
                      )}
                      {o.status === 'HELD' && <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-800 font-medium">HELD</span>}
                    </div>
                    {o.goal && <div className="text-xs text-gray-500 mt-0.5">{o.goal}</div>}
                    <div className="text-xs text-gray-600 mt-1">
                      {o.frequencyHours ? `Every ${o.frequencyHours}h` : 'Once'}
                      {' · '}
                      {o.completedCount} carried out
                      {o.missedCount > 0 && <span className="text-amber-700"> · {o.missedCount} missed</span>}
                      {o.lastExecutedAt && ` · last ${formatDistanceToNow(new Date(o.lastExecutedAt), { addSuffix: true })}`}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {mayExecute && o.status === 'ACTIVE' && (
                      <button onClick={() => setExecuting(o)}
                        className="flex items-center gap-1.5 px-3 py-2 bg-gray-900 text-white text-sm">
                        <Check size={15} /> Record
                      </button>
                    )}
                    {mayOrder && (
                      <>
                        <button
                          onClick={() => setStatus({ id: o.id, status: o.status === 'HELD' ? 'ACTIVE' : 'HELD' })}
                          title={o.status === 'HELD' ? 'Resume' : 'Hold'}
                          className="p-2 border border-gray-300 text-gray-600 hover:bg-gray-50"
                        >
                          {o.status === 'HELD' ? <Play size={15} /> : <Pause size={15} />}
                        </button>
                        <button
                          onClick={() => {
                            const reason = window.prompt('Why is this order being stopped?');
                            if (reason && reason.trim().length >= 3) setStatus({ id: o.id, status: 'DISCONTINUED', reason });
                            else if (reason !== null) toast.error('Give a reason for stopping the order');
                          }}
                          title="Stop"
                          className="p-2 border border-gray-300 text-gray-600 hover:bg-gray-50"
                        >
                          <X size={15} />
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {showForm && <OrderForm patients={patients || []} onClose={() => setShowForm(false)} />}
      {executing && <ExecuteDialog order={executing} onClose={() => setExecuting(null)} />}
    </div>
  );
}
