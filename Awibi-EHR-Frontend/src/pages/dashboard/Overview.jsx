import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate, Link } from 'react-router-dom';
import {
  IconUsers, IconCalendar, IconBed, IconFlask, IconStethoscope,
  IconReportMedical, IconBuildingHospital, IconClipboardList,
  IconChartBar, IconPlus,
  IconActivityHeartbeat, IconPill, IconAlertTriangle, IconDroplet,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import StatusBadge from '@/components/ui/StatusBadge';
import api from '@/lib/api';
import TodaysClinics from '@/components/clinical/TodaysClinics';
import { roleLabel } from '@/lib/permissions';

// ── KPI stat card ─────────────────────────────────────────────────────────────
function StatCard({ label, value, color, icon: Icon, loading, onClick, sub }) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl overflow-hidden flex flex-row items-center justify-between px-5 py-4 ${onClick ? 'cursor-pointer hover:opacity-90' : ''}`}
      style={{ backgroundColor: color }}
    >
      <div className="flex flex-col gap-0.5">
        {loading ? (
          <div className="h-9 w-16 bg-white/30 rounded mb-1 animate-pulse" />
        ) : (
          <h2 className="text-3xl font-extrabold text-white leading-none">{value ?? '0'}</h2>
        )}
        <h4 className="text-white/90 text-sm font-medium leading-tight">{label}</h4>
        {sub && <p className="text-white/60 text-xs">{sub}</p>}
      </div>
      <Icon className="text-white/40 size-14 shrink-0" />
    </div>
  );
}

function AppointmentRow({ appt }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2.5 border-b border-gray-50 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900 leading-tight truncate">
          {appt.patient?.firstName} {appt.patient?.lastName}
        </p>
        <p className="text-xs text-gray-400">
          {appt.visitType?.replace(/_/g,' ')} · {appt.scheduledAt ? (appt.scheduledAt || '').slice(11,16) : '—'}
        </p>
      </div>
      <StatusBadge status={appt.status} />
    </div>
  );
}

function QuickAction({ label, path, color, icon: Icon }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(path)}
      className="flex flex-col items-center justify-center gap-2 rounded-xl p-4 text-white text-sm font-semibold hover:opacity-90 transition-opacity shadow-sm"
      style={{ backgroundColor: color }}
    >
      <Icon size={22} />
      {label}
    </button>
  );
}

// ── ADMIN Overview ────────────────────────────────────────────────────────────
function SummaryMetric({ label, value, sub, color = '#2D5BFF' }) {
  return (
    <div className="bg-white rounded-xl border p-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold" style={{ color }}>{value ?? '—'}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function AdminOverview({ stats, summary, appointments, loading }) {
  const navigate = useNavigate();
  const PIE_DATA = stats ? [
    { name: 'In-Patient', value: stats.patientStatus?.inPatients || 0, color: '#335CF4' },
    { name: 'Out-Patient', value: stats.patientStatus?.outPatients || 0, color: '#00C49F' },
    { name: 'Discharged', value: stats.patientStatus?.discharged || 0, color: '#F59E0B' },
  ] : [];

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Total Patients" value={stats?.kpi?.totalPatients} color="#FF5A5A" icon={IconUsers} loading={loading} onClick={() => navigate('/dashboard/patients')} />
        <StatCard label="Appointments Today" value={stats?.kpi?.todayAppointments} color="#335CF4" icon={IconCalendar} loading={loading} onClick={() => navigate('/dashboard/appointments')} />
        <StatCard label="Active Admissions" value={stats?.kpi?.totalAdmissions} color="#D55D90" icon={IconBed} loading={loading} sub={`${stats?.kpi?.availableBeds ?? '—'} beds free`} onClick={() => navigate('/dashboard/admissions')} />
        <StatCard label="Lab Pending" value={stats?.kpi?.pendingLab} color="#669933" icon={IconFlask} loading={loading} onClick={() => navigate('/dashboard/lab')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Monthly visits bar */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><IconChartBar size={16} className="text-[#2D5BFF]" /> Monthly Patient Visits</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-44 w-full" /> : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={stats?.monthlyVisits || []} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="visits" fill="#335CF4" radius={[4,4,0,0]} name="Visits" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Patient status donut */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Patient Status</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-44 w-full" /> : (
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={PIE_DATA} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                    {PIE_DATA.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent appointments */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent Appointments</CardTitle>
            <Link to="/dashboard/appointments" className="text-xs text-[#2D5BFF] hover:underline">View all</Link>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : appointments.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">No appointments today</p>
            ) : (
              <div>{appointments.map(a => <AppointmentRow key={a.id} appt={a} />)}</div>
            )}
          </CardContent>
        </Card>

        {/* Weekly insights */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Weekly Insights</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(stats?.weeklyInsight || []).map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <div className="w-5 h-5 rounded-full bg-[#2D5BFF]/10 text-[#2D5BFF] flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{i+1}</div>
                  {w.text}
                </div>
              ))}
              {(!stats?.weeklyInsight || stats.weeklyInsight.length === 0) && (
                <p className="text-sm text-gray-400">Loading insights…</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <QuickAction label="Add Patient" path="/dashboard/patients/add" color="#335CF4" icon={IconPlus} />
        <QuickAction label="New Appointment" path="/dashboard/appointments" color="#D55D90" icon={IconCalendar} />
        <QuickAction label="Lab Request" path="/dashboard/lab" color="#FF5A5A" icon={IconFlask} />
        <QuickAction label="New Encounter" path="/dashboard/cases/new" color="#669933" icon={IconStethoscope} />
      </div>

      {/* Deep analytics summary (SUPER_ADMIN / ADMIN) */}
      {summary && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
            <IconChartBar size={15} /> Facility Analytics Summary
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
            <SummaryMetric
              label="Revenue Billed"
              value={summary.revenue?.totalBilled ? `₦${(summary.revenue.totalBilled / 1000).toFixed(0)}k` : '₦0'}
              sub={`${summary.revenue?.collectionRate ?? 0}% collected`}
              color="#16a34a"
            />
            <SummaryMetric
              label="Outstanding"
              value={summary.revenue?.outstanding ? `₦${(summary.revenue.outstanding / 1000).toFixed(0)}k` : '₦0'}
              sub={`${summary.revenue?.unpaidInvoices ?? 0} unpaid`}
              color="#dc2626"
            />
            <SummaryMetric
              label="Active Staff"
              value={summary.staff?.active}
              sub={`${summary.staff?.inactive ?? 0} inactive`}
              color="#2D5BFF"
            />
            <SummaryMetric
              label="Bed Occupancy"
              value={`${summary.beds?.occupancyPct ?? 0}%`}
              sub={`${summary.beds?.occupied ?? 0} / ${summary.beds?.total ?? 0} beds`}
              color="#d97706"
            />
            <SummaryMetric
              label="Lab Completion"
              value={`${summary.lab?.completionRate ?? 0}%`}
              sub={`${summary.lab?.pending ?? 0} pending`}
              color="#7c3aed"
            />
            <SummaryMetric
              label="Patient Growth"
              value={summary.patients?.growthPct != null ? `${summary.patients.growthPct > 0 ? '+' : ''}${summary.patients.growthPct}%` : '—'}
              sub={`${summary.patients?.newThisMonth ?? 0} new this month`}
              color={summary.patients?.growthPct >= 0 ? '#16a34a' : '#dc2626'}
            />
          </div>

          {/* Subscription status */}
          {summary.subscription && (
            <div className="rounded-xl border bg-white px-4 py-3 flex items-center gap-4 flex-wrap">
              <div>
                <p className="text-xs font-medium text-gray-500">Subscription Plan</p>
                <p className="text-sm font-bold text-gray-900">{summary.subscription.plan}</p>
              </div>
              <Badge className={`capitalize ${summary.subscription.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                {summary.subscription.status?.toLowerCase()}
              </Badge>
              {summary.subscription.patientLimit && (
                <div>
                  <p className="text-xs font-medium text-gray-500">Patients</p>
                  <p className="text-sm text-gray-700">{summary.subscription.patientsUsed ?? '—'} / {summary.subscription.patientLimit}</p>
                </div>
              )}
              {summary.subscription.endDate && (
                <div>
                  <p className="text-xs font-medium text-gray-500">Renews</p>
                  <p className="text-sm text-gray-700">{new Date(summary.subscription.endDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
              )}
              <Link to="/dashboard/subscription" className="ml-auto text-xs text-[#2D5BFF] hover:underline">Manage plan →</Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── UPID Keypad ───────────────────────────────────────────────────────────────
function UPIDKeypad() {
  const navigate = useNavigate();
  const [digits, setDigits] = React.useState(Array(8).fill(''));
  const [status, setStatus] = React.useState(null); // null | 'loading' | { patient } | 'error'
  const inputRefs = React.useRef([]);

  const code = digits.join('').toUpperCase();
  const upid = code ? `AWB-${code}` : '';

  const handleKey = (idx, val) => {
    const ch = val.slice(-1).toUpperCase().replace(/[^A-Z0-9]/, '');
    if (!ch) return;
    const next = [...digits];
    next[idx] = ch;
    setDigits(next);
    if (idx < 7) inputRefs.current[idx + 1]?.focus();
  };

  const handleBackspace = (idx, e) => {
    if (e.key === 'Backspace') {
      const next = [...digits];
      if (next[idx]) { next[idx] = ''; setDigits(next); }
      else if (idx > 0) { next[idx - 1] = ''; setDigits(next); inputRefs.current[idx - 1]?.focus(); }
    }
  };

  const clear = () => { setDigits(Array(8).fill('')); setStatus(null); inputRefs.current[0]?.focus(); };

  const lookup = async () => {
    if (code.length < 8) return;
    setStatus('loading');
    try {
      const { data } = await api.get(`/patients/resolve/${upid}`);
      const p = data.patient || data;
      setStatus({ patient: p });
      setTimeout(() => navigate(`/dashboard/patients/${p.id}`), 900);
    } catch {
      setStatus('error');
    }
  };

  const pad = [
    ['1','2','3'],['4','5','6'],['7','8','9'],
    ['A','B','C'],['D','E','F'],['0','⌫','↵'],
  ];

  const pressKey = (k) => {
    if (k === '⌫') {
      const last = digits.map((d,i) => d ? i : -1).filter(i => i >= 0).pop() ?? -1;
      if (last >= 0) { const n=[...digits]; n[last]=''; setDigits(n); inputRefs.current[last]?.focus(); }
      return;
    }
    if (k === '↵') { lookup(); return; }
    const first = digits.findIndex(d => !d);
    if (first === -1) return;
    const n = [...digits]; n[first] = k; setDigits(n);
    inputRefs.current[Math.min(first + 1, 7)]?.focus();
  };

  return (
    <div className="rounded-2xl border border-[#2D5BFF]/20 bg-linear-to-br from-[#2D5BFF]/5 to-white p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-[#2D5BFF] flex items-center justify-center">
          <IconUsers className="size-4 text-white" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Patient ID lookup</h3>
          <p className="text-xs text-gray-400">Enter the 8-character Patient ID</p>
        </div>
      </div>

      {/* Digit slots */}
      <div className="flex items-center gap-1 mb-4 justify-center">
        <span className="text-base font-bold text-[#2D5BFF] font-mono mr-1">AWB-</span>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={el => { inputRefs.current[i] = el; }}
            value={d}
            maxLength={1}
            onChange={e => handleKey(i, e.target.value)}
            onKeyDown={e => handleBackspace(i, e)}
            className="w-9 h-10 text-center font-mono text-base font-bold border-2 rounded-lg focus:outline-none focus:border-[#2D5BFF] transition-colors uppercase"
            style={{ borderColor: d ? '#2D5BFF' : '#e5e7eb', backgroundColor: d ? '#eff5ff' : 'white' }}
          />
        ))}
      </div>

      {/* Physical keypad */}
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {pad.flat().map((k) => (
          <button
            key={k}
            onClick={() => pressKey(k)}
            className={`py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              k === '↵'
                ? 'bg-[#2D5BFF] text-white hover:bg-[#1a45e0]'
                : k === '⌫'
                  ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  : 'bg-gray-50 text-gray-800 hover:bg-gray-100 font-mono'
            }`}
          >
            {k}
          </button>
        ))}
      </div>

      {/* Status / actions */}
      {status === 'loading' && (
        <p className="text-center text-sm text-[#2D5BFF] animate-pulse">Looking up patient…</p>
      )}
      {status === 'error' && (
        <p className="text-center text-sm text-red-500">Patient not found. Check the ID and try again.
          <button onClick={clear} className="ml-2 underline">Clear</button>
        </p>
      )}
      {status?.patient && (
        <p className="text-center text-sm text-green-700 font-medium">
          ✓ {status.patient.firstName} {status.patient.lastName} — redirecting…
        </p>
      )}
      {!status && (
        <div className="flex gap-2">
          <button
            onClick={lookup}
            disabled={code.length < 8}
            className="flex-1 py-2.5 bg-[#2D5BFF] text-white text-sm font-semibold rounded-lg hover:bg-[#1a45e0] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Look up patient
          </button>
          {code && (
            <button onClick={clear} className="px-4 py-2.5 rounded-lg bg-gray-100 text-sm text-gray-600 hover:bg-gray-200">
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── CLINICIAN (Doctor) Overview ───────────────────────────────────────────────
function ClinicianOverview({ stats, appointments, cases, loading, user }) {
  const navigate = useNavigate();
  return (
    <div className="space-y-6">
      <CriticalAlerts />
      {/* UPID keypad — primary entry point for clinicians */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <UPIDKeypad />
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Today's Appointments" value={stats?.kpi?.todayAppointments} color="#335CF4" icon={IconCalendar} loading={loading} onClick={() => navigate('/dashboard/appointments')} />
          <StatCard label="Total Patients" value={stats?.kpi?.totalPatients} color="#FF5A5A" icon={IconUsers} loading={loading} onClick={() => navigate('/dashboard/patients')} />
          <StatCard label="Lab Pending" value={stats?.kpi?.pendingLab} color="#669933" icon={IconFlask} loading={loading} onClick={() => navigate('/dashboard/lab')} />
          <StatCard label="New This Month" value={stats?.kpi?.patientsThisMonth} color="#D55D90" icon={IconReportMedical} loading={loading} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Today's appointments */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Today's Schedule</CardTitle>
            <Link to="/dashboard/appointments" className="text-xs text-[#2D5BFF] hover:underline">Manage</Link>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : appointments.length === 0 ? (
              <div className="text-center py-6">
                <IconCalendar size={28} className="text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">No appointments scheduled today</p>
                <button onClick={() => navigate('/dashboard/appointments')} className="mt-2 text-xs text-[#2D5BFF] hover:underline">
                  Book one now
                </button>
              </div>
            ) : (
              <div>{appointments.map(a => <AppointmentRow key={a.id} appt={a} />)}</div>
            )}
          </CardContent>
        </Card>

        {/* Recent cases */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent Encounters</CardTitle>
            <Link to="/dashboard/cases" className="text-xs text-[#2D5BFF] hover:underline">View all</Link>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : cases.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">No recent encounters</p>
            ) : (
              <div className="space-y-2">
                {cases.map(c => (
                  <Link key={c.id} to={`/dashboard/cases/${c.id}`} className="block p-3 rounded-lg hover:bg-gray-50 transition-colors border border-gray-100">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{c.patient?.firstName} {c.patient?.lastName}</p>
                        <p className="text-xs text-gray-400 font-mono">{c.patient?.universalPatientId}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{c.chiefComplaint || c.title}</p>
                      </div>
                      <StatusBadge status={c.status} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <QuickAction label="New Encounter" path="/dashboard/cases/new" color="#335CF4" icon={IconStethoscope} />
        <QuickAction label="Patient Lookup" path="/dashboard/patients" color="#D55D90" icon={IconUsers} />
        <QuickAction label="Lab Request" path="/dashboard/lab" color="#669933" icon={IconFlask} />
        <QuickAction label="Reports" path="/dashboard/reports" color="#FF8C00" icon={IconReportMedical} />
      </div>
    </div>
  );
}

// ── Critical result alert strip ───────────────────────────────────────────────
// A critical result is not "handled" until a named practitioner acknowledges it,
// so this stays on screen until someone does.
function CriticalAlerts() {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['critical-alerts'],
    queryFn: () => api.get('/lab/alerts/critical').then(r => r.data),
    refetchInterval: 30000,
  });

  if (!data?.criticalCount) return null;

  return (
    <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4">
      <div className="flex items-start gap-3">
        <IconAlertTriangle size={22} className="text-red-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-red-900">
            {data.criticalCount} critical result{data.criticalCount === 1 ? '' : 's'} awaiting acknowledgement
          </h3>
          <div className="mt-2 space-y-1.5">
            {data.critical.slice(0, 4).map(c => (
              <button key={c.id} onClick={() => navigate('/dashboard/lab')}
                className="w-full text-left flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm hover:underline">
                <span className="font-semibold text-red-900">{c.testName}</span>
                <span className="font-mono text-red-700">
                  {c.resultValue ?? ''} {c.resultUnit ?? ''}
                </span>
                <span className="px-1.5 py-0.5 bg-red-600 text-white rounded text-xs font-medium">
                  {c.abnormalFlag?.replace('_', ' ')}
                </span>
                <span className="text-red-800">
                  — {c.patient?.firstName} {c.patient?.lastName}
                </span>
              </button>
            ))}
          </div>
          {data.criticalCount > 4 && (
            <p className="text-xs text-red-700 mt-2">+{data.criticalCount - 4} more</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── NURSE Overview ────────────────────────────────────────────────────────────
function NurseOverview({ stats, appointments, loading }) {
  const navigate = useNavigate();

  // Ward documentation the nurse is actually accountable for this shift.
  const { data: ward } = useQuery({
    queryKey: ['nursing-stats'],
    queryFn: () => api.get('/nursing/stats').then(r => r.data),
    refetchInterval: 60000,
  });

  return (
    <div className="space-y-6">
      <CriticalAlerts />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Active Monitoring" value={ward?.activeSheets} color="#335CF4" icon={IconActivityHeartbeat} loading={loading} onClick={() => navigate('/dashboard/nursing')} />
        <StatCard label="Abnormal Today" value={ward?.abnormalToday} color="#FF5A5A" icon={IconAlertTriangle} loading={loading} onClick={() => navigate('/dashboard/nursing')} sub="flagged observations" />
        <StatCard label="Doses Given Today" value={ward?.dosesToday} color="#669933" icon={IconPill} loading={loading} onClick={() => navigate('/dashboard/nursing/drug-chart')} />
        <StatCard label="Shift Reports To Read" value={ward?.unacknowledgedHandovers} color="#D55D90" icon={IconClipboardList} loading={loading} onClick={() => navigate('/dashboard/nursing/shift-report')} />
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Active Admissions" value={stats?.kpi?.totalAdmissions} color="#8B5CF6" icon={IconBed} loading={loading} onClick={() => navigate('/dashboard/admissions')} />
        <StatCard label="Available Beds" value={stats?.kpi?.availableBeds} color="#0EA5E9" icon={IconBuildingHospital} loading={loading} onClick={() => navigate('/dashboard/admissions')} />
        <StatCard label="Transfusions Running" value={ward?.activeTransfusions} color="#E5484D" icon={IconDroplet} loading={loading} onClick={() => navigate('/dashboard/nursing')} sub="observe every 15 min" />
        <StatCard label="Today's Appointments" value={stats?.kpi?.todayAppointments} color="#F76B15" icon={IconCalendar} loading={loading} onClick={() => navigate('/dashboard/appointments')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Today's Appointments</CardTitle>
            <Link to="/dashboard/appointments" className="text-xs text-[#2D5BFF] hover:underline">View all</Link>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : appointments.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">No appointments today</p>
            ) : (
              <div>{appointments.map(a => <AppointmentRow key={a.id} appt={a} />)}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Nursing Actions</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <QuickAction label="Monitoring" path="/dashboard/nursing" color="#335CF4" icon={IconActivityHeartbeat} />
              <QuickAction label="Drug Chart" path="/dashboard/nursing/drug-chart" color="#669933" icon={IconPill} />
              <QuickAction label="Shift report" path="/dashboard/nursing/shift-report" color="#D55D90" icon={IconClipboardList} />
              <QuickAction label="Record Vitals" path="/dashboard/patients" color="#8B5CF6" icon={IconStethoscope} />
              <QuickAction label="Admissions" path="/dashboard/admissions" color="#0EA5E9" icon={IconBed} />
              <QuickAction label="Diagnostics" path="/dashboard/lab" color="#F76B15" icon={IconFlask} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── RECORDS Officer Overview ──────────────────────────────────────────────────
function RecordsOverview({ stats, appointments, loading }) {
  const navigate = useNavigate();
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Total Patients" value={stats?.kpi?.totalPatients} color="#335CF4" icon={IconUsers} loading={loading} onClick={() => navigate('/dashboard/patients')} />
        <StatCard label="New This Month" value={stats?.kpi?.patientsThisMonth} color="#FF5A5A" icon={IconPlus} loading={loading} />
        <StatCard label="Today's Appointments" value={stats?.kpi?.todayAppointments} color="#D55D90" icon={IconCalendar} loading={loading} onClick={() => navigate('/dashboard/appointments')} />
        <StatCard label="Lab Pending" value={stats?.kpi?.pendingLab} color="#669933" icon={IconFlask} loading={loading} onClick={() => navigate('/dashboard/lab')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent Appointments</CardTitle>
            <Link to="/dashboard/appointments" className="text-xs text-[#2D5BFF] hover:underline">View all</Link>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : appointments.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">No appointments</p>
            ) : (
              <div>{appointments.map(a => <AppointmentRow key={a.id} appt={a} />)}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Record Actions</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[
                { label: 'Register Patient', path: '/dashboard/patients/add', color: 'bg-[#2D5BFF] text-white' },
                { label: 'Patient Lookup', path: '/dashboard/patients', color: 'bg-gray-100 text-gray-800' },
                { label: 'Book Appointment', path: '/dashboard/appointments', color: 'bg-gray-100 text-gray-800' },
                { label: 'Lab Requests', path: '/dashboard/lab', color: 'bg-gray-100 text-gray-800' },
              ].map(a => (
                <button key={a.label} onClick={() => navigate(a.path)}
                  className={`w-full py-2.5 rounded-lg text-sm font-medium text-left px-4 transition-all hover:opacity-80 ${a.color}`}>
                  {a.label}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function LabOverview({ stats, loading }) {
  const navigate = useNavigate();
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Pending Requests" value={stats?.kpi?.pendingLab} color="#669933" icon={IconFlask} loading={loading} onClick={() => navigate('/dashboard/lab')} />
        <StatCard label="Completed Today" value={stats?.labStatus?.completedToday} color="#335CF4" icon={IconReportMedical} loading={loading} onClick={() => navigate('/dashboard/lab')} />
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Laboratory workspace</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500 mb-4">Review pending tests, record verified results, and transfer completed results securely.</p>
          <button onClick={() => navigate('/dashboard/lab')} className="px-4 py-2.5 rounded-lg bg-[#669933] text-white text-sm font-semibold">
            Open Lab &amp; Imaging
          </button>
        </CardContent>
      </Card>
    </div>
  );
}

function PharmacistOverview({ stats, loading }) {
  const navigate = useNavigate();
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Total Patients" value={stats?.kpi?.totalPatients} color="#335CF4" icon={IconUsers} loading={loading} onClick={() => navigate('/dashboard/patients')} />
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Pharmacy workspace</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">Dispensing workflow is not yet implemented. Patient medication histories remain read-only until it is completed.</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Overview ─────────────────────────────────────────────────────────────
export default function Overview() {
  const { user, facility } = useSelector((s) => s.auth);
  const [stats, setStats] = useState(null);
  const [summary, setSummary] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);

  const role = user?.role;

  useEffect(() => {
    const load = async () => {
      try {
        const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN';
        const [statsRes, apptRes, summaryRes] = await Promise.all([
          api.get('/analytics').catch(() => ({ data: null })),
          api.get('/appointments?limit=8').catch(() => ({ data: { appointments: [] } })),
          isAdmin ? api.get('/analytics/summary').catch(() => ({ data: null })) : Promise.resolve({ data: null }),
        ]);
        setStats(statsRes.data);
        setSummary(summaryRes.data);
        const apptList = apptRes.data?.appointments || apptRes.data || [];
        setAppointments(Array.isArray(apptList) ? apptList : []);
        setCases(statsRes.data?.recentCases || []);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const subRole = user?.subRole;

  const greetingName = user?.firstName || 'there';
  // One source of truth for the label, so the greeting, the sidebar and the
  // login picker can never disagree about what this person is called.
  const greetingRole = role ? roleLabel(role, subRole) : '';

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Welcome bar */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Good {getGreeting()}, {greetingName}!
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {facility?.name || 'Awibi EHR'} &mdash; {greetingRole} Dashboard
          </p>
        </div>
        <div className="text-right text-sm text-gray-400 hidden sm:block">
          <div className="font-medium text-gray-700">{format(new Date(), 'EEEE, d MMM yyyy')}</div>
        </div>
      </div>

      {/* Role-specific view */}
      {(role === 'SUPER_ADMIN' || role === 'ADMIN') && (
        <AdminOverview stats={stats} summary={summary} appointments={appointments} loading={loading} />
      )}
      {role === 'CLINICIAN' && subRole === 'DOCTOR' && (
        <ClinicianOverview stats={stats} appointments={appointments} cases={cases} loading={loading} user={user} />
      )}
      {role === 'RECORDS' && subRole !== 'NURSE' && (
        <RecordsOverview stats={stats} appointments={appointments} loading={loading} />
      )}
      {role === 'CLINICIAN' && subRole === 'NURSE' && (
        <NurseOverview stats={stats} appointments={appointments} loading={loading} />
      )}
      {role === 'CLINICIAN' && subRole === 'LAB' && (
        <LabOverview stats={stats} loading={loading} />
      )}
      {role === 'CLINICIAN' && subRole === 'PHARMACIST' && (
        <PharmacistOverview stats={stats} loading={loading} />
      )}
      {/* Fallback for any unlisted role */}
      {!['SUPER_ADMIN','ADMIN','CLINICIAN','RECORDS'].includes(role) && (
        <AdminOverview stats={stats} appointments={appointments} loading={loading} />
      )}
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}
