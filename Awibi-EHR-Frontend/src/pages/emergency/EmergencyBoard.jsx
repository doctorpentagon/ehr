import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, Clock, X } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import Spinner from '../../components/ui/Spinner';

/**
 * The board used during a resuscitation.
 *
 * Everything here assumes the person using it has one free hand and no attention
 * to spare. Targets are large, each action is a single tap that records a
 * complete timestamped fact, and the only confirmation is on defibrillation —
 * because a confirmation dialogue during an arrest costs a second that matters,
 * and the only action where that second is worth spending is the one that can
 * injure the person delivering it.
 */

const OUTCOMES = [
  ['ROSC', 'ROSC achieved'],
  ['STABILISED', 'Stabilised'],
  ['TRANSFERRED_ICU', 'Transferred to ICU'],
  ['TRANSFERRED_THEATRE', 'Transferred to theatre'],
  ['DECEASED', 'Deceased'],
  ['OTHER', 'Other'],
];

function formatOffset(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Counts up from the call, and keeps counting while the tab is open. */
function useElapsed(startedAt, endedAt) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endedAt) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [endedAt]);
  if (!startedAt) return 0;
  const end = endedAt ? new Date(endedAt).getTime() : now;
  return Math.floor((end - new Date(startedAt).getTime()) / 1000);
}

function Stopwatch({ seconds, ended, targetMins }) {
  const overTarget = targetMins && seconds > targetMins * 60;
  return (
    <div className={`px-6 py-4 text-center ${ended ? 'bg-gray-800' : overTarget ? 'bg-red-700' : 'bg-gray-900'}`}>
      <div className="text-5xl font-bold tabular-nums text-white tracking-tight">
        T+{formatOffset(seconds)}
      </div>
      <div className="text-xs text-gray-300 mt-1">
        {ended ? 'Closed' : targetMins ? `Target: complete within ${targetMins} minutes` : 'Running'}
      </div>
    </div>
  );
}

export default function EmergencyBoard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(null);
  const [closing, setClosing] = useState(false);
  const [outcome, setOutcome] = useState('ROSC');
  const [outcomeNote, setOutcomeNote] = useState('');
  const timelineRef = useRef(null);

  const { data: event, isLoading } = useQuery({
    queryKey: ['resuscitation', id],
    queryFn: () => api.get(`/emergency/resuscitation/${id}`).then((r) => r.data),
    // Several people may be logging at once; keep the timeline close to live.
    refetchInterval: (q) => (q.state.data?.endedAt ? false : 5000),
  });

  const elapsed = useElapsed(event?.startedAt, event?.endedAt);

  const { mutate: logAction, isPending: logging } = useMutation({
    mutationFn: (body) => api.post(`/emergency/resuscitation/${id}/entries`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['resuscitation', id] }),
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not record that'),
  });

  const { mutate: endEvent, isPending: ending } = useMutation({
    mutationFn: () => api.put(`/emergency/resuscitation/${id}/end`, { outcome, outcomeNote }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resuscitation', id] });
      toast.success('Resuscitation record closed');
      setClosing(false);
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not close the record'),
  });

  useEffect(() => {
    if (timelineRef.current) timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
  }, [event?.entries?.length]);

  if (isLoading) return <div className="py-16 flex justify-center"><Spinner size="lg" /></div>;
  if (!event) return <div className="p-6 text-sm text-gray-500">Resuscitation record not found.</div>;

  const ended = Boolean(event.endedAt);
  const steps = (event.availableProtocols || []).flatMap((p) => p.steps.map((s) => ({ ...s, protocol: p.key })));
  const targetMins = (event.availableProtocols || []).find((p) => p.targetMins)?.targetMins;
  const doneActions = new Set((event.entries || []).map((e) => e.action));

  const record = (step) => {
    if (step.confirm && !confirming) { setConfirming(step); return; }
    setConfirming(null);
    logAction({ action: step.action, detail: step.detail, meta: step.meta || {} });
  };

  return (
    <div className="max-w-6xl space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            {event.type.replace(/_/g, ' ')}
            {ended && <span className="ml-2 text-sm font-normal text-gray-500">closed</span>}
          </h1>
          <p className="text-sm text-gray-600">
            {event.patient?.firstName} {event.patient?.lastName}
            {event.patient?.mrn && <span className="text-gray-400 ml-2">{event.patient.mrn}</span>}
            {event.patient?.isEmergencyTemp && (
              <span className="ml-2 text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5">not yet identified</span>
            )}
          </p>
        </div>
        <button onClick={() => navigate('/dashboard/emergency')} className="text-sm text-gray-600 hover:text-gray-900">
          Back to emergency
        </button>
      </div>

      <Stopwatch seconds={elapsed} ended={ended} targetMins={targetMins} />

      {/* What has fallen due again. In a long arrest this is the thing a team
          cannot track reliably while their hands are busy. */}
      {!ended && event.dueRepeats?.length > 0 && (
        <div className="border-2 border-red-600 bg-red-50 p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={18} className="text-red-700" />
            <span className="text-sm font-semibold text-red-900">Due again now</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {event.dueRepeats.map((d) => (
              <button
                key={d.action}
                onClick={() => logAction({ action: d.action, meta: d.meta || {} })}
                disabled={logging}
                style={{ minHeight: 60 }}
                className="w-full px-4 bg-red-700 text-white text-base font-semibold text-left disabled:opacity-60"
              >
                {d.action}
                <span className="block text-xs font-normal opacity-90">
                  last given {Math.floor(d.lastGivenSecondsAgo / 60)} min ago
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="border border-gray-300 bg-white">
          <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-900">Protocol</h2>
          </div>
          <div className="p-3 grid gap-2 sm:grid-cols-2">
            {steps.map((step) => {
              const done = doneActions.has(step.action);
              return (
                <button
                  key={`${step.protocol}-${step.action}`}
                  onClick={() => record(step)}
                  disabled={ended || logging}
                  style={{ minHeight: 60 }}
                  className={`w-full px-3 py-2 text-left text-sm font-medium border-2 disabled:opacity-50
                    ${step.critical ? 'border-red-600 text-red-800' : 'border-gray-300 text-gray-800'}
                    ${done ? 'bg-green-50 border-green-600 text-green-900' : 'bg-white hover:bg-gray-50'}`}
                >
                  <span className="flex items-start gap-2">
                    {done && <Check size={16} className="mt-0.5 shrink-0" />}
                    <span>
                      {step.action}
                      {step.meta?.dose && <span className="block text-xs font-normal opacity-80">{step.meta.dose} {step.meta.route || ''}</span>}
                      {step.meta?.joules && <span className="block text-xs font-normal opacity-80">{step.meta.joules} J</span>}
                      {step.repeatEveryMins && <span className="block text-xs font-normal opacity-70">repeat every {step.repeatEveryMins} min</span>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="border border-gray-300 bg-white flex flex-col">
          <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
            <Clock size={15} className="text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-900">Timeline</h2>
            <span className="text-xs text-gray-500 ml-auto">{event.entries?.length || 0} actions</span>
          </div>
          <div ref={timelineRef} className="p-3 space-y-1.5 overflow-y-auto" style={{ maxHeight: 460 }}>
            {(event.entries || []).length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Nothing recorded yet.</p>
            ) : (
              event.entries.map((e) => (
                <div key={e.id} className="flex gap-3 text-sm border-b border-gray-100 pb-1.5 last:border-0">
                  <span className="font-mono text-gray-500 tabular-nums shrink-0">T+{formatOffset(e.timeOffsetSeconds)}</span>
                  <span className="text-gray-900">
                    {e.action}
                    {e.detail && <span className="block text-xs text-gray-500">{e.detail}</span>}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {ended ? (
        <div className="border border-gray-300 bg-gray-50 p-4">
          <div className="text-sm font-medium text-gray-900">
            Outcome: {OUTCOMES.find(([v]) => v === event.outcome)?.[1] || event.outcome}
          </div>
          {event.outcomeNote && <div className="text-sm text-gray-600 mt-1">{event.outcomeNote}</div>}
          <div className="text-xs text-gray-500 mt-2">Total duration {formatOffset(elapsed)}</div>
        </div>
      ) : (
        <button
          onClick={() => setClosing(true)}
          style={{ minHeight: 60 }}
          className="w-full bg-gray-900 text-white text-base font-semibold"
        >
          End resuscitation and record outcome
        </button>
      )}

      {/* The only confirmation on the board. A shock can injure the person who
          delivers it, so this one second is worth spending. */}
      {confirming && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm p-6 text-center">
            <AlertTriangle size={40} className="text-red-600 mx-auto mb-3" />
            <p className="text-lg font-semibold text-gray-900">{confirming.confirm}</p>
            {confirming.meta?.joules && (
              <p className="text-sm text-gray-600 mt-1">{confirming.meta.joules} J</p>
            )}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button onClick={() => setConfirming(null)} style={{ minHeight: 60 }}
                className="border-2 border-gray-300 text-gray-700 font-semibold">Cancel</button>
              <button onClick={() => record({ ...confirming, confirm: null })} style={{ minHeight: 60 }}
                className="bg-red-700 text-white font-semibold">Confirm</button>
            </div>
          </div>
        </div>
      )}

      {closing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setClosing(false)}>
          <div className="bg-white w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-gray-900">Record the outcome</h3>
              <button onClick={() => setClosing(false)} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
            </div>
            <div className="space-y-2">
              {OUTCOMES.map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm cursor-pointer py-1">
                  <input type="radio" name="outcome" checked={outcome === value} onChange={() => setOutcome(value)} />
                  <span className="text-gray-800">{label}</span>
                </label>
              ))}
            </div>
            <textarea
              value={outcomeNote} onChange={(e) => setOutcomeNote(e.target.value)} rows={3}
              placeholder="Anything else that should be on the record"
              className="mt-3 w-full border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-gray-500"
            />
            <button onClick={() => endEvent()} disabled={ending} style={{ minHeight: 52 }}
              className="mt-4 w-full bg-gray-900 text-white font-semibold disabled:opacity-50">
              {ending ? 'Closing…' : 'Close the record'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
