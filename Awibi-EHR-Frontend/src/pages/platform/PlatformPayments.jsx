import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Download, Wallet } from 'lucide-react';
import { format } from 'date-fns';
import api from '../../lib/api';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import { downloadCsv } from './PlatformFacilities';

const NAIRA = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });

const STATUS_STYLES = {
  PAID:      'bg-green-50 text-green-700 border-green-200',
  PART_PAID: 'bg-amber-50 text-amber-700 border-amber-200',
  UNPAID:    'bg-gray-100 text-gray-600 border-gray-200',
};

export default function PlatformPayments() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['platform-payments', status, search],
    queryFn: () => api.get('/platform/payments', {
      params: { status: status || undefined, search: search || undefined, limit: 100 },
    }).then(r => r.data),
  });

  const invoices = data?.invoices || [];
  const totals = data?.totals;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Payments and plans</h1>
          <p className="text-sm text-gray-500">Revenue across every facility on the platform</p>
        </div>
        <button onClick={() => downloadCsv('/platform/export/payments', `awibi-payments-${new Date().toISOString().slice(0, 10)}.csv`)}
          className="flex items-center justify-center gap-2 px-4 min-h-11 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">
          <Download size={15} /> Export CSV
        </button>
      </div>

      {totals && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-500">Billed</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{NAIRA.format(totals.billed)}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-500">Collected</p>
            <p className="text-2xl font-bold text-green-700 mt-1">{NAIRA.format(totals.collected)}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-500">Outstanding</p>
            <p className="text-2xl font-bold text-amber-700 mt-1">{NAIRA.format(totals.outstanding)}</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} aria-label="Search by reference"
            placeholder="Search invoice reference…"
            className="w-full pl-9 pr-4 min-h-11 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by payment status"
          className="px-3 min-h-11 border border-gray-200 rounded-lg text-sm bg-white">
          <option value="">All statuses</option>
          <option value="PAID">Paid</option>
          <option value="PART_PAID">Part paid</option>
          <option value="UNPAID">Unpaid</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="py-16 flex justify-center"><Spinner size="lg" /></div>
        ) : error ? (
          <div className="py-12 text-center text-sm text-gray-600">{error?.response?.data?.error || 'Could not load payments.'}</div>
        ) : invoices.length === 0 ? (
          <EmptyState icon={Wallet} title="No payments" description="No invoice matches these filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-xs font-medium text-gray-500">
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Facility</th>
                  <th className="px-4 py-3">Patient</th>
                  <th className="px-4 py-3 text-right">Billed</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invoices.map(i => (
                  <tr key={i.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{i.invoiceNumber}</td>
                    <td className="px-4 py-3">
                      <div className="text-gray-900">{i.facility?.name}</div>
                      <div className="text-xs text-gray-400">
                        {i.facility?.type === 'LAB' ? 'Lab / Imaging' : i.facility?.type}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[#2D5BFF]">{i.patient?.universalPatientId || '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{NAIRA.format(Number(i.total))}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{NAIRA.format(Number(i.amountPaid))}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[i.paymentStatus] || ''}`}>
                        {i.paymentStatus?.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {i.paidAt ? format(new Date(i.paidAt), 'dd MMM yyyy') : format(new Date(i.createdAt), 'dd MMM yyyy')}
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
