import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X, User, Loader2 } from 'lucide-react';
import api from '../../lib/api';

/**
 * Type-ahead patient selector.
 *
 * Replaces dropdowns that loaded every patient into a <select> — that does not
 * scale and forces staff to scroll a list. Here staff type a Hosp No, Patient ID, phone or
 * name fragment and the server returns the top few matches.
 *
 * Search is debounced and only fires from 2 characters, so a busy reception desk
 * is not issuing a request per keystroke.
 */
export default function PatientPicker({
  value,
  onChange,
  label = 'Patient',
  placeholder = 'Type Hosp No, Patient ID, phone or name…',
  required = false,
  autoFocus = false,
  id = 'patient-picker',
  disabled = false,
}) {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [selected, setSelected] = useState(null);
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 180);
    return () => clearTimeout(t);
  }, [term]);

  // Restore the label when a parent supplies an id we have not resolved yet.
  useEffect(() => {
    if (!value) { setSelected(null); return; }
    if (selected?.id === value) return;
    let active = true;
    api.get(`/patients/${value}`)
      .then(({ data }) => { if (active) setSelected(data); })
      .catch(() => {});
    return () => { active = false; };
  }, [value]);

  useEffect(() => {
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ['patient-lookup', debounced],
    queryFn: () => api.get('/patients/lookup', { params: { q: debounced, limit: 8 } }).then(r => r.data),
    enabled: debounced.length >= 2,
    staleTime: 30000,
  });

  const results = data?.patients || [];

  function pick(p) {
    setSelected(p);
    onChange?.(p.id, p);
    setTerm('');
    setOpen(false);
    setHighlight(0);
  }

  function clear() {
    setSelected(null);
    onChange?.('', null);
    setTerm('');
    setOpen(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function onKeyDown(e) {
    if (!open || !results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(results[highlight]); }
    else if (e.key === 'Escape') { setOpen(false); }
  }

  const age = (dob) => {
    if (!dob) return null;
    const years = Math.floor((Date.now() - new Date(dob)) / (365.25 * 24 * 3600 * 1000));
    return Number.isFinite(years) ? `${years}y` : null;
  };

  if (selected) {
    return (
      <div>
        <span className="block text-sm font-medium text-gray-700 mb-1.5">
          {label}{required && <span className="text-red-500"> *</span>}
        </span>
        <div className="flex items-center gap-3 min-h-12 px-3 border border-[#2D5BFF] bg-[#2D5BFF]/5 rounded-lg">
          <User size={16} className="text-[#2D5BFF] shrink-0" />
          <div className="flex-1 min-w-0 py-2">
            <div className="text-sm font-medium text-gray-900 truncate">
              {selected.firstName} {selected.lastName}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-xs">
              <span className="font-mono text-[#2D5BFF]">{selected.universalPatientId}</span>
              {selected.mrn && <span className="text-gray-500">Hosp No {selected.mrn}</span>}
              {age(selected.dateOfBirth) && <span className="text-gray-500">{age(selected.dateOfBirth)}</span>}
              {selected.phone && <span className="text-gray-500">{selected.phone}</span>}
            </div>
          </div>
          {!disabled && (
            <button type="button" onClick={clear} aria-label="Change patient"
              className="w-11 h-11 -mr-2 flex items-center justify-center rounded-lg hover:bg-white/60 shrink-0">
              <X size={16} className="text-gray-500" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          id={id}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={`${id}-listbox`}
          autoComplete="off"
          autoFocus={autoFocus}
          disabled={disabled}
          value={term}
          placeholder={placeholder}
          onChange={(e) => { setTerm(e.target.value); setOpen(true); setHighlight(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="w-full pl-9 pr-9 min-h-12 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 disabled:bg-gray-50"
        />
        {isFetching && <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />}
      </div>

      {open && term.trim().length >= 2 && (
        <ul id={`${id}-listbox`} role="listbox"
          className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-y-auto">
          {results.length === 0 ? (
            <li className="px-3 py-4 text-sm text-gray-500 text-center">
              {isFetching ? 'Searching…' : 'No patient matches that ID, phone or name.'}
            </li>
          ) : results.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === highlight}>
              <button type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(p)}
                className={`w-full text-left px-3 py-2.5 min-h-12 flex items-center gap-3 ${i === highlight ? 'bg-[#2D5BFF]/5' : 'hover:bg-gray-50'}`}>
                <div className="w-8 h-8 rounded-full bg-[#2D5BFF]/10 flex items-center justify-center shrink-0">
                  <span className="text-xs font-semibold text-[#2D5BFF]">
                    {(p.firstName?.[0] || '') + (p.lastName?.[0] || '')}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 truncate">{p.firstName} {p.lastName}</div>
                  <div className="flex flex-wrap items-center gap-x-2 text-xs">
                    <span className="font-mono text-[#2D5BFF]">{p.universalPatientId}</span>
                    {p.mrn && <span className="text-gray-500">Hosp No {p.mrn}</span>}
                    {age(p.dateOfBirth) && <span className="text-gray-500">{age(p.dateOfBirth)}</span>}
                    {p.phone && <span className="text-gray-500">{p.phone}</span>}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {term.trim().length === 1 && (
        <p className="text-xs text-gray-400 mt-1">Keep typing — search starts at 2 characters.</p>
      )}
    </div>
  );
}
