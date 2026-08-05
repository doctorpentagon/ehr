import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Download, Building2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import api from '../../lib/api';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';

// The designs group the register as Hospitals / Labs / Professionals.
const TABS = [
  { key: '', label: 'All' },
  { key: 'HOSPITAL', label: 'Hospitals' },
  { key: 'CLINIC', label: 'Clinics' },
  { key: 'LAB', label: 'Lab / Imaging' },
  { key: 'PROFESSIONAL', label: 'Professionals' },
];

async function downloadCsv(path, filename) {
  try {
    const res = await api.get(path, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast.success('Export downloaded');
  } catch (e) {
    toast.error(e?.response?.data?.error || 'Export failed');
  }
}

export default function PlatformFacilities() {
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['platform-facilities', type, status, search],
    queryFn: () => api.get('/platform/facilities', {
      params: { type: type || undefined, status: status || undefined, search: search || undefined, limit: 100 },
    }).then(r => r.data),
  });

  const facilities = data?.facilities || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Facilities management</h1>
          <p className="text-sm text-gray-500">{data?.total ?? 0} facilities on the platform</p>
        </div>
        <button onClick={() => downloadCsv('/platform/export/facilities', `awibi-facilities-${new Date().toISOString().slice(0, 10)}.csv`)}
          className="flex items-center justify-center gap-2 px-4 min-h-11 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">
          <Download size={15} /> Export CSV
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setType(t.key)} aria-pressed={type === t.key}
              className={`px-3 min-h-11 rounded-lg border text-sm font-medium transition-colors ${
                type === t.key ? 'border-[#2D5BFF] bg-[#2D5BFF]/5 text-[#2D5BFF]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} aria-label="Search facilities"
              placeholder="Search name, email or state…"
              className="w-full pl-9 pr-4 min-h-11 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
          </div>
          <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by status"
            className="px-3 min-h-11 border border-gray-200 rounded-lg text-sm bg-white">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="py-16 flex justify-center"><Spinner size="lg" /></div>
        ) : error ? (
          <div className="py-12 text-center text-sm text-gray-600">{error?.response?.data?.error || 'Could not load facilities.'}</div>
        ) : facilities.length === 0 ? (
          <EmptyState icon={Building2} title="No facilities" description="No facility matches these filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-xs font-medium text-gray-500">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">State</th>
                  <th className="px-4 py-3">Package</th>
                  <th className="px-4 py-3">Renewal</th>
                  <th className="px-4 py-3">Usage</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {facilities.map(f => (
                  <tr key={f.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{f.name}</div>
                      <div className="text-xs text-gray-400">{f.address || '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {f.type === 'LAB' ? 'Lab / Imaging' : f.type[0] + f.type.slice(1).toLowerCase()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-700">{f.email || '—'}</div>
                      <div className="text-xs text-gray-400">{f.phone || '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{f.state || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-[#2D5BFF]/10 text-[#2D5BFF] rounded text-xs font-medium">
                        {(f.subscription?.plan || f.plan || '').replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {f.subscription?.endDate ? format(new Date(f.subscription.endDate), 'dd MMM yyyy') : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {f._count.users} staff · {f._count.patients} patients · {f._count.cases} cases
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                        f.isActive ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-100 text-gray-600 border-gray-200'
                      }`}>
                        {f.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export { downloadCsv };
