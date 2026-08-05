import React, { useState } from 'react';
import { HelpCircle, ChevronDown, ChevronUp, Phone, Mail, MessageSquare } from 'lucide-react';

const FAQS = [
  { q: 'How do I register a new patient?', a: 'Go to Patients → New Patient or click the Lookup button and enter a Patient ID. Fill in the 3-step registration form. The system will automatically generate a Patient ID in the format AWB-XXXXXXXX, plus a Hosp No for this facility.' },
  { q: 'What is the difference between a Patient ID and a Hosp No?', a: 'The Hosp No is the chart number this hospital uses for its own records, for example UCH-26-001234. The Patient ID is the AWB-XXXXXXXX identifier that stays with the person across every facility using AwibiEHR, so their record can be found after a transfer or referral.' },
  { q: 'Can multiple staff log in at the same time?', a: 'Yes. Each staff member has their own account with their specific role and permissions. You can add staff under Staff Management. Staff can log in using their email or their Staff ID (e.g. UCH-STF-100001).' },
  { q: 'Does AwibiEHR work offline?', a: 'Key actions (patient lookup, vital signs, notes, appointments) are queued locally using IndexedDB when offline and automatically synced when the connection is restored.' },
  { q: 'How do I record a lab result?', a: 'Go to Lab & Imaging, find the pending request, and click "Enter Result". Fill in the result text and any clinical interpretation. The status will automatically update to Completed.' },
  { q: 'How do I upgrade my subscription?', a: 'Go to Subscription in the left sidebar. Choose a plan and click Upgrade. Payment is processed securely via Paystack. Your limits are immediately updated after payment.' },
  { q: 'Is patient data secure?', a: 'Yes. AwibiEHR is built in compliance with the Nigeria Data Protection Act (NDPA) 2023. All PHI access is logged with audit trails, data is encrypted in transit, and no PHI is stored in URLs or logs.' },
  { q: 'How do I reset a staff member\'s password?', a: 'Go to Staff, find the staff member, and click the key icon (Reset Password). A temporary password will be shown once — share it with the staff member who should change it on first login.' },
  { q: 'Can I use voice recordings for consultations?', a: 'Yes. When creating a new encounter, select "Voice Recording" as the method. You\'ll be able to record the consultation audio directly. The system stores the audio and allows you to add notes alongside it.' },
  { q: 'How do I admit a patient to a bed?', a: 'Go to Admissions, click Admit Patient. Select the patient, choose an available bed, and enter the diagnosis. The bed status will automatically update to Occupied.' },
];

export default function Support() {
  const [open, setOpen] = useState(null);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Support & Help</h1>
        <p className="text-sm text-gray-500">Frequently asked questions and contact information</p>
      </div>

      {/* Contact cards */}
      <div className="grid sm:grid-cols-3 gap-4">
        {[
          { Icon: Phone, label: 'Call us', value: '+234 817 779 0294', sub: 'Mon–Fri, 8am–6pm' },
          { Icon: Mail, label: 'Email', value: 'support@awibihealth.com', sub: '24h response time' },
          { Icon: MessageSquare, label: 'WhatsApp', value: '+234 817 779 0294', sub: 'Quick answers' },
        ].map(({ Icon, label, value, sub }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-xl p-4 text-center hover:shadow-md transition-shadow">
            <div className="w-10 h-10 bg-[#2D5BFF]/10 rounded-xl flex items-center justify-center mx-auto mb-3">
              <Icon size={18} className="text-[#2D5BFF]" />
            </div>
            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">{label}</div>
            <div className="text-sm font-medium text-gray-900">{value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{sub}</div>
          </div>
        ))}
      </div>

      {/* FAQ */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <HelpCircle size={18} className="text-[#2D5BFF]" /> Frequently Asked Questions
          </h2>
        </div>
        <div className="divide-y divide-gray-100">
          {FAQS.map((faq, i) => (
            <div key={i} className="px-5">
              <button
                onClick={() => setOpen(o => o === i ? null : i)}
                className="w-full flex items-center justify-between py-4 text-left gap-4"
              >
                <span className="text-sm font-medium text-gray-900">{faq.q}</span>
                {open === i ? <ChevronUp size={16} className="text-gray-400 flex-shrink-0" /> : <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />}
              </button>
              {open === i && (
                <div className="pb-4 text-sm text-gray-600 leading-relaxed">{faq.a}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Version info */}
      <div className="text-center text-xs text-gray-400">
        AwibiEHR v2.0 · Built for Nigerian Healthcare · NDPA 2023 Compliant
      </div>
    </div>
  );
}
