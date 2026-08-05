import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Plus, X, Download, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import api from '../../lib/api';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import PatientPicker from '../../components/clinical/PatientPicker';

const NAIRA = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });

const PROVIDERS = ['NHIS', 'Hygeia HMO', 'Reliance HMO', 'AXA Mansard', 'Leadway Health', 'Avon HMO', 'Private / self-pay'];

function AddPolicyModal({ open, onClose }) {
  const qc = useQueryClient();
  const [patientId, setPatientId] = useState('');
  const [provider, setProvider] = useState('');
  const [planName, setPlanName] = useState('');
  const [policyNumber, setPolicyNumber] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  // Free-form key/value so each provider can carry its own coverage shape.
  const [coverage, setCoverage] = useState([{ key: 'Outpatient', value: '100%' }, { key: 'Laboratory', value: '80%' }, { key: 'Copay', value: '500' }]);

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post('/insurance', {
      patientId, provider, planName: planName || undefined, policyNumber: policyNumber || undefined,
      validFrom: validFrom || undefined, validTo: validTo || undefined,
      authorizationRequired: authRequired,
      coverageDetails: Object.fromEntries(coverage.filter(c => c.key.trim()).map(c => [c.key.trim(), c.value])),
    }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['insurance-report'] });
      toast.success('Insurance recorded');
      setPatientId(''); setProvider(''); setPlanName(''); setPolicyNumber('');
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not save the policy'),
  });

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Record insurance</h2>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 flex items-center justify-center rounded-lg hover:bg-gray-100"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          <PatientPicker id="ins-patient" value={patientId} onChange={setPatientId} required autoFocus />

          <div>
            <label htmlFor="ins-provider" className="block text-sm font-medium text-gray-700 mb-1.5">Provider *</label>
            <input id="ins-provider" list="provider-list" value={provider} onChange={e => setProvider(e.target.value)}
              placeholder="Choose or type a provider"
              className="w-full min-h-12 px-3 border border-gray-300 rounded-lg text-sm" />
            <datalist id="provider-list">{PROVIDERS.map(p => <option key={p} value={p} />)}</datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ins-plan" className="block text-sm font-medium text-gray-700 mb-1.5">Plan</label>
              <input id="ins-plan" value={planName} onChange={e => setPlanName(e.target.value)}
                className="w-full min-h-12 px-3 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label htmlFor="ins-policy" className="block text-sm font-medium text-gray-700 mb-1.5">Policy number</label>
              <input id="ins-policy" value={policyNumber} onChange={e => setPolicyNumber(e.target.value)}
                className="w-full min-h-12 px-3 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label htmlFor="ins-from" className="block text-sm font-medium text-gray-700 mb-1.5">Valid from</label>
              <input id="ins-from" type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)}
                className="w-full min-h-12 px-3 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label htmlFor="ins-to" className="block text-sm font-medium text-gray-700 mb-1.5">Valid to</label>
              <input id="ins-to" type="date" value={validTo} onChange={e => setValidTo(e.target.value)}
                className="w-full min-h-12 px-3 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>

          <div>
            <span className="block text-sm font-medium text-gray-700 mb-1.5">Coverage details</span>
            <div className="space-y-2">
              {coverage.map((c, i) => (
                <div key={i} className="flex gap-2">
                  <input value={c.key} placeholder="e.g. Outpatient" aria-label="Coverage item"
                    onChange={e => setCoverage(v => v.map((x, j) => j === i ? { ...x, key: e.target.value } : x))}
                    className="flex-1 min-h-12 px-3 border border-gray-300 rounded-lg text-sm" />
                  <input value={c.value} placeholder="e.g. 100%" aria-label="Coverage value"
                    onChange={e => setCoverage(v => v.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                    className="w-32 min-h-12 px-3 border border-gray-300 rounded-lg text-sm" />
                  <button type="button" onClick={() => setCoverage(v => v.filter((_, j) => j !== i))}
                    aria-label="Remove coverage row"
                    className="w-12 min-h-12 flex items-center justify-center border border-gray-300 rounded-lg hover:bg-gray-50">
                    <Trash2 size={15} className="text-gray-500" />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setCoverage(v => [...v, { key: '', value: '' }])}
              className="mt-2 text-sm text-[#2D5BFF] font-medium min-h-11">+ Add coverage item</button>
          </div>

          <label className="flex items-center gap-2 min-h-11 cursor-pointer">
            <input type="checkbox" checked={authRequired} onChange={e => setAuthRequired(e.target.checked)} className="w-5 h-5 rounded border-gray-300" />
            <span className="text-sm text-gray-700">Pre-authorisation required</span>
          </label>
        </div>
        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-5 py-3 flex gap-3">
          <button onClick={onClose} className="flex-1 min-h-12 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button onClick={() => (patientId && provider) ? mutate() : toast.error('Patient and provider are required')} disabled={isPending}
            className="flex-1 min-h-12 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50">
            {isPending ? 'Saving…' : 'Save policy'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Insurance() {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['insurance-report'],
    queryFn: () => api.get('/insurance/report').then(r => r.data),
  });

  async function exportCsv() {
    try {
      const res = await api.get('/insurance/report.csv', { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url; a.download = `insurance-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success('Export downloaded');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Export failed');
    }
  }

  const providers = data?.providers || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Insurance</h1>
          <p className="text-sm text-gray-500">Cover recorded per patient, summarised by provider</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCsv}
            className="flex items-center gap-2 px-4 min-h-12 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">
            <Download size={15} /> Export
          </button>
          <button onClick={() => setOpen(true)}
            className="flex items-center gap-2 px-4 min-h-12 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]">
            <Plus size={16} /> Record policy
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 flex justify-center"><Spinner size="lg" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs font-medium text-gray-500">Providers</p>
              <p className="text-2xl font-bold text-gray-900">{data?.totalProviders ?? 0}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs font-medium text-gray-500">Insured patients</p>
              <p className="text-2xl font-bold text-gray-900">
                {providers.reduce((s, p) => s + p.patients, 0)}
              </p>
            </div>
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
              <p className="text-xs font-medium text-amber-800">Uninsured</p>
              <p className="text-2xl font-bold text-amber-900">{data?.uninsuredPatients ?? 0}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {!providers.length ? (
              <EmptyState icon={ShieldCheck} title="No insurance recorded"
                description="Record a patient's cover so billing shows their provider and copay." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr className="text-left text-xs font-medium text-gray-500">
                      <th className="px-4 py-3">Provider</th>
                      <th className="px-4 py-3">Plans</th>
                      <th className="px-4 py-3 text-right">Patients</th>
                      <th className="px-4 py-3 text-right">Invoices</th>
                      <th className="px-4 py-3 text-right">Billed</th>
                      <th className="px-4 py-3 text-right">Collected</th>
                      <th className="px-4 py-3 text-right">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {providers.map(p => (
                      <tr key={p.provider} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{p.provider}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{p.plans.join(', ') || '—'}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{p.patients}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{p.invoices}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{NAIRA.format(p.billed)}</td>
                        <td className="px-4 py-3 text-right font-medium text-green-700">{NAIRA.format(p.collected)}</td>
                        <td className="px-4 py-3 text-right font-medium text-amber-700">{NAIRA.format(p.outstanding)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="text-xs text-gray-500">
            Eligibility is not verified electronically — no provider integration is configured. Confirm cover with the provider directly.
          </p>
        </>
      )}

      <AddPolicyModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
