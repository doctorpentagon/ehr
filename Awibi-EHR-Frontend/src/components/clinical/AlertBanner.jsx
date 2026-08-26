import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { useSelector } from 'react-redux';
import api from '@/lib/api';
import { can } from '@/lib/permissions';

const SEVERITY_STYLE = {
  CRITICAL: { border: 'border-red-300', bg: 'bg-red-50', dot: 'bg-red-600', text: 'text-red-900' },
  WARNING: { border: 'border-amber-300', bg: 'bg-amber-50', dot: 'bg-amber-600', text: 'text-amber-900' },
  INFO: { border: 'border-blue-300', bg: 'bg-blue-50', dot: 'bg-blue-600', text: 'text-blue-900' },
};

const STATUS_LABEL = {
  OPEN: 'Awaiting acknowledgement',
  ACKNOWLEDGED: 'Acknowledged - action required',
  ACTED_ON: 'Action recorded - outcome required',
};

export default function AlertBanner() {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState({});
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useSelector((state) => state.auth.user);
  const canRespond = can(user?.role, user?.subRole, 'clinical_write');

  const { data } = useQuery({
    queryKey: ['clinical-alerts'],
    queryFn: () => api.get('/alerts').then(response => response.data),
    refetchInterval: 15_000,
    staleTime: 10_000,
    retry: false,
  });

  const lifecycle = useMutation({
    mutationFn: ({ id, step, body }) => api.post(`/alerts/${id}/${step}`, body),
    onSuccess: (_, variables) => {
      setNotes(current => ({ ...current, [variables.id]: {} }));
      qc.invalidateQueries({ queryKey: ['clinical-alerts'] });
      toast.success(variables.step === 'acknowledge' ? 'Critical alert acknowledged' : variables.step === 'action' ? 'Clinical action recorded' : 'Critical alert resolved');
    },
    onError: error => toast.error(error.response?.data?.error || 'Could not update alert'),
  });

  const alerts = data?.alerts || [];
  if (alerts.length === 0) return null;
  const { critical = 0, warning = 0 } = data.counts || {};
  const style = SEVERITY_STYLE[critical > 0 ? 'CRITICAL' : 'WARNING'];

  const updateNote = (id, key, value) => setNotes(current => ({
    ...current,
    [id]: { ...(current[id] || {}), [key]: value },
  }));

  return (
    <div className={`border ${style.border} ${style.bg} mb-4`}>
      <button type="button" onClick={() => setOpen(value => !value)}
        className="w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left">
        <span className="flex items-center gap-2 min-w-0">
          <AlertTriangle size={16} className={style.text} />
          <span className={`text-sm font-medium ${style.text}`}>
            {critical > 0 && `${critical} critical`}{critical > 0 && warning > 0 && ', '}{warning > 0 && `${warning} needing attention`}
          </span>
          {!open && <span className="text-sm text-gray-600 truncate hidden sm:inline">- {alerts[0].title}{alerts[0].patient && ` · ${alerts[0].patient.firstName} ${alerts[0].patient.lastName}`}</span>}
        </span>
        {open ? <ChevronUp size={16} className="text-gray-500 shrink-0" /> : <ChevronDown size={16} className="text-gray-500 shrink-0" />}
      </button>

      {open && (
        <ul className="border-t border-gray-200 divide-y divide-gray-100 bg-white max-h-[32rem] overflow-y-auto">
          {alerts.map(alert => {
            const alertStyle = SEVERITY_STYLE[alert.severity] || SEVERITY_STYLE.INFO;
            const local = notes[alert.id] || {};
            const busy = lifecycle.isPending && lifecycle.variables?.id === alert.id;
            return (
              <li key={alert.id} className="px-4 py-3">
                <div className="flex items-start gap-2.5">
                  <span className={`mt-1.5 size-2 shrink-0 ${alertStyle.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <span className="block text-sm font-medium text-gray-900">{alert.title}</span>
                        {alert.detail && <span className="block text-xs text-gray-600">{alert.detail}</span>}
                        <span className="block text-xs text-gray-500 mt-0.5">
                          {alert.patient && `${alert.patient.firstName} ${alert.patient.lastName} · ${alert.patient.mrn || ''} · `}
                          {formatDistanceToNow(new Date(alert.at), { addSuffix: true })}
                        </span>
                      </div>
                      {alert.link && <button type="button" onClick={() => navigate(alert.link)} className="min-h-10 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-700 hover:bg-gray-50">Open chart</button>}
                    </div>

                    {alert.persistent && (
                      <div className="mt-2 rounded-lg border border-red-100 bg-red-50/60 p-2.5">
                        <div className="text-xs font-semibold text-red-900">{STATUS_LABEL[alert.status] || alert.status}</div>
                        {alert.normalizedAt && <p className="mt-1 text-xs text-green-800">The latest reading has returned below the critical threshold. Clinical closure is still required.</p>}
                        {!canRespond ? (
                          <p className="mt-1 text-xs text-gray-600">A doctor or authorised clinician must complete this safety loop.</p>
                        ) : alert.status === 'OPEN' ? (
                          <button type="button" disabled={busy} onClick={() => lifecycle.mutate({ id: alert.id, step: 'acknowledge' })}
                            className="mt-2 min-h-10 rounded-lg bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50">
                            {busy ? 'Saving...' : 'Acknowledge alert'}
                          </button>
                        ) : alert.status === 'ACKNOWLEDGED' ? (
                          <div className="mt-2 flex flex-col sm:flex-row gap-2">
                            <input aria-label={`Action taken for ${alert.title}`} value={local.actionNote || ''} onChange={event => updateNote(alert.id, 'actionNote', event.target.value)}
                              placeholder="Action taken, e.g. reviewed patient and ordered repeat test" className="min-h-10 flex-1 rounded-lg border border-red-200 bg-white px-3 text-xs" />
                            <button type="button" disabled={busy || (local.actionNote || '').trim().length < 3}
                              onClick={() => lifecycle.mutate({ id: alert.id, step: 'action', body: { actionNote: local.actionNote } })}
                              className="min-h-10 rounded-lg bg-[#0B1F66] px-3 text-xs font-semibold text-white disabled:opacity-50">
                              {busy ? <Loader2 size={14} className="animate-spin" /> : 'Record action'}
                            </button>
                          </div>
                        ) : (
                          <div className="mt-2 flex flex-col sm:flex-row gap-2">
                            <input aria-label={`Resolution for ${alert.title}`} value={local.resolution || ''} onChange={event => updateNote(alert.id, 'resolution', event.target.value)}
                              placeholder="Outcome, repeat result and follow-up plan" className="min-h-10 flex-1 rounded-lg border border-red-200 bg-white px-3 text-xs" />
                            <button type="button" disabled={busy || (local.resolution || '').trim().length < 3}
                              onClick={() => lifecycle.mutate({ id: alert.id, step: 'resolve', body: { resolution: local.resolution } })}
                              className="min-h-10 rounded-lg bg-green-700 px-3 text-xs font-semibold text-white disabled:opacity-50">
                              {busy ? <Loader2 size={14} className="animate-spin" /> : 'Resolve alert'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
