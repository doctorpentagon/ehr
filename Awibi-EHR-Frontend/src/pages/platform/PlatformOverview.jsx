import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { Building2, FlaskConical, Stethoscope, Users, TrendingUp, Wallet } from 'lucide-react';
import api from '../../lib/api';
import Spinner from '../../components/ui/Spinner';

const NAIRA = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });
const PIE_COLOURS = ['#2D5BFF', '#12A594', '#F76B15', '#8B5CF6', '#E5484D'];

function Metric({ label, value, sub, icon: Icon, tone = '#2D5BFF' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1 truncate">{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        </div>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${tone}1a` }}>
          <Icon size={18} style={{ color: tone }} />
        </div>
      </div>
    </div>
  );
}

export default function PlatformOverview() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['platform-overview'],
    queryFn: () => api.get('/platform/overview').then(r => r.data),
  });

  if (isLoading) return <div className="py-24 flex justify-center"><Spinner size="lg" /></div>;
  if (error) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <p className="text-sm text-gray-600">{error?.response?.data?.error || 'Could not load platform metrics.'}</p>
      </div>
    );
  }

  const f = data.facilities;
  const byType = [
    { name: 'Hospitals', value: f.byType.hospitals },
    { name: 'Clinics', value: f.byType.clinics },
    { name: 'Lab/Imaging', value: f.byType.labs },
    { name: 'Professionals', value: f.byType.professionals },
  ].filter(x => x.value > 0);

  const packages = Object.entries(data.packages || {}).map(([name, value]) => ({ name, value }));

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Platform overview</h1>
          <p className="text-sm text-gray-500">Every facility on Awibi — the numbers behind the business</p>
        </div>
        <button onClick={() => navigate('/dashboard/platform/facilities')}
          className="px-4 min-h-11 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]">
          View facilities
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <Metric label="Facilities" value={f.total} sub={`${f.active} active · ${f.inactive} inactive`} icon={Building2} />
        <Metric label="Hospitals" value={f.byType.hospitals} icon={Building2} tone="#12A594" />
        <Metric label="Lab / Imaging" value={f.byType.labs} icon={FlaskConical} tone="#F76B15" />
        <Metric label="Doctors" value={data.users.doctors} sub={`${data.users.active} active users`} icon={Stethoscope} tone="#8B5CF6" />
        <Metric label="Patients" value={data.patients.total.toLocaleString()} sub={`+${data.patients.thisMonth} this month`} icon={Users} tone="#E5484D" />
        <Metric label="Encounters" value={data.encounters.total.toLocaleString()} sub={`+${data.encounters.thisMonth} this month`} icon={TrendingUp} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="font-semibold text-gray-900 text-sm mb-1">Platform revenue</h2>
          <p className="text-3xl font-bold text-green-700">{NAIRA.format(data.platformRevenue.recurringPerCycle)}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            recurring, from {data.platformRevenue.activeSubscriptions} active subscription{data.platformRevenue.activeSubscriptions === 1 ? '' : 's'}
            {' · '}{NAIRA.format(data.platformRevenue.contractedTotal)} contracted
          </p>
          <button onClick={() => navigate('/dashboard/platform/subscriptions')}
            className="mt-2 text-xs font-medium text-[#2D5BFF] hover:underline min-h-11">
            View subscriptions &rarr;
          </button>
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs font-medium text-gray-500">Clinical billing across facilities</p>
            <p className="text-lg font-bold text-gray-700">{NAIRA.format(data.clinicalVolume.collectedAllTime)}</p>
            <p className="text-xs text-gray-400">
              collected by facilities from their own patients. Platform activity, not Awibi income.
            </p>
          </div>
          <div className="h-48 mt-4 -ml-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#d1d5db" />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#d1d5db" width={60}
                  tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)} />
                <Tooltip formatter={(v) => NAIRA.format(v)} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                <Bar dataKey="clinicalVolume" name="Clinical billing" fill="#12A594" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="font-semibold text-gray-900 text-sm mb-1">Encounters per month</h2>
          <p className="text-xs text-gray-500">Clinical activity across every facility</p>
          <div className="h-48 mt-4 -ml-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#d1d5db" />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#d1d5db" width={38} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                <Line type="monotone" dataKey="encounters" name="Encounters" stroke="#2D5BFF" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Facility mix</h2>
          {byType.length === 0 ? <p className="text-sm text-gray-400 py-8 text-center">No facilities yet</p> : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={byType} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                    {byType.map((_, i) => <Cell key={i} fill={PIE_COLOURS[i % PIE_COLOURS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Package overview</h2>
          {packages.length === 0 ? <p className="text-sm text-gray-400 py-8 text-center">No subscriptions yet</p> : (
            <div className="space-y-2">
              {packages.map((p, i) => (
                <div key={p.name} className="flex items-center gap-3">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: PIE_COLOURS[i % PIE_COLOURS.length] }} />
                  <span className="text-sm text-gray-700 flex-1">{p.name.replace(/_/g, ' ')}</span>
                  <span className="text-sm font-semibold text-gray-900">{p.value}</span>
                </div>
              ))}
            </div>
          )}
          <button onClick={() => navigate('/dashboard/platform/payments')}
            className="mt-4 w-full min-h-11 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center justify-center gap-2">
            <Wallet size={15} /> Payment history
          </button>
        </div>
      </div>
    </div>
  );
}
