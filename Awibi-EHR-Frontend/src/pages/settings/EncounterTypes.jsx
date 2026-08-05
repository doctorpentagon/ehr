import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Lock, Clock, MapPin, Users } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import Spinner from '@/components/ui/Spinner';

/**
 * Encounter classification and the clinic timetable.
 *
 * These are the categories every report, price list and clinic board is built
 * on, so the screen is deliberately plain and hard to get wrong: built-in types
 * are visibly locked, and a type already used by encounters is deactivated
 * rather than deleted.
 */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function TypeForm({ onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', description: '', defaultDurationMins: '' });

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post('/encounter-types', {
      ...form,
      defaultDurationMins: form.defaultDurationMins === '' ? null : Number(form.defaultDurationMins),
    }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['encounter-types-admin'] });
      toast.success('Encounter type added');
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not add the type'),
  });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">New encounter type</h3>
          <button onClick={onClose} className="w-11 h-11 -mr-2 flex items-center justify-center text-gray-400"><X size={18} /></button>
        </div>

        <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
        <input value={form.name} onChange={set('name')} autoFocus placeholder="e.g. Antenatal Clinic"
          className="w-full min-h-11 px-3 border border-gray-300 rounded-lg text-sm mb-3" />

        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
        <input value={form.description} onChange={set('description')} placeholder="Optional"
          className="w-full min-h-11 px-3 border border-gray-300 rounded-lg text-sm mb-3" />

        <label className="block text-sm font-medium text-gray-700 mb-1">Typical length (minutes)</label>
        <input type="number" min="1" value={form.defaultDurationMins} onChange={set('defaultDurationMins')} placeholder="Optional"
          className="w-full min-h-11 px-3 border border-gray-300 rounded-lg text-sm mb-4" />
        <p className="text-xs text-gray-500 -mt-3 mb-4">Used when building a clinic timetable</p>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 min-h-11 border border-gray-300 rounded-lg text-sm">Cancel</button>
          <button onClick={() => mutate()} disabled={isPending || !form.name.trim()}
            className="flex-1 min-h-11 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {isPending ? 'Adding…' : 'Add type'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ScheduleForm({ types, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    encounterTypeId: '', departmentId: '', dayOfWeek: 1,
    startTime: '08:00', endTime: '14:00', location: '', maxPatients: '',
  });
  const [doctorIds, setDoctorIds] = useState([]);

  const { data: staff } = useQuery({
    queryKey: ['staff-for-clinics'],
    queryFn: () => api.get('/staff').then((r) => r.data?.staff || r.data?.users || r.data || []),
  });
  const { data: departments } = useQuery({
    queryKey: ['departments-for-clinics'],
    queryFn: () => api.get('/departments').then((r) => r.data?.departments || r.data || []),
  });

  const doctors = (staff || []).filter((u) => u.subRole === 'DOCTOR');

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post('/encounter-types/schedules', {
      ...form,
      dayOfWeek: Number(form.dayOfWeek),
      departmentId: form.departmentId || undefined,
      maxPatients: form.maxPatients === '' ? null : Number(form.maxPatients),
      doctorIds,
    }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clinic-schedules'] });
      toast.success('Clinic added to the timetable');
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not add the clinic'),
  });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">New clinic</h3>
          <button onClick={onClose} className="w-11 h-11 -mr-2 flex items-center justify-center text-gray-400"><X size={18} /></button>
        </div>

        <label className="block text-sm font-medium text-gray-700 mb-1">Encounter type</label>
        <select value={form.encounterTypeId} onChange={set('encounterTypeId')}
          className="w-full min-h-11 px-3 border border-gray-300 rounded-lg text-sm mb-3">
          <option value="">Choose…</option>
          {(types || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Day</label>
            <select value={form.dayOfWeek} onChange={set('dayOfWeek')}
              className="w-full min-h-11 px-3 border border-gray-300 rounded-lg text-sm">
              {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
            <select value={form.departmentId} onChange={set('departmentId')}
              className="w-full min-h-11 px-3 border border-gray-300 rounded-lg text-sm">
              <option value="">None</option>
              {(departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Starts</label>
            <input type="time" value={form.startTime} onChange={set('startTime')}
              className="w-full min-h-11 px-3 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ends</label>
            <input type="time" value={form.endTime} onChange={set('endTime')}
              className="w-full min-h-11 px-3 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Room</label>
            <input value={form.location} onChange={set('location')} placeholder="Consulting Room 3"
              className="w-full min-h-11 px-3 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Max patients</label>
            <input type="number" min="1" value={form.maxPatients} onChange={set('maxPatients')} placeholder="Optional"
              className="w-full min-h-11 px-3 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>

        <span className="block text-sm font-medium text-gray-700 mb-1.5">Clinicians running it</span>
        <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto mb-4">
          {doctors.length === 0 ? (
            <p className="text-sm text-gray-500 p-3">No doctors on staff yet.</p>
          ) : doctors.map((d) => (
            <label key={d.id} className="flex items-center gap-2.5 px-3 py-2.5 border-b border-gray-100 last:border-0 cursor-pointer">
              <input type="checkbox" checked={doctorIds.includes(d.id)}
                onChange={(e) => setDoctorIds((ids) => (e.target.checked ? [...ids, d.id] : ids.filter((x) => x !== d.id)))} />
              <span className="text-sm text-gray-800">
                {d.firstName} {d.lastName}
                {d.specialty && <span className="text-gray-500 text-xs ml-1.5">{d.specialty}</span>}
              </span>
            </label>
          ))}
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 min-h-11 border border-gray-300 rounded-lg text-sm">Cancel</button>
          <button onClick={() => mutate()} disabled={isPending || !form.encounterTypeId}
            className="flex-1 min-h-11 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {isPending ? 'Adding…' : 'Add clinic'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function EncounterTypes() {
  const qc = useQueryClient();
  const [addType, setAddType] = useState(false);
  const [addClinic, setAddClinic] = useState(false);

  const { data: typeData, isLoading } = useQuery({
    queryKey: ['encounter-types-admin'],
    queryFn: () => api.get('/encounter-types?includeInactive=true').then((r) => r.data),
  });
  const { data: scheduleData } = useQuery({
    queryKey: ['clinic-schedules'],
    queryFn: () => api.get('/encounter-types/schedules?dayOfWeek=ALL').then((r) => r.data),
  });

  const { mutate: toggle } = useMutation({
    mutationFn: ({ id, isActive }) => api.put(`/encounter-types/${id}`, { isActive }).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['encounter-types-admin'] }); toast.success('Updated'); },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not update'),
  });

  const { mutate: removeClinic } = useMutation({
    mutationFn: (id) => api.delete(`/encounter-types/schedules/${id}`).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clinic-schedules'] }); toast.success('Clinic removed'); },
  });

  if (isLoading) return <div className="py-16 flex justify-center"><Spinner size="lg" /></div>;

  const types = typeData?.types || [];
  const schedules = scheduleData?.schedules || [];
  const byDay = DAYS.map((name, i) => ({ name, clinics: schedules.filter((s) => s.dayOfWeek === i) }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Encounter types &amp; clinics</h1>
        <p className="text-sm text-gray-500">
          What kind of contact each encounter was, and which clinics run on which days.
        </p>
      </div>

      <section className="bg-white rounded-xl border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-900">Encounter types</h2>
          <button onClick={() => setAddType(true)}
            className="flex items-center gap-1.5 px-3 min-h-11 bg-[#2D5BFF] text-white rounded-lg text-sm">
            <Plus size={15} /> Add
          </button>
        </div>
        <ul className="divide-y divide-gray-100">
          {types.map((t) => (
            <li key={t.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${t.isActive ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
                    {t.name}
                  </span>
                  {t.isSystem && (
                    <span title="Built in — cannot be renamed or deleted"
                      className="flex items-center gap-1 text-xs text-gray-500">
                      <Lock size={11} /> built in
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {t.description || 'No description'}
                  {t.defaultDurationMins ? ` · ${t.defaultDurationMins} min` : ''}
                  {t._count?.cases > 0 ? ` · ${t._count.cases} encounter${t._count.cases === 1 ? '' : 's'}` : ''}
                </div>
              </div>
              <button onClick={() => toggle({ id: t.id, isActive: !t.isActive })}
                className="px-3 min-h-11 border border-gray-300 rounded-lg text-sm text-gray-700">
                {t.isActive ? 'Deactivate' : 'Reactivate'}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white rounded-xl border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-900">Clinic timetable</h2>
          <button onClick={() => setAddClinic(true)}
            className="flex items-center gap-1.5 px-3 min-h-11 bg-[#2D5BFF] text-white rounded-lg text-sm">
            <Plus size={15} /> Add clinic
          </button>
        </div>

        {schedules.length === 0 ? (
          <p className="text-sm text-gray-500 p-6 text-center">
            No clinics yet. Add one so doctors see what they are running and patients can be offered real slots.
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {byDay.filter((d) => d.clinics.length > 0).map(({ name, clinics }) => (
              <div key={name} className="px-4 py-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{name}</h3>
                <ul className="space-y-2">
                  {clinics.map((c) => (
                    <li key={c.id} className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900">{c.encounterType?.name}</div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-600 mt-0.5">
                          <span className="flex items-center gap-1"><Clock size={11} /> {c.startTime}–{c.endTime}</span>
                          {c.location && <span className="flex items-center gap-1"><MapPin size={11} /> {c.location}</span>}
                          {c.department?.name && <span>{c.department.name}</span>}
                          {c.maxPatients && <span className="flex items-center gap-1"><Users size={11} /> max {c.maxPatients}</span>}
                        </div>
                        {c.doctors?.length > 0 && (
                          <div className="text-xs text-gray-500 mt-0.5">
                            {c.doctors.map((d) => `${d.firstName} ${d.lastName}`).join(', ')}
                          </div>
                        )}
                      </div>
                      <button onClick={() => removeClinic(c.id)}
                        className="px-3 min-h-11 border border-gray-300 rounded-lg text-sm text-gray-600">
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {addType && <TypeForm onClose={() => setAddType(false)} />}
      {addClinic && <ScheduleForm types={types.filter((t) => t.isActive)} onClose={() => setAddClinic(false)} />}
    </div>
  );
}
