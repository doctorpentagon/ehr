import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, Clock, MessageSquare, Check } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { useSelector } from 'react-redux';
import api from '../../lib/api';
import Spinner from '../../components/ui/Spinner';
import { can } from '../../lib/permissions';
import MonitoringChart from '../../components/clinical/MonitoringChart';

/**
 * Everything the nursing team has done for one patient, on one screen.
 *
 * A ward round gives roughly a minute per patient. Before this, answering "is the
 * plan actually being carried out" meant opening the monitoring module, then the
 * task list, then each sheet — so it went unchecked. What matters first is at the
 * top; the charts are below it.
 */

const WINDOWS = [
  { hours: 24, label: '24 hours' },
  { hours: 48, label: '48 hours' },
  { hours: 168, label: '7 days' },
];

function AttentionPanel({ attention, onReview }) {
  const { criticalReadings = [], overdueOrders = [], poorAdherence = [], unresolvedReviews = 0 } = attention || {};
  const nothing = criticalReadings.length === 0 && overdueOrders.length === 0
    && poorAdherence.length === 0 && unresolvedReviews === 0;

  if (nothing) {
    return (
      <div className="border border-green-200 bg-green-50 px-4 py-3 flex items-center gap-2">
        <Check size={16} className="text-green-700" />
        <span className="text-sm text-green-900">
          Nothing outstanding — no critical readings, no overdue orders, nothing awaiting a nurse.
        </span>
      </div>
    );
  }

  return (
    <div className="border border-red-200 bg-red-50 p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={16} className="text-red-700" />
        <h2 className="text-sm font-semibold text-red-900">Needs your attention</h2>
      </div>
      <ul className="space-y-2 text-sm">
        {criticalReadings.map((r) => (
          <li key={`crit-${r.sheetId}-${r.label}`} className="flex items-start gap-2">
            <span className="mt-1.5 size-1.5 bg-red-600 shrink-0" />
            <span className="text-gray-900">
              <strong>{r.label} {r.latest}{r.unit || ''}</strong> — outside the critical range and {r.trend?.toLowerCase() || 'steady'}
            </span>
          </li>
        ))}
        {overdueOrders.map((o) => (
          <li key={`late-${o.id}`} className="flex items-start gap-2">
            <span className="mt-1.5 size-1.5 bg-amber-600 shrink-0" />
            <span className="text-gray-900">
              <strong>{o.name}</strong> is overdue — was due {o.dueAt ? formatDistanceToNow(new Date(o.dueAt), { addSuffix: true }) : 'earlier'}
            </span>
          </li>
        ))}
        {poorAdherence.map((o) => (
          <li key={`adh-${o.id}`} className="flex items-start gap-2">
            <span className="mt-1.5 size-1.5 bg-amber-600 shrink-0" />
            <span className="text-gray-900">
              <strong>{o.name}</strong> — carried out {o.carriedOut} of {o.expected} expected ({o.adherencePercent}%)
            </span>
          </li>
        ))}
        {unresolvedReviews > 0 && (
          <li className="flex items-start gap-2">
            <span className="mt-1.5 size-1.5 bg-blue-600 shrink-0" />
            <span className="text-gray-900">
              {unresolvedReviews} review {unresolvedReviews === 1 ? 'request is' : 'requests are'} still open with nursing
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}

function OrderRow({ order }) {
  const adherence = order.adherencePercent;
  const tone = order.isOverdue ? 'text-red-700'
    : adherence != null && adherence < 70 ? 'text-amber-700' : 'text-gray-600';

  return (
    <tr className="border-b border-gray-100 last:border-0">
      <td className="py-2 pr-3">
        <div className="text-sm font-medium text-gray-900">{order.name}</div>
        {order.goal && <div className="text-xs text-gray-500">{order.goal}</div>}
      </td>
      <td className="py-2 pr-3 text-xs text-gray-600">{order.type}</td>
      <td className="py-2 pr-3 text-xs text-gray-600">
        {order.frequencyHours ? `Every ${order.frequencyHours}h` : 'Once'}
      </td>
      <td className={`py-2 pr-3 text-sm tabular-nums ${tone}`}>
        {order.expected != null ? `${order.carriedOut} / ${order.expected}` : order.carriedOut}
        {adherence != null && <span className="text-xs ml-1">({adherence}%)</span>}
      </td>
      <td className="py-2 pr-3 text-xs text-gray-600">
        {order.missed > 0 ? <span className="text-amber-700">{order.missed} missed</span> : '—'}
      </td>
      <td className="py-2 text-xs text-gray-600">
        {order.lastExecutedAt ? formatDistanceToNow(new Date(order.lastExecutedAt), { addSuffix: true }) : 'not yet'}
        {order.status === 'HELD' && <span className="ml-2 text-amber-700 font-medium">HELD</span>}
      </td>
    </tr>
  );
}

/** A doctor's request goes to the nurse; the doctor never edits the observation. */
function ReviewDialog({ sheetId, sheetLabel, onClose }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState('CORRECTION_REQUESTED');
  const [comment, setComment] = useState('');

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post(`/nursing/monitoring-sheets/${sheetId}/reviews`, { kind, comment }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient-monitoring-overview'] });
      toast.success('Sent to nursing');
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not send the request'),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-md max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-900">Ask nursing about {sheetLabel}</h3>
        <p className="text-xs text-gray-500 mt-1">
          The observation stays the nursing record. This asks the nurse to check or change something.
        </p>

        <div className="mt-4 space-y-2">
          {[
            ['ACKNOWLEDGED', 'I have read this chart'],
            ['CORRECTION_REQUESTED', 'A reading looks wrong — please recheck'],
            ['ADJUSTMENT_REQUESTED', 'Change the plan (frequency, target range)'],
          ].map(([value, text]) => (
            <label key={value} className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="radio" name="kind" value={value} checked={kind === value}
                onChange={() => setKind(value)} className="mt-1" />
              <span className="text-gray-800">{text}</span>
            </label>
          ))}
        </div>

        <textarea
          value={comment} onChange={(e) => setComment(e.target.value)} rows={3}
          placeholder={kind === 'ACKNOWLEDGED' ? 'Optional note' : 'Say exactly what should change'}
          className="mt-3 w-full border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-gray-500"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 border border-gray-300">Cancel</button>
          <button
            onClick={() => mutate()} disabled={isPending}
            className="px-4 py-2 text-sm bg-gray-900 text-white disabled:opacity-50"
          >
            {isPending ? 'Sending…' : 'Send to nursing'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PatientMonitoringOverview() {
  const { patientId } = useParams();
  const navigate = useNavigate();
  const [hours, setHours] = useState(48);
  const [reviewing, setReviewing] = useState(null);

  const user = useSelector((s) => s.auth?.user);
  const mayReview = can(user?.role, user?.subRole, 'monitoring_review');

  const { data, isLoading } = useQuery({
    queryKey: ['patient-monitoring-overview', patientId, hours],
    queryFn: () => api.get(`/nursing/patient-overview/${patientId}?hours=${hours}`).then((r) => r.data),
  });

  if (isLoading) return <div className="py-16 flex justify-center"><Spinner size="lg" /></div>;
  if (!data) return <div className="p-6 text-sm text-gray-500">Nothing to show for this patient.</div>;

  const { charts = [], orders = [], openReviews = [], counts = {} } = data;

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex items-center gap-1 border border-gray-300">
          {WINDOWS.map((w) => (
            <button
              key={w.hours} onClick={() => setHours(w.hours)}
              className={`px-3 py-1.5 text-xs ${hours === w.hours ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h1 className="text-xl font-semibold text-gray-900">Nursing record</h1>
        <p className="text-sm text-gray-500">
          {counts.activeSheets} active {counts.activeSheets === 1 ? 'chart' : 'charts'} ·{' '}
          {counts.chartedSeries} measurements · {counts.activeOrders} standing{' '}
          {counts.activeOrders === 1 ? 'order' : 'orders'}
        </p>
      </div>

      <AttentionPanel attention={data.attention} />

      {openReviews.length > 0 && (
        <div className="border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare size={15} className="text-blue-700" />
            <h2 className="text-sm font-semibold text-blue-900">Awaiting nursing</h2>
          </div>
          <ul className="space-y-1.5 text-sm text-gray-800">
            {openReviews.map((r) => (
              <li key={r.id}>
                <span className="text-xs text-gray-500">{format(new Date(r.raisedAt), 'd MMM HH:mm')}</span>
                {' · '}{r.comment}
              </li>
            ))}
          </ul>
        </div>
      )}

      {orders.length > 0 && (
        <section className="border border-gray-200 bg-white">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
            <Clock size={15} className="text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-900">Is the plan being carried out?</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                  <th className="py-2 px-4 font-medium">Order</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">Frequency</th>
                  <th className="py-2 pr-3 font-medium">Carried out</th>
                  <th className="py-2 pr-3 font-medium">Missed</th>
                  <th className="py-2 pr-4 font-medium">Last</th>
                </tr>
              </thead>
              <tbody className="[&>tr>td:first-child]:pl-4 [&>tr>td:last-child]:pr-4">
                {orders.map((o) => <OrderRow key={o.id} order={o} />)}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {charts.length === 0 ? (
        <div className="border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          No numeric observations recorded in this period.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {charts.map((series) => (
            <div key={`${series.sheetId}-${series.key}`} className="space-y-1">
              <MonitoringChart series={series} />
              {mayReview && (
                <button
                  onClick={() => setReviewing({ sheetId: series.sheetId, label: series.label })}
                  className="text-xs text-gray-600 hover:text-gray-900 underline"
                >
                  Ask nursing about this
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {reviewing && (
        <ReviewDialog
          sheetId={reviewing.sheetId} sheetLabel={reviewing.label}
          onClose={() => setReviewing(null)}
        />
      )}
    </div>
  );
}
