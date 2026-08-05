import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, AlertTriangle, X, Check, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import api from '../../lib/api';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';

const STATUS_STYLES = {
  PENDING:     'bg-amber-50 text-amber-800 border-amber-200',
  CONFIRMED:   'bg-green-50 text-green-700 border-green-200',
  REJECTED:    'bg-red-50 text-red-700 border-red-200',
  RESCHEDULED: 'bg-blue-50 text-blue-700 border-blue-200',
  CANCELLED:   'bg-gray-100 text-gray-600 border-gray-200',
};

function DecisionModal({ booking, action, onClose }) {
  const qc = useQueryClient();
  const [when, setWhen] = useState(booking ? new Date(booking.requestedAt).toISOString().slice(0, 16) : '');
  const [note, setNote] = useState('');

  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      if (action === 'confirm') return api.post(`/bookings/${booking.id}/confirm`, { scheduledAt: new Date(when).toISOString(), note }).then(r => r.data);
      if (action === 'reject') return api.post(`/bookings/${booking.id}/reject`, { reason: note }).then(r => r.data);
      return api.post(`/bookings/${booking.id}/reschedule`, { requestedAt: new Date(when).toISOString(), note }).then(r => r.data);
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      qc.invalidateQueries({ queryKey: ['booking-stats'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      toast.success(d?.message || 'Booking updated');
      setNote(''); onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not update the booking'),
  });

  if (!booking) return null;
  const title = action === 'confirm' ? 'Confirm appointment' : action === 'reject' ? 'Reject request' : 'Propose a new time';
  const reasonRequired = action === 'reject';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="border-b border-gray-200 px-5 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 flex items-center justify-center rounded-lg hover:bg-gray-100"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-gray-50 rounded-lg p-3 text-sm">
            <p className="font-medium text-gray-900">{booking.fullName}</p>
            <p className="text-gray-600">{booking.phone}{booking.email ? ` · ${booking.email}` : ''}</p>
            {booking.isNewPatient && <p className="text-xs text-amber-700 mt-1">New patient — a provisional record will be created.</p>}
          </div>

          {action !== 'reject' && (
            <div>
              <label htmlFor="bk-when" className="block text-sm font-medium text-gray-700 mb-1.5">Appointment time</label>
              <input id="bk-when" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)}
                className="w-full min-h-12 px-3 border border-gray-300 rounded-lg text-sm" />
            </div>
          )}

          <div>
            <label htmlFor="bk-note" className="block text-sm font-medium text-gray-700 mb-1.5">
              {reasonRequired ? 'Reason (required — the patient will be told)' : 'Note'}
            </label>
            <textarea id="bk-note" rows={2} value={note} onChange={e => setNote(e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg text-sm ${reasonRequired && !note ? 'border-red-300' : 'border-gray-300'}`} />
          </div>
        </div>
        <div className="border-t border-gray-200 px-5 py-3 flex gap-3">
          <button onClick={onClose} className="flex-1 min-h-12 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutate()} disabled={isPending || (reasonRequired && !note.trim())}
            className={`flex-1 min-h-12 text-white rounded-lg text-sm font-medium disabled:opacity-50 ${action === 'reject' ? 'bg-red-600 hover:bg-red-700' : 'bg-[#2D5BFF] hover:bg-[#1a45e0]'}`}>
            {isPending ? 'Saving…' : title}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Bookings() {
  const [status, setStatus] = useState('PENDING');
  const [decision, setDecision] = useState({ booking: null, action: null });

  const { data: stats } = useQuery({
    queryKey: ['booking-stats'],
    queryFn: () => api.get('/bookings/stats').then(r => r.data),
    refetchInterval: 30000,
  });
  const { data, isLoading } = useQuery({
    queryKey: ['bookings', status],
    queryFn: () => api.get('/bookings', { params: { status } }).then(r => r.data),
    refetchInterval: 30000,
  });

  const requests = data?.requests || [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Booking requests</h1>
        <p className="text-sm text-gray-500">Appointment requests from the public clinic page</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500">Pending</p>
          <p className="text-2xl font-bold text-gray-900">{stats?.pending ?? 0}</p>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-200 p-4">
          <p className="text-xs font-medium text-red-700">Routed to emergency</p>
          <p className="text-2xl font-bold text-red-800">{stats?.emergencyRouted ?? 0}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500">For today</p>
          <p className="text-2xl font-bold text-gray-900">{stats?.forToday ?? 0}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-3 flex gap-2 overflow-x-auto">
        {['PENDING', 'CONFIRMED', 'REJECTED', 'ALL'].map(s => (
          <button key={s} onClick={() => setStatus(s)} aria-pressed={status === s}
            className={`px-4 min-h-11 rounded-lg border text-sm font-medium whitespace-nowrap ${
              status === s ? 'border-[#2D5BFF] bg-[#2D5BFF]/5 text-[#2D5BFF]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}>
            {s[0] + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="py-16 flex justify-center"><Spinner size="lg" /></div>
        ) : !requests.length ? (
          <EmptyState icon={CalendarCheck} title="No booking requests"
            description="Requests submitted from your public clinic page land here for confirmation." />
        ) : (
          <div className="divide-y divide-gray-100">
            {requests.map(b => (
              <div key={b.id} className={`p-4 ${b.routing === 'EMERGENCY' ? 'bg-red-50/50' : ''}`}>
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-gray-900">{b.fullName}</span>
                      <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${STATUS_STYLES[b.status]}`}>{b.status}</span>
                      {b.isNewPatient && <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-medium">new patient</span>}
                      {b.routing === 'EMERGENCY' && (
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-red-600 text-white rounded text-xs font-bold">
                          <AlertTriangle size={11} /> ROUTED TO EMERGENCY
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      {b.phone}{b.email ? ` · ${b.email}` : ''}
                      <span className="ml-2 font-mono text-xs text-gray-400">{b.reference}</span>
                    </p>
                    <p className="text-sm text-gray-700 mt-1 flex items-center gap-1.5">
                      <Clock size={13} className="text-gray-400" />
                      {format(new Date(b.requestedAt), 'EEE dd MMM yyyy, HH:mm')}
                      {b.doctor && <span className="text-gray-500">· Dr. {b.doctor.firstName} {b.doctor.lastName}</span>}
                    </p>
                    {b.reason && <p className="text-sm text-gray-600 mt-1">{b.reason}</p>}
                    {b.symptomSummary && (
                      <div className="mt-2 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                        <span className="font-medium text-gray-700">Symptom check:</span> {b.symptomSummary}
                        {b.severity != null && <span className="text-gray-500"> · severity {b.severity}/10</span>}
                        {Array.isArray(b.redFlags) && b.redFlags.length > 0 && (
                          <span className="text-red-700 font-medium"> · {b.redFlags.length} red flag(s)</span>
                        )}
                      </div>
                    )}
                    {b.decisionNote && <p className="text-xs text-gray-500 mt-1.5 italic">{b.decisionNote}</p>}
                  </div>

                  {b.status === 'PENDING' && (
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => setDecision({ booking: b, action: 'confirm' })}
                        className="flex items-center gap-1.5 px-3 min-h-11 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
                        <Check size={15} /> Confirm
                      </button>
                      <button onClick={() => setDecision({ booking: b, action: 'reschedule' })}
                        className="px-3 min-h-11 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">
                        Reschedule
                      </button>
                      <button onClick={() => setDecision({ booking: b, action: 'reject' })}
                        className="px-3 min-h-11 border border-red-300 text-red-700 rounded-lg text-sm font-medium hover:bg-red-50">
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <DecisionModal booking={decision.booking} action={decision.action}
        onClose={() => setDecision({ booking: null, action: null })} />
    </div>
  );
}
