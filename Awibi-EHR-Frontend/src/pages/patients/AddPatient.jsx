import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Check, Loader2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';

const STEPS = ['Personal Info', 'Medical Details', 'Emergency Contact'];

const INITIAL = {
  firstName: '', lastName: '', dateOfBirth: '', gender: '', maritalStatus: '', religion: '',
  phone: '', email: '', nin: '', address: '', state: '', lga: '',
  bloodType: '', height: '', weight: '', hmo: '', allergies: '', notes: '',
  emergencyContactName: '', emergencyContactPhone: '', emergencyContactRelationship: '',
};

export default function AddPatient() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(INITIAL);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post('/patients', form),
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ['patients'] });
      toast.success(`Patient registered · Hosp No ${data.mrn} · Patient ID ${data.universalPatientId}`);
      navigate(`/dashboard/patients/${data.id}`);
    },
    onError: err => toast.error(err.response?.data?.error || 'Registration failed'),
  });

  const next = () => { if (step < STEPS.length - 1) setStep(s => s + 1); else mutate(); };
  const back = () => { if (step > 0) setStep(s => s - 1); };

  const Field = ({ label, name, type = 'text', required, options, half }) => (
    <div className={half ? 'col-span-1' : 'col-span-2 sm:col-span-1'}>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      {options ? (
        <select value={form[name]} onChange={set(name)} required={required} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 bg-white">
          <option value="">Select…</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input type={type} value={form[name]} onChange={set(name)} required={required} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
      )}
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto">
      {/* Back */}
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4">
        <ChevronLeft size={18} /> Back to Patients
      </button>

      <h1 className="text-xl font-bold text-gray-900 mb-6">Register New Patient</h1>

      {/* Steps */}
      <div className="flex items-center gap-2 mb-8">
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <div className={`flex items-center gap-2 ${i <= step ? 'text-[#2D5BFF]' : 'text-gray-400'}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${i < step ? 'bg-[#2D5BFF] border-[#2D5BFF] text-white' : i === step ? 'border-[#2D5BFF] text-[#2D5BFF]' : 'border-gray-300'}`}>
                {i < step ? <Check size={13} /> : i + 1}
              </div>
              <span className="text-sm font-medium hidden sm:inline">{s}</span>
            </div>
            {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 ${i < step ? 'bg-[#2D5BFF]' : 'bg-gray-200'}`} />}
          </React.Fragment>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <form onSubmit={e => { e.preventDefault(); next(); }}>
          {step === 0 && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="First name" name="firstName" required />
              <Field label="Last name" name="lastName" required />
              <Field label="Date of birth" name="dateOfBirth" type="date" required />
              <Field label="Gender" name="gender" required options={['MALE','FEMALE','OTHER']} />
              <Field label="Marital status" name="maritalStatus" options={['Single','Married','Divorced','Widowed']} />
              <Field label="Religion" name="religion" options={['Islam','Christianity','Traditional','Other']} />
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone number<span className="text-red-500 ml-0.5">*</span></label>
                <input type="tel" required value={form.phone} onChange={set('phone')} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" placeholder="+234 80 0000 0000" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input type="email" value={form.email} onChange={set('email')} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
              </div>
              <Field label="NIN" name="nin" />
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Home address</label>
                <textarea rows={2} value={form.address} onChange={set('address')} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none" />
              </div>
              <Field label="State" name="state" />
              <Field label="LGA" name="lga" />
            </div>
          )}

          {step === 1 && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Blood type" name="bloodType" options={['A+','A-','B+','B-','AB+','AB-','O+','O-','Unknown']} />
              <Field label="HMO / Insurance" name="hmo" />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Height (cm)</label>
                <input type="number" value={form.height} onChange={set('height')} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" placeholder="e.g. 170" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Weight (kg)</label>
                <input type="number" value={form.weight} onChange={set('weight')} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" placeholder="e.g. 70" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Known allergies</label>
                <textarea rows={2} value={form.allergies} onChange={set('allergies')} placeholder="e.g. Penicillin — rash" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Additional notes</label>
                <textarea rows={3} value={form.notes} onChange={set('notes')} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none" />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Emergency contact name<span className="text-red-500 ml-0.5">*</span></label>
                <input required value={form.emergencyContactName} onChange={set('emergencyContactName')} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Emergency contact phone<span className="text-red-500 ml-0.5">*</span></label>
                <input type="tel" required value={form.emergencyContactPhone} onChange={set('emergencyContactPhone')} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Relationship</label>
                <select value={form.emergencyContactRelationship} onChange={set('emergencyContactRelationship')} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 bg-white">
                  <option value="">Select…</option>
                  {['Spouse','Parent','Child','Sibling','Friend','Other'].map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              <div className="bg-[#2D5BFF]/5 rounded-xl p-4 text-sm text-[#2D5BFF]">
                <strong>Review:</strong> {form.firstName} {form.lastName}, {form.gender}, DOB {form.dateOfBirth}, Phone: {form.phone}
              </div>
            </div>
          )}

          <div className="flex gap-3 mt-6">
            {step > 0 && (
              <button type="button" onClick={back} className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center justify-center gap-1">
                <ChevronLeft size={16} /> Back
              </button>
            )}
            <button type="submit" disabled={isPending} className="flex-1 py-2.5 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50 flex items-center justify-center gap-2">
              {isPending && <Loader2 size={15} className="animate-spin" />}
              {step < STEPS.length - 1 ? (<>Next <ChevronRight size={16} /></>) : (isPending ? 'Registering...' : 'Register Patient')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
