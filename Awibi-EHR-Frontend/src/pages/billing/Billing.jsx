import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Receipt, DollarSign, AlertCircle, CheckCircle, Plus, Search, CreditCard, Eye, Download } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import api from '@/lib/api';
import StatusBadge from '@/components/ui/StatusBadge';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';

const PAY_STATUS_COLOR = {
  PAID:      'bg-green-100 text-green-700',
  PART_PAID: 'bg-yellow-100 text-yellow-700',
  UNPAID:    'bg-red-100 text-red-700',
};

// The PDF endpoint needs the auth header, so it cannot be a plain <a href>.
async function openInvoicePdf(invoice) {
  try {
    const res = await api.get(`/billing/${invoice.id}/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${invoice.invoiceNumber}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast.success('Invoice downloaded');
  } catch (e) {
    toast.error(e?.response?.data?.error || 'Could not generate the invoice PDF');
  }
}

export default function Billing() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [payModal, setPayModal] = useState(null);  // invoice object
  const [viewModal, setViewModal] = useState(null); // invoice object

  const { data, isLoading } = useQuery({
    queryKey: ['billing', search],
    queryFn: () => api.get('/billing', { params: { search, limit: 30 } }).then(r => r.data),
  });

  const { data: summary } = useQuery({
    queryKey: ['billing-summary'],
    queryFn: () => api.get('/billing/summary').then(r => r.data),
  });

  const invoices = data?.invoices || data || [];
  const s = summary || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Billing & Invoices</h1>
          <p className="text-sm text-gray-500">Payments and outstanding balances</p>
        </div>
      </div>

      {/* Summary strip */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Billed',     value: s.totalBilled,    color: 'bg-gray-900 text-white'  },
            { label: 'Total Collected',  value: s.totalCollected, color: 'bg-green-600 text-white' },
            { label: 'Outstanding',      value: s.outstanding,    color: 'bg-red-500 text-white'   },
            { label: 'Unpaid Invoices',  value: s.unpaidCount,    color: 'bg-orange-400 text-white', isCount: true },
          ].map(c => (
            <div key={c.label} className={`rounded-xl p-4 ${c.color}`}>
              {c.isCount
                ? <div className="text-2xl font-extrabold">{c.value ?? '0'}</div>
                : <div className="text-xl font-extrabold">₦{Number(c.value ?? 0).toLocaleString()}</div>
              }
              <div className="text-sm opacity-80">{c.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by patient name or invoice number…"
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 bg-gray-50" />
      </div>

      {isLoading ? (
        <div className="py-16 flex justify-center"><Spinner /></div>
      ) : invoices.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <Receipt size={36} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No invoices found</p>
          <p className="text-xs text-gray-300 mt-1">Invoices are generated when appointments are booked with charges</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Invoice #', 'Patient', 'Total', 'Paid', 'Balance', 'Status', 'Due Date', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {invoices.map(inv => (
                <tr key={inv.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-mono text-xs text-[#2D5BFF] font-semibold">{inv.invoiceNumber}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{inv.patient?.firstName} {inv.patient?.lastName}</div>
                    <div className="text-xs font-mono text-gray-400">{inv.patient?.universalPatientId}</div>
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-900">₦{Number(inv.total).toLocaleString()}</td>
                  <td className="px-4 py-3 text-green-700">₦{Number(inv.amountPaid).toLocaleString()}</td>
                  <td className="px-4 py-3 text-red-600 font-medium">₦{Number(inv.balance).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PAY_STATUS_COLOR[inv.paymentStatus] || 'bg-gray-100 text-gray-600'}`}>
                      {inv.paymentStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                    {inv.dueDate ? format(new Date(inv.dueDate), 'dd MMM yyyy') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setViewModal(inv)} title="View invoice"
                        className="p-1.5 text-gray-400 hover:text-[#2D5BFF] hover:bg-[#2D5BFF]/10 rounded-lg">
                        <Eye size={14} />
                      </button>
                      <button onClick={() => openInvoicePdf(inv)} title="Download PDF"
                        className="p-1.5 text-gray-400 hover:text-[#2D5BFF] hover:bg-[#2D5BFF]/10 rounded-lg">
                        <Download size={14} />
                      </button>
                      {inv.paymentStatus !== 'PAID' && (
                        <button onClick={() => setPayModal(inv)}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-[#2D5BFF] text-white rounded-lg text-xs font-medium hover:bg-[#1a45e0]">
                          <CreditCard size={12} /> Pay
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {payModal && <PayModal invoice={payModal} onClose={() => setPayModal(null)} />}
      {viewModal && <InvoiceViewModal invoice={viewModal} onClose={() => setViewModal(null)} />}
    </div>
  );
}

function PayModal({ invoice, onClose }) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);

  const pay = async () => {
    setLoading(true);
    try {
      const { data } = await api.post('/paystack/initialize', {
        amount: Number(invoice.balance),
        email: invoice.patient?.email || 'patient@awibi.health',
        invoiceId: invoice.id,
        metadata: { invoiceId: invoice.id, patientId: invoice.patientId },
      });
      if (data.authorizationUrl) {
        window.open(data.authorizationUrl, '_blank');
        onClose();
        toast.success('Paystack payment window opened');
      }
    } catch {
      toast.error('Could not initiate payment');
    } finally {
      setLoading(false);
    }
  };

  const markPaid = async () => {
    setLoading(true);
    try {
      await api.put(`/billing/${invoice.id}/mark-paid`);
      qc.invalidateQueries({ queryKey: ['billing'] });
      qc.invalidateQueries({ queryKey: ['billing-summary'] });
      toast.success('Invoice marked as paid (cash)');
      onClose();
    } catch {
      toast.error('Failed to update');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open title="Record Payment" onClose={onClose} size="sm">
      <div className="p-6 space-y-4">
        <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">Invoice</span><span className="font-mono font-semibold">{invoice.invoiceNumber}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Patient</span><span>{invoice.patient?.firstName} {invoice.patient?.lastName}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Total</span><span className="font-semibold">₦{Number(invoice.total).toLocaleString()}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Amount Paid</span><span className="text-green-700">₦{Number(invoice.amountPaid).toLocaleString()}</span></div>
          <div className="flex justify-between border-t border-gray-200 pt-2"><span className="font-semibold">Balance Due</span><span className="font-bold text-red-600">₦{Number(invoice.balance).toLocaleString()}</span></div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button onClick={markPaid} disabled={loading}
            className="py-2.5 border-2 border-green-500 text-green-700 rounded-lg text-sm font-medium hover:bg-green-50 disabled:opacity-50">
            Mark Paid (Cash)
          </button>
          <button onClick={pay} disabled={loading}
            className="py-2.5 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50 flex items-center justify-center gap-1.5">
            <CreditCard size={14} /> Pay via Paystack
          </button>
        </div>
        <button onClick={onClose} className="w-full py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
      </div>
    </Modal>
  );
}

function InvoiceViewModal({ invoice, onClose }) {
  return (
    <Modal open title={`Invoice ${invoice.invoiceNumber}`} onClose={onClose} size="sm">
      <div className="p-6">
        <div className="space-y-3 text-sm">
          <div className="flex justify-between border-b border-gray-100 pb-2">
            <span className="text-gray-500">Patient</span>
            <span className="font-medium">{invoice.patient?.firstName} {invoice.patient?.lastName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Date</span>
            <span>{invoice.createdAt ? format(new Date(invoice.createdAt), 'dd MMM yyyy') : '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Due Date</span>
            <span>{invoice.dueDate ? format(new Date(invoice.dueDate), 'dd MMM yyyy') : '—'}</span>
          </div>

          {/* Line items */}
          {invoice.items?.length > 0 && (
            <div className="border border-gray-100 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600 uppercase">Items</div>
              {invoice.items.map((item, i) => (
                <div key={i} className="flex justify-between px-3 py-2 border-t border-gray-50 text-xs">
                  <span>{item.description || item.name}</span>
                  <span className="font-medium">₦{Number(item.amount || item.price || 0).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-gray-200 pt-3 space-y-1.5">
            <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>₦{Number(invoice.subtotal || invoice.total).toLocaleString()}</span></div>
            {invoice.discount > 0 && <div className="flex justify-between text-green-700"><span>Discount</span><span>-₦{Number(invoice.discount).toLocaleString()}</span></div>}
            <div className="flex justify-between font-bold text-base"><span>Total</span><span>₦{Number(invoice.total).toLocaleString()}</span></div>
            <div className="flex justify-between text-green-700"><span>Paid</span><span>₦{Number(invoice.amountPaid).toLocaleString()}</span></div>
            <div className="flex justify-between font-bold text-red-600"><span>Balance</span><span>₦{Number(invoice.balance).toLocaleString()}</span></div>
          </div>

          <div className="flex justify-center mt-2">
            <span className={`text-sm px-4 py-1.5 rounded-full font-semibold ${PAY_STATUS_COLOR[invoice.paymentStatus] || 'bg-gray-100 text-gray-600'}`}>
              {invoice.paymentStatus}
            </span>
          </div>
        </div>

        <button onClick={onClose} className="w-full mt-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Close</button>
      </div>
    </Modal>
  );
}
