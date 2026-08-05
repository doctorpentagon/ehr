import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, AlertTriangle, X, Send, Archive } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { toast } from 'sonner';
import api from '../../lib/api';
import Spinner from '../../components/ui/Spinner';
import { roleLabel } from '../../lib/permissions';

/**
 * Internal messaging between colleagues in the same facility.
 *
 * This exists because ward conversations that matter currently happen on
 * personal WhatsApp — which puts patient details on personal phones, outside
 * the record and outside the facility's control. It is deliberately plain: an
 * inbox, a compose box, and the ability to say which patient you mean.
 */

function Compose({ replyTo, onClose }) {
  const qc = useQueryClient();
  const [recipientId, setRecipientId] = useState(replyTo?.sender?.id || '');
  const [subject, setSubject] = useState(replyTo?.subject ? `Re: ${replyTo.subject}` : '');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [patientId, setPatientId] = useState(replyTo?.patient?.id || '');
  const [patientQuery, setPatientQuery] = useState('');

  const { data: recipients } = useQuery({
    queryKey: ['message-recipients'],
    queryFn: () => api.get('/messages/recipients').then((r) => r.data?.recipients || []),
  });

  const { data: patients } = useQuery({
    queryKey: ['patients-for-messages', patientQuery],
    queryFn: () => api.get(`/patients?limit=8${patientQuery ? `&search=${encodeURIComponent(patientQuery)}` : ''}`)
      .then((r) => r.data?.patients || []),
    enabled: patientQuery.length >= 2,
  });

  const selectedPatient = (patients || []).find((p) => p.id === patientId) || replyTo?.patient;

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post('/messages', {
      recipientId, subject, body, priority,
      patientId: patientId || undefined,
      parentId: replyTo?.id,
    }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['unread-count'] });
      toast.success('Sent');
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not send the message'),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">{replyTo ? 'Reply' : 'New message'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
        <select value={recipientId} onChange={(e) => setRecipientId(e.target.value)} disabled={Boolean(replyTo)}
          className="w-full border border-gray-300 px-3 py-2 text-sm mb-3 disabled:bg-gray-50 focus:outline-none focus:border-gray-500">
          <option value="">Choose a colleague…</option>
          {(recipients || []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.firstName} {r.lastName} — {roleLabel(r.role, r.subRole)}
            </option>
          ))}
        </select>

        <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
        <input value={subject} onChange={(e) => setSubject(e.target.value)}
          className="w-full border border-gray-300 px-3 py-2 text-sm mb-3 focus:outline-none focus:border-gray-500" />

        <label className="block text-sm font-medium text-gray-700 mb-1">
          About a patient <span className="font-normal text-gray-500">(optional)</span>
        </label>
        {selectedPatient ? (
          <div className="flex items-center justify-between border border-gray-300 px-3 py-2 mb-3">
            <span className="text-sm text-gray-900">
              {selectedPatient.firstName} {selectedPatient.lastName}
              <span className="text-gray-500 text-xs ml-2">{selectedPatient.mrn}</span>
            </span>
            <button onClick={() => { setPatientId(''); setPatientQuery(''); }}
              className="text-gray-400 hover:text-gray-700"><X size={15} /></button>
          </div>
        ) : (
          <>
            <input value={patientQuery} onChange={(e) => setPatientQuery(e.target.value)}
              placeholder="Type a name or hospital number"
              className="w-full border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-gray-500" />
            {(patients || []).length > 0 && (
              <ul className="border border-t-0 border-gray-300 max-h-32 overflow-y-auto mb-3">
                {patients.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => setPatientId(p.id)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                      {p.firstName} {p.lastName} <span className="text-gray-500 text-xs ml-1">{p.mrn}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {(patients || []).length === 0 && <div className="mb-3" />}
          </>
        )}

        <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5}
          className="w-full border border-gray-300 px-3 py-2 text-sm mb-3 focus:outline-none focus:border-gray-500" />

        <label className="flex items-center gap-2 text-sm mb-4 cursor-pointer">
          <input type="checkbox" checked={priority === 'URGENT'}
            onChange={(e) => setPriority(e.target.checked ? 'URGENT' : 'NORMAL')} />
          <span className="text-gray-800">Needs an answer this shift</span>
        </label>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 border border-gray-300">Cancel</button>
          <button onClick={() => mutate()} disabled={isPending || !recipientId || !body.trim()}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-900 text-white disabled:opacity-50">
            <Send size={15} /> {isPending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Messages() {
  const [box, setBox] = useState('inbox');
  const [composing, setComposing] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [openId, setOpenId] = useState(null);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['messages', box],
    queryFn: () => api.get(`/messages?box=${box}`).then((r) => r.data),
    refetchInterval: 60_000,
  });

  const { mutate: markRead } = useMutation({
    mutationFn: (id) => api.put(`/messages/${id}/read`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });

  const { mutate: archive } = useMutation({
    mutationFn: (id) => api.put(`/messages/${id}/archive`).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['messages'] }); toast.success('Archived'); },
  });

  if (isLoading) return <div className="py-16 flex justify-center"><Spinner size="lg" /></div>;

  const messages = data?.messages || [];

  const open = (m) => {
    setOpenId(openId === m.id ? null : m.id);
    if (box === 'inbox' && !m.readAt) markRead(m.id);
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Messages</h1>
          <p className="text-sm text-gray-500">
            Colleagues in this facility
            {data?.unread > 0 && <span className="font-medium text-gray-900"> · {data.unread} unread</span>}
          </p>
        </div>
        <button onClick={() => { setReplyTo(null); setComposing(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm">
          <Plus size={16} /> New message
        </button>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {[['inbox', 'Inbox'], ['sent', 'Sent']].map(([value, label]) => (
          <button key={value} onClick={() => setBox(value)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${box === value ? 'border-gray-900 text-gray-900 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {label}
          </button>
        ))}
      </div>

      {messages.length === 0 ? (
        <div className="border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          {box === 'inbox' ? 'No messages.' : 'You have not sent anything yet.'}
        </div>
      ) : (
        <ul className="border border-gray-200 bg-white divide-y divide-gray-100">
          {messages.map((m) => {
            const unread = box === 'inbox' && !m.readAt;
            const other = box === 'inbox' ? m.sender : m.recipient;
            return (
              <li key={m.id} className={unread ? 'bg-blue-50/40' : ''}>
                <button onClick={() => open(m)} className="w-full text-left px-4 py-3 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm ${unread ? 'font-semibold text-gray-900' : 'text-gray-800'}`}>
                          {other?.firstName} {other?.lastName}
                        </span>
                        <span className="text-xs text-gray-500">{roleLabel(other?.role, other?.subRole)}</span>
                        {m.priority === 'URGENT' && (
                          <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 bg-red-100 text-red-800 font-medium">
                            <AlertTriangle size={11} /> urgent
                          </span>
                        )}
                      </div>
                      {m.subject && (
                        <div className={`text-sm mt-0.5 ${unread ? 'font-medium text-gray-900' : 'text-gray-700'}`}>
                          {m.subject}
                        </div>
                      )}
                      {m.patient && (
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/dashboard/patients/${m.patient.id}`); }}
                          className="text-xs text-blue-700 hover:underline mt-0.5"
                        >
                          {m.patient.firstName} {m.patient.lastName} · {m.patient.mrn}
                        </button>
                      )}
                      {openId !== m.id && (
                        <p className="text-sm text-gray-500 truncate mt-0.5">{m.body}</p>
                      )}
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">
                      {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                </button>

                {openId === m.id && (
                  <div className="px-4 pb-3">
                    <p className="text-sm text-gray-800 whitespace-pre-wrap border-l-2 border-gray-200 pl-3">{m.body}</p>
                    <div className="text-xs text-gray-400 mt-2">{format(new Date(m.createdAt), 'd MMM yyyy, HH:mm')}</div>
                    <div className="flex gap-2 mt-3">
                      {box === 'inbox' && (
                        <button onClick={() => { setReplyTo(m); setComposing(true); }}
                          className="px-3 py-1.5 text-sm bg-gray-900 text-white">Reply</button>
                      )}
                      <button onClick={() => archive(m.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-700">
                        <Archive size={14} /> Archive
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {composing && <Compose replyTo={replyTo} onClose={() => { setComposing(false); setReplyTo(null); }} />}
    </div>
  );
}
