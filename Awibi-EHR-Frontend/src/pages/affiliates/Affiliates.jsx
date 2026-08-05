import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Building2, Phone, Mail, MapPin, Edit2, Trash2, FlaskConical, X } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import Modal from '@/components/ui/Modal';
import EmptyState from '@/components/ui/EmptyState';
import Spinner from '@/components/ui/Spinner';

const TYPE_COLORS = {
  LAB:        'bg-orange-50 text-orange-700 border-orange-200',
  IMAGING:    'bg-blue-50 text-blue-700 border-blue-200',
  PHARMACY:   'bg-green-50 text-green-700 border-green-200',
  SPECIALIST: 'bg-purple-50 text-purple-700 border-purple-200',
  HOSPITAL:   'bg-red-50 text-red-700 border-red-200',
};

const TYPES = ['LAB', 'IMAGING', 'PHARMACY', 'SPECIALIST', 'HOSPITAL'];

export default function Affiliates() {
  const qc = useQueryClient();
  const [modal, setModal] = useState(null); // null | 'add' | affiliate object

  const { data, isLoading } = useQuery({
    queryKey: ['affiliates'],
    queryFn: () => api.get('/affiliates').then(r => r.data),
  });

  const affiliates = data?.affiliates || [];

  const { mutate: del } = useMutation({
    mutationFn: id => api.delete(`/affiliates/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['affiliates'] }); toast.success('Affiliate removed'); },
    onError: () => toast.error('Failed to delete'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Affiliates</h1>
          <p className="text-sm text-gray-500">Linked labs, imaging centres, pharmacies and specialist clinics</p>
        </div>
        <button
          onClick={() => setModal('add')}
          className="flex items-center gap-2 px-4 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]"
        >
          <Plus size={16} /> Add Affiliate
        </button>
      </div>

      {/* Type filter chips */}
      <div className="flex flex-wrap gap-2">
        {TYPES.map(t => (
          <span key={t} className={`text-xs px-3 py-1 rounded-full border font-medium ${TYPE_COLORS[t]}`}>
            {t}
          </span>
        ))}
      </div>

      {isLoading ? (
        <div className="py-16 flex justify-center"><Spinner /></div>
      ) : affiliates.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No affiliates yet"
          description="Add labs, imaging centres, pharmacies, or specialist clinics you refer patients to."
          action={{ label: 'Add Affiliate', onClick: () => setModal('add') }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {affiliates.map(a => (
            <AffiliateCard key={a.id} affiliate={a} onEdit={() => setModal(a)} onDelete={() => del(a.id)} />
          ))}
        </div>
      )}

      <AffiliateModal
        open={!!modal}
        onClose={() => setModal(null)}
        affiliate={modal !== 'add' ? modal : null}
      />
    </div>
  );
}

function AffiliateCard({ affiliate: a, onEdit, onDelete }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 hover:border-gray-300 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#2D5BFF]/10 rounded-xl flex items-center justify-center flex-shrink-0">
            <Building2 size={18} className="text-[#2D5BFF]" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 leading-tight">{a.name}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${TYPE_COLORS[a.type] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
              {a.type}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-[#2D5BFF] hover:bg-[#2D5BFF]/10 rounded-lg transition-colors">
            <Edit2 size={14} />
          </button>
          <button onClick={onDelete} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="space-y-1.5 text-xs text-gray-500">
        {a.contactName && (
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-700">{a.contactName}</span>
          </div>
        )}
        {a.phone && (
          <div className="flex items-center gap-2">
            <Phone size={11} className="flex-shrink-0" /> {a.phone}
          </div>
        )}
        {a.email && (
          <div className="flex items-center gap-2">
            <Mail size={11} className="flex-shrink-0" /> {a.email}
          </div>
        )}
        {a.address && (
          <div className="flex items-center gap-2">
            <MapPin size={11} className="flex-shrink-0" />
            <span className="truncate">{a.address}</span>
          </div>
        )}
        {a.notes && <p className="text-gray-400 italic mt-1 line-clamp-2">{a.notes}</p>}
      </div>
    </div>
  );
}

function AffiliateModal({ open, onClose, affiliate }) {
  const qc = useQueryClient();
  const isEdit = !!affiliate;
  const [form, setForm] = useState(affiliate || { name: '', type: 'LAB', contactName: '', phone: '', email: '', address: '', notes: '' });
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  React.useEffect(() => {
    setForm(affiliate || { name: '', type: 'LAB', contactName: '', phone: '', email: '', address: '', notes: '' });
  }, [affiliate, open]);

  const { mutate, isPending } = useMutation({
    mutationFn: () => isEdit ? api.put(`/affiliates/${affiliate.id}`, form) : api.post('/affiliates', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliates'] });
      toast.success(isEdit ? 'Affiliate updated' : 'Affiliate added');
      onClose();
    },
    onError: () => toast.error('Failed to save'),
  });

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Affiliate' : 'Add Affiliate'} size="sm">
      <div className="p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
          <input value={form.name} onChange={set('name')} placeholder="e.g. Evercare Lab Ilorin"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 focus:border-[#2D5BFF]" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
          <select value={form.type} onChange={set('type')}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 bg-white">
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Contact Name</label>
            <input value={form.contactName} onChange={set('contactName')}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
            <input value={form.phone} onChange={set('phone')} type="tel"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
          <input value={form.email} onChange={set('email')} type="email"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Address</label>
          <input value={form.address} onChange={set('address')}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <textarea value={form.notes} onChange={set('notes')} rows={2}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none" />
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutate()} disabled={isPending || !form.name}
            className="flex-1 py-2.5 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50">
            {isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Affiliate'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
