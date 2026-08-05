import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Activity, Search, X } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import api from '../../lib/api';
import Avatar from '../../components/ui/Avatar';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import { can } from '../../lib/permissions';
import PatientPicker from '../../components/clinical/PatientPicker';
import { useSelector } from 'react-redux';

const STATUS_STYLES = {
  ACTIVE:    'bg-green-50 text-green-700 border-green-200',
  PAUSED:    'bg-amber-50 text-amber-700 border-amber-200',
  COMPLETED: 'bg-gray-100 text-gray-600 border-gray-200',
  CANCELLED: 'bg-red-50 text-red-700 border-red-200',
};

function NewSheetModal({ open, onClose }) {
  const qc = useQueryClient();
  const [patientId, setPatientId] = useState('');
  const [type, setType] = useState('');
  const [customType, setCustomType] = useState('');
  const [customFields, setCustomFields] = useState([{ key: '', label: '', unit: '', kind: 'number' }]);
  const [targetValue, setTargetValue] = useState('');
  const [frequencyMins, setFrequencyMins] = useState('');
  const [instructions, setInstructions] = useState('');

  const { data: templatesData } = useQuery({
    queryKey: ['monitoring-templates'],
    queryFn: () => api.get('/nursing/monitoring-templates').then(r => r.data),
    enabled: open,
  });
  const templates = templatesData?.templates || [];
  const selected = templates.find(t => t.type === type);
  const isCustom = type === 'CUSTOM';

  const { mutate, isPending } = useMutation({
    mutationFn: (body) => api.post('/nursing/monitoring-sheets', body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['monitoring-sheets'] });
      toast.success('Monitoring sheet created');
      reset();
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not create monitoring sheet'),
  });

  function reset() {
    setPatientId(''); setType(''); setCustomType('');
    setCustomFields([{ key: '', label: '', unit: '', kind: 'number' }]);
    setTargetValue(''); setFrequencyMins(''); setInstructions('');
  }

  function submit() {
    if (!patientId) return toast.error('Choose a patient');
    if (!type) return toast.error('Choose what you are monitoring');
    const body = { patientId, type, instructions: instructions || undefined };
    if (targetValue) body.targetValue = Number(targetValue);
    if (frequencyMins) body.frequencyMins = Number(frequencyMins);
    if (isCustom) {
      const fields = customFields
        .filter(f => f.label.trim())
        .map((f, i) => ({
          key: f.key.trim() || `field_${i + 1}`,
          label: f.label.trim(),
          unit: f.unit.trim() || undefined,
          kind: f.kind,
        }));
      if (!fields.length) return toast.error('Add at least one field to your custom sheet');
      if (!customType.trim()) return toast.error('Name your custom monitoring');
      body.customType = customType.trim();
      body.title = customType.trim();
      body.fields = fields;
    }
    mutate(body);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">New monitoring sheet</h2>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 flex items-center justify-center rounded-lg hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <PatientPicker id="ms-patient" value={patientId} onChange={setPatientId} required autoFocus />

          <div>
            <span className="block text-sm font-medium text-gray-700 mb-1.5">What are you monitoring?</span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {templates.map(t => (
                <button key={t.type} type="button" onClick={() => setType(t.type)}
                  className={`min-h-[48px] px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
                    type === t.type ? 'border-[#2D5BFF] bg-[#2D5BFF]/5 text-[#2D5BFF] font-medium' : 'border-gray-200 hover:bg-gray-50'
                  }`}>
                  {t.label}
                </button>
              ))}
              <button type="button" onClick={() => setType('CUSTOM')}
                className={`min-h-[48px] px-3 py-2 rounded-lg border border-dashed text-sm text-left transition-colors ${
                  isCustom ? 'border-[#2D5BFF] bg-[#2D5BFF]/5 text-[#2D5BFF] font-medium' : 'border-gray-300 hover:bg-gray-50'
                }`}>
                + Something else
              </button>
            </div>
          </div>

          {selected && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <div className="text-xs font-medium text-gray-500 mb-2">You will record:</div>
              <div className="flex flex-wrap gap-1.5">
                {selected.fields.map(f => (
                  <span key={f.key} className="px-2 py-1 bg-white border border-gray-200 rounded text-xs text-gray-700">
                    {f.label}{f.unit ? ` (${f.unit})` : ''}{f.required ? ' *' : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {isCustom && (
            <div className="space-y-3 border border-dashed border-gray-300 rounded-lg p-3">
              <div>
                <label htmlFor="ms-custom-name" className="block text-sm font-medium text-gray-700 mb-1.5">Name this monitoring</label>
                <input id="ms-custom-name" value={customType} onChange={e => setCustomType(e.target.value)}
                  placeholder="e.g. Chest tube drainage"
                  className="w-full min-h-[48px] px-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
              </div>
              <div>
                <span className="block text-sm font-medium text-gray-700 mb-1.5">What will you record each time?</span>
                <div className="space-y-2">
                  {customFields.map((f, i) => (
                    <div key={i} className="flex flex-col sm:flex-row gap-2">
                      <input value={f.label} placeholder="Label e.g. Drainage volume"
                        onChange={e => setCustomFields(cf => cf.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                        className="flex-1 min-h-[48px] px-3 border border-gray-300 rounded-lg text-sm" />
                      <input value={f.unit} placeholder="Unit"
                        onChange={e => setCustomFields(cf => cf.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))}
                        className="sm:w-24 min-h-[48px] px-3 border border-gray-300 rounded-lg text-sm" />
                      <select value={f.kind} aria-label="Field type"
                        onChange={e => setCustomFields(cf => cf.map((x, j) => j === i ? { ...x, kind: e.target.value } : x))}
                        className="sm:w-32 min-h-[48px] px-2 border border-gray-300 rounded-lg text-sm bg-white">
                        <option value="number">Number</option>
                        <option value="text">Text</option>
                        <option value="boolean">Yes/No</option>
                      </select>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setCustomFields(cf => [...cf, { key: '', label: '', unit: '', kind: 'number' }])}
                  className="mt-2 text-sm text-[#2D5BFF] font-medium min-h-[44px]">+ Add another field</button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="ms-target" className="block text-sm font-medium text-gray-700 mb-1.5">Target / expected {selected?.targetUnit ? `(${selected.targetUnit})` : ''}</label>
              <input id="ms-target" type="number" inputMode="decimal" value={targetValue} onChange={e => setTargetValue(e.target.value)}
                className="w-full min-h-[48px] px-3 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label htmlFor="ms-freq" className="block text-sm font-medium text-gray-700 mb-1.5">
                Check every (minutes){selected?.frequencyMins ? ` — default ${selected.frequencyMins}` : ''}
              </label>
              <input id="ms-freq" type="number" inputMode="numeric" value={frequencyMins} onChange={e => setFrequencyMins(e.target.value)}
                placeholder={selected?.frequencyMins ? String(selected.frequencyMins) : ''}
                className="w-full min-h-[48px] px-3 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>

          <div>
            <label htmlFor="ms-instructions" className="block text-sm font-medium text-gray-700 mb-1.5">Instructions</label>
            <textarea id="ms-instructions" rows={2} value={instructions} onChange={e => setInstructions(e.target.value)}
              placeholder="e.g. Observe every 15 minutes for the first hour"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-5 py-3 flex gap-3">
          <button onClick={onClose} className="flex-1 min-h-[48px] border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={isPending}
            className="flex-1 min-h-[48px] bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50">
            {isPending ? 'Creating…' : 'Create sheet'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Monitoring() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('ACTIVE');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const user = useSelector(s => s.auth?.user);
  const mayWrite = can(user?.role, user?.subRole, 'monitoring_write');

  const { data, isLoading } = useQuery({
    queryKey: ['monitoring-sheets', status],
    queryFn: () => api.get('/nursing/monitoring-sheets', { params: { status: status || undefined, limit: 50 } }).then(r => r.data),
  });

  const sheets = (data?.sheets || []).filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    const name = `${s.patient?.firstName || ''} ${s.patient?.lastName || ''}`.toLowerCase();
    return name.includes(q) || (s.title || '').toLowerCase().includes(q) || (s.patient?.universalPatientId || '').toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Monitoring</h1>
          <p className="text-sm text-gray-500">Catheter, fluids, transfusion, drains, neuro observation and more</p>
        </div>
        {mayWrite && (
          <button onClick={() => setModalOpen(true)}
            className="flex items-center justify-center gap-2 px-4 min-h-[48px] bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]">
            <Plus size={16} /> New monitoring
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient or sheet…" aria-label="Search monitoring sheets"
            className="w-full pl-9 pr-4 min-h-[48px] border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by status"
          className="px-3 min-h-[48px] border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30">
          <option value="ACTIVE">Active</option>
          <option value="PAUSED">Paused</option>
          <option value="COMPLETED">Completed</option>
          <option value="">All</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="py-16 flex justify-center"><Spinner size="lg" /></div>
        ) : sheets.length === 0 ? (
          <EmptyState icon={Activity} title="No monitoring sheets"
            description={mayWrite ? 'Create a sheet to start recording catheter output, fluids, transfusion observations and more.' : 'No active monitoring for this facility.'}
            action={mayWrite ? <button onClick={() => setModalOpen(true)} className="px-4 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium">New monitoring</button> : null} />
        ) : (
          <div className="divide-y divide-gray-100">
            {sheets.map(s => (
              <button key={s.id} onClick={() => navigate(`/dashboard/nursing/sheet/${s.id}`)}
                className="w-full text-left p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 bg-[#2D5BFF]/10 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                    <Activity size={17} className="text-[#2D5BFF]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium text-gray-900 truncate">{s.title}</div>
                      <span className={`px-2 py-0.5 rounded-full border text-xs font-medium shrink-0 ${STATUS_STYLES[s.status] || ''}`}>{s.status}</span>
                    </div>
                    {s.patient && (
                      <div className="flex items-center gap-2 mt-1">
                        <Avatar name={`${s.patient.firstName} ${s.patient.lastName}`} size="sm" />
                        <span className="text-sm text-gray-600 truncate">{s.patient.firstName} {s.patient.lastName}</span>
                        <span className="text-xs font-mono text-[#2D5BFF]">{s.patient.universalPatientId}</span>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-400">
                      <span>{s._count?.entries ?? 0} entries</span>
                      {s.frequencyMins && <><span>·</span><span>every {s.frequencyMins} min</span></>}
                      <span>·</span>
                      <span>started {s.startedAt ? format(new Date(s.startedAt), 'dd MMM HH:mm') : ''}</span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <NewSheetModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
