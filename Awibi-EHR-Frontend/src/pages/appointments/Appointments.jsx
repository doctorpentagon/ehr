import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Calendar, Clock, Search, Edit2, X, CreditCard, CheckCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { addDays, addMonths, addWeeks, eachDayOfInterval, endOfDay, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfDay, startOfMonth, startOfWeek, subMonths, subWeeks } from 'date-fns';
import api from '@/lib/api';
import PatientPicker from '@/components/clinical/PatientPicker';
import StatusBadge from '@/components/ui/StatusBadge';
import Avatar from '@/components/ui/Avatar';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import { toast } from 'sonner';

const VISIT_TYPES = ['CONSULTATION', 'FOLLOW_UP', 'EMERGENCY', 'ROUTINE', 'PROCEDURE', 'SPECIALIST'];
const STATUSES = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];

const PAY_COLOR = {
  PAID:    'bg-green-100 text-green-700',
  UNPAID:  'bg-red-100 text-red-700',
  WAIVED:  'bg-gray-100 text-gray-600',
};

export default function Appointments() {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const presetPatientId = searchParams.get('patientId') || '';
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [modal, setModal] = useState(presetPatientId ? 'add' : null); // null | 'add' | appt object
  const [payAppt, setPayAppt] = useState(null);
  const [calendarView, setCalendarView] = useState('MONTH');
  const [calendarDate, setCalendarDate] = useState(new Date());

  const calendarStart = calendarView === 'DAY'
    ? startOfDay(calendarDate)
    : calendarView === 'WEEK'
      ? startOfWeek(calendarDate, { weekStartsOn: 1 })
      : startOfWeek(startOfMonth(calendarDate), { weekStartsOn: 1 });
  const calendarEnd = calendarView === 'DAY'
    ? endOfDay(calendarDate)
    : calendarView === 'WEEK'
      ? endOfWeek(calendarDate, { weekStartsOn: 1 })
      : endOfWeek(endOfMonth(calendarDate), { weekStartsOn: 1 });

  const { data, isLoading } = useQuery({
    queryKey: ['appointments', search, statusFilter, dateFilter],
    queryFn: () => api.get('/appointments', { params: { search, status: statusFilter, date: dateFilter, limit: 40 } }).then(r => r.data),
  });

  const appts = data?.appointments || data || [];

  const { data: calendarData, isLoading: calendarLoading } = useQuery({
    queryKey: ['appointments-calendar', calendarView, calendarStart.toISOString(), calendarEnd.toISOString(), statusFilter],
    queryFn: () => api.get('/appointments', {
      params: { startDate: calendarStart.toISOString(), endDate: calendarEnd.toISOString(), status: statusFilter, limit: 500 },
    }).then(r => r.data),
  });
  const calendarAppointments = calendarData?.appointments || calendarData || [];
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const { mutate: updateStatus } = useMutation({
    mutationFn: ({ id, status }) => api.put(`/appointments/${id}`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['appointments'] }); toast.success('Status updated'); },
    onError: () => toast.error('Failed to update status'),
  });

  const { mutate: cancelAppt } = useMutation({
    mutationFn: id => api.put(`/appointments/${id}`, { status: 'CANCELLED' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['appointments'] }); toast.success('Appointment cancelled'); },
    onError: () => toast.error('Failed to cancel'),
  });

  const today = appts.filter(a => a.scheduledAt && format(new Date(a.scheduledAt), 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd'));
  const scheduled = appts.filter(a => a.status === 'SCHEDULED' || a.status === 'CONFIRMED');
  const moveCalendar = (direction) => {
    if (calendarView === 'DAY') setCalendarDate(current => addDays(current, direction));
    else if (calendarView === 'WEEK') setCalendarDate(current => direction > 0 ? addWeeks(current, 1) : subWeeks(current, 1));
    else setCalendarDate(current => direction > 0 ? addMonths(current, 1) : subMonths(current, 1));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Appointments</h1>
          <p className="text-sm text-gray-500">{appts.length} appointments · {today.length} today · {scheduled.length} upcoming</p>
        </div>
        <button onClick={() => setModal('add')}
          className="flex items-center gap-2 px-4 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]">
          <Plus size={16} /> Book Appointment
        </button>
      </div>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => moveCalendar(-1)} aria-label="Previous period" className="flex size-10 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50"><ChevronLeft size={17} /></button>
            <button type="button" onClick={() => setCalendarDate(new Date())} className="min-h-10 rounded-lg border border-gray-200 px-3 text-sm font-medium hover:bg-gray-50">Today</button>
            <button type="button" onClick={() => moveCalendar(1)} aria-label="Next period" className="flex size-10 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50"><ChevronRight size={17} /></button>
            <h2 className="ml-1 text-sm font-semibold text-gray-900">
              {calendarView === 'DAY' ? format(calendarDate, 'EEEE, d MMMM yyyy') : calendarView === 'WEEK' ? `${format(calendarStart, 'd MMM')} – ${format(calendarEnd, 'd MMM yyyy')}` : format(calendarDate, 'MMMM yyyy')}
            </h2>
          </div>
          <div className="inline-flex rounded-lg bg-gray-100 p-1">
            {['DAY', 'WEEK', 'MONTH'].map(view => (
              <button key={view} type="button" onClick={() => setCalendarView(view)} className={`min-h-9 rounded-md px-3 text-xs font-semibold ${calendarView === view ? 'bg-white text-[#2D5BFF] shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>{view.charAt(0) + view.slice(1).toLowerCase()}</button>
            ))}
          </div>
        </div>
        {calendarLoading ? <div className="flex min-h-48 items-center justify-center"><Spinner /></div> : (
          <div className={`grid ${calendarView === 'DAY' ? 'grid-cols-1' : 'grid-cols-7'} overflow-x-auto`}>
            {calendarView !== 'DAY' && calendarDays.slice(0, 7).map(day => (
              <div key={`heading-${day.toISOString()}`} className="min-w-28 border-b border-r border-gray-100 bg-gray-50 px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500">{format(day, 'EEE')}</div>
            ))}
            {calendarDays.map(day => {
              const dayAppointments = calendarAppointments.filter(item => item.scheduledAt && isSameDay(new Date(item.scheduledAt), day));
              return (
                <button key={day.toISOString()} type="button" onClick={() => setDateFilter(format(day, 'yyyy-MM-dd'))}
                  className={`${calendarView === 'DAY' ? 'min-h-52' : calendarView === 'WEEK' ? 'min-h-52 min-w-28' : 'min-h-28 min-w-28'} border-b border-r border-gray-100 p-2 text-left align-top hover:bg-blue-50/30 ${calendarView === 'MONTH' && !isSameMonth(day, calendarDate) ? 'bg-gray-50/60 text-gray-400' : 'bg-white'}`}>
                  <span className={`inline-flex size-7 items-center justify-center rounded-full text-xs font-semibold ${isSameDay(day, new Date()) ? 'bg-[#2D5BFF] text-white' : 'text-gray-700'}`}>{format(day, 'd')}</span>
                  <div className="mt-1 space-y-1">
                    {dayAppointments.slice(0, calendarView === 'MONTH' ? 3 : 8).map(item => (
                      <div key={item.id} className={`truncate rounded px-1.5 py-1 text-[10px] font-medium ${item.status === 'CANCELLED' ? 'bg-gray-100 text-gray-500 line-through' : item.status === 'CONFIRMED' ? 'bg-green-50 text-green-800' : 'bg-blue-50 text-blue-800'}`}>
                        {format(new Date(item.scheduledAt), 'HH:mm')} {item.patient?.firstName} {item.patient?.lastName}
                      </div>
                    ))}
                    {dayAppointments.length > (calendarView === 'MONTH' ? 3 : 8) && <div className="text-[10px] font-medium text-gray-500">+{dayAppointments.length - (calendarView === 'MONTH' ? 3 : 8)} more</div>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
        <div className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">Select a date to filter the detailed appointment list below.</div>
      </section>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or Patient ID…"
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 bg-gray-50" />
        </div>
        <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)}
          className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30">
          <option value="">All Status</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        {(search || statusFilter || dateFilter) && (
          <button onClick={() => { setSearch(''); setStatusFilter(''); setDateFilter(''); }}
            className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-500 hover:bg-gray-50">
            Clear
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="py-16 flex justify-center"><Spinner /></div>
      ) : appts.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title="No appointments found"
          description="Book an appointment to get started, or adjust your filters."
          action={{ label: 'Book Appointment', onClick: () => setModal('add') }}
        />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Date/Time', 'Patient', 'Doctor', 'Type', 'Status', 'Payment', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {appts.map(a => (
                <tr key={a.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="font-semibold text-gray-900">{a.scheduledAt ? format(new Date(a.scheduledAt), 'dd MMM') : '—'}</div>
                    <div className="text-xs text-gray-400 flex items-center gap-1">
                      <Clock size={10} />
                      {a.scheduledAt ? format(new Date(a.scheduledAt), 'HH:mm') : '—'}
                      {a.duration ? ` · ${a.duration}min` : ''}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Avatar name={`${a.patient?.firstName} ${a.patient?.lastName}`} size="sm" />
                      <div>
                        <div className="font-medium text-gray-900">{a.patient?.firstName} {a.patient?.lastName}</div>
                        <div className="text-xs font-mono text-gray-400">{a.patient?.universalPatientId}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">
                    {a.doctor ? `Dr. ${a.doctor.lastName}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-[#2D5BFF]/10 text-[#2D5BFF] px-2 py-0.5 rounded-full font-medium">
                      {a.visitType?.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <select value={a.status}
                      onChange={e => updateStatus({ id: a.id, status: e.target.value })}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-[#2D5BFF]/30">
                      {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium w-fit ${PAY_COLOR[a.paymentStatus] || 'bg-gray-100 text-gray-500'}`}>
                        {a.paymentStatus || 'UNPAID'}
                      </span>
                      {a.charges > 0 && (
                        <span className="text-xs text-gray-400">₦{Number(a.charges).toLocaleString()}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setModal(a)}
                        className="p-1.5 text-gray-400 hover:text-[#2D5BFF] hover:bg-[#2D5BFF]/10 rounded-lg">
                        <Edit2 size={13} />
                      </button>
                      {a.charges > 0 && a.paymentStatus !== 'PAID' && (
                        <button onClick={() => setPayAppt(a)}
                          className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg"
                          title="Record payment">
                          <CreditCard size={13} />
                        </button>
                      )}
                      {a.status !== 'CANCELLED' && a.status !== 'COMPLETED' && (
                        <button onClick={() => cancelAppt(a.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          title="Cancel">
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <AppointmentModal
          open={!!modal}
          onClose={() => setModal(null)}
          initial={modal !== 'add' ? modal : null}
          initialPatientId={presetPatientId}
        />
      )}

      {payAppt && (
        <PayModal appt={payAppt} onClose={() => setPayAppt(null)} />
      )}
    </div>
  );
}

function AppointmentModal({ open, onClose, initial, initialPatientId = '' }) {
  const qc = useQueryClient();
  const isEdit = !!initial;
  const [form, setForm] = useState({
    patientId: initialPatientId,
    doctorId: '',
    scheduledAt: '',
    duration: 30,
    visitType: 'CONSULTATION',
    charges: '',
    paymentStatus: 'UNPAID',
    remarks: '',
    ...( initial ? {
      patientId: initial.patientId || '',
      doctorId: initial.doctorId || '',
      scheduledAt: initial.scheduledAt ? initial.scheduledAt.slice(0, 16) : '',
      duration: initial.duration || 30,
      visitType: initial.visitType || 'CONSULTATION',
      charges: initial.charges || '',
      paymentStatus: initial.paymentStatus || 'UNPAID',
      remarks: initial.remarks || '',
    } : {}),
  });

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const { data: sData } = useQuery({
    queryKey: ['staff-doctors'],
    queryFn: () => api.get('/staff', { params: { subRole: 'DOCTOR', limit: 50 } }).then(r => r.data),
  });
  const doctors = sData?.staff || sData || [];

  const { mutate, isPending } = useMutation({
    mutationFn: () => isEdit
      ? api.put(`/appointments/${initial.id}`, form)
      : api.post('/appointments', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] });
      toast.success(isEdit ? 'Appointment updated' : 'Appointment booked');
      onClose();
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed'),
  });

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Appointment' : 'Book Appointment'} size="md">
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <PatientPicker value={form.patientId} onChange={(id) => setForm(f => ({ ...f, patientId: id }))} required autoFocus />
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Doctor</label>
            <select value={form.doctorId} onChange={set('doctorId')}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30">
              <option value="">Auto-assign</option>
              {doctors.map(d => (
                <option key={d.id} value={d.id}>Dr. {d.firstName} {d.lastName}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Date & Time <span className="text-red-500">*</span></label>
            <input type="datetime-local" value={form.scheduledAt} onChange={set('scheduledAt')}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Duration (min)</label>
            <input type="number" value={form.duration} onChange={set('duration')} min={10} max={240}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Visit Type</label>
            <select value={form.visitType} onChange={set('visitType')}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30">
              {VISIT_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Consultation Charges (₦)</label>
            <input type="number" value={form.charges} onChange={set('charges')} placeholder="0"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
          </div>
        </div>

        {(isEdit || Number(form.charges) > 0) && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Payment Status</label>
            <select value={form.paymentStatus} onChange={set('paymentStatus')}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30">
              <option value="UNPAID">Unpaid</option>
              <option value="PART_PAID">Part Paid</option>
              <option value="PAID">Paid</option>
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Remarks / Chief Complaint</label>
          <textarea value={form.remarks} onChange={set('remarks')} rows={2}
            placeholder="Reason for visit…"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none" />
        </div>

        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={() => mutate()}
            disabled={isPending || !form.patientId || !form.scheduledAt}
            className="flex-1 py-2.5 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50">
            {isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Book Appointment'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PayModal({ appt, onClose }) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);

  const markPaid = async () => {
    setLoading(true);
    try {
      await api.put(`/appointments/${appt.id}`, { paymentStatus: 'PAID' });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      toast.success('Payment recorded');
      onClose();
    } catch {
      toast.error('Failed to record payment');
    } finally {
      setLoading(false);
    }
  };

  const payViaPaystack = async () => {
    setLoading(true);
    try {
      const { data } = await api.post('/paystack/initialize', {
        amount: Number(appt.charges),
        email: appt.patient?.email || 'patient@awibi.health',
        appointmentId: appt.id,
        metadata: { appointmentId: appt.id, patientId: appt.patientId },
      });
      if (data.authorizationUrl) {
        window.open(data.authorizationUrl, '_blank');
        onClose();
        toast.success('Paystack payment window opened');
      }
    } catch {
      toast.error('Could not initiate payment');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open title="Record Payment" onClose={onClose} size="sm">
      <div className="p-6 space-y-4">
        <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Patient</span>
            <span className="font-medium">{appt.patient?.firstName} {appt.patient?.lastName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Visit Type</span>
            <span>{appt.visitType?.replace(/_/g, ' ')}</span>
          </div>
          <div className="flex justify-between border-t border-gray-200 pt-2">
            <span className="font-semibold">Amount Due</span>
            <span className="font-bold text-[#2D5BFF]">₦{Number(appt.charges).toLocaleString()}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button onClick={markPaid} disabled={loading}
            className="py-2.5 border-2 border-green-500 text-green-700 rounded-lg text-sm font-medium hover:bg-green-50 disabled:opacity-50 flex items-center justify-center gap-1.5">
            <CheckCircle size={14} /> Mark Paid (Cash)
          </button>
          <button onClick={payViaPaystack} disabled={loading}
            className="py-2.5 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50 flex items-center justify-center gap-1.5">
            <CreditCard size={14} /> Pay via Paystack
          </button>
        </div>
        <button onClick={onClose} className="w-full py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
      </div>
    </Modal>
  );
}
