import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import api from '@/lib/api';
import { can } from '@/lib/permissions';

function buildExamples(data) {
  const patientId = data?.patient?.id;
  const ids = data?.examples || {};
  return [
    { key: 'patient', label: 'Patient record', detail: 'Identity, conditions, medicines and history', module: 'patients', match: '/dashboard/patients', path: patientId && `/dashboard/patients/${patientId}`, ready: ids.patient },
    { key: 'consultation', label: 'Signed consultation', detail: 'Structured note, diagnosis, plan and attribution', module: 'cases', match: '/dashboard/cases', path: ids.consultation && `/dashboard/cases/${ids.consultation}`, ready: ids.consultation },
    { key: 'appointment', label: 'Appointment', detail: 'Confirmed follow-up linked to the patient and doctor', module: 'appointments', match: '/dashboard/appointments', path: '/dashboard/appointments', ready: ids.appointment },
    { key: 'orders', label: 'Orders & prescriptions', detail: 'Doctor instruction routed to nursing, diagnostics and pharmacy', module: 'clinical_orders', match: '/dashboard/orders', path: '/dashboard/orders', ready: ids.orders },
    { key: 'diagnostics', label: 'Five diagnostics workflows', detail: 'Imaging, haematology, chemical pathology, microbiology and histopathology', module: 'lab', match: '/dashboard/lab', path: '/dashboard/lab', ready: ids.diagnostics >= 5 },
    { key: 'admission', label: 'Admission & bed', detail: 'Doctor decision followed by nurse admission and bed assignment', module: 'admissions', match: '/dashboard/admissions', path: '/dashboard/admissions', ready: ids.admission },
    { key: 'handover', label: 'Shift handover', detail: 'Acknowledged SBAR note with outstanding work', module: 'handover', match: '/dashboard/nursing/shift-report', path: '/dashboard/nursing/shift-report', ready: ids.handover },
    { key: 'worklist', label: 'Nursing worklist', detail: 'Doctor instruction ready for the nurse to carry out and record', module: 'drug_admin', match: '/dashboard/nursing/worklist', path: '/dashboard/nursing/worklist', ready: ids.orders },
    { key: 'standing-orders', label: 'Practitioner orders', detail: 'Patient-linked active instruction and its monitoring chart', module: 'orders', match: '/dashboard/nursing/orders', path: '/dashboard/nursing/orders', ready: ids.orders },
    { key: 'monitoring', label: 'Monitoring chart', detail: 'Practitioner order, five observations, multimodal notes and trend', module: 'monitoring', match: '/dashboard/nursing', path: ids.monitoring && `/dashboard/nursing/sheet/${ids.monitoring}`, ready: ids.monitoring },
    { key: 'pharmacy', label: 'Pharmacy care', detail: 'Prescription, stock issue, DTP and signed care plan', module: 'pharmacy', match: '/dashboard/pharmacy', path: '/dashboard/pharmacy', ready: ids.pharmacy },
    { key: 'messages', label: 'Staff communication', detail: 'Patient-linked nurse-to-doctor update', module: null, match: '/dashboard/messages', path: '/dashboard/messages', ready: ids.message },
    { key: 'billing', label: 'Billing', detail: 'Patient-linked paid invoice and payment trail', module: 'billing', match: '/dashboard/billing', path: '/dashboard/billing', ready: ids.invoice },
    { key: 'household', label: 'Household & cover', detail: 'Principal member and synthetic insurance policy', module: 'households', match: '/dashboard/households', path: '/dashboard/households', ready: ids.household },
    { key: 'insurance', label: 'Insurance', detail: 'Coverage information attached to the sample patient', module: 'billing', match: '/dashboard/insurance', path: '/dashboard/insurance', ready: ids.insurance },
    { key: 'affiliate', label: 'Affiliate referral', detail: 'Synthetic imaging partner in the facility network', module: 'affiliates', match: '/dashboard/affiliates', path: '/dashboard/affiliates', ready: ids.affiliate },
  ].filter((item) => item.ready && item.path);
}

export default function DemoExampleGuide() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const user = useSelector((state) => state.auth.user);
  const isPlatform = user?.role === 'SUPER_ADMIN';
  const { data } = useQuery({
    queryKey: ['demo-showcase-index'],
    queryFn: () => api.get('/showcase').then((response) => response.data),
    enabled: !isPlatform,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const examples = useMemo(() => buildExamples(data).filter((item) => can(user?.role, user?.subRole, item.module)), [data, user]);
  if (!data?.enabled || !examples.length) return null;

  const relevant = examples.find((item) => location.pathname.startsWith(item.match));
  return (
    <section className="mb-4 rounded-xl border border-violet-200 bg-violet-50/80" aria-label="Demo examples">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-100 text-violet-700"><Sparkles size={17} /></span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-violet-950">Demo examples</p>
            <p className="truncate text-xs text-violet-800">Synthetic, ready-made flows for {data.patient.firstName} {data.patient.lastName} · {data.patient.universalPatientId}</p>
          </div>
        </div>
        {relevant && (
          <Link to={relevant.path} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-violet-700 px-3 text-sm font-semibold text-white hover:bg-violet-800">
            Open this example <ArrowRight size={15} />
          </Link>
        )}
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-3 text-sm font-semibold text-violet-800">
          {open ? 'Hide examples' : 'See examples'} {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>
      {open && (
        <div className="grid gap-2 border-t border-violet-200 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {examples.map((item) => (
            <Link key={item.key} to={item.path} onClick={() => setOpen(false)} className="rounded-lg border border-violet-100 bg-white p-3 hover:border-violet-300 hover:shadow-sm">
              <div className="flex items-center justify-between gap-2 text-sm font-semibold text-gray-900"><span>{item.label}</span><ArrowRight size={15} className="shrink-0 text-violet-600" /></div>
              <p className="mt-1 text-xs leading-5 text-gray-600">{item.detail}</p>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
