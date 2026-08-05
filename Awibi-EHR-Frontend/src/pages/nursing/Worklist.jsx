import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Pill, FlaskConical, Check, AlertTriangle, X } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { useSelector } from 'react-redux';
import api from '../../lib/api';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import { can } from '../../lib/permissions';

const PRIORITY = {
  STAT:    'bg-red-100 text-red-800 border-red-200',
  URGENT:  'bg-amber-100 text-amber-800 border-amber-200',
  ROUTINE: 'bg-gray-100 text-gray-600 border-gray-200',
};

function CompleteTaskModal({ task, onClose }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post(`/orders/nursing-tasks/${task.id}/complete`, { note }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nurse-worklist'] });
      toast.success(task.frequencyHours ? 'Task completed — next occurrence scheduled' : 'Task completed');
      setNote(''); onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not complete the task'),
  });

  if (!task) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="border-b border-gray-200 px-5 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Complete task</h2>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 flex items-center justify-center rounded-lg hover:bg-gray-100"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm font-medium text-gray-900">{task.title}</p>
          {task.instructions && <p className="text-sm text-gray-600">{task.instructions}</p>}
          {task.frequencyHours && (
            <p className="text-xs text-[#2D5BFF] bg-[#2D5BFF]/5 rounded-lg px-3 py-2">
              Recurring every {task.frequencyHours}h — completing this schedules the next one automatically.
            </p>
          )}
          <div>
            <label htmlFor="ct-note" className="block text-sm font-medium text-gray-700 mb-1.5">Note</label>
            <textarea id="ct-note" rows={3} value={note} onChange={e => setNote(e.target.value)}
              placeholder="What you observed or did"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>
        <div className="border-t border-gray-200 px-5 py-3 flex gap-3">
          <button onClick={onClose} className="flex-1 min-h-12 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutate()} disabled={isPending}
            className="flex-1 min-h-12 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
            {isPending ? 'Saving…' : 'Mark done'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Worklist() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('TASKS');
  const [completing, setCompleting] = useState(null);
  const user = useSelector(s => s.auth?.user);
  const mayExecute = can(user?.role, user?.subRole, 'drug_admin_write');

  const { data, isLoading } = useQuery({
    queryKey: ['nurse-worklist'],
    queryFn: () => api.get('/orders/worklist').then(r => r.data),
    // Polling keeps a new doctor's order visible without a page refresh.
    refetchInterval: 15000,
  });

  const { mutate: collect } = useMutation({
    mutationFn: (id) => api.post(`/lab/${id}/status`, { status: 'COLLECTED' }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nurse-worklist'] }); toast.success('Specimen marked collected'); },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not update'),
  });

  const counts = data?.counts || {};
  const TABS = [
    { key: 'TASKS', label: 'Nursing tasks', count: counts.tasks, Icon: ListChecks },
    { key: 'MEDS', label: 'Medications', count: counts.medications, Icon: Pill },
    { key: 'SPECIMENS', label: 'Specimens', count: counts.specimens, Icon: FlaskConical },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Orders &amp; tasks</h1>
        <p className="text-sm text-gray-500">What the ward needs done right now</p>
      </div>

      {counts.overdueTasks > 0 && (
        <div className="flex items-center gap-2 bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3">
          <AlertTriangle size={18} className="text-red-600 shrink-0" />
          <span className="text-sm font-semibold text-red-900">
            {counts.overdueTasks} task{counts.overdueTasks === 1 ? '' : 's'} overdue
          </span>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="border-b border-gray-100 flex overflow-x-auto">
          {TABS.map(({ key, label, count, Icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap ${
                tab === key ? 'border-[#2D5BFF] text-[#2D5BFF]' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              <Icon size={15} /> {label}
              {count > 0 && <span className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">{count}</span>}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="py-16 flex justify-center"><Spinner size="lg" /></div>
        ) : tab === 'TASKS' ? (
          !data?.tasks?.length ? (
            <EmptyState icon={ListChecks} title="No outstanding tasks" description="Doctor's nursing orders appear here as soon as they are written." />
          ) : (
            <div className="divide-y divide-gray-100">
              {data.tasks.map(t => (
                <div key={t.id} className={`p-4 ${t.isOverdue ? 'bg-red-50/50' : ''}`}>
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`px-2 py-0.5 rounded border text-xs font-medium ${PRIORITY[t.priority]}`}>{t.priority}</span>
                        <span className="font-medium text-gray-900">{t.title}</span>
                        {t.isOverdue && <span className="text-xs font-bold text-red-700">OVERDUE</span>}
                      </div>
                      <p className="text-sm text-gray-600 mt-1">
                        {t.patient?.firstName} {t.patient?.lastName}
                        <span className="ml-2 font-mono text-xs text-[#2D5BFF]">{t.patient?.universalPatientId}</span>
                      </p>
                      {t.instructions && <p className="text-sm text-gray-500 mt-1">{t.instructions}</p>}
                      {t.dueAt && (
                        <p className="text-xs text-gray-400 mt-1">
                          due {format(new Date(t.dueAt), 'dd MMM HH:mm')}
                          {t.frequencyHours ? ` · every ${t.frequencyHours}h` : ''}
                        </p>
                      )}
                    </div>
                    {mayExecute && (
                      <button onClick={() => setCompleting(t)}
                        className="flex items-center justify-center gap-1.5 px-4 min-h-11 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 shrink-0">
                        <Check size={15} /> Done
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : tab === 'MEDS' ? (
          !data?.medications?.length ? (
            <EmptyState icon={Pill} title="No active medications" description="Active prescriptions across the facility appear here." />
          ) : (
            <div className="divide-y divide-gray-100">
              {data.medications.map(m => (
                <div key={m.id} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-medium text-gray-900">{m.drugName}</span>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {[m.dosage, m.frequency, m.route].filter(Boolean).join(' · ')}
                      </p>
                      <p className="text-sm text-gray-600 mt-1">
                        {m.patient?.firstName} {m.patient?.lastName}
                        <span className="ml-2 font-mono text-xs text-[#2D5BFF]">{m.patient?.universalPatientId}</span>
                      </p>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${m.givenToday > 0 ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                      {m.givenToday} given today
                    </span>
                  </div>
                </div>
              ))}
              <div className="p-4 bg-gray-50 text-xs text-gray-500">
                Record each dose from the <strong>Drug chart</strong> so the balance and missed doses stay accurate.
              </div>
            </div>
          )
        ) : (
          !data?.specimensToCollect?.length ? (
            <EmptyState icon={FlaskConical} title="No specimens waiting" description="Investigations awaiting collection appear here." />
          ) : (
            <div className="divide-y divide-gray-100">
              {data.specimensToCollect.map(s => (
                <div key={s.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900">{s.testName}</span>
                      <span className={`px-2 py-0.5 rounded border text-xs font-medium ${PRIORITY[s.priority] || PRIORITY.ROUTINE}`}>{s.priority}</span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      {s.patient?.firstName} {s.patient?.lastName}
                      <span className="ml-2 font-mono text-xs text-[#2D5BFF]">{s.patient?.universalPatientId}</span>
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      ordered {formatDistanceToNow(new Date(s.createdAt))} ago
                      {s.specimenType ? ` · ${s.specimenType}` : ''}
                    </p>
                  </div>
                  {mayExecute && (
                    <button onClick={() => collect(s.id)}
                      className="px-4 min-h-11 border border-[#2D5BFF] text-[#2D5BFF] rounded-lg text-sm font-medium hover:bg-[#2D5BFF]/5 shrink-0">
                      Mark collected
                    </button>
                  )}
                </div>
              ))}
            </div>
          )
        )}
      </div>

      <CompleteTaskModal task={completing} onClose={() => setCompleting(null)} />
    </div>
  );
}
