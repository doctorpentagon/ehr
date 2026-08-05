import React from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceArea, ReferenceLine, Dot,
} from 'recharts';
import { format } from 'date-fns';

/**
 * A time-series of one monitored value against the range it is supposed to be in.
 *
 * The shaded band is what "normal" means for this patient and this measurement.
 * Reading a chart without it means holding the target range in your head, which
 * is how a drifting value gets noticed late.
 */

// Deliberately flat clinical colours — the same red means the same thing on every
// chart, every table and every alert in the system.
const SEVERITY_COLOUR = {
  NORMAL: '#15803d',
  LOW: '#b45309',
  HIGH: '#b45309',
  CRITICAL_LOW: '#b91c1c',
  CRITICAL_HIGH: '#b91c1c',
};

const TREND_LABEL = { RISING: 'rising', FALLING: 'falling', FLAT: 'steady' };

/** Points carry their own severity, so an out-of-range reading is visible at a glance. */
function SeverityDot({ cx, cy, payload }) {
  if (cx == null || cy == null) return null;
  const severity = payload?.severity || 'NORMAL';
  const critical = severity.startsWith('CRITICAL');
  return (
    <Dot
      cx={cx} cy={cy}
      r={critical ? 5 : 3.5}
      fill={SEVERITY_COLOUR[severity] || SEVERITY_COLOUR.NORMAL}
      stroke="#fff"
      strokeWidth={critical ? 2 : 1}
    />
  );
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const severity = point.severity || 'NORMAL';
  return (
    <div className="bg-white border border-gray-300 shadow-sm px-3 py-2 text-xs">
      <div className="font-medium text-gray-900">
        {point.value}{point.unit ? ` ${point.unit}` : ''}
      </div>
      <div className="text-gray-500">{format(new Date(point.at), 'd MMM, HH:mm')}</div>
      {severity !== 'NORMAL' && (
        <div className="mt-1 font-medium" style={{ color: SEVERITY_COLOUR[severity] }}>
          {point.deviation > 0 ? `${point.deviation} ${severity.includes('LOW') ? 'below' : 'above'} target` : severity}
        </div>
      )}
    </div>
  );
}

export default function MonitoringChart({ series, height = 200, showHeader = true }) {
  if (!series?.points?.length) return null;

  const { points, goalMin, goalMax, criticalLow, criticalHigh, unit, label, trend } = series;
  const data = points.map((p) => ({ ...p, unit, time: new Date(p.at).getTime() }));

  // Keep the goal band in frame even when every reading sits outside it —
  // otherwise a chart of uniformly high values looks unremarkable.
  const values = points.map((p) => p.value);
  const candidates = [...values, goalMin, goalMax].filter((v) => v != null && Number.isFinite(v));
  const lo = Math.min(...candidates);
  const hi = Math.max(...candidates);
  const pad = Math.max((hi - lo) * 0.15, 1);
  const domain = [Math.floor(lo - pad), Math.ceil(hi + pad)];

  const latest = points[points.length - 1];
  const latestColour = SEVERITY_COLOUR[latest.severity] || SEVERITY_COLOUR.NORMAL;

  return (
    <div className="border border-gray-200 bg-white p-4">
      {showHeader && (
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{label}</h3>
            {(goalMin != null || goalMax != null) && (
              <p className="text-xs text-gray-500">
                Target {goalMin ?? '−'}–{goalMax ?? '−'}{unit ? ` ${unit}` : ''}
              </p>
            )}
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold tabular-nums" style={{ color: latestColour }}>
              {latest.value}<span className="text-xs font-normal text-gray-500">{unit ? ` ${unit}` : ''}</span>
            </div>
            <div className="text-xs text-gray-500">
              {TREND_LABEL[trend] || 'steady'}
              {series.abnormalCount > 0 && ` · ${series.abnormalCount} out of range`}
            </div>
          </div>
        </div>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -12 }}>
          <CartesianGrid stroke="#f1f5f9" vertical={false} />

          {/* The band the value is supposed to stay inside. */}
          {goalMin != null && goalMax != null && (
            <ReferenceArea y1={goalMin} y2={goalMax} fill="#16a34a" fillOpacity={0.07} stroke="none" />
          )}
          {/* The lines beyond which someone needs to be told now. */}
          {criticalLow != null && <ReferenceLine y={criticalLow} stroke="#b91c1c" strokeDasharray="3 3" strokeWidth={1} />}
          {criticalHigh != null && <ReferenceLine y={criticalHigh} stroke="#b91c1c" strokeDasharray="3 3" strokeWidth={1} />}

          <XAxis
            dataKey="time" type="number" domain={['dataMin', 'dataMax']} scale="time"
            tickFormatter={(t) => format(new Date(t), 'HH:mm')}
            tick={{ fontSize: 11, fill: '#64748b' }} stroke="#cbd5e1"
          />
          <YAxis domain={domain} tick={{ fontSize: 11, fill: '#64748b' }} stroke="#cbd5e1" width={44} />
          <Tooltip content={<ChartTooltip />} />
          <Line
            type="monotone" dataKey="value" stroke="#334155" strokeWidth={1.5}
            dot={<SeverityDot />} activeDot={{ r: 6 }} isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Compact trend for a table cell or a list row. */
export function Sparkline({ points, width = 88, height = 24 }) {
  if (!points?.length) return null;
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const step = points.length > 1 ? width / (points.length - 1) : width;

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${(height - ((p.value - lo) / span) * height).toFixed(1)}`)
    .join(' ');

  const last = points[points.length - 1];
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      <path d={path} fill="none" stroke="#64748b" strokeWidth="1.25" />
      <circle
        cx={(points.length - 1) * step}
        cy={height - ((last.value - lo) / span) * height}
        r="2.5"
        fill={SEVERITY_COLOUR[last.severity] || SEVERITY_COLOUR.NORMAL}
      />
    </svg>
  );
}

export { SEVERITY_COLOUR };
