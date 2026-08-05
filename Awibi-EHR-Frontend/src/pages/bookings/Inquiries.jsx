import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Phone, Mail, MessageSquare, UserPlus, Check } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import api from '../../lib/api';
import Spinner from '../../components/ui/Spinner';

/**
 * Enquiries from the public page, worked by the records desk.
 *
 * Anything the keyword routing flagged as possibly urgent sits at the top
 * regardless of when it arrived — someone describing chest pain should not be
 * behind eleven appointment questions.
 */

const TABS = [
  ['NEW', 'New'],
  ['CONTACTED', 'Contacted'],
  ['BOOKED', 'Booked'],
  ['CLOSED', 'Closed'],
];

function ContactDialog({ inquiry, onClose }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.put(`/inquiries/${inquiry.id}/status`, { status: 'CONTACTED', responseNote: note }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inquiries'] });
      toast.success('Recorded');
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not record it'),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-md max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-900">Record the conversation</h3>
        <p className="text-xs text-gray-500 mt-1">
          {inquiry.name || 'Unnamed enquiry'}
          {inquiry.phone && ` · ${inquiry.phone}`}
        </p>
        <textarea
          value={note} onChange={(e) => setNote(e.target.value)} rows={4} autoFocus
          placeholder="What was discussed, and what happens next"
          className="mt-3 w-full border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-gray-500"
        />
        <p className="text-xs text-gray-500 mt-1">
          &ldquo;Called them&rdquo; on its own tells the next person nothing.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 border border-gray-300">Cancel</button>
          <button onClick={() => mutate()} disabled={isPending || note.trim().length < 3}
            className="px-4 py-2 text-sm bg-gray-900 text-white disabled:opacity-50">
            {isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Inquiries() {
  const [tab, setTab] = useState('NEW');
  const [contacting, setContacting] = useState(null);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['inquiries', tab],
    queryFn: () => api.get(`/inquiries?status=${tab}`).then((r) => r.data),
    refetchInterval: 60_000,
  });

  const { mutate: close } = useMutation({
    mutationFn: (id) => api.put(`/inquiries/${id}/status`, { status: 'CLOSED' }).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inquiries'] }); toast.success('Closed'); },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not close it'),
  });

  /** Carry what they already told us into registration, rather than retyping it. */
  const register = async (inquiry) => {
    try {
      const { data: prefill } = await api.get(`/inquiries/${inquiry.id}/prefill`);
      if (prefill.phoneNeedsChecking) {
        toast.warning(`Check the phone number they gave: ${prefill.rawPhone}`);
      }
      navigate('/dashboard/patients', { state: { prefill } });
    } catch {
      toast.error('Could not open registration');
    }
  };

  if (isLoading) return <div className="py-16 flex justify-center"><Spinner size="lg" /></div>;

  const inquiries = data?.inquiries || [];
  const counts = data?.counts || {};

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Enquiries</h1>
        <p className="text-sm text-gray-500">
          People who contacted the clinic through the public page
          {counts.urgentWaiting > 0 && (
            <span className="text-red-700 font-medium"> · {counts.urgentWaiting} possibly urgent and unanswered</span>
          )}
        </p>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(([value, label]) => (
          <button
            key={value} onClick={() => setTab(value)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${tab === value ? 'border-gray-900 text-gray-900 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
          >
            {label}
            {counts[value.toLowerCase()] > 0 && (
              <span className="ml-1.5 text-xs text-gray-400">{counts[value.toLowerCase()]}</span>
            )}
          </button>
        ))}
      </div>

      {inquiries.length === 0 ? (
        <div className="border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Nothing here.
        </div>
      ) : (
        <ul className="space-y-2">
          {inquiries.map((q) => (
            <li key={q.id} className={`border bg-white p-4 ${q.isUrgent && q.status === 'NEW' ? 'border-red-300' : 'border-gray-200'}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900">{q.name || 'Name not given'}</span>
                    {q.isUrgent && (
                      <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 bg-red-100 text-red-800 font-medium">
                        <AlertTriangle size={11} /> possibly urgent
                      </span>
                    )}
                    {q.suggestedDepartment && (
                      <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-700">{q.suggestedDepartment}</span>
                    )}
                  </div>

                  {q.symptomsText && <p className="text-sm text-gray-700 mt-1.5">{q.symptomsText}</p>}

                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 flex-wrap">
                    {q.phone && (
                      <a href={`tel:${q.phone}`} className="flex items-center gap-1 hover:text-gray-900">
                        <Phone size={12} /> {q.phone}
                      </a>
                    )}
                    {q.email && (
                      <a href={`mailto:${q.email}`} className="flex items-center gap-1 hover:text-gray-900">
                        <Mail size={12} /> {q.email}
                      </a>
                    )}
                    <span>{formatDistanceToNow(new Date(q.createdAt), { addSuffix: true })}</span>
                  </div>

                  {q.responseNote && (
                    <p className="text-xs text-gray-600 mt-2 border-l-2 border-gray-200 pl-2">{q.responseNote}</p>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {q.status !== 'CLOSED' && q.status !== 'BOOKED' && (
                    <button onClick={() => setContacting(q)}
                      className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
                      <MessageSquare size={14} /> Contacted
                    </button>
                  )}
                  {q.status !== 'BOOKED' && (
                    <button onClick={() => register(q)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-gray-900 text-white text-sm">
                      <UserPlus size={14} /> Register
                    </button>
                  )}
                  {q.status !== 'CLOSED' && (
                    <button onClick={() => close(q.id)} title="Close"
                      className="p-2 border border-gray-300 text-gray-600 hover:bg-gray-50">
                      <Check size={15} />
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {contacting && <ContactDialog inquiry={contacting} onClose={() => setContacting(null)} />}
    </div>
  );
}
