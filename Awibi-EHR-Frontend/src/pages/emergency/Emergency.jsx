import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus, X, UserPlus, Link2, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import api from '../../lib/api';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import PatientPicker from '../../components/clinical/PatientPicker';

// South African Triage Scale colours — the ordering here is the clinical priority.
const TRIAGE = [
  { key: 'RESUSCITATION', label: 'Resuscitation', hint: 'Immediate',      cls: 'bg-red-600 text-white border-red-700' },
  { key: 'EMERGENCY',     label: 'Emergency',     hint: 'Within 10 min',  cls: 'bg-orange-500 text-white border-orange-600' },
  { key: 'URGENT',        label: 'Urgent',        hint: 'Within 1 hour',  cls: 'bg-amber-400 text-amber-950 border-amber-500' },
  { key: 'SEMI_URGENT',   label: 'Semi-urgent',   hint: 'Within 2 hours', cls: 'bg-green-500 text-white border-green-600' },
  { key: 'NON_URGENT',    label: 'Non-urgent',    hint: 'Within 4 hours', cls: 'bg-blue-500 text-white border-blue-600' },
];
const triageOf = (k) => TRIAGE.find((t) => t.key === k) || TRIAGE[2];

function StartEmergencyModal({ open, onClose }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState('UNKNOWN');
  const [patientId, setPatientId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [age, setAge] = useState('');
  const [triage, setTriage] = useState('URGENT');
  const [complaint, setComplaint] = useState('');
  const [flags, setFlags] = useState([]);

  const { data: flagData } = useQuery({
    queryKey: ['emergency-red-flags'],
    queryFn: () => api.get('/emergency/red-flags').then(r => r.data),
    enabled: open,
  });
  const catalogue = flagData?.redFlags || [];

  // Suggest existing records so a known patient is not duplicated.
  const { data: matchData } = useQuery({
    queryKey: ['emergency-match', name, phone],
    queryFn: () => api.get('/emergency/match/suggest', { params: { name, phone } }).then(r => r.data),
    enabled: open && mode === 'UNKNOWN' && (name.length >= 2 || phone.length >= 4),
  });
  const matches = matchData?.matches || [];

  const { mutate, isPending } = useMutation({
    mutationFn: (body) => api.post('/emergency', body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emergency'] });
      qc.invalidateQueries({ queryKey: ['emergency-stats'] });
      toast.success('Emergency encounter started');
      setName(''); setPhone(''); setAge(''); setComplaint(''); setFlags([]); setPatientId(''); setTriage('URGENT');
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not start the encounter'),
  });

  if (!open) return null;

  function submit() {
    if (mode === 'KNOWN' && !patientId) return toast.error('Select the patient');
    if (mode === 'UNKNOWN' && !name.trim()) return toast.error('A name is required — even an approximate one');
    mutate({
      patientId: mode === 'KNOWN' ? patientId : undefined,
      presentingName: mode === 'UNKNOWN' ? name.trim() : undefined,
      presentingPhone: phone || undefined,
      approximateAge: age ? Number(age) : undefined,
      triage,
      chiefComplaint: complaint || undefined,
      redFlags: catalogue.filter(f => flags.includes(f.key)).map(f => ({ ...f, checked: true })),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[94vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-red-600 text-white px-5 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2"><AlertTriangle size={20} /> Start emergency encounter</h2>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 flex items-center justify-center rounded-lg hover:bg-white/15"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode('UNKNOWN')} aria-pressed={mode === 'UNKNOWN'}
              className={`flex-1 min-h-12 rounded-lg border text-sm font-medium ${mode === 'UNKNOWN' ? 'border-red-600 bg-red-50 text-red-700' : 'border-gray-200 hover:bg-gray-50'}`}>
              Unknown / new arrival
            </button>
            <button type="button" onClick={() => setMode('KNOWN')} aria-pressed={mode === 'KNOWN'}
              className={`flex-1 min-h-12 rounded-lg border text-sm font-medium ${mode === 'KNOWN' ? 'border-red-600 bg-red-50 text-red-700' : 'border-gray-200 hover:bg-gray-50'}`}>
              Known patient
            </button>
          </div>

          {mode === 'KNOWN' ? (
            <PatientPicker id="em-patient" value={patientId} onChange={setPatientId} required autoFocus />
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label htmlFor="em-name" className="block text-sm font-medium text-gray-700 mb-1.5">Name (or best guess) *</label>
                  <input id="em-name" value={name} onChange={e => setName(e.target.value)} autoFocus
                    placeholder="e.g. Musa Ibrahim, or Unknown Male"
                    className="w-full min-h-12 px-3 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label htmlFor="em-age" className="block text-sm font-medium text-gray-700 mb-1.5">Approx. age</label>
                  <input id="em-age" type="number" inputMode="numeric" value={age} onChange={e => setAge(e.target.value)}
                    className="w-full min-h-12 px-3 border border-gray-300 rounded-lg text-sm" />
                </div>
              </div>
              <div>
                <label htmlFor="em-phone" className="block text-sm font-medium text-gray-700 mb-1.5">Phone (if known)</label>
                <input id="em-phone" value={phone} onChange={e => setPhone(e.target.value)}
                  className="w-full min-h-12 px-3 border border-gray-300 rounded-lg text-sm" />
              </div>

              {matches.length > 0 && (
                <div className="border border-amber-200 bg-amber-50 rounded-lg p-3">
                  <p className="text-xs font-semibold text-amber-900 mb-2">
                    Possible existing records — attaching avoids a duplicate:
                  </p>
                  <div className="space-y-1.5">
                    {matches.map(m => (
                      <button key={m.id} type="button"
                        onClick={() => { setMode('KNOWN'); setPatientId(m.id); }}
                        className="w-full text-left px-3 min-h-11 bg-white border border-amber-200 rounded-lg text-sm hover:bg-amber-100">
                        {m.firstName} {m.lastName} · <span className="font-mono text-[#2D5BFF]">{m.universalPatientId}</span>
                        {m.phone && <span className="text-gray-500"> · {m.phone}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <div>
            <span className="block text-sm font-medium text-gray-700 mb-1.5">Triage category *</span>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {TRIAGE.map(t => (
                <button key={t.key} type="button" onClick={() => setTriage(t.key)} aria-pressed={triage === t.key}
                  className={`min-h-16 rounded-lg border-2 px-2 py-2 text-xs font-bold transition-all ${
                    triage === t.key ? `${t.cls} scale-[1.03]` : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}>
                  <div>{t.label}</div>
                  <div className="font-normal opacity-80 mt-0.5">{t.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="em-complaint" className="block text-sm font-medium text-gray-700 mb-1.5">Presenting complaint</label>
            <textarea id="em-complaint" rows={2} value={complaint} onChange={e => setComplaint(e.target.value)}
              placeholder="e.g. Collapsed at market, unresponsive"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>

          <div>
            <span className="block text-sm font-medium text-gray-700 mb-1.5">Red flags — tap all that apply</span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {catalogue.map(f => {
                const on = flags.includes(f.key);
                return (
                  <button key={f.key} type="button"
                    onClick={() => setFlags(v => on ? v.filter(k => k !== f.key) : [...v, f.key])}
                    aria-pressed={on}
                    className={`min-h-14 px-3 py-2 rounded-lg border-2 text-xs font-medium text-left transition-colors ${
                      on ? 'bg-red-600 text-white border-red-700' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}>
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-5 py-3 flex gap-3">
          <button onClick={onClose} className="flex-1 min-h-12 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={isPending}
            className="flex-1 min-h-12 bg-red-600 text-white rounded-lg text-sm font-bold hover:bg-red-700 disabled:opacity-50">
            {isPending ? 'Starting…' : 'Start encounter'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReconcileModal({ encounter, onClose }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState('LINK');
  const [targetId, setTargetId] = useState('');
  const [form, setForm] = useState({ firstName: '', lastName: '', dateOfBirth: '', gender: 'MALE', phone: '', address: '' });

  const { mutate: link, isPending: linking } = useMutation({
    mutationFn: () => api.post(`/emergency/${encounter.id}/link`, { targetPatientId: targetId }).then(r => r.data),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['emergency'] });
      const moved = Object.entries(d.moved || {}).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ');
      toast.success(`Linked to ${d.targetPatient.firstName} ${d.targetPatient.lastName}${moved ? ` — moved ${moved}` : ''}`, { duration: 8000 });
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not link'),
  });

  const { mutate: register, isPending: registering } = useMutation({
    mutationFn: () => api.post(`/emergency/${encounter.id}/register`, form).then(r => r.data),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['emergency'] });
      toast.success(`Registered as ${d.patient.universalPatientId}`);
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not register'),
  });

  if (!encounter) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Confirm identity</h2>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 flex items-center justify-center rounded-lg hover:bg-gray-100"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">
            <strong>{encounter.presentingName}</strong> was recorded before identity was confirmed.
            All vitals, results and notes follow the patient — nothing is lost either way.
          </p>

          <div className="flex gap-2">
            <button onClick={() => setTab('LINK')} aria-pressed={tab === 'LINK'}
              className={`flex-1 min-h-12 rounded-lg border text-sm font-medium ${tab === 'LINK' ? 'border-[#2D5BFF] bg-[#2D5BFF]/5 text-[#2D5BFF]' : 'border-gray-200'}`}>
              <Link2 size={15} className="inline mr-1.5" /> Existing patient
            </button>
            <button onClick={() => setTab('NEW')} aria-pressed={tab === 'NEW'}
              className={`flex-1 min-h-12 rounded-lg border text-sm font-medium ${tab === 'NEW' ? 'border-[#2D5BFF] bg-[#2D5BFF]/5 text-[#2D5BFF]' : 'border-gray-200'}`}>
              <UserPlus size={15} className="inline mr-1.5" /> Register new
            </button>
          </div>

          {tab === 'LINK' ? (
            <>
              <PatientPicker id="rec-target" value={targetId} onChange={setTargetId}
                label="Merge this emergency record into" required autoFocus />
              <button onClick={() => link()} disabled={linking || !targetId}
                className="w-full min-h-12 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50">
                {linking ? 'Linking…' : 'Link and merge records'}
              </button>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="rn-first" className="block text-sm font-medium text-gray-700 mb-1.5">First name *</label>
                  <input id="rn-first" value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}
                    className="w-full min-h-12 px-3 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label htmlFor="rn-last" className="block text-sm font-medium text-gray-700 mb-1.5">Last name *</label>
                  <input id="rn-last" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}
                    className="w-full min-h-12 px-3 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label htmlFor="rn-dob" className="block text-sm font-medium text-gray-700 mb-1.5">Date of birth</label>
                  <input id="rn-dob" type="date" value={form.dateOfBirth} onChange={e => setForm(f => ({ ...f, dateOfBirth: e.target.value }))}
                    className="w-full min-h-12 px-3 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label htmlFor="rn-gender" className="block text-sm font-medium text-gray-700 mb-1.5">Gender</label>
                  <select id="rn-gender" value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}
                    className="w-full min-h-12 px-3 border border-gray-300 rounded-lg text-sm bg-white">
                    <option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option>
                  </select>
                </div>
              </div>
              <button onClick={() => register()} disabled={registering || !form.firstName || !form.lastName}
                className="w-full min-h-12 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50">
                {registering ? 'Registering…' : 'Complete registration'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Emergency() {
  const [open, setOpen] = useState(false);
  const [reconcile, setReconcile] = useState(null);
  const navigate = useNavigate();

  /**
   * Open the resuscitation board for this patient.
   *
   * If someone else has already started one, the API says so and returns the
   * running record — so a second responder joins the existing board instead of
   * creating a second, half-complete account of the same arrest.
   */
  const startResus = async (encounter) => {
    try {
      const { data: created } = await api.post('/emergency/resuscitation', {
        patientId: encounter.patientId,
        emergencyEncounterId: encounter.id,
        type: 'CODE_BLUE',
        protocols: ['ACLS'],
      });
      navigate(`/dashboard/emergency/resuscitation/${created.id}`);
    } catch (err) {
      const running = err?.response?.data?.eventId;
      if (running) {
        toast.info('Joining the resuscitation already in progress');
        navigate(`/dashboard/emergency/resuscitation/${running}`);
        return;
      }
      toast.error(err?.response?.data?.error || 'Could not open the resuscitation board');
    }
  };

  const { data: stats } = useQuery({
    queryKey: ['emergency-stats'],
    queryFn: () => api.get('/emergency/stats').then(r => r.data),
    refetchInterval: 30000,
  });
  const { data, isLoading } = useQuery({
    queryKey: ['emergency'],
    queryFn: () => api.get('/emergency', { params: { status: 'ACTIVE' } }).then(r => r.data),
    refetchInterval: 30000,
  });

  const encounters = data?.encounters || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Emergency</h1>
          <p className="text-sm text-gray-500">Triage board — most urgent first</p>
        </div>
        <button onClick={() => setOpen(true)}
          className="flex items-center justify-center gap-2 px-5 min-h-13 bg-red-600 text-white rounded-lg text-sm font-bold hover:bg-red-700">
          <AlertTriangle size={18} /> Start emergency
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500">Active</p>
          <p className="text-2xl font-bold text-gray-900">{stats?.active ?? 0}</p>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-200 p-4">
          <p className="text-xs font-medium text-red-700">Critical triage</p>
          <p className="text-2xl font-bold text-red-800">{stats?.criticalTriage ?? 0}</p>
        </div>
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
          <p className="text-xs font-medium text-amber-800">Awaiting ID</p>
          <p className="text-2xl font-bold text-amber-900">{stats?.awaitingIdentification ?? 0}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="py-16 flex justify-center"><Spinner size="lg" /></div>
        ) : !encounters.length ? (
          <EmptyState icon={AlertTriangle} title="No active emergencies"
            description="Start an encounter the moment a patient arrives — identity can be confirmed afterwards." />
        ) : (
          <div className="divide-y divide-gray-100">
            {encounters.map(e => {
              const t = triageOf(e.triage);
              const flags = Array.isArray(e.redFlags) ? e.redFlags : [];
              return (
                <div key={e.id} className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                    <span className={`px-3 py-1.5 rounded-lg border-2 text-xs font-bold shrink-0 self-start ${t.cls}`}>
                      {t.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-gray-900">
                          {e.patient.firstName} {e.patient.lastName}
                        </span>
                        {e.patient.isEmergencyTemp && (
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded text-xs font-medium">
                            identity not confirmed
                          </span>
                        )}
                        <span className="font-mono text-xs text-[#2D5BFF]">{e.patient.universalPatientId}</span>
                      </div>
                      {e.chiefComplaint && <p className="text-sm text-gray-600 mt-1">{e.chiefComplaint}</p>}
                      {flags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {flags.map(f => (
                            <span key={f.key} className="px-2 py-0.5 bg-red-100 text-red-800 rounded text-xs font-medium">
                              {f.label}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 mt-2 text-xs text-gray-400">
                        <Clock size={12} />
                        waiting {formatDistanceToNow(new Date(e.createdAt))}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      {/* Reaching the board must never take more than one tap
                          from the board a nurse is already looking at. */}
                      <button onClick={() => startResus(e)}
                        className="px-4 min-h-11 bg-red-700 text-white rounded-lg text-sm font-semibold hover:bg-red-800">
                        Resuscitation
                      </button>
                      {e.patient.isEmergencyTemp && (
                        <button onClick={() => setReconcile(e)}
                          className="px-4 min-h-11 border border-[#2D5BFF] text-[#2D5BFF] rounded-lg text-sm font-medium hover:bg-[#2D5BFF]/5">
                          Confirm identity
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <StartEmergencyModal open={open} onClose={() => setOpen(false)} />
      <ReconcileModal encounter={reconcile} onClose={() => setReconcile(null)} />
    </div>
  );
}
