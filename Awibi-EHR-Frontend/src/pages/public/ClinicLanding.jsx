import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Stethoscope, CalendarCheck, AlertTriangle, MapPin, Phone, Mail,
  ChevronLeft, Check, Activity,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import api from '../../lib/api';
import Spinner from '../../components/ui/Spinner';

const NAIRA = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });

// ── Symptom checker ─────────────────────────────────────────────────────────
function SymptomChecker({ onDone, onBack }) {
  const [complaint, setComplaint] = useState('');
  const [duration, setDuration] = useState('');
  const [severity, setSeverity] = useState(5);
  const [flags, setFlags] = useState([]);
  const [result, setResult] = useState(null);

  const { data } = useQuery({
    queryKey: ['public-red-flags'],
    queryFn: () => api.get('/public/symptom-checker/red-flags').then(r => r.data),
  });
  const catalogue = data?.redFlags || [];

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post('/public/symptom-checker', { redFlags: flags, severity, duration }).then(r => r.data),
    onSuccess: (d) => setResult(d),
    onError: () => toast.error('Could not check your symptoms. Please call the clinic.'),
  });

  if (result) {
    const emergency = result.routing === 'EMERGENCY';
    return (
      <div className="space-y-4">
        <div className={`rounded-2xl border-2 p-5 ${emergency ? 'bg-red-50 border-red-300' : 'bg-green-50 border-green-300'}`}>
          <div className="flex items-start gap-3">
            {emergency
              ? <AlertTriangle size={26} className="text-red-600 shrink-0" />
              : <Check size={26} className="text-green-600 shrink-0" />}
            <div>
              <h3 className={`text-lg font-bold ${emergency ? 'text-red-900' : 'text-green-900'}`}>{result.urgency}</h3>
              <p className={`text-sm mt-1 ${emergency ? 'text-red-800' : 'text-green-800'}`}>{result.message}</p>
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">{result.disclaimer}</p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button onClick={onBack} className="flex-1 min-h-13 border border-gray-300 rounded-xl text-sm font-medium hover:bg-gray-50">
            Back
          </button>
          {!emergency && (
            <button
              onClick={() => onDone({
                symptomSummary: complaint, symptomDuration: duration, severity,
                redFlags: catalogue.filter(f => flags.includes(f.key)),
                routing: result.routing,
              })}
              className="flex-1 min-h-13 bg-[#2D5BFF] text-white rounded-xl text-sm font-semibold hover:bg-[#1a45e0]">
              Continue to booking
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 min-h-11">
        <ChevronLeft size={16} /> Back
      </button>
      <div>
        <h2 className="text-xl font-bold text-gray-900">How are you feeling?</h2>
        <p className="text-sm text-gray-500 mt-1">
          A few questions to tell you where to be seen. This is not a diagnosis.
        </p>
      </div>

      <div>
        <label htmlFor="sc-complaint" className="block text-sm font-medium text-gray-700 mb-1.5">What is troubling you?</label>
        <textarea id="sc-complaint" rows={2} value={complaint} onChange={e => setComplaint(e.target.value)}
          placeholder="e.g. Fever and headache since yesterday"
          className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm" />
      </div>

      <div>
        <label htmlFor="sc-duration" className="block text-sm font-medium text-gray-700 mb-1.5">How long has it been going on?</label>
        <input id="sc-duration" value={duration} onChange={e => setDuration(e.target.value)}
          placeholder="e.g. 2 days, 3 weeks"
          className="w-full min-h-13 px-3 border border-gray-300 rounded-xl text-sm" />
      </div>

      <div>
        <label htmlFor="sc-sev" className="block text-sm font-medium text-gray-700 mb-1.5">
          How bad is it? <span className="font-bold text-[#2D5BFF]">{severity}/10</span>
        </label>
        <input id="sc-sev" type="range" min={1} max={10} value={severity}
          onChange={e => setSeverity(Number(e.target.value))} className="w-full" />
        <div className="flex justify-between text-xs text-gray-400"><span>Mild</span><span>Severe</span></div>
      </div>

      <div>
        <span className="block text-sm font-medium text-gray-700 mb-2">Do you have any of these? Tap all that apply.</span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {catalogue.map(f => {
            const on = flags.includes(f.key);
            return (
              <button key={f.key} type="button" aria-pressed={on}
                onClick={() => setFlags(v => on ? v.filter(k => k !== f.key) : [...v, f.key])}
                className={`min-h-14 px-4 rounded-xl border-2 text-sm font-medium text-left ${
                  on ? 'bg-red-600 text-white border-red-700' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}>
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      <button onClick={() => mutate()} disabled={isPending}
        className="w-full min-h-14 bg-[#2D5BFF] text-white rounded-xl text-base font-semibold hover:bg-[#1a45e0] disabled:opacity-50">
        {isPending ? 'Checking…' : 'See what to do'}
      </button>
    </div>
  );
}

// ── Booking ─────────────────────────────────────────────────────────────────
function BookingFlow({ slug, clinic, prefill, onBack, onBooked }) {
  const [step, setStep] = useState(1);
  const [doctorId, setDoctorId] = useState('');
  const [slot, setSlot] = useState('');
  const [isReturning, setIsReturning] = useState(false);
  const [lookupValue, setLookupValue] = useState('');
  const [patientRef, setPatientRef] = useState(null);
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', reason: '' });

  const { data: avail, isFetching } = useQuery({
    queryKey: ['public-availability', slug, doctorId],
    queryFn: () => api.get(`/public/clinic/${slug}/availability`, { params: { doctorId } }).then(r => r.data),
    enabled: Boolean(doctorId),
  });

  const { mutate: verify, isPending: verifying } = useMutation({
    mutationFn: () => api.post(`/public/clinic/${slug}/verify-patient`, /^\+?\d[\d\s]*$/.test(lookupValue)
      ? { phone: lookupValue.replace(/\s/g, '') } : { hospitalId: lookupValue }).then(r => r.data),
    onSuccess: (d) => {
      if (d.found) {
        setPatientRef(d.patientRef);
        setForm(f => ({ ...f, fullName: f.fullName || d.firstName }));
        toast.success(`Welcome back, ${d.firstName}`);
      } else {
        toast.info(d.message);
      }
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not check those details'),
  });

  const { mutate: book, isPending: booking } = useMutation({
    mutationFn: () => api.post(`/public/clinic/${slug}/booking`, {
      ...form, doctorId: doctorId || undefined, requestedAt: slot,
      patientRef: patientRef || undefined, ...prefill,
    }).then(r => r.data),
    onSuccess: (d) => onBooked(d),
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not submit your request'),
  });

  const doctors = clinic?.doctors || [];

  return (
    <div className="space-y-5">
      <button onClick={step === 1 ? onBack : () => setStep(s => s - 1)}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 min-h-11">
        <ChevronLeft size={16} /> Back
      </button>

      <div className="flex items-center gap-2">
        {[1, 2, 3].map(n => (
          <div key={n} className={`h-1.5 flex-1 rounded-full ${n <= step ? 'bg-[#2D5BFF]' : 'bg-gray-200'}`} />
        ))}
      </div>

      {step === 1 && (
        <>
          <h2 className="text-xl font-bold text-gray-900">Choose a doctor</h2>
          {!doctors.length ? (
            <p className="text-sm text-gray-500">No doctors are listed yet. Please call the clinic.</p>
          ) : (
            <div className="space-y-2">
              {doctors.map(d => (
                <button key={d.id} onClick={() => { setDoctorId(d.id); setStep(2); }}
                  className={`w-full text-left p-4 rounded-xl border-2 min-h-16 ${
                    doctorId === d.id ? 'border-[#2D5BFF] bg-[#2D5BFF]/5' : 'border-gray-200 hover:bg-gray-50'
                  }`}>
                  <div className="font-semibold text-gray-900">Dr. {d.firstName} {d.lastName}</div>
                  {d.specialty && <div className="text-sm text-gray-500">{d.specialty}</div>}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <h2 className="text-xl font-bold text-gray-900">Pick a time</h2>
          {isFetching ? <div className="py-10 flex justify-center"><Spinner /></div>
            : !avail?.availability?.length ? (
              <p className="text-sm text-gray-500">No free slots in the next week. Please call the clinic.</p>
            ) : (
              <div className="space-y-4">
                {avail.availability.map(day => (
                  <div key={day.date}>
                    <p className="text-sm font-semibold text-gray-900 mb-2">
                      {format(new Date(day.date), 'EEEE d MMMM')}
                    </p>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {day.slots.map(s => (
                        <button key={s} onClick={() => { setSlot(s); setStep(3); }}
                          className={`min-h-12 rounded-lg border text-sm font-medium ${
                            slot === s ? 'border-[#2D5BFF] bg-[#2D5BFF]/5 text-[#2D5BFF]' : 'border-gray-200 hover:bg-gray-50'
                          }`}>
                          {format(new Date(s), 'HH:mm')}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
        </>
      )}

      {step === 3 && (
        <>
          <h2 className="text-xl font-bold text-gray-900">Your details</h2>
          <p className="text-sm text-gray-500">
            {format(new Date(slot), 'EEEE d MMMM, HH:mm')} with Dr. {doctors.find(d => d.id === doctorId)?.lastName}
          </p>

          <div className="flex gap-2">
            <button onClick={() => { setIsReturning(false); setPatientRef(null); }} aria-pressed={!isReturning}
              className={`flex-1 min-h-13 rounded-xl border-2 text-sm font-medium ${!isReturning ? 'border-[#2D5BFF] bg-[#2D5BFF]/5 text-[#2D5BFF]' : 'border-gray-200'}`}>
              I am new here
            </button>
            <button onClick={() => setIsReturning(true)} aria-pressed={isReturning}
              className={`flex-1 min-h-13 rounded-xl border-2 text-sm font-medium ${isReturning ? 'border-[#2D5BFF] bg-[#2D5BFF]/5 text-[#2D5BFF]' : 'border-gray-200'}`}>
              I have been here before
            </button>
          </div>

          {isReturning && (
            <div>
              <label htmlFor="bk-lookup" className="block text-sm font-medium text-gray-700 mb-1.5">Phone number or hospital ID</label>
              <div className="flex gap-2">
                <input id="bk-lookup" value={lookupValue} onChange={e => setLookupValue(e.target.value)}
                  placeholder="08012345678 or AWB-XXXXXXXX"
                  className="flex-1 min-h-13 px-3 border border-gray-300 rounded-xl text-sm" />
                <button onClick={() => verify()} disabled={verifying || !lookupValue}
                  className="px-4 min-h-13 border border-[#2D5BFF] text-[#2D5BFF] rounded-xl text-sm font-medium disabled:opacity-50">
                  {verifying ? '…' : 'Check'}
                </button>
              </div>
              {patientRef && <p className="text-xs text-green-700 mt-1.5">✓ We found your record.</p>}
            </div>
          )}

          <div>
            <label htmlFor="bk-name" className="block text-sm font-medium text-gray-700 mb-1.5">Full name *</label>
            <input id="bk-name" value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
              className="w-full min-h-13 px-3 border border-gray-300 rounded-xl text-sm" />
          </div>
          <div>
            <label htmlFor="bk-phone" className="block text-sm font-medium text-gray-700 mb-1.5">Phone number *</label>
            <input id="bk-phone" type="tel" inputMode="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="08012345678"
              className="w-full min-h-13 px-3 border border-gray-300 rounded-xl text-sm" />
          </div>
          <div>
            <label htmlFor="bk-email" className="block text-sm font-medium text-gray-700 mb-1.5">Email (optional)</label>
            <input id="bk-email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className="w-full min-h-13 px-3 border border-gray-300 rounded-xl text-sm" />
          </div>
          <div>
            <label htmlFor="bk-reason" className="block text-sm font-medium text-gray-700 mb-1.5">Reason for visit</label>
            <textarea id="bk-reason" rows={2} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm" />
          </div>

          <button onClick={() => book()} disabled={booking || !form.fullName || !form.phone}
            className="w-full min-h-14 bg-[#2D5BFF] text-white rounded-xl text-base font-semibold hover:bg-[#1a45e0] disabled:opacity-50">
            {booking ? 'Sending…' : 'Request appointment'}
          </button>
          <p className="text-xs text-gray-500 text-center">
            The clinic will confirm your appointment. You will get a reference number now.
          </p>
        </>
      )}
    </div>
  );
}

export default function ClinicLanding() {
  const { slug } = useParams();
  const [view, setView] = useState('HOME');
  const [prefill, setPrefill] = useState({});
  const [confirmation, setConfirmation] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['public-clinic', slug],
    queryFn: () => api.get(`/public/clinic/${slug}`).then(r => r.data),
  });

  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><Spinner size="lg" /></div>;
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <h1 className="text-lg font-bold text-gray-900">Clinic not found</h1>
          <p className="text-sm text-gray-500 mt-1">Check the link and try again.</p>
        </div>
      </div>
    );
  }

  const clinic = data.clinic;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 py-5">
          <div className="flex items-center gap-3">
            {clinic.logo
              ? <img src={clinic.logo} alt="" className="h-11 w-11 rounded-xl object-cover" />
              : <div className="h-11 w-11 rounded-xl bg-[#2D5BFF]/10 flex items-center justify-center"><Stethoscope size={22} className="text-[#2D5BFF]" /></div>}
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-gray-900 truncate">{clinic.name}</h1>
              <p className="text-xs text-gray-500">
                {clinic.type === 'LAB' ? 'Laboratory & Imaging' : clinic.type[0] + clinic.type.slice(1).toLowerCase()}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        {confirmation ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <Check size={28} className="text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mt-4">Request received</h2>
            <p className="text-sm text-gray-600 mt-2">{confirmation.message}</p>
            <div className="mt-4 bg-gray-50 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-500">Your reference</p>
              <p className="text-lg font-mono font-bold text-[#2D5BFF]">{confirmation.reference}</p>
            </div>
            <p className="text-sm text-gray-500 mt-3">
              {format(new Date(confirmation.requestedAt), 'EEEE d MMMM yyyy, HH:mm')}
            </p>
            <button onClick={() => { setConfirmation(null); setView('HOME'); }}
              className="mt-5 w-full min-h-13 border border-gray-300 rounded-xl text-sm font-medium hover:bg-gray-50">
              Done
            </button>
          </div>
        ) : view === 'HOME' ? (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button onClick={() => setView('BOOK')}
                className="bg-[#2D5BFF] text-white rounded-2xl p-5 text-left min-h-28 hover:bg-[#1a45e0]">
                <CalendarCheck size={26} />
                <div className="font-bold text-lg mt-2">Book appointment</div>
                <div className="text-sm opacity-90">Choose a doctor and time</div>
              </button>
              <button onClick={() => setView('SYMPTOMS')}
                className="bg-white border-2 border-gray-200 rounded-2xl p-5 text-left min-h-28 hover:border-[#2D5BFF]">
                <Activity size={26} className="text-[#2D5BFF]" />
                <div className="font-bold text-lg mt-2 text-gray-900">I have symptoms</div>
                <div className="text-sm text-gray-500">Find out where to be seen</div>
              </button>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-3">Contact</h2>
              <div className="space-y-2 text-sm text-gray-600">
                {clinic.address && <p className="flex items-start gap-2"><MapPin size={15} className="mt-0.5 shrink-0 text-gray-400" />{clinic.address}{clinic.state ? `, ${clinic.state}` : ''}</p>}
                {clinic.phone && <p className="flex items-center gap-2"><Phone size={15} className="text-gray-400" />{clinic.phone}</p>}
                {clinic.email && <p className="flex items-center gap-2"><Mail size={15} className="text-gray-400" />{clinic.email}</p>}
              </div>
            </div>

            {data.doctors?.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h2 className="font-semibold text-gray-900 mb-3">Our doctors</h2>
                <div className="space-y-2">
                  {data.doctors.map(d => (
                    <div key={d.id} className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[#2D5BFF]/10 flex items-center justify-center text-xs font-semibold text-[#2D5BFF]">
                        {d.firstName[0]}{d.lastName[0]}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">Dr. {d.firstName} {d.lastName}</p>
                        {d.specialty && <p className="text-xs text-gray-500">{d.specialty}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.services?.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h2 className="font-semibold text-gray-900 mb-3">Services</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                  {data.services.slice(0, 20).map(s => (
                    <div key={s.name} className="flex items-center justify-between text-sm gap-2">
                      <span className="text-gray-700 truncate">{s.name}</span>
                      {Number(s.price) > 0 && <span className="text-gray-500 shrink-0">{NAIRA.format(Number(s.price))}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : view === 'SYMPTOMS' ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <SymptomChecker
              onBack={() => setView('HOME')}
              onDone={(p) => { setPrefill(p); setView('BOOK'); }}
            />
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <BookingFlow slug={slug} clinic={data} prefill={prefill}
              onBack={() => setView('HOME')} onBooked={setConfirmation} />
          </div>
        )}
      </main>

      <footer className="max-w-3xl mx-auto px-4 py-6 text-center">
        <p className="text-xs text-gray-400">
          In an emergency, go to the nearest emergency unit — do not wait for an appointment.
        </p>
      </footer>
    </div>
  );
}
