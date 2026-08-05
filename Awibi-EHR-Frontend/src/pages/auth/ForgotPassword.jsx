import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async e => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (_) {
      setSent(true); // anti-enumeration: always show success
    } finally {
      setLoading(false);
    }
  };

  if (sent) return (
    <div className="text-center">
      <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
        <CheckCircle2 size={32} className="text-green-600" />
      </div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">Check your email</h2>
      <p className="text-sm text-gray-500 mb-6">If an account exists for {email}, we've sent a password reset link. Check your spam folder too.</p>
      <Link to="/login" className="text-[#2D5BFF] text-sm font-medium hover:underline">Back to login</Link>
    </div>
  );

  return (
    <div>
      <img src="/logo.png" alt="AwibiEHR" className="h-10 w-auto mb-6" />
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Reset password</h1>
      <p className="text-sm text-gray-500 mb-6">Enter your email and we'll send a reset link</p>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" placeholder="you@hospital.ng" />
        </div>
        <button type="submit" disabled={loading} className="w-full py-2.5 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50 flex items-center justify-center gap-2">
          {loading && <Loader2 size={16} className="animate-spin" />}
          Send reset link
        </button>
      </form>
      <p className="text-center text-sm text-gray-500 mt-6">
        <Link to="/login" className="text-[#2D5BFF] font-medium hover:underline">Back to login</Link>
      </p>
    </div>
  );
}
