import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import api from '../../lib/api';

export default function MedicationSafetyPanel({ patientId, compact = false }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['medication-safety', patientId],
    queryFn: () => api.get(`/orders/medication-safety/${patientId}`).then((response) => response.data),
    enabled: Boolean(patientId),
  });

  if (!patientId) return null;
  const safety = data?.safety;
  const warnings = safety?.warnings || [];
  const alert = warnings.length > 0;

  return (
    <section className={`rounded-xl border p-4 ${alert ? 'border-amber-300 bg-amber-50' : 'border-blue-200 bg-blue-50'}`}>
      <div className="flex items-start gap-3">
        <ShieldAlert size={20} className={`mt-0.5 shrink-0 ${alert ? 'text-amber-700' : 'text-blue-700'}`} />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-gray-900">Medicine safety</h3>
          {isLoading ? <p className="mt-1 text-xs text-gray-600">Checking active medicines…</p>
            : isError ? <p className="mt-1 text-xs font-medium text-red-700">Could not load safety checks. Check allergies and interactions before continuing.</p>
              : <>
                <p className="mt-1 text-xs text-gray-700">{safety?.scope}</p>
                {warnings.length ? <div className="mt-3 space-y-2">{warnings.map((warning, index) => (
                  <div key={`${warning.kind}-${index}`} className="rounded-lg bg-white/85 p-3 text-sm text-gray-900">
                    <span className="mr-2 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold">{warning.severity}</span>
                    {warning.message}
                  </div>
                ))}</div> : <p className="mt-2 text-sm text-blue-950">No allergy or duplicate medicine warning found.</p>}
                {!compact && <p className="mt-3 text-xs font-medium text-gray-700">{safety?.limitation}</p>}
              </>}
        </div>
      </div>
    </section>
  );
}
