import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Users, Activity, FlaskConical } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import api from '../../lib/api';
import Spinner from '../../components/ui/Spinner';

const COLORS = ['#2D5BFF','#00C896','#F59E0B','#EF4444','#8B5CF6','#06B6D4'];

export default function Reports() {
  const [dateRange, setDateRange] = useState({ startDate: '', endDate: '' });

  const { data: patients, isLoading: patLoading } = useQuery({
    queryKey: ['report-patients', dateRange],
    queryFn: () => api.get('/reports/patients', { params: dateRange }).then(r => r.data),
  });

  const { data: diseases, isLoading: disLoading } = useQuery({
    queryKey: ['report-diseases'],
    queryFn: () => api.get('/reports/disease-incidence').then(r => r.data),
  });

  const { data: lab, isLoading: labLoading } = useQuery({
    queryKey: ['report-lab'],
    queryFn: () => api.get('/reports/lab').then(r => r.data),
  });

  const patientGenderData = patients ? [
    { name: 'Male', count: patients.male },
    { name: 'Female', count: patients.female },
  ] : [];

  const patientStatusData = patients ? [
    { name: 'In-Patient', count: patients.inPatient },
    { name: 'Out-Patient', count: patients.outPatient },
    { name: 'Discharged', count: patients.discharged },
  ] : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Reports & Analytics</h1>
        <p className="text-sm text-gray-500">Facility statistics and trends</p>
      </div>

      {/* Date filter */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <span className="text-sm font-medium text-gray-700">Date range:</span>
          <div className="flex gap-3">
            <input type="date" value={dateRange.startDate} onChange={e => setDateRange(d => ({ ...d, startDate: e.target.value }))} className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
            <span className="self-center text-gray-400">to</span>
            <input type="date" value={dateRange.endDate} onChange={e => setDateRange(d => ({ ...d, endDate: e.target.value }))} className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
          </div>
          {(dateRange.startDate || dateRange.endDate) && (
            <button onClick={() => setDateRange({ startDate: '', endDate: '' })} className="text-xs text-[#2D5BFF] hover:underline">Clear</button>
          )}
        </div>
      </div>

      {/* Patient stats */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2"><Users size={16} /> Patient Demographics</h2>
        {patLoading ? <div className="py-10 flex justify-center"><Spinner /></div> : (
          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <h3 className="text-xs font-medium text-gray-500 mb-2 uppercase">Gender Distribution</h3>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={patientGenderData} cx="50%" cy="50%" outerRadius={60} dataKey="count" nameKey="name">
                    {patientGenderData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div>
              <h3 className="text-xs font-medium text-gray-500 mb-2 uppercase">Patient Status</h3>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={patientStatusData} barSize={32}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="count" fill="#2D5BFF" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
        {patients && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mt-4 text-center">
            {[
              ['Total', patients.total, 'text-[#2D5BFF]'],
              ['Male', patients.male, 'text-[#2D5BFF]'],
              ['Female', patients.female, 'text-pink-600'],
              ['In-Patient', patients.inPatient, 'text-purple-600'],
              ['Out-Patient', patients.outPatient, 'text-green-600'],
              ['Discharged', patients.discharged, 'text-gray-600'],
            ].map(([label, val, color]) => (
              <div key={label} className="bg-gray-50 rounded-xl p-2">
                <div className={`text-xl font-bold ${color}`}>{val ?? 0}</div>
                <div className="text-xs text-gray-500">{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Disease incidence */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2"><Activity size={16} /> Disease Incidence (Top 10)</h2>
        {disLoading ? <div className="py-10 flex justify-center"><Spinner /></div> : !diseases?.length ? (
          <div className="text-center py-8 text-gray-400 text-sm">No condition data yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={diseases} layout="vertical" barSize={18}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={140} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="count" fill="#00C896" radius={[0,4,4,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Lab stats */}
      {lab && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2"><FlaskConical size={16} /> Lab & Imaging Summary</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ['Pending', lab.pending, 'bg-yellow-50 text-yellow-700'],
              ['Completed', lab.completed, 'bg-green-50 text-green-700'],
              ['Lab Tests', lab.lab, 'bg-blue-50 text-blue-700'],
              ['Imaging', lab.imaging, 'bg-purple-50 text-purple-700'],
            ].map(([label, val, color]) => (
              <div key={label} className={`${color} rounded-xl p-4 text-center`}>
                <div className="text-2xl font-bold">{val ?? 0}</div>
                <div className="text-xs">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
