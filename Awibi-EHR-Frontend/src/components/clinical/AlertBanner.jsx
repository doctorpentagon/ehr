import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import api from '@/lib/api';

/**
 * What somebody should look at now, across the whole facility.
 *
 * Shown collapsed by default with the count, expanding to the list. A banner
 * that occupies half the screen every day gets scrolled past within a week, and
 * then it is worse than nothing — so the resting state is one line.
 *
 * The feed is derived from current state on the server, which means an item
 * disappears the moment the thing it describes is dealt with.
 */

const SEVERITY_STYLE = {
  CRITICAL: { border: 'border-red-300', bg: 'bg-red-50', dot: 'bg-red-600', text: 'text-red-900' },
  WARNING: { border: 'border-amber-300', bg: 'bg-amber-50', dot: 'bg-amber-600', text: 'text-amber-900' },
  INFO: { border: 'border-blue-300', bg: 'bg-blue-50', dot: 'bg-blue-600', text: 'text-blue-900' },
};

export default function AlertBanner() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ['clinical-alerts'],
    queryFn: () => api.get('/alerts').then((r) => r.data),
    refetchInterval: 60_000,
    staleTime: 30_000,
    // A role with nothing to act on gets nothing rendered at all.
    retry: false,
  });

  const alerts = data?.alerts || [];
  if (alerts.length === 0) return null;

  const { critical = 0, warning = 0 } = data.counts || {};
  const worst = critical > 0 ? 'CRITICAL' : 'WARNING';
  const style = SEVERITY_STYLE[worst];

  return (
    <div className={`border ${style.border} ${style.bg} mb-4`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          <AlertTriangle size={16} className={style.text} />
          <span className={`text-sm font-medium ${style.text}`}>
            {critical > 0 && `${critical} critical`}
            {critical > 0 && warning > 0 && ', '}
            {warning > 0 && `${warning} needing attention`}
          </span>
          {!open && (
            <span className="text-sm text-gray-600 truncate hidden sm:inline">
              — {alerts[0].title}
              {alerts[0].patient && ` · ${alerts[0].patient.firstName} ${alerts[0].patient.lastName}`}
            </span>
          )}
        </span>
        {open ? <ChevronUp size={16} className="text-gray-500 shrink-0" /> : <ChevronDown size={16} className="text-gray-500 shrink-0" />}
      </button>

      {open && (
        <ul className="border-t border-gray-200 divide-y divide-gray-100 bg-white max-h-80 overflow-y-auto">
          {alerts.map((a) => {
            const s = SEVERITY_STYLE[a.severity] || SEVERITY_STYLE.INFO;
            return (
              <li key={a.id}>
                <button
                  onClick={() => a.link && navigate(a.link)}
                  className="w-full px-4 py-2.5 flex items-start gap-2.5 text-left hover:bg-gray-50"
                >
                  <span className={`mt-1.5 size-2 shrink-0 ${s.dot}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-gray-900">{a.title}</span>
                    {a.detail && <span className="block text-xs text-gray-600 truncate">{a.detail}</span>}
                    <span className="block text-xs text-gray-500 mt-0.5">
                      {a.patient && `${a.patient.firstName} ${a.patient.lastName} · ${a.patient.mrn || ''} · `}
                      {formatDistanceToNow(new Date(a.at), { addSuffix: true })}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
