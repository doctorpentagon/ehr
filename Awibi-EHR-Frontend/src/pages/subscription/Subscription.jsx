import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Zap, Building2, AlertCircle, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { useSelector } from 'react-redux';
import { toast } from 'sonner';
import api from '@/lib/api';
import Spinner from '@/components/ui/Spinner';

const PLANS = [
  {
    key: 'FREE',
    label: 'Free Trial',
    price: '₦0',
    period: '/month',
    color: 'border-gray-200',
    headerColor: 'bg-gray-50',
    badge: null,
    features: [
      'Up to 50 patients',
      '1 staff account',
      'Basic patient records',
      'Patient ID generation',
      'Community support',
    ],
    limits: { patients: 50, staff: 1 },
    amount: 0,
  },
  {
    key: 'SMALL',
    label: 'Small Clinic',
    price: '₦20,000',
    period: '/month',
    color: 'border-[#2D5BFF]',
    headerColor: 'bg-[#2D5BFF]',
    badge: 'Most Popular',
    features: [
      'Up to 200 patients',
      'Up to 10 staff accounts',
      'Full EHR features',
      'Lab & Imaging requests',
      'Admissions & Bed management',
      'Billing & Paystack',
      'Email support',
    ],
    limits: { patients: 200, staff: 10 },
    amount: 20000,
  },
  {
    key: 'CLINIC_PLUS',
    label: 'Clinic+',
    price: '₦45,000',
    period: '/month',
    color: 'border-purple-300',
    headerColor: 'bg-purple-600',
    badge: 'For Larger Clinics',
    features: [
      'Up to 2,000 patients',
      'Up to 50 staff accounts',
      'Everything in Small Clinic',
      'Priority support',
      'Custom reports',
      'API access',
      'Affiliate lab routing',
    ],
    limits: { patients: 2000, staff: 50 },
    amount: 45000,
  },
  {
    key: 'INSTITUTION',
    label: 'Institution',
    price: '₦300,000',
    period: '/year',
    color: 'border-teal-300',
    headerColor: 'bg-teal-600',
    badge: 'Best Value',
    features: [
      'Unlimited patients',
      'Unlimited staff',
      'Everything in Clinic+',
      'Dedicated account manager',
      'SLA guarantee',
      'Custom integrations',
      'On-site training',
    ],
    limits: { patients: 99999, staff: 999 },
    amount: 300000,
  },
];

function UsageMeter({ label, used, limit, color }) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const isWarning = pct >= 80;
  const isDanger = pct >= 95;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-600">{label}</span>
        <span className={`font-medium ${isDanger ? 'text-red-600' : isWarning ? 'text-orange-500' : 'text-gray-700'}`}>
          {used.toLocaleString()} / {limit >= 99999 ? '∞' : limit.toLocaleString()}
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isDanger ? 'bg-red-500' : isWarning ? 'bg-orange-400' : color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function Subscription() {
  const qc = useQueryClient();
  const { user, facility } = useSelector(s => s.auth);
  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(user?.role);

  const { data, isLoading } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => api.get('/subscriptions').then(r => r.data),
  });

  const sub = data?.subscription;
  const currentPlan = sub?.plan || 'FREE';

  const { mutate: upgrade, isPending } = useMutation({
    mutationFn: plan => api.post('/subscriptions/upgrade', { plan }),
    onSuccess: ({ data: d }) => {
      if (d?.authorizationUrl) {
        window.open(d.authorizationUrl, '_blank');
      } else {
        qc.invalidateQueries({ queryKey: ['subscription'] });
        toast.success('Plan updated!');
      }
    },
    onError: err => toast.error(err.response?.data?.error || 'Upgrade failed'),
  });

  const { mutate: initPay } = useMutation({
    mutationFn: plan => {
      const p = PLANS.find(x => x.key === plan);
      return api.post('/paystack/initialize', {
        amount: p.amount,
        email: user?.email || facility?.email,
        plan,
        metadata: { plan, facilityId: facility?.id },
      });
    },
    onSuccess: ({ data: d }) => {
      if (d?.authorizationUrl) window.open(d.authorizationUrl, '_blank');
    },
    onError: () => toast.error('Could not initiate payment'),
  });

  if (isLoading) return <div className="py-24 flex justify-center"><Spinner size="lg" /></div>;

  const daysLeft = sub?.endDate
    ? Math.max(0, Math.ceil((new Date(sub.endDate) - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Subscription & Plans</h1>
        <p className="text-sm text-gray-500">Manage your facility plan and usage</p>
      </div>

      {/* Current plan status */}
      {sub && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3 flex-1">
            <div className="w-10 h-10 bg-[#2D5BFF]/10 rounded-xl flex items-center justify-center">
              <Zap size={18} className="text-[#2D5BFF]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900">{PLANS.find(p => p.key === currentPlan)?.label || currentPlan}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sub.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : sub.status === 'TRIAL' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>
                  {sub.status}
                </span>
              </div>
              <p className="text-sm text-gray-500">
                {sub.endDate ? `Renews ${format(new Date(sub.endDate), 'dd MMM yyyy')}` : 'No expiry set'}
                {daysLeft !== null && daysLeft <= 14 && (
                  <span className="text-orange-600 ml-2 font-medium">({daysLeft} days left)</span>
                )}
              </p>
            </div>
          </div>

          {/* Usage meters */}
          <div className="flex-1 space-y-2 min-w-0">
            <UsageMeter label="Patients" used={sub.patientsUsed || 0} limit={sub.patientLimit || 50} color="bg-[#2D5BFF]" />
            <UsageMeter label="Staff" used={sub.staffUsed || 0} limit={sub.staffLimit || 5} color="bg-purple-500" />
          </div>
        </div>
      )}

      {/* Upgrade prompt when near limit */}
      {sub && sub.patientsUsed >= sub.patientLimit * 0.9 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-orange-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-orange-800">Approaching patient limit</p>
            <p className="text-xs text-orange-700">You've used {sub.patientsUsed} of {sub.patientLimit} patients. Upgrade your plan to continue adding patients.</p>
          </div>
        </div>
      )}

      {/* Plan cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {PLANS.map(plan => {
          const isCurrent = plan.key === currentPlan;
          const isLower = PLANS.findIndex(p => p.key === plan.key) < PLANS.findIndex(p => p.key === currentPlan);

          return (
            <div
              key={plan.key}
              className={`rounded-xl border-2 overflow-hidden transition-all ${plan.color} ${isCurrent ? 'shadow-md' : ''}`}
            >
              {/* Header */}
              <div className={`px-4 py-3 ${isCurrent ? plan.headerColor : 'bg-gray-50'}`}>
                {plan.badge && (
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full mb-1 inline-block ${isCurrent ? 'bg-white/20 text-white' : 'bg-white text-gray-700 border border-gray-200'}`}>
                    {plan.badge}
                  </span>
                )}
                <h3 className={`font-bold text-base ${isCurrent ? 'text-white' : 'text-gray-900'}`}>{plan.label}</h3>
                <div className={`flex items-baseline gap-1 mt-0.5 ${isCurrent ? 'text-white' : 'text-gray-900'}`}>
                  <span className="text-2xl font-extrabold">{plan.price}</span>
                  <span className={`text-xs ${isCurrent ? 'text-white/70' : 'text-gray-400'}`}>{plan.period}</span>
                </div>
              </div>

              {/* Features */}
              <div className="px-4 py-3 space-y-2">
                {plan.features.map(f => (
                  <div key={f} className="flex items-start gap-2">
                    <Check size={13} className="text-green-500 flex-shrink-0 mt-0.5" />
                    <span className="text-xs text-gray-600">{f}</span>
                  </div>
                ))}
              </div>

              {/* CTA */}
              <div className="px-4 pb-4">
                {isCurrent ? (
                  <div className="w-full py-2 bg-gray-100 text-gray-500 rounded-lg text-xs font-medium text-center">
                    Current Plan
                  </div>
                ) : isAdmin ? (
                  <button
                    disabled={isLower || isPending}
                    onClick={() => plan.amount > 0 ? initPay(plan.key) : upgrade(plan.key)}
                    className="w-full py-2 bg-[#2D5BFF] text-white rounded-lg text-xs font-medium hover:bg-[#1a45e0] disabled:opacity-40 flex items-center justify-center gap-1.5"
                  >
                    {plan.amount > 0 && <ExternalLink size={11} />}
                    {isLower ? 'Downgrade' : plan.amount > 0 ? 'Pay & Upgrade' : 'Activate'}
                  </button>
                ) : (
                  <p className="text-xs text-gray-400 text-center">Admin only</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-400">
        Payments processed securely via Paystack. All prices in Nigerian Naira (₦). Plans auto-renew monthly unless cancelled.
      </p>
    </div>
  );
}
