import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceArea,
} from 'recharts';
import { format } from 'date-fns';
import { Activity } from 'lucide-react';
import api from '../../lib/api';
import Spinner from '../ui/Spinner';

// Normal adult ranges — drawn as a shaded band so a nurse can see at a glance
// whether a trend is drifting out of range.
const SERIES = {
  bp:   { key: 'bp',   label: 'BP (systolic)', unit: 'mmHg',  colour: '#2D5BFF', normal: [90, 140] },
  dia:  { key: 'dia',  label: 'BP (diastolic)', unit: 'mmHg', colour: '#7EA0FF', normal: [60, 90] },
  pr:   { key: 'pr',   label: 'Pulse',         unit: 'bpm',   colour: '#E5484D', normal: [60, 100] },
  rr:   { key: 'rr',   label: 'Resp. rate',    unit: '/min',  colour: '#F76B15', normal: [12, 20] },
  temp: { key: 'temp', label: 'Temperature',   unit: '°C',    colour: '#8B5CF6', normal: [36.1, 37.2] },
  spo2: { key: 'spo2', label: 'SpO₂',          unit: '%',     colour: '#12A594', normal: [95, 100] },
};

const RANGES = [
  { key: '24h', label: '24h', hours: 24 },
  { key: '7d',  label: '7 days', hours: 24 * 7 },
  { key: '30d', label: '30 days', hours: 24 * 30 },
  { key: 'all', label: 'All', hours: null },
];

export default function VitalsTrendChart({ patientId }) {
  const [range, setRange] = useState('7d');
  const [active, setActive] = useState(['bp', 'pr', 'spo2']);

  const { data, isLoading } = useQuery({
    queryKey: ['patient-vitals-trend', patientId],
    queryFn: () => api.get(`/patients/${patientId}/vitals`).then(r => r.data),
    enabled: Boolean(patientId),
  });

  const points = useMemo(() => {
    const rows = Array.isArray(data) ? data : (data?.vitals || []);
    const cutoffHours = RANGES.find(r => r.key === range)?.hours;
    const cutoff = cutoffHours ? Date.now() - cutoffHours * 3600 * 1000 : null;

    return rows
      .map(v => ({
        t: new Date(v.recordedAt || v.createdAt).getTime(),
        bp: v.bloodPressureSystolic ?? null,
        dia: v.bloodPressureDiastolic ?? null,
        pr: v.heartRate ?? null,
        rr: v.respiratoryRate ?? null,
        temp: v.temperature ?? null,
        spo2: v.oxygenSaturation ?? null,
      }))
      .filter(p => !cutoff || p.t >= cutoff)
      .sort((a, b) => a.t - b.t);
  }, [data, range]);

  function toggle(key) {
    setActive(a => (a.includes(key) ? a.filter(k => k !== key) : [...a, key]));
  }

  // A single shaded normal band only makes sense when one series is shown.
  const soleBand = active.length === 1 ? SERIES[active[0]].normal : null;

  if (isLoading) return <div className="py-12 flex justify-center"><Spinner /></div>;

  if (!points.length) {
    return (
      <div className="border border-gray-200 rounded-xl py-10 text-center">
        <Activity size={24} className="mx-auto text-gray-300 mb-2" />
        <p className="text-sm text-gray-500">No vitals in this period.</p>
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-xl p-3 sm:p-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
        <h3 className="font-semibold text-gray-900 text-sm">Vitals trend</h3>
        <div className="flex gap-1" role="group" aria-label="Time range">
          {RANGES.map(r => (
            <button key={r.key} onClick={() => setRange(r.key)}
              aria-pressed={range === r.key}
              className={`px-3 min-h-[40px] rounded-lg text-xs font-medium border transition-colors ${
                range === r.key ? 'border-[#2D5BFF] bg-[#2D5BFF]/5 text-[#2D5BFF]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {Object.values(SERIES).map(s => (
          <button key={s.key} onClick={() => toggle(s.key)}
            aria-pressed={active.includes(s.key)}
            className={`px-2.5 min-h-[40px] rounded-lg border text-xs font-medium transition-colors ${
              active.includes(s.key) ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
            style={active.includes(s.key) ? { backgroundColor: s.colour } : undefined}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="h-64 sm:h-72 -ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 5, right: 8, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" />
            {soleBand && (
              <ReferenceArea y1={soleBand[0]} y2={soleBand[1]} fill="#12A594" fillOpacity={0.07} strokeOpacity={0} />
            )}
            <XAxis
              dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time"
              tickFormatter={(t) => format(new Date(t), points.length > 1 && (points.at(-1).t - points[0].t) > 86400000 ? 'dd MMM' : 'HH:mm')}
              tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#d1d5db"
            />
            <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#d1d5db" width={38} />
            <Tooltip
              contentStyle={{ borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 12 }}
              labelFormatter={(t) => format(new Date(t), 'dd MMM yyyy, HH:mm')}
              formatter={(value, name) => {
                const s = Object.values(SERIES).find(x => x.label === name);
                return [`${value} ${s?.unit || ''}`, name];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {active.map(k => (
              <Line key={k} type="monotone" dataKey={k} name={SERIES[k].label}
                stroke={SERIES[k].colour} strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 5 }}
                connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {soleBand && (
        <p className="text-xs text-gray-500 mt-2">
          Shaded band = normal adult range for {SERIES[active[0]].label} ({soleBand[0]}–{soleBand[1]} {SERIES[active[0]].unit}).
        </p>
      )}
      <p className="text-xs text-gray-400 mt-1">{points.length} reading{points.length === 1 ? '' : 's'} in this period.</p>
    </div>
  );
}
