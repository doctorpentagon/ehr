import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, AlertTriangle, TrendingUp } from 'lucide-react';
import { format } from 'date-fns';
import api from '../../lib/api';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';

const NAIRA = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });

const STATUS_STYLES = {
  ACTIVE:    'bg-green-50 text-green-700 border-green-200',
  TRIAL:     'bg-blue-50 text-blue-700 border-blue-200',
  EXPIRED:   'bg-red-50 text-red-700 border-red-200',
  CANCELLED: 'bg-gray-100 text-gray-600 border-gray-200',
};

// A usage bar that turns amber near the plan limit — the upsell signal.
function UsageBar({ used, limit, label }) {
  if (!limit) return <span className="text-xs text-gray-400">{used} {label}</span>;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const tone = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-green-500';
  return (
    <div className="min-w-[110px]">
      <div className="flex justify-between text-xs text-gray-600">
        <span>{label}</span>
        <span className={pct >= 90 ? 'font-semibold text-red-700' : ''}>{used}/{limit}</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full mt-1 overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function PlatformSubscriptions() {
  const [status, setStatus] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['platform-subscriptions', status],
    queryFn: () => api.get('/platform/subscriptions', { params: { status: status || undefined } }).then(r => r.data),
  });

  const rows = data?.subscriptions || [];
  const t = data?.totals;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Subscriptions</h1>
        <p className="text-sm text-gray-500">What facilities pay Awibi. This is platform revenue.</p>
      </div>

      {t && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-500">Recurring revenue</p>
            <p className="text-2xl font-bold text-green-700 mt-1">{NAIRA.format(t.activeRecurring)}</p>
            <p className="text-xs text-gray-400 mt-0.5">{t.active} active subscription{t.active === 1 ? '' : 's'}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-500">Contracted total</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{NAIRA.format(t.contracted)}</p>
          </div>
          <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
            <p className="text-xs font-medium text-blue-700">On trial</p>
            <p className="text-2xl font-bold text-blue-800 mt-1">{t.trial}</p>
            <p className="text-xs text-blue-600 mt-0.5">conversion opportunity</p>
          </div>
          <div className={`rounded-xl border p-4 ${t.expired || t.renewingSoon ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
            <p className="text-xs font-medium text-amber-800">Needs attention</p>
            <p className="text-2xl font-bold text-amber-900 mt-1">{t.expired + t.renewingSoon}</p>
            <p className="text-xs text-amber-700 mt-0.5">{t.expired} expired · {t.renewingSoon} renewing in 30d</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-3 flex gap-2 overflow-x-auto">
        {[['', 'All'], ['ACTIVE', 'Active'], ['TRIAL', 'Trial'], ['EXPIRED', 'Expired'], ['CANCELLED', 'Cancelled']].map(([v, label]) => (
          <button key={v || 'all'} onClick={() => setStatus(v)} aria-pressed={status === v}
            className={`px-4 min-h-11 rounded-lg border text-sm font-medium whitespace-nowrap ${
              status === v ? 'border-[#2D5BFF] bg-[#2D5BFF]/5 text-[#2D5BFF]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}>
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="py-16 flex justify-center"><Spinner size="lg" /></div>
        ) : error ? (
          <div className="py-12 text-center text-sm text-gray-600">{error?.response?.data?.error || 'Could not load subscriptions.'}</div>
        ) : !rows.length ? (
          <EmptyState icon={CreditCard} title="No subscriptions" description="No facility matches this filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-xs font-medium text-gray-500">
                  <th className="px-4 py-3">Facility</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Renewal</th>
                  <th className="px-4 py-3">Usage against plan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(s => (
                  <tr key={s.id} className={`hover:bg-gray-50 ${s.isExpired ? 'bg-red-50/40' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{s.facility.name}</div>
                      <div className="text-xs text-gray-400">
                        {s.facility.type === 'LAB' ? 'Diagnostics' : s.facility.type[0] + s.facility.type.slice(1).toLowerCase()}
                        {s.facility.state ? ` · ${s.facility.state}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-[#2D5BFF]/10 text-[#2D5BFF] rounded text-xs font-medium">
                        {s.plan.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{NAIRA.format(s.amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${STATUS_STYLES[s.status] || ''}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {s.endDate ? (
                        <span className={s.isExpired ? 'text-red-700 font-semibold' : s.renewsWithin30Days ? 'text-amber-700 font-medium' : 'text-gray-600'}>
                          {format(new Date(s.endDate), 'dd MMM yyyy')}
                          {s.isExpired && ' · expired'}
                          {s.renewsWithin30Days && ' · soon'}
                        </span>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-4">
                        <UsageBar used={s.patientsUsed} limit={s.patientLimit} label="patients" />
                        <UsageBar used={s.staffUsed} limit={s.staffLimit} label="staff" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
        <TrendingUp size={14} className="shrink-0 mt-0.5" />
        <span>
          This page shows Awibi&rsquo;s own income. The <strong>Clinical billing</strong> page shows what facilities
          bill their patients — that money belongs to the facility, not to Awibi, and is a measure of platform
          activity rather than revenue.
        </span>
      </div>
    </div>
  );
}
