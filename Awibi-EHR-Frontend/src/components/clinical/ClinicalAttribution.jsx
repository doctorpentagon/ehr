import React from 'react';
import { Clock3, ShieldCheck, UserRoundCheck } from 'lucide-react';
import { format } from 'date-fns';

export function professionalName(professional) {
  if (!professional) return 'Professional not captured';
  const base = `${professional.firstName || ''} ${professional.lastName || ''}`.trim() || 'Professional not captured';
  if (professional.subRole === 'DOCTOR' && !/^dr\.?\s/i.test(base)) return `Dr. ${base}`;
  return base;
}

export function professionalRole(professional) {
  if (!professional) return '';
  if (professional.specialty) return professional.specialty;
  const role = professional.subRole || professional.role || '';
  return role.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, character => character.toUpperCase());
}

export default function ClinicalAttribution({
  professional,
  timestamp,
  label = 'Recorded by',
  pending = false,
  compact = false,
}) {
  const [now, setNow] = React.useState(() => new Date());

  React.useEffect(() => {
    if (timestamp) return undefined;
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [timestamp]);

  const displayedAt = timestamp ? new Date(timestamp) : now;
  const validTime = !Number.isNaN(displayedAt.getTime());
  const role = professionalRole(professional);

  return (
    <div className={`flex flex-col gap-2 rounded-xl border border-blue-100 bg-blue-50/60 ${compact ? 'px-3 py-2.5' : 'p-3 sm:flex-row sm:items-center sm:justify-between'}`}>
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-[#2D5BFF] shadow-sm">
          <UserRoundCheck size={18} />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">{label}</div>
          <div className="truncate text-sm font-semibold text-gray-950">
            {professionalName(professional)}{role ? <span className="font-normal text-gray-500"> · {role}</span> : null}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-11 text-xs text-gray-600 sm:pl-0">
        <span className="inline-flex items-center gap-1.5">
          <Clock3 size={14} className="text-[#2D5BFF]" />
          {validTime ? format(displayedAt, 'dd MMM yyyy · hh:mm:ss a') : 'Time unavailable'}
        </span>
        <span className="inline-flex items-center gap-1 text-blue-700">
          <ShieldCheck size={14} /> {pending ? 'Locked to server time on save' : 'Server recorded'}
        </span>
      </div>
    </div>
  );
}
