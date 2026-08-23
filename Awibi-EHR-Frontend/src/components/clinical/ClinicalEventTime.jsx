import React from 'react';
import { Clock3, History } from 'lucide-react';

export function toLocalDateTimeInput(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function ClinicalEventTime({
  custom,
  onCustomChange,
  value,
  onValueChange,
  reason,
  onReasonChange,
  label = 'When did this care occur?',
}) {
  const chooseCustom = () => {
    onCustomChange(true);
    if (!value) onValueChange(toLocalDateTimeInput());
  };

  return (
    <fieldset className="rounded-xl border border-gray-200 bg-gray-50 p-3">
      <legend className="px-1 text-sm font-semibold text-gray-900">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${!custom ? 'border-[#2D5BFF] bg-blue-50 text-blue-950' : 'border-gray-200 bg-white text-gray-700'}`}>
          <input type="radio" name={`${label}-mode`} checked={!custom} onChange={() => onCustomChange(false)} />
          <Clock3 size={17} className="text-[#2D5BFF]" />
          <span><strong>Current date &amp; time</strong><br /><span className="text-xs font-normal text-gray-500">Set by the server when saved</span></span>
        </label>
        <label className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${custom ? 'border-amber-500 bg-amber-50 text-amber-950' : 'border-gray-200 bg-white text-gray-700'}`}>
          <input type="radio" name={`${label}-mode`} checked={custom} onChange={chooseCustom} />
          <History size={17} className="text-amber-700" />
          <span><strong>Earlier date &amp; time</strong><br /><span className="text-xs font-normal text-gray-500">For retrospective documentation</span></span>
        </label>
      </div>

      {custom && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-700">Care occurred at <span className="text-red-600">*</span></label>
            <input type="datetime-local" value={value} max={toLocalDateTimeInput()} onChange={event => onValueChange(event.target.value)} required
              className="min-h-12 w-full rounded-lg border border-amber-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/30" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-700">Reason for late entry <span className="text-red-600">*</span></label>
            <input value={reason} onChange={event => onReasonChange(event.target.value)} required
              placeholder="e.g. Emergency care documented after stabilisation"
              className="min-h-12 w-full rounded-lg border border-amber-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/30" />
          </div>
          <p className="text-xs leading-5 text-amber-900 sm:col-span-2">
            The original care time and this reason will be retained. The EHR separately preserves the actual server time and professional who entered the record.
          </p>
        </div>
      )}
    </fieldset>
  );
}
