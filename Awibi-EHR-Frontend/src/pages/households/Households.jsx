import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users2, Plus, Search, X, UserPlus, HeartPulse } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import PatientPicker from '../../components/clinical/PatientPicker';

const RELATIONSHIPS = ['PRINCIPAL', 'SPOUSE', 'CHILD', 'DEPENDENT', 'OTHER'];

function ageOf(dob) {
  if (!dob) return null;
  return Math.floor((Date.now() - new Date(dob)) / (365.25 * 24 * 3600 * 1000));
}

function NewHouseholdModal({ open, onClose }) {
  const qc = useQueryClient();
  const [principalId, setPrincipalId] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post('/households', { name, principalPatientId: principalId || undefined, address: address || undefined }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['households'] });
      toast.success('Household created');
      setName(''); setAddress(''); setPrincipalId(''); onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not create the household'),
  });

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="border-b border-gray-200 px-5 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">New household</h2>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 flex items-center justify-center rounded-lg hover:bg-gray-100"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          <PatientPicker id="hh-principal" value={principalId}
            label="Principal (the responsible adult)"
            onChange={(id, p) => {
              setPrincipalId(id);
              // Suggest a household name from the surname, as reception would write it.
              if (p?.lastName && !name) setName(`${p.lastName} Family`);
            }}
            autoFocus />
          <div>
            <label htmlFor="hh-name" className="block text-sm font-medium text-gray-700 mb-1.5">Household name *</label>
            <input id="hh-name" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Adegoke Family"
              className="w-full min-h-12 px-3 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label htmlFor="hh-address" className="block text-sm font-medium text-gray-700 mb-1.5">Address</label>
            <input id="hh-address" value={address} onChange={e => setAddress(e.target.value)}
              className="w-full min-h-12 px-3 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>
        <div className="border-t border-gray-200 px-5 py-3 flex gap-3">
          <button onClick={onClose} className="flex-1 min-h-12 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button onClick={() => name.trim() ? mutate() : toast.error('Name the household')} disabled={isPending}
            className="flex-1 min-h-12 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50">
            {isPending ? 'Creating…' : 'Create household'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddMemberModal({ household, onClose }) {
  const qc = useQueryClient();
  const [patientId, setPatientId] = useState('');
  const [relationship, setRelationship] = useState('CHILD');
  const [inherit, setInherit] = useState(true);

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post(`/households/${household.id}/members`, { patientId, relationship, inheritInsurance: inherit }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['households'] });
      toast.success('Member added');
      setPatientId(''); onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not add the member'),
  });

  if (!household) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="border-b border-gray-200 px-5 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Add to {household.name}</h2>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 flex items-center justify-center rounded-lg hover:bg-gray-100"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          <PatientPicker id="hm-patient" value={patientId} onChange={setPatientId} required autoFocus />
          <div>
            <span className="block text-sm font-medium text-gray-700 mb-1.5">Relationship</span>
            <div className="flex flex-wrap gap-2">
              {RELATIONSHIPS.map(r => (
                <button key={r} type="button" onClick={() => setRelationship(r)} aria-pressed={relationship === r}
                  className={`px-3 min-h-11 rounded-lg border text-sm font-medium ${relationship === r ? 'border-[#2D5BFF] bg-[#2D5BFF]/5 text-[#2D5BFF]' : 'border-gray-200 hover:bg-gray-50'}`}>
                  {r[0] + r.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-start gap-2 min-h-11 cursor-pointer">
            <input type="checkbox" checked={inherit} onChange={e => setInherit(e.target.checked)} className="w-5 h-5 mt-0.5 rounded border-gray-300" />
            <span className="text-sm text-gray-700">
              Inherit the principal&rsquo;s insurance
              <span className="block text-xs text-gray-500">Skipped automatically if this patient already has an active policy.</span>
            </span>
          </label>
        </div>
        <div className="border-t border-gray-200 px-5 py-3 flex gap-3">
          <button onClick={onClose} className="flex-1 min-h-12 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button onClick={() => patientId ? mutate() : toast.error('Choose a patient')} disabled={isPending}
            className="flex-1 min-h-12 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50">
            {isPending ? 'Adding…' : 'Add member'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FamilyHistoryPanel({ householdId, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['family-history', householdId],
    queryFn: () => api.get(`/households/${householdId}/family-history`).then(r => r.data),
    enabled: Boolean(householdId),
  });
  if (!householdId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2"><HeartPulse size={18} /> Family history</h2>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 flex items-center justify-center rounded-lg hover:bg-gray-100"><X size={20} /></button>
        </div>
        {isLoading ? <div className="py-16 flex justify-center"><Spinner /></div> : (
          <div className="p-5 space-y-5">
            <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              Read-only aggregation across household members. It does not change any individual record.
            </p>
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Chronic conditions</h3>
              {!data?.conditions?.length ? <p className="text-sm text-gray-400">None recorded.</p> : (
                <div className="space-y-1.5">
                  {data.conditions.map(c => (
                    <div key={c.id} className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-gray-900">{c.patient.firstName}</span>
                      <span className="text-gray-600">{c.name}</span>
                      {c.status && <span className="px-1.5 py-0.5 bg-gray-100 rounded text-xs text-gray-600">{c.status}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Allergies</h3>
              {!data?.allergies?.length ? <p className="text-sm text-gray-400">None recorded.</p> : (
                <div className="space-y-1.5">
                  {data.allergies.map(a => (
                    <div key={a.id} className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-gray-900">{a.patient.firstName}</span>
                      <span className="text-gray-600">{a.substance || a.name}</span>
                      {a.severity && <span className="px-1.5 py-0.5 bg-red-50 text-red-700 rounded text-xs">{a.severity}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Recent encounters</h3>
              {!data?.recentCases?.length ? <p className="text-sm text-gray-400">None recorded.</p> : (
                <div className="space-y-1.5">
                  {data.recentCases.slice(0, 10).map(c => (
                    <div key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium text-gray-900">{c.patient.firstName}</span>
                      <span className="text-gray-600">{c.title}</span>
                      <span className="px-1.5 py-0.5 bg-gray-100 rounded text-xs text-gray-500">{c.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Households() {
  const [search, setSearch] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [addTo, setAddTo] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['households', search],
    queryFn: () => api.get('/households', { params: { search: search || undefined } }).then(r => r.data),
  });
  const households = data?.households || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Households</h1>
          <p className="text-sm text-gray-500">Families billed together, with shared insurance and history</p>
        </div>
        <button onClick={() => setNewOpen(true)}
          className="flex items-center justify-center gap-2 px-4 min-h-12 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]">
          <Plus size={16} /> New household
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} aria-label="Search households"
            placeholder="Search by household name, member surname or phone…"
            className="w-full pl-9 pr-4 min-h-12 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 flex justify-center"><Spinner size="lg" /></div>
      ) : !households.length ? (
        <div className="bg-white rounded-xl border border-gray-200">
          <EmptyState icon={Users2} title="No households"
            description="Group family members so bills, insurance and history stay together." />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {households.map(h => (
            <div key={h.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="font-semibold text-gray-900">{h.name}</h2>
                  {h.address && <p className="text-xs text-gray-500 mt-0.5">{h.address}</p>}
                </div>
                <span className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-600 shrink-0">
                  {h.members.length} member{h.members.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="mt-3 space-y-1.5">
                {h.members.map(m => {
                  const age = ageOf(m.dateOfBirth);
                  const isChild = age != null && age < 18;
                  return (
                    <div key={m.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium text-gray-900">{m.firstName} {m.lastName}</span>
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                        m.relationship === 'PRINCIPAL' ? 'bg-[#2D5BFF]/10 text-[#2D5BFF]' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {m.relationship ? m.relationship[0] + m.relationship.slice(1).toLowerCase() : 'Member'}
                      </span>
                      {age != null && (
                        <span className={`text-xs ${isChild ? 'text-amber-700 font-medium' : 'text-gray-500'}`}>
                          {age}y{isChild ? ' · paediatric' : ''}
                        </span>
                      )}
                      <span className="font-mono text-xs text-gray-400">{m.universalPatientId}</span>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-2 mt-4">
                <button onClick={() => setAddTo(h)}
                  className="flex items-center gap-1.5 px-3 min-h-11 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">
                  <UserPlus size={15} /> Add member
                </button>
                <button onClick={() => setHistoryFor(h.id)}
                  className="flex items-center gap-1.5 px-3 min-h-11 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">
                  <HeartPulse size={15} /> Family history
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <NewHouseholdModal open={newOpen} onClose={() => setNewOpen(false)} />
      <AddMemberModal household={addTo} onClose={() => setAddTo(null)} />
      <FamilyHistoryPanel householdId={historyFor} onClose={() => setHistoryFor(null)} />
    </div>
  );
}
