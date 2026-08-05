import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Building2, Users, Edit2, Trash2, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';

export default function Departments() {
  const qc = useQueryClient();
  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then(r => r.data),
  });

  const { data: staffData } = useQuery({
    queryKey: ['staff'],
    queryFn: () => api.get('/staff?limit=100').then(r => r.data),
  });

  const depts = data?.departments || data || [];
  const staff = staffData?.staff || staffData || [];

  const { mutate: del } = useMutation({
    mutationFn: id => api.delete(`/departments/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['departments'] }); toast.success('Department deleted'); },
    onError: () => toast.error('Cannot delete — staff or beds may be linked'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Departments</h1>
          <p className="text-sm text-gray-500">{depts.length} departments</p>
        </div>
        <button onClick={() => setModal('add')}
          className="flex items-center gap-2 px-4 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]">
          <Plus size={16} /> Add Department
        </button>
      </div>

      {isLoading ? (
        <div className="py-16 flex justify-center"><Spinner /></div>
      ) : depts.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <Building2 size={36} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No departments yet</p>
          <button onClick={() => setModal('add')} className="mt-3 text-sm text-[#2D5BFF] hover:underline">Create first department</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {depts.map(d => {
            const deptStaff = staff.filter(s => s.departmentId === d.id);
            const head = staff.find(s => s.id === d.headId);
            return (
              <div key={d.id}
                className={`bg-white border-2 rounded-xl p-4 hover:border-[#2D5BFF]/40 transition-colors cursor-pointer ${d.isEmergency ? 'border-red-200' : 'border-gray-200'}`}
                onClick={() => setSelected(d.id === selected ? null : d.id)}
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${d.isEmergency ? 'bg-red-100' : 'bg-[#2D5BFF]/10'}`}>
                      <Building2 size={18} className={d.isEmergency ? 'text-red-600' : 'text-[#2D5BFF]'} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{d.name}</h3>
                      {d.code && <span className="text-xs font-mono text-gray-400">{d.code}</span>}
                      {d.isEmergency && (
                        <span className="ml-2 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">EMERGENCY</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={e => { e.stopPropagation(); setModal(d); }}
                      className="p-1.5 text-gray-400 hover:text-[#2D5BFF] hover:bg-[#2D5BFF]/10 rounded-lg">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={e => { e.stopPropagation(); del(d.id); }}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {d.description && (
                  <p className="text-xs text-gray-500 mb-2 line-clamp-2">{d.description}</p>
                )}

                <div className="flex items-center justify-between text-xs text-gray-500">
                  <div className="flex items-center gap-1">
                    <Users size={12} />
                    <span>{deptStaff.length} staff</span>
                  </div>
                  {head && <span>Head: Dr. {head.lastName}</span>}
                  <ChevronRight size={14} className={`transition-transform ${selected === d.id ? 'rotate-90' : ''}`} />
                </div>

                {/* Expanded staff list */}
                {selected === d.id && deptStaff.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
                    {deptStaff.map(s => (
                      <div key={s.id} className="flex items-center justify-between text-xs">
                        <span className="text-gray-700">{s.firstName} {s.lastName}</span>
                        <span className="text-gray-400">{s.subRole || s.role}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <DeptModal open={!!modal} onClose={() => setModal(null)} dept={modal !== 'add' ? modal : null} staff={staff} />
    </div>
  );
}

function DeptModal({ open, onClose, dept, staff }) {
  const qc = useQueryClient();
  const isEdit = !!dept;
  const [form, setForm] = useState(dept || { name: '', code: '', description: '', headId: '', isEmergency: false });
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const setCheck = k => e => setForm(f => ({ ...f, [k]: e.target.checked }));

  React.useEffect(() => {
    setForm(dept || { name: '', code: '', description: '', headId: '', isEmergency: false });
  }, [dept, open]);

  const { mutate, isPending } = useMutation({
    mutationFn: () => isEdit ? api.put(`/departments/${dept.id}`, form) : api.post('/departments', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['departments'] });
      toast.success(isEdit ? 'Department updated' : 'Department created');
      onClose();
    },
    onError: () => toast.error('Failed to save'),
  });

  const doctors = staff.filter(s => s.subRole === 'DOCTOR' || s.role === 'CLINICIAN');

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Department' : 'Add Department'} size="sm">
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Department Name <span className="text-red-500">*</span></label>
            <input value={form.name} onChange={set('name')} placeholder="e.g. Paediatrics"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Code</label>
            <input value={form.code || ''} onChange={set('code')} placeholder="e.g. PAED"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 uppercase font-mono" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
          <textarea value={form.description || ''} onChange={set('description')} rows={2}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 resize-none" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Department Head</label>
          <select value={form.headId || ''} onChange={set('headId')}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30">
            <option value="">— None —</option>
            {doctors.map(d => (
              <option key={d.id} value={d.id}>Dr. {d.firstName} {d.lastName}</option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.isEmergency || false} onChange={setCheck('isEmergency')}
            className="w-4 h-4 accent-[#2D5BFF]" />
          <span className="text-sm text-gray-700">Emergency department</span>
        </label>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutate()} disabled={isPending || !form.name}
            className="flex-1 py-2.5 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0] disabled:opacity-50">
            {isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Department'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
