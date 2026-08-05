import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, AlertTriangle, Check } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useSelector } from 'react-redux';
import api from '../../lib/api';
import Spinner from '../../components/ui/Spinner';
import { can } from '../../lib/permissions';

// Fields flagged mapsTo feed the running intake/output balance.
function splitBalance(fields, values) {
  const out = { intakeMl: undefined, outputMl: undefined };
  fields.forEach(f => {
    if (!f.mapsTo) return;
    const v = values[f.key];
    if (v === '' || v == null) return;
    out[f.mapsTo] = Number(v);
  });
  return out;
}

export default function MonitoringSheet() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [values, setValues] = useState({});
  const [notes, setNotes] = useState('');
  const [abnormal, setAbnormal] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const user = useSelector(s => s.auth?.user);
  const mayWrite = can(user?.role, user?.subRole, 'monitoring_write');

  const { data: sheet, isLoading } = useQuery({
    queryKey: ['monitoring-sheet', id],
    queryFn: () => api.get(`/nursing/monitoring-sheets/${id}`).then(r => r.data),
  });

  const { mutate: addEntry, isPending } = useMutation({
    mutationFn: (body) => api.post(`/nursing/monitoring-sheets/${id}/entries`, body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['monitoring-sheet', id] });
      toast.success('Observation recorded');
      setValues({}); setNotes(''); setAbnormal(false); setShowForm(false);
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not record observation'),
  });

  const { mutate: setStatus } = useMutation({
    mutationFn: (status) => api.patch(`/nursing/monitoring-sheets/${id}`, { status }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['monitoring-sheet', id] }); toast.success('Sheet updated'); },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not update sheet'),
  });

  if (isLoading) return <div className="py-16 flex justify-center"><Spinner size="lg" /></div>;
  if (!sheet) return <div className="p-6 text-sm text-gray-500">Monitoring sheet not found.</div>;

  const fields = sheet.fields || [];
  const totals = sheet.totals || { intakeMl: 0, outputMl: 0, balanceMl: 0 };

  function submit() {
    const missing = fields.filter(f => f.required && (values[f.key] === '' || values[f.key] == null));
    if (missing.length) return toast.error(`${missing[0].label} is required`);
    addEntry({ values, notes: notes || undefined, isAbnormal: abnormal, ...splitBalance(fields, values) });
  }

  return (
    <div className="space-y-4">
      <button onClick={() => navigate('/dashboard/nursing')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 min-h-[44px]">
        <ArrowLeft size={16} /> Back to monitoring
      </button>

      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900">{sheet.title}</h1>
            {sheet.patient && (
              <p className="text-sm text-gray-600 mt-0.5">
                {sheet.patient.firstName} {sheet.patient.lastName}
                <span className="ml-2 font-mono text-xs text-[#2D5BFF]">{sheet.patient.universalPatientId}</span>
              </p>
            )}
            {sheet.instructions && <p className="text-sm text-gray-500 mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{sheet.instructions}</p>}
          </div>
          {mayWrite && sheet.status === 'ACTIVE' && (
            <div className="flex gap-2 shrink-0">
              <button onClick={() => setStatus('COMPLETED')} className="px-3 min-h-[44px] border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">Complete</button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
            <div className="text-xs text-blue-600 font-medium">Intake</div>
            <div className="text-lg font-bold text-blue-900">{totals.intakeMl} <span className="text-xs font-normal">ml</span></div>
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
            <div className="text-xs text-amber-600 font-medium">Output</div>
            <div className="text-lg font-bold text-amber-900">{totals.outputMl} <span className="text-xs font-normal">ml</span></div>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <div className="text-xs text-gray-500 font-medium">Balance</div>
            <div className={`text-lg font-bold ${totals.balanceMl < 0 ? 'text-red-700' : 'text-gray-900'}`}>
              {totals.balanceMl > 0 ? '+' : ''}{totals.balanceMl} <span className="text-xs font-normal">ml</span>
            </div>
          </div>
        </div>
        {sheet.targetValue != null && (
          <p className="text-xs text-gray-500 mt-2">Target: {sheet.targetValue} {sheet.targetUnit || ''}{sheet.frequencyMins ? ` · check every ${sheet.frequencyMins} min` : ''}</p>
        )}
      </div>

      {mayWrite && sheet.status === 'ACTIVE' && (
        showForm ? (
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 space-y-4">
            <h2 className="font-semibold text-gray-900">Record observation</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {fields.map(f => (
                <div key={f.key}>
                  <label htmlFor={`f-${f.key}`} className="block text-sm font-medium text-gray-700 mb-1.5">
                    {f.label}{f.unit ? ` (${f.unit})` : ''}{f.required ? ' *' : ''}
                  </label>
                  {f.kind === 'select' ? (
                    <select id={`f-${f.key}`} value={values[f.key] ?? ''} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                      className="w-full min-h-[48px] px-3 border border-gray-300 rounded-lg text-sm bg-white">
                      <option value="">Select…</option>
                      {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.kind === 'boolean' ? (
                    <select id={`f-${f.key}`} value={values[f.key] ?? ''} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                      className="w-full min-h-[48px] px-3 border border-gray-300 rounded-lg text-sm bg-white">
                      <option value="">Select…</option>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  ) : (
                    <input id={`f-${f.key}`} type={f.kind === 'number' ? 'number' : 'text'}
                      inputMode={f.kind === 'number' ? 'decimal' : 'text'}
                      value={values[f.key] ?? ''} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                      className="w-full min-h-[48px] px-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
                  )}
                </div>
              ))}
            </div>
            <div>
              <label htmlFor="entry-notes" className="block text-sm font-medium text-gray-700 mb-1.5">Notes</label>
              <textarea id="entry-notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <label className="flex items-center gap-2 min-h-[44px] cursor-pointer">
              <input type="checkbox" checked={abnormal} onChange={e => setAbnormal(e.target.checked)} className="w-5 h-5 rounded border-gray-300" />
              <span className="text-sm text-gray-700">Flag as abnormal / escalate</span>
            </label>
            <div className="flex gap-3">
              <button onClick={() => setShowForm(false)} className="flex-1 min-h-[48px] border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
              <button onClick={submit} disabled={isPending}
                className="flex-1 min-h-[48px] bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50">
                {isPending ? 'Saving…' : 'Save observation'}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowForm(true)}
            className="w-full flex items-center justify-center gap-2 min-h-[52px] bg-[#2D5BFF] text-white rounded-xl text-sm font-medium hover:bg-[#1a45e0]">
            <Plus size={18} /> Record observation
          </button>
        )
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-900 text-sm">
          Observations ({sheet.entries?.length || 0})
        </div>
        {!sheet.entries?.length ? (
          <div className="py-10 text-center text-sm text-gray-500">No observations recorded yet.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {sheet.entries.map(e => (
              <div key={e.id} className={`p-4 ${e.isAbnormal ? 'bg-red-50/60' : ''}`}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-sm font-medium text-gray-900">
                    {format(new Date(e.recordedAt), 'dd MMM yyyy · HH:mm')}
                  </span>
                  {e.isAbnormal
                    ? <span className="flex items-center gap-1 text-xs font-medium text-red-700"><AlertTriangle size={13} /> Abnormal</span>
                    : <Check size={14} className="text-green-600" />}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {fields.map(f => {
                    const v = e.values?.[f.key];
                    if (v === undefined || v === null || v === '') return null;
                    const display = v === 'true' ? 'Yes' : v === 'false' ? 'No' : v;
                    return (
                      <span key={f.key} className="px-2 py-1 bg-gray-50 border border-gray-200 rounded text-xs text-gray-700">
                        <span className="text-gray-500">{f.label}:</span> {display}{f.unit ? ` ${f.unit}` : ''}
                      </span>
                    );
                  })}
                </div>
                {(e.intakeMl != null || e.outputMl != null) && (
                  <div className="mt-2 text-xs text-gray-500">
                    {e.intakeMl != null && <span className="mr-3">In: {e.intakeMl} ml</span>}
                    {e.outputMl != null && <span>Out: {e.outputMl} ml</span>}
                  </div>
                )}
                {e.notes && <p className="mt-2 text-sm text-gray-600">{e.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
